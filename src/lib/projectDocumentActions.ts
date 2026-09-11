import { DEFAULT_PROJECT_NAME } from './brand';
import { buildDefaultFlowWorkspace } from './flowProjectWorkspaces';
import type { FlowProjectDocument } from './projectLibrary';
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectSchema';
import {
  normalizeProjectMediaReferencesForSave,
  resolveProjectMediaReferencesForRestore,
} from './projectMediaReferences';
import { assertProjectDocumentReplacementCandidate, sanitizeProjectDocument } from './projectValidation';
import { migrateLegacyPaperBinaryFields } from '../features/paper/assets/PaperDocumentAssets';
import { paperAssetRepository } from '../features/paper/assets/PaperAssetRuntime';
import {
  PaperAssetPolicyError,
  buildPaperPortableAssetsSection,
  collectMissingPaperAssetDiagnostics,
  importPaperPortableAssetsSection,
  planPaperPortableAssets,
  type PaperPortableAssetsImportResult,
  type PaperPortableAssetsSection,
} from '../features/paper/assets/PaperPortableAssets';
import { mergePaperSnapshotRecovery } from './paperSnapshotRecovery';
import type { PaperDocument } from '../types/paper';
import { useEditorStore } from '../store/editorStore';
import { prepareFlowSnapshotImportedAssets, useFlowStore } from '../store/flowStore';
import { useFlowWorkspaceStore } from '../store/flowWorkspaceStore';
import {
  useImageEditorStore,
  type ImageEditorProjectSnapshot,
  type ImageEditorProjectSnapshotTransaction,
} from '../store/imageEditorStore';
import {
  capturePaperWorkspaceAuthorization,
  isPaperWorkspaceAuthorizationCurrent,
  usePaperStore,
  type PaperWorkspaceAuthorization,
} from '../store/paperStore';
import { useProjectUsageStore } from '../store/projectUsageStore';
import { useProjectHistoryStore } from '../store/projectHistoryStore';
import { PROJECT_HISTORY_SECTION_VERSION } from './projectHistory';
import {
  noteActiveSourceCatalogProjectDocument,
  recordSourceCatalogProjectDocument,
} from '../store/sourceCatalogStore';
import {
  leaseSourceBinProjectSnapshotObjectUrls,
  useSourceBinStore,
  type PreparedSourceBinProjectSnapshot,
} from '../store/sourceBinStore';
import { getEditorAssets } from './editorAssets';
import { getEditorVisualClips } from './manualEditorState';
import { getEditorStageObjects } from './editorStageObjects';
import { ensureBundledFontFaceReferencesRegistered } from './bundledFontLibrary';
import { assertNoConflictingPaperManagedFontDescriptors } from './paperExactManagedFonts';
import { classifyPaperFontPackaging } from './paperManagedFonts';
import { isBinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import {
  collectImageBundledFontFaceReferences,
  collectVideoBundledFontFaceReferences,
  upgradeLegacyBundledFontIssuesInProject,
} from './managedBundledFonts';
import { getFloatingSelection, getSelection } from '../components/ImageEditor/selectionRegistry';
import { requestPaperDestructiveAction } from './paperLossPrevention';
import type { PaperLossSaveResult } from '../store/paperLossPreventionStore';
import type { ImageDocument } from '../types/imageEditor';
import { toImageDocumentWire } from './imageDocumentNativeSync';
import {
  getSourceLibraryRendererNativeVersion,
  setSourceLibraryRendererNativeVersion,
} from './sourceLibraryNativeSync';
import { collectProjectProviderPackSnapshots } from './providerPackProject';

export interface WorkspaceReplacementAuthorization {
  /** Opaque lookup for an exact internally held Image authorization capability. */
  token: string;
}

export interface ProjectReplacementAuthorization {
  paper: PaperWorkspaceAuthorization;
  image: WorkspaceReplacementAuthorization;
}

export type ProjectReplacementRequestGuard = () => boolean;

type ProjectReplacementBookkeepingRollback = () => void;
export type ProjectReplacementTransactionBookkeeping = 'reset-source-library-native-sync';

interface InternalWorkspaceReplacementAuthorization {
  signature: string;
  documentsIdentity: object;
  macrosIdentity: object;
}

interface InternalPaperReplacementAuthorization {
  signature: string;
}

interface InternalProjectReplacementAuthorization {
  paper?: InternalPaperReplacementAuthorization;
  image?: InternalWorkspaceReplacementAuthorization;
}

interface NormalizedProjectDocumentReplacementOptions {
  paper?: InternalPaperReplacementAuthorization;
  imageToken?: string;
  transactionBookkeeping?: ProjectReplacementTransactionBookkeeping;
}

export interface ProjectDocumentReplacementOptions {
  /** Exact Image state covered by an explicit discard/save/recovery decision. */
  imageAuthorization?: WorkspaceReplacementAuthorization;
  /** Exact Paper tab set/content/dirty baseline covered by Paper loss prevention. */
  paperAuthorization?: PaperWorkspaceAuthorization;
  /** Closed, synchronous bookkeeping performed and rolled back by the replacement transaction. */
  transactionBookkeeping?: ProjectReplacementTransactionBookkeeping;
}

type RuntimeDataRecord = Readonly<Record<string, unknown>>;

const LEGACY_BEFORE_REPLACE_ERROR = 'Arbitrary project replacement beforeReplace callbacks are not supported. '
  + 'Use transaction-owned synchronous bookkeeping.';
let untrustedNormalizationDepth = 0;
let replacementRequestSequence = 0;
let imageAuthorizationSequence = 0;
const imageAuthorizationCapabilities = new Map<string, InternalWorkspaceReplacementAuthorization>();

function inspectRuntimeDataRecord(
  value: unknown,
  label: string,
  supportedKeys: ReadonlySet<string>,
): RuntimeDataRecord {
  if (value === undefined) return Object.freeze(Object.create(null) as Record<string, unknown>);
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new Error(`${label} must be a plain data object.`);
  }

  // Reflective compatibility inspection is explicitly untrusted. A Proxy may run arbitrary code
  // from any trap, so no authority captured before this function is accepted by the transaction.
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    if (Reflect.getOwnPropertyDescriptor(prototype, 'beforeReplace')) {
      throw new Error(LEGACY_BEFORE_REPLACE_ERROR);
    }
    throw new Error(`${label} must be a plain data object.`);
  }

  const normalized = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !supportedKeys.has(key)) {
      if (key === 'beforeReplace') throw new Error(LEGACY_BEFORE_REPLACE_ERROR);
      throw new Error(`${label} contains an unsupported option.`);
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new Error(`${label}.${key} must be an inert data property.`);
    }
    normalized[key] = descriptor.value;
  }
  return Object.freeze(normalized);
}

function runUntrustedNormalizationPhase<T>(normalize: () => T): T {
  if (untrustedNormalizationDepth > 0) {
    throw new Error('Re-entrant project replacement option normalization is not supported.');
  }
  untrustedNormalizationDepth += 1;
  try {
    return normalize();
  } finally {
    untrustedNormalizationDepth -= 1;
  }
}

function runStableWorkspaceNormalizationPhase<T>(normalize: () => T): T {
  // Incoming documents/options may be Proxy-backed or expose accessors. Never let their traps
  // mutate a live workspace and then have that newer state silently become the replacement
  // authorization baseline.
  const workspaceToken = captureProjectWorkspaceToken();
  const normalized = runUntrustedNormalizationPhase(normalize);
  if (!isProjectWorkspaceTokenCurrent(workspaceToken)) {
    throw new Error('Project replacement was blocked because the workspace changed after replacement was authorized.');
  }
  return normalized;
}

function optionalString(record: RuntimeDataRecord, key: string, label: string): string | undefined {
  const value = record[key];
  if (value === undefined || typeof value === 'string') return value;
  throw new Error(`${label}.${key} must be a string.`);
}

function optionalFunction<T extends (...args: never[]) => unknown>(
  record: RuntimeDataRecord,
  key: string,
  label: string,
): T | undefined {
  const value = record[key];
  if (value === undefined || typeof value === 'function') return value as T | undefined;
  throw new Error(`${label}.${key} must be a function.`);
}

function normalizePaperAuthorization(value: unknown): InternalPaperReplacementAuthorization | undefined {
  if (value === undefined) return undefined;
  const record = inspectRuntimeDataRecord(
    value,
    'Paper replacement authorization',
    new Set(['activeDocumentId', 'documents', 'signature']),
  );
  if (typeof record.signature !== 'string') {
    throw new Error('Paper replacement authorization.signature must be a string.');
  }
  return Object.freeze({ signature: record.signature });
}

function normalizeImageAuthorizationToken(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const record = inspectRuntimeDataRecord(
    value,
    'Image replacement authorization',
    new Set(['token']),
  );
  if (typeof record.token !== 'string') {
    throw new Error('Image replacement authorization.token must be a string.');
  }
  return record.token;
}

function normalizeTransactionBookkeeping(value: unknown): ProjectReplacementTransactionBookkeeping | undefined {
  if (value === undefined || value === 'reset-source-library-native-sync') return value;
  throw new Error('Unsupported project replacement bookkeeping primitive.');
}

function normalizeProjectDocumentReplacementOptions(
  value: unknown,
): NormalizedProjectDocumentReplacementOptions {
  const record = inspectRuntimeDataRecord(
    value,
    'Project replacement options',
    new Set(['imageAuthorization', 'paperAuthorization', 'transactionBookkeeping']),
  );
  return Object.freeze({
    imageToken: normalizeImageAuthorizationToken(record.imageAuthorization),
    paper: normalizePaperAuthorization(record.paperAuthorization),
    transactionBookkeeping: normalizeTransactionBookkeeping(record.transactionBookkeeping),
  });
}

function assertDirtyImageReplacementAllowed(
  authorization: InternalWorkspaceReplacementAuthorization | undefined,
): void {
  if (authorization) {
    if (isInternalImageReplacementAuthorizationCurrent(authorization)) return;
    throw new Error('Project replacement was blocked because the Image workspace changed after replacement was authorized.');
  }
  const workspaceToken = captureProjectWorkspaceToken();
  const projection = tryBuildDirtyImageReplacementProjection(workspaceToken.image.documents);
  if (!projection || !isProjectWorkspaceTokenCurrent(workspaceToken)) {
    throw new Error('Project replacement was blocked because Image document metadata could not be inspected safely.');
  }
  if (projection.dirtyDocumentCount === 0) return;
  throw new Error(
    `Project replacement was blocked because dirty Image document "${projection.soleDocument?.title ?? 'Untitled Image'}" is still open. `
    + 'Save or discard it explicitly before replacing the project.',
  );
}

function assertDirtyPaperReplacementAllowed(
  authorization: InternalPaperReplacementAuthorization | undefined,
): void {
  if (authorization) {
    if (isInternalPaperReplacementAuthorizationCurrent(authorization)) return;
    throw new Error('Project replacement was blocked because the Paper workspace changed after replacement was authorized.');
  }
  const paperState = usePaperStore.getState();
  const dirtyDocument = paperState.exportSnapshot().documents
    ?.find((document) => paperState.isDocumentDirty(document.id));
  if (!dirtyDocument) return;
  throw new Error(
    `Project replacement was blocked because dirty Paper document "${dirtyDocument.document.title}" is still open. `
    + 'Save or discard it through the Paper loss-prevention policy before replacing the project.',
  );
}

function assertProjectReplacementAllowed(
  paperAuthorization: InternalPaperReplacementAuthorization | undefined,
  imageAuthorization: InternalWorkspaceReplacementAuthorization | undefined,
): void {
  const workspaceToken = captureProjectWorkspaceToken();
  assertDirtyImageReplacementAllowed(imageAuthorization);
  if (!isProjectWorkspaceTokenCurrent(workspaceToken)) {
    throw new Error('Project replacement was blocked because the workspace changed during Image authorization inspection.');
  }
  assertDirtyPaperReplacementAllowed(paperAuthorization);
  if (!isProjectWorkspaceTokenCurrent(workspaceToken)) {
    throw new Error('Project replacement was blocked because the workspace changed during Paper authorization inspection.');
  }
}

function stableReplacementStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableReplacementStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, candidate]) => candidate !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, candidate]) => `${JSON.stringify(key)}:${stableReplacementStringify(candidate)}`).join(',')}}`;
}

function imageDocumentReplacementProjection(document: ImageDocument): unknown {
  // Authorization intentionally relies on sanctioned Image mutations advancing bitmapVersion and
  // replacing store collections. Hashing every full-resolution canvas here would stall project
  // replacement. Raw in-place pixel writes that bypass Image store APIs are out of contract.
  const wire = toImageDocumentWire(document);
  const {
    dirty: _dirty,
    viewport: _viewport,
    activeLayerId: _activeLayerId,
    selectedLayerIds: _selectedLayerIds,
    activeLayerEditTarget: _activeLayerEditTarget,
    hasSelection: _hasSelection,
    selectionVersion: _selectionVersion,
    ...authored
  } = wire;
  return authored;
}

function imageReplacementSignatureFromSnapshot(
  snapshot: Pick<ImageEditorProjectSnapshot, 'documents' | 'activeDocId' | 'quickActionMacros'>,
  includeDirtyBaseline: boolean,
): string {
  return stableReplacementStringify({
    activeDocId: snapshot.activeDocId,
    documents: snapshot.documents.map((document) => ({
      id: document.id,
      ...(includeDirtyBaseline ? { dirty: document.dirty } : {}),
      authored: imageDocumentReplacementProjection(document),
    })),
    quickActionMacros: snapshot.quickActionMacros ?? [],
  });
}

function imageReplacementSignature(): string {
  const state = useImageEditorStore.getState();
  return imageReplacementSignatureFromSnapshot({
    documents: state.documents,
    activeDocId: state.activeDocId,
    quickActionMacros: state.quickActionMacros,
  }, true);
}

function captureInternalImageReplacementAuthorization(): InternalWorkspaceReplacementAuthorization {
  const workspaceToken = captureProjectWorkspaceToken();
  return captureInternalImageReplacementAuthorizationForState(workspaceToken.image);
}

function captureInternalImageReplacementAuthorizationForState(
  state: ReturnType<typeof useImageEditorStore.getState>,
): InternalWorkspaceReplacementAuthorization {
  return Object.freeze({
    signature: imageReplacementSignatureFromSnapshot({
      documents: state.documents,
      activeDocId: state.activeDocId,
      quickActionMacros: state.quickActionMacros,
    }, true),
    documentsIdentity: state.documents,
    macrosIdentity: state.quickActionMacros,
  });
}

function mintImageReplacementAuthorization(
  internalAuthorization = captureInternalImageReplacementAuthorization(),
): WorkspaceReplacementAuthorization {
  imageAuthorizationSequence += 1;
  const token = `${globalThis.crypto?.randomUUID?.() ?? 'image-authorization'}:${imageAuthorizationSequence}`;
  imageAuthorizationCapabilities.set(token, internalAuthorization);
  if (imageAuthorizationCapabilities.size > 256) {
    const oldest = imageAuthorizationCapabilities.keys().next().value;
    if (typeof oldest === 'string') imageAuthorizationCapabilities.delete(oldest);
  }
  return Object.freeze({ token });
}

function consumeImageReplacementAuthorization(
  token: string | undefined,
): InternalWorkspaceReplacementAuthorization | undefined {
  if (!token) return undefined;
  const authorization = imageAuthorizationCapabilities.get(token);
  imageAuthorizationCapabilities.delete(token);
  return authorization;
}

export function captureProjectReplacementAuthorization(): ProjectReplacementAuthorization {
  const workspaceToken = captureProjectWorkspaceToken();
  const paper = capturePaperWorkspaceAuthorization();
  const image = captureInternalImageReplacementAuthorizationForState(workspaceToken.image);
  if (!isProjectWorkspaceTokenCurrent(workspaceToken)
    || !isInternalImageReplacementAuthorizationCurrent(image)) {
    throw new Error('Project replacement authorization was blocked because the workspace changed during metadata inspection.');
  }
  return {
    paper,
    image: mintImageReplacementAuthorization(image),
  };
}

function captureInternalProjectReplacementAuthorization(): Required<InternalProjectReplacementAuthorization> {
  const workspaceToken = captureProjectWorkspaceToken();
  const paper = capturePaperWorkspaceAuthorization();
  const image = captureInternalImageReplacementAuthorizationForState(workspaceToken.image);
  if (!isProjectWorkspaceTokenCurrent(workspaceToken)
    || !isInternalImageReplacementAuthorizationCurrent(image)) {
    throw new Error('Project replacement authorization was blocked because the workspace changed during metadata inspection.');
  }
  return Object.freeze({
    paper: Object.freeze({ signature: paper.signature }),
    image,
  });
}

function isInternalPaperReplacementAuthorizationCurrent(
  authorization: InternalPaperReplacementAuthorization,
): boolean {
  return authorization.signature === capturePaperWorkspaceAuthorization().signature;
}

function isInternalImageReplacementAuthorizationCurrent(
  authorization: InternalWorkspaceReplacementAuthorization,
): boolean {
  const state = useImageEditorStore.getState();
  try {
    return authorization.signature === imageReplacementSignature()
      && authorization.documentsIdentity === state.documents
      && authorization.macrosIdentity === state.quickActionMacros;
  } catch {
    return false;
  }
}

export function isPaperReplacementAuthorizationCurrent(
  authorization: PaperWorkspaceAuthorization,
): boolean {
  return isPaperWorkspaceAuthorizationCurrent(authorization);
}

export function isImageReplacementAuthorizationCurrent(
  authorization: WorkspaceReplacementAuthorization,
): boolean {
  const internal = imageAuthorizationCapabilities.get(authorization.token);
  return Boolean(internal && isInternalImageReplacementAuthorizationCurrent(internal));
}

/** True only when live Image authored state is still the exact snapshot acknowledged by project save. */
export function isCurrentImageWorkspaceAtProjectSnapshot(
  snapshot: ImageEditorProjectSnapshot | undefined,
): boolean {
  if (!snapshot) return useImageEditorStore.getState().documents.length === 0;
  const current = useImageEditorStore.getState();
  return imageReplacementSignatureFromSnapshot({
    documents: current.documents,
    activeDocId: current.activeDocId,
    quickActionMacros: current.quickActionMacros,
  }, false) === imageReplacementSignatureFromSnapshot(snapshot, false);
}

export async function buildCurrentProjectDocument(options: {
  id?: string;
  name?: string;
  includeAssetData?: boolean;
  /**
   * Explicit portable-export flows fail closed when a Paper font's rights forbid packaging or a
   * reachable managed record is missing. Plain Save never fails for policy reasons; it records
   * exclusions explicitly in the section instead.
   */
  strictPaperAssets?: boolean;
} = {}): Promise<FlowProjectDocument> {
  const name = options.name?.trim() || `${DEFAULT_PROJECT_NAME} ${new Date().toLocaleString()}`;
  const savedAt = Date.now();
  const flow = useFlowStore.getState().exportProjectFlowSnapshot();
  const flowWorkspaceStore = useFlowWorkspaceStore.getState();
  const flowWorkspaces = flowWorkspaceStore.exportProjectSnapshot(flow);

  const document: FlowProjectDocument = {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: options.id ?? globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}`,
    name,
    savedAt,
    flow,
    flowWorkspaces,
    activeFlowWorkspaceId: flowWorkspaceStore.activeWorkspaceId ?? flowWorkspaces[0]?.id,
    providerPacks: collectProjectProviderPackSnapshots({ nodes: flow.nodes, flowWorkspaces }),
    editor: useEditorStore.getState().exportWorkspaceSnapshot(),
    sourceBin: await useSourceBinStore.getState().exportProjectSnapshot({
      includeAssetData: options.includeAssetData,
    }),
    usageLedger: useProjectUsageStore.getState().exportSnapshot(),
    paper: usePaperStore.getState().exportSnapshot(),
    imageEditor: await useImageEditorStore.getState().exportProjectSnapshotWithPixels(),
  };

  const projectHistoryStore = useProjectHistoryStore.getState();
  if (projectHistoryStore.records.length > 0 || projectHistoryStore.branchedFrom) {
    document.projectHistory = {
      version: PROJECT_HISTORY_SECTION_VERSION,
      revisions: projectHistoryStore.records,
      ...(projectHistoryStore.branchedFrom ? { branchedFrom: projectHistoryStore.branchedFrom } : {}),
    };
  }

  const normalized = normalizeProjectMediaReferencesForSave(document).document;
  // Enumerate from the NORMALIZED Paper documents: reference normalization can remap a managed
  // locator to a durable external URL, and the section must carry exactly what reopen will need.
  const paperAssets = await buildProjectPaperPortableAssets(normalized.paper, {
    strict: options.strictPaperAssets,
  });
  const finalDocument = { ...normalized, ...(paperAssets ? { paperAssets } : {}) };
  // Cross-project Source Library catalogue (MH-085): every canonical save/autosave/export
  // records its Source Library metadata. The recorder is failure-isolated and never blocks save.
  recordSourceCatalogProjectDocument(finalDocument);
  return finalDocument;
}

function collectProjectPaperDocuments(paper: FlowProjectDocument['paper']): PaperDocument[] {
  if (!paper?.document) return [];
  const documents = (paper.documents ?? [])
    .map((workspaceDocument) => workspaceDocument.document)
    .filter((document): document is PaperDocument => Boolean(document));
  return [paper.document, ...documents];
}

/**
 * Applies the same fail-closed policy to an already-saved project that strict live export applies
 * while building a fresh one. Saved rows cannot be rebuilt from the current workspace, so verify
 * that every reachable managed Paper record is present in their embedded section and honor any
 * exclusions or missing records that ordinary Save recorded without blocking.
 */
export function assertSavedProjectPaperAssetsPortable(document: FlowProjectDocument): void {
  const documents = collectProjectPaperDocuments(document.paper);
  if (documents.length === 0) return;

  const plan = planPaperPortableAssets(documents);
  const exclusions = [...plan.exclusions];
  const exclusionKeys = new Set(exclusions.map((entry) => `${entry.faceId}:${entry.assetId}`));
  for (const exclusion of document.paperAssets?.excludedFonts ?? []) {
    const key = `${exclusion.faceId}:${exclusion.assetId}`;
    if (!exclusionKeys.has(key)) {
      exclusionKeys.add(key);
      exclusions.push(exclusion);
    }
  }

  const packagedRefs = new Map((document.paperAssets?.assets ?? []).map((entry) => [entry.ref.id, entry.ref]));
  const missing = [...(document.paperAssets?.missingAssets ?? [])];
  const missingIds = new Set(missing.map((entry) => entry.id));
  for (const source of plan.sources) {
    const packagedRef = packagedRefs.get(source.id);
    const matchesDocumentRef = !source.ref || (
      packagedRef?.sha256 === source.ref.sha256
      && packagedRef.byteLength === source.ref.byteLength
    );
    if (packagedRef && matchesDocumentRef) continue;
    if (!missingIds.has(source.id)) {
      missingIds.add(source.id);
      missing.push({
        id: source.id,
        context: `${source.role} "${source.label}" in document "${source.documentTitle}"`,
      });
    }
  }

  if (exclusions.length > 0 || missing.length > 0) {
    throw new PaperAssetPolicyError(exclusions, missing);
  }
}

async function buildProjectPaperPortableAssets(
  paper: FlowProjectDocument['paper'],
  options: { strict?: boolean },
): Promise<PaperPortableAssetsSection | undefined> {
  const documents = collectProjectPaperDocuments(paper);
  if (documents.length === 0) return undefined;
  const built = await buildPaperPortableAssetsSection(documents, paperAssetRepository, {
    strict: options.strict,
  });
  return built.section;
}

const LEGACY_PAPER_ASSETS_UNAVAILABLE_ERROR =
  'The selected project references managed Paper assets but omits the required paperAssets section.';

/**
 * Projects saved before the portable Paper section existed can still reopen on the profile that
 * created them: their content-addressed bytes already live in the local repository. Rebuild the
 * section in memory only after replacement was authorized, requiring every packageable record to
 * verify. The next ordinary Save then persists the section and makes the project self-contained.
 * A copied legacy project whose local bytes are absent continues to fail closed.
 */
async function migrateLegacyProjectPaperAssets(
  document: FlowProjectDocument,
): Promise<FlowProjectDocument> {
  if (document.paperAssets) return document;
  const documents = collectProjectPaperDocuments(document.paper);
  if (documents.length === 0) return document;

  const plan = planPaperPortableAssets(documents);
  if (plan.sources.length === 0 && plan.exclusions.length === 0) return document;

  try {
    const built = await buildPaperPortableAssetsSection(documents, paperAssetRepository);
    if (!built.section || built.missing.length > 0) {
      throw new Error(built.missing.map((entry) => entry.id).join(', '));
    }
    return { ...document, paperAssets: built.section };
  } catch (error) {
    const detail = error instanceof Error && error.message
      ? ` Exact local records could not be verified: ${error.message}`
      : '';
    throw new Error(`${LEGACY_PAPER_ASSETS_UNAVAILABLE_ERROR}${detail}`);
  }
}

function rollbackBookkeeping(rollback: ProjectReplacementBookkeepingRollback | undefined): void {
  if (!rollback) return;
  try {
    rollback();
  } catch (error) {
    console.error('[project-replacement] Bookkeeping rollback failed.', error);
  }
}

function runProjectReplacementBookkeeping(
  transactionBookkeeping: ProjectReplacementTransactionBookkeeping | undefined,
): ProjectReplacementBookkeepingRollback | undefined {
  if (!transactionBookkeeping) return undefined;

  switch (transactionBookkeeping) {
    case 'reset-source-library-native-sync': {
      const previousVersion = getSourceLibraryRendererNativeVersion();
      const previousStatus = useSourceBinStore.getState().nativeSyncStatus;
      setSourceLibraryRendererNativeVersion(0);
      useSourceBinStore.getState().setNativeSyncStatus({ state: 'idle' });
      return () => {
        setSourceLibraryRendererNativeVersion(previousVersion);
        useSourceBinStore.getState().setNativeSyncStatus(previousStatus);
      };
    }
    default: {
      const unsupported: never = transactionBookkeeping;
      throw new Error(`Unsupported project replacement bookkeeping primitive: ${unsupported}`);
    }
  }
}

function normalizeIncomingProjectDocument(document: unknown): FlowProjectDocument {
  const candidateName = (document as { name?: unknown } | null | undefined)?.name;
  const fallbackName = typeof candidateName === 'string' ? candidateName : DEFAULT_PROJECT_NAME;
  return sanitizeProjectDocument(document ?? {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}`,
    name: DEFAULT_PROJECT_NAME,
    savedAt: Date.now(),
    flow: { version: 3, nodes: [], edges: [] },
  }, fallbackName);
}

interface ProjectWorkspaceToken {
  flow: ReturnType<typeof useFlowStore.getState>;
  flowWorkspaces: ReturnType<typeof useFlowWorkspaceStore.getState>;
  editor: ReturnType<typeof useEditorStore.getState>;
  source: ReturnType<typeof useSourceBinStore.getState>;
  usage: ReturnType<typeof useProjectUsageStore.getState>;
  paper: ReturnType<typeof usePaperStore.getState>;
  image: ReturnType<typeof useImageEditorStore.getState>;
  sourceNativeVersion: number;
}

class ProjectReplacementPreparationStaleError extends Error {
  constructor() {
    super('The workspace changed while project replacement was prepared.');
  }
}

function beginProjectReplacementRequest(): number {
  replacementRequestSequence += 1;
  return replacementRequestSequence;
}

function isProjectReplacementRequestCurrent(requestId: number): boolean {
  return requestId === replacementRequestSequence;
}

function captureProjectWorkspaceToken(): ProjectWorkspaceToken {
  return {
    flow: useFlowStore.getState(),
    flowWorkspaces: useFlowWorkspaceStore.getState(),
    editor: useEditorStore.getState(),
    source: useSourceBinStore.getState(),
    usage: useProjectUsageStore.getState(),
    paper: usePaperStore.getState(),
    image: useImageEditorStore.getState(),
    sourceNativeVersion: getSourceLibraryRendererNativeVersion(),
  };
}

function isProjectWorkspaceTokenCurrent(token: ProjectWorkspaceToken): boolean {
  return token.flow === useFlowStore.getState()
    && token.flowWorkspaces === useFlowWorkspaceStore.getState()
    && token.editor === useEditorStore.getState()
    && token.source === useSourceBinStore.getState()
    && token.usage === useProjectUsageStore.getState()
    && token.paper === usePaperStore.getState()
    && token.image === useImageEditorStore.getState()
    && token.sourceNativeVersion === getSourceLibraryRendererNativeVersion();
}

/** Paper has its own exact authorization loop, so a Paper-only callback race re-enters that policy. */
function isImageConfirmationEnvironmentTokenCurrent(token: ProjectWorkspaceToken): boolean {
  return token.flow === useFlowStore.getState()
    && token.flowWorkspaces === useFlowWorkspaceStore.getState()
    && token.editor === useEditorStore.getState()
    && token.source === useSourceBinStore.getState()
    && token.usage === useProjectUsageStore.getState()
    && token.image === useImageEditorStore.getState()
    && token.sourceNativeVersion === getSourceLibraryRendererNativeVersion();
}

export interface PreparedProjectDocumentTransaction {
  readonly document: FlowProjectDocument;
  assertCanCommit: () => void;
  commit: () => void;
  finalize: () => void;
  rollback: () => Promise<void>;
}

interface ProjectStoreIdentity {
  flowNodes: unknown;
  flowEdges: unknown;
  workspaces: unknown;
  activeWorkspaceId: string | null;
  editor: unknown;
  sourceBins: unknown;
  sourceDismissals: unknown;
  sourceNativeVersion: number;
  usageLedger: unknown;
  paperDocuments: unknown;
  paperDocument: unknown;
  imageDocuments: unknown;
  imageActiveDocId: string | null;
  imageUndoStacks: unknown;
  imageRedoStacks: unknown;
  imageQuickActionMacros: unknown;
  imageActiveQuickActionRecording: unknown;
  imageGenerativeFillDismissedByDocId: unknown;
  imageSelections: ReadonlyArray<readonly [string, unknown, unknown]>;
  projectHistory: unknown;
}

function captureProjectStoreIdentity(): ProjectStoreIdentity {
  const flow = useFlowStore.getState();
  const workspaces = useFlowWorkspaceStore.getState();
  const editor = useEditorStore.getState();
  const source = useSourceBinStore.getState();
  const usage = useProjectUsageStore.getState();
  const paper = usePaperStore.getState();
  const image = useImageEditorStore.getState();
  return {
    flowNodes: flow.nodes,
    flowEdges: flow.edges,
    workspaces: workspaces.workspaces,
    activeWorkspaceId: workspaces.activeWorkspaceId,
    editor: editor,
    sourceBins: source.bins,
    sourceDismissals: source.dismissedSourceKeys,
    sourceNativeVersion: getSourceLibraryRendererNativeVersion(),
    usageLedger: usage.ledger,
    paperDocuments: paper.documents,
    paperDocument: paper.document,
    imageDocuments: image.documents,
    imageActiveDocId: image.activeDocId,
    imageUndoStacks: image.undoStacks,
    imageRedoStacks: image.redoStacks,
    imageQuickActionMacros: image.quickActionMacros,
    imageActiveQuickActionRecording: image.activeQuickActionRecording,
    imageGenerativeFillDismissedByDocId: image.generativeFillDismissedByDocId,
    imageSelections: image.documents.map((document) => [
      document.id,
      getSelection(document.id),
      getFloatingSelection(document.id),
    ] as const),
    projectHistory: useProjectHistoryStore.getState().records,
  };
}

function sameProjectStoreIdentityField(
  left: ProjectStoreIdentity,
  right: ProjectStoreIdentity,
  key: keyof ProjectStoreIdentity,
): boolean {
  if (key !== 'imageSelections') return left[key] === right[key];
  return left.imageSelections.length === right.imageSelections.length
    && left.imageSelections.every(([documentId, selection, floatingSelection], index) => (
      right.imageSelections[index]?.[0] === documentId
      && right.imageSelections[index]?.[1] === selection
      && right.imageSelections[index]?.[2] === floatingSelection
    ));
}

function sameProjectStoreIdentity(left: ProjectStoreIdentity, right: ProjectStoreIdentity): boolean {
  return (Object.keys(left) as Array<keyof ProjectStoreIdentity>)
    .every((key) => sameProjectStoreIdentityField(left, right, key));
}

type ProjectStoreIdentityKey = keyof ProjectStoreIdentity;

function sameProjectStoreIdentityFields(
  left: ProjectStoreIdentity,
  right: ProjectStoreIdentity,
  keys: readonly ProjectStoreIdentityKey[],
): boolean {
  return keys.every((key) => sameProjectStoreIdentityField(left, right, key));
}

function commitWithoutObserverFailure(commit: () => void): void {
  try {
    commit();
  } catch {
    // Zustand observers run synchronously after a state replacement and may throw. Every store
    // commit below is independently continued so one bad observer cannot expose a half-project.
  }
}

export async function prepareProjectDocumentTransaction(
  document: unknown,
  options: ProjectDocumentReplacementOptions = {},
): Promise<PreparedProjectDocumentTransaction> {
  const normalized = runStableWorkspaceNormalizationPhase(() => ({
    document: normalizeIncomingProjectDocument(document),
    options: normalizeProjectDocumentReplacementOptions(options),
  }));
  const requestId = beginProjectReplacementRequest();
  const imageAuthorization = consumeImageReplacementAuthorization(normalized.options.imageToken);
  return prepareNormalizedProjectDocumentTransaction(
    requestId,
    normalized.document,
    normalized.options.paper,
    imageAuthorization,
    normalized.options.transactionBookkeeping,
  );
}

async function prepareNormalizedProjectDocumentTransaction(
  requestId: number,
  sanitizedDocument: FlowProjectDocument,
  paperAuthorization: InternalPaperReplacementAuthorization | undefined,
  imageAuthorization: InternalWorkspaceReplacementAuthorization | undefined,
  transactionBookkeeping: ProjectReplacementTransactionBookkeeping | undefined,
  requestGuard?: ProjectReplacementRequestGuard,
): Promise<PreparedProjectDocumentTransaction> {
  assertGuardedReplacementRequestCurrent(requestId, requestGuard);
  assertProjectReplacementAllowed(paperAuthorization, imageAuthorization);
  const baseIdentity = captureProjectStoreIdentity();
  // Coarse whole-store staleness for the async preparation window: any store-state churn (even
  // non-authored, like sync status or the native Source version) invalidates the prepared commit.
  const preparationToken = captureProjectWorkspaceToken();
  let preparedDocument = sanitizedDocument;
  await upgradeLegacyBundledFontIssuesInProject(preparedDocument);
  assertGuardedReplacementRequestCurrent(requestId, requestGuard);
  preparedDocument = await migrateLegacyProjectPaperAssets(preparedDocument);
  assertGuardedReplacementRequestCurrent(requestId, requestGuard);
  assertPortablePaperFontRecordsPresent(preparedDocument.paper, preparedDocument.paperAssets);
  for (const paperDocument of collectProjectPaperDocuments(preparedDocument.paper)) {
    assertNoConflictingPaperManagedFontDescriptors(paperDocument.importedFonts);
  }
  let paperAssetsImport: PaperPortableAssetsImportResult | undefined;
  let paperAssetsFinalized = false;
  let paperAssetsRollbackPromise: Promise<void> | undefined;
  const rollbackPaperAssets = (): Promise<void> => {
    if (paperAssetsFinalized || !paperAssetsImport) return Promise.resolve();
    paperAssetsRollbackPromise ??= paperAssetsImport.rollback();
    return paperAssetsRollbackPromise;
  };

  const preparedStores = await (async () => {
    // Paper bytes are validated and staged before any renderer store can change. They remain
    // provisional until finalize(), so a canceled native handoff or any later preparation failure
    // can restore the repository exactly to its pre-open state.
    if (preparedDocument.paperAssets) {
      paperAssetsImport = await importPaperPortableAssetsSection(
        preparedDocument.paperAssets,
        paperAssetRepository,
      );
      assertGuardedReplacementRequestCurrent(requestId, requestGuard);
    }
    if (preparedDocument.paper?.document) {
      preparedDocument = await migrateProjectPaperDocuments(preparedDocument);
      assertGuardedReplacementRequestCurrent(requestId, requestGuard);
    }

    const imageFontReferences = collectImageBundledFontFaceReferences(preparedDocument.imageEditor?.documents ?? []);
    const flowSnapshots = [preparedDocument.flow, ...(preparedDocument.flowWorkspaces ?? []).map((workspace) => workspace.flow)];
    const videoFontReferences = flowSnapshots.flatMap((flow) => flow.nodes.flatMap((node) => (
      collectVideoBundledFontFaceReferences({
        assets: getEditorAssets(node.data),
        visualClips: getEditorVisualClips(node.data),
        stageObjects: getEditorStageObjects(node.data),
      })
    )));
    await ensureBundledFontFaceReferencesRegistered([...imageFontReferences, ...videoFontReferences]);
    assertGuardedReplacementRequestCurrent(requestId, requestGuard);
    preparedDocument = {
      ...preparedDocument,
      paper: await attachPaperMissingAssetDiagnostics(
        preparedDocument.paper,
        preparedDocument.paperAssets,
      ),
    };

    const preparedSource = await useSourceBinStore.getState().prepareProjectSnapshot(preparedDocument.sourceBin);
    assertGuardedReplacementRequestCurrent(requestId, requestGuard);
    const releasePreparedSourceUrls = leaseSourceBinProjectSnapshotObjectUrls(preparedSource);
    const sourceItems = preparedSource.bins.flatMap((bin) => bin.items);
    try {
      preparedDocument = resolveProjectMediaReferencesForRestore(preparedDocument, sourceItems);
      const preparedWorkspaces = await Promise.all(
        (preparedDocument.flowWorkspaces ?? [buildDefaultFlowWorkspace(preparedDocument.flow)])
          .map(async (workspace) => ({
            ...workspace,
            flow: await prepareFlowSnapshotImportedAssets(workspace.flow, sourceItems),
          })),
      );
      const activeWorkspace = preparedWorkspaces.find((workspace) => workspace.id === preparedDocument.activeFlowWorkspaceId)
        ?? preparedWorkspaces[0];
      const preparedFlow = activeWorkspace?.flow
        ?? await prepareFlowSnapshotImportedAssets(preparedDocument.flow, sourceItems);
      preparedDocument = {
        ...preparedDocument,
        flow: preparedFlow,
        flowWorkspaces: preparedWorkspaces,
        activeFlowWorkspaceId: activeWorkspace?.id,
      };
      const preparedImage = await useImageEditorStore.getState().prepareProjectSnapshotWithPixels(preparedDocument.imageEditor);
      try {
        assertGuardedReplacementRequestCurrent(requestId, requestGuard);
      } catch (error) {
        useImageEditorStore.getState().disposePreparedProjectSnapshotWithPixels(preparedImage);
        throw error;
      }
      return {
        preparedFlow,
        preparedImage,
        preparedSource,
        preparedWorkspaces,
        releasePreparedSourceUrls,
      };
    } catch (error) {
      releasePreparedSourceUrls();
      throw error;
    }
  })().catch(async (error) => {
    await rollbackPaperAssets();
    throw error;
  });
  const {
    preparedFlow,
    preparedImage,
    preparedSource,
    preparedWorkspaces,
    releasePreparedSourceUrls,
  } = preparedStores;

  const previous = {
    flow: useFlowStore.getState().exportProjectFlowSnapshot(),
    flowWorkspaces: useFlowWorkspaceStore.getState().exportProjectSnapshot(useFlowStore.getState().exportProjectFlowSnapshot()),
    activeFlowWorkspaceId: useFlowWorkspaceStore.getState().activeWorkspaceId,
    editor: useEditorStore.getState().exportWorkspaceSnapshot(),
    source: {
      bins: useSourceBinStore.getState().bins,
      dismissedSourceKeys: useSourceBinStore.getState().dismissedSourceKeys,
    } satisfies PreparedSourceBinProjectSnapshot,
    usage: useProjectUsageStore.getState().exportSnapshot(),
    // Local persistence baselines ride along so a rollback restores each tab's exact
    // dirty/save state instead of silently marking edited tabs clean.
    paper: usePaperStore.getState().exportSnapshot({ includeLocalPersistence: true }),
    projectHistory: useProjectHistoryStore.getState().captureSnapshot(),
  };
  const releasePreviousSourceUrls = leaseSourceBinProjectSnapshotObjectUrls(previous.source, {
    adoptSnapshotOwnership: true,
  });
  const appliedStores: Array<{
    keys: readonly ProjectStoreIdentityKey[];
    postIdentity: ProjectStoreIdentity;
    restore: () => void;
    settleSkippedRollback?: () => void;
  }> = [];
  let imageTransaction: ImageEditorProjectSnapshotTransaction | undefined;
  let bookkeepingRollback: ProjectReplacementBookkeepingRollback | undefined;
  let committed = false;
  let settled = false;

  const releaseSourceUrlLeases = () => {
    if (settled) return;
    settled = true;
    try {
      releasePreparedSourceUrls();
    } finally {
      releasePreviousSourceUrls();
    }
  };

  const rollbackAppliedStores = () => {
    for (const applied of [...appliedStores].reverse()) {
      if (sameProjectStoreIdentityFields(captureProjectStoreIdentity(), applied.postIdentity, applied.keys)) {
        commitWithoutObserverFailure(applied.restore);
      } else {
        applied.settleSkippedRollback?.();
      }
    }
    appliedStores.length = 0;
    committed = false;
    rollbackBookkeeping(bookkeepingRollback);
    bookkeepingRollback = undefined;
  };

  const applyStore = (
    keys: readonly ProjectStoreIdentityKey[],
    apply: () => void,
    restore: () => void,
    settleSkippedRollback?: () => void,
  ) => {
    const before = captureProjectStoreIdentity();
    if (!sameProjectStoreIdentityFields(before, baseIdentity, keys)) {
      throw new Error('A project store changed while the replacement was committing. Retry the project switch.');
    }
    let observerError: unknown;
    try {
      apply();
    } catch (error) {
      observerError = error;
    }
    const postIdentity = captureProjectStoreIdentity();
    if (observerError && sameProjectStoreIdentityFields(before, postIdentity, keys)) {
      throw observerError;
    }
    appliedStores.push({ keys, postIdentity, restore, settleSkippedRollback });
  };

  const assertCanCommit = () => {
    assertGuardedReplacementRequestCurrent(requestId, requestGuard);
    assertProjectReplacementAllowed(paperAuthorization, imageAuthorization);
    if (!isProjectWorkspaceTokenCurrent(preparationToken)) {
      throw new ProjectReplacementPreparationStaleError();
    }
    if (!sameProjectStoreIdentity(baseIdentity, captureProjectStoreIdentity())) {
      throw new Error('The current project changed while the replacement was being prepared. Retry the project switch.');
    }
  };

  const commit = () => {
    if (committed) return;
    if (settled) {
      throw new Error('This project replacement transaction has already been settled.');
    }
    assertCanCommit();
    try {
      bookkeepingRollback = runProjectReplacementBookkeeping(transactionBookkeeping);
      applyStore(
        ['sourceBins', 'sourceDismissals'],
        () => useSourceBinStore.getState().commitPreparedProjectSnapshot(preparedSource, { publishNative: false }),
        () => useSourceBinStore.getState().commitPreparedProjectSnapshot(previous.source, { publishNative: false }),
      );
      applyStore(
        ['workspaces', 'activeWorkspaceId'],
        () => useFlowWorkspaceStore.getState().hydrateProjectSnapshot({
          workspaces: preparedWorkspaces,
          activeWorkspaceId: preparedDocument.activeFlowWorkspaceId,
        }),
        () => useFlowWorkspaceStore.getState().hydrateProjectSnapshot({
          workspaces: previous.flowWorkspaces,
          activeWorkspaceId: previous.activeFlowWorkspaceId,
        }),
      );
      applyStore(
        ['flowNodes', 'flowEdges'],
        () => useFlowStore.getState().replaceFlowSnapshot(preparedFlow),
        () => useFlowStore.getState().replaceFlowSnapshot(previous.flow),
      );
      applyStore(
        ['editor'],
        () => useEditorStore.getState().restoreWorkspaceSnapshot(preparedDocument.editor),
        () => useEditorStore.getState().restoreWorkspaceSnapshot(previous.editor),
      );
      applyStore(
        ['usageLedger'],
        () => useProjectUsageStore.getState().restoreSnapshot(preparedDocument.usageLedger),
        () => useProjectUsageStore.getState().restoreSnapshot(previous.usage),
      );
      applyStore(
        ['paperDocuments', 'paperDocument'],
        () => usePaperStore.getState().restoreSnapshot(preparedDocument.paper),
        () => usePaperStore.getState().restoreSnapshot(previous.paper, { baseline: 'preserve' }),
      );
      applyStore(
        [
          'imageDocuments',
          'imageActiveDocId',
          'imageUndoStacks',
          'imageRedoStacks',
          'imageQuickActionMacros',
          'imageActiveQuickActionRecording',
          'imageGenerativeFillDismissedByDocId',
          'imageSelections',
        ],
        () => {
          imageTransaction = useImageEditorStore.getState()
            .commitPreparedProjectSnapshotWithPixels(preparedImage);
        },
        () => imageTransaction?.rollback(),
        () => imageTransaction?.finalize(),
      );
      applyStore(
        ['projectHistory'],
        () => useProjectHistoryStore.getState().hydrateFromSection(preparedDocument.projectHistory),
        () => useProjectHistoryStore.getState().restoreSnapshot(previous.projectHistory),
      );
      committed = true;
    } catch (error) {
      rollbackAppliedStores();
      useImageEditorStore.getState().disposePreparedProjectSnapshotWithPixels(preparedImage);
      releaseSourceUrlLeases();
      void rollbackPaperAssets();
      throw error;
    }
  };

  return {
    document: preparedDocument,
    assertCanCommit,
    commit,
    finalize: () => {
      if (!committed) return;
      paperAssetsFinalized = true;
      bookkeepingRollback = undefined;
      try {
        imageTransaction?.finalize();
      } finally {
        releaseSourceUrlLeases();
      }
    },
    rollback: async () => {
      if (settled) {
        await rollbackPaperAssets();
        return;
      }
      try {
        if (committed) rollbackAppliedStores();
      } finally {
        try {
          useImageEditorStore.getState().disposePreparedProjectSnapshotWithPixels(preparedImage);
        } finally {
          releaseSourceUrlLeases();
        }
      }
      await rollbackPaperAssets();
    },
  };
}

async function restoreNormalizedProjectDocument(
  requestId: number,
  sanitizedDocument: FlowProjectDocument,
  paperAuthorization: InternalPaperReplacementAuthorization | undefined,
  imageAuthorization: InternalWorkspaceReplacementAuthorization | undefined,
  transactionBookkeeping: ProjectReplacementTransactionBookkeeping | undefined,
  operationKind: 'restore' | 'reset' = 'restore',
  requestGuard?: ProjectReplacementRequestGuard,
): Promise<void> {
  const transaction = await prepareNormalizedProjectDocumentTransaction(
    requestId,
    sanitizedDocument,
    paperAuthorization,
    imageAuthorization,
    transactionBookkeeping,
    requestGuard,
  );
  try {
    transaction.commit();
    transaction.finalize();
  } catch (error) {
    await transaction.rollback();
    const message = error instanceof Error
      ? error.message
      : operationKind === 'reset' ? 'Unknown reset error' : 'Unknown restore error';
    throw new Error(operationKind === 'reset'
      ? `The project could not be reset safely. Previous workspace was left unchanged. ${message}`
      : `The selected project could not be restored safely. Previous workspace was left unchanged. ${message}`);
  }
  // The replacement settled irreversibly: the opened project becomes the catalogue's active
  // identity and its Source Library metadata is recorded (MH-085). Failure-isolated.
  noteActiveSourceCatalogProjectDocument(transaction.document);
}

export async function restoreProjectDocument(
  document: unknown,
  options: ProjectDocumentReplacementOptions = {},
): Promise<void> {
  const normalized = runStableWorkspaceNormalizationPhase(() => ({
    document: normalizeIncomingProjectDocument(document),
    options: normalizeProjectDocumentReplacementOptions(options),
  }));
  const requestId = beginProjectReplacementRequest();
  const imageAuthorization = consumeImageReplacementAuthorization(normalized.options.imageToken);
  return restoreNormalizedProjectDocument(
    requestId,
    normalized.document,
    normalized.options.paper,
    imageAuthorization,
    normalized.options.transactionBookkeeping,
  );
}

export async function resetProjectDocument(
  options: ProjectDocumentReplacementOptions = {},
): Promise<void> {
  const normalized = runStableWorkspaceNormalizationPhase(() => ({
    document: normalizeIncomingProjectDocument(undefined),
    options: normalizeProjectDocumentReplacementOptions(options),
  }));
  const requestId = beginProjectReplacementRequest();
  const imageAuthorization = consumeImageReplacementAuthorization(normalized.options.imageToken);
  return restoreNormalizedProjectDocument(
    requestId,
    normalized.document,
    normalized.options.paper,
    imageAuthorization,
    normalized.options.transactionBookkeeping,
    'reset',
  );
}

/** A current portable section is a self-contained contract. Only genuinely older projects omit it. */
function assertPortablePaperFontRecordsPresent(
  paper: FlowProjectDocument['paper'],
  section: PaperPortableAssetsSection | undefined,
): void {
  if (!section) return;
  const packaged = new Set(section.assets.map((entry) => entry.ref.id));
  const declaredMissing = new Set((section.missingAssets ?? []).map((entry) => entry.id));
  for (const document of collectProjectPaperDocuments(paper)) {
    for (const face of document.importedFonts ?? []) {
      // An explicitly excluded non-portable face is retained as a truthful compatibility diagnostic;
      // it is not a record the portable format promised to carry. Any packageable face is required.
      if (!classifyPaperFontPackaging(face).allowed) continue;
      if (!packaged.has(face.fontAsset.id)) {
        const listed = declaredMissing.has(face.fontAsset.id) ? ' (it is listed as missing in the portable section)' : '';
        throw new Error(`Portable Paper document "${document.title}" is missing required managed font ${face.postscriptName || face.id}${listed}. Re-save after restoring the exact font bytes.`);
      }
      if (declaredMissing.has(face.fontAsset.id)) {
        throw new Error(`Portable Paper document "${document.title}" declares required managed font ${face.postscriptName || face.id} missing. Exact composition cannot reopen safely.`);
      }
      const license = face.license?.textAsset;
      if (!isBinaryAssetRef(license)) {
        throw new Error(`Portable Paper document "${document.title}" is missing required license text for managed font ${face.postscriptName || face.id}. Exact portable reopen is blocked before partial restore.`);
      }
      if (!packaged.has(license.id)) {
        const listed = declaredMissing.has(license.id) ? ' (it is listed as missing in the portable section)' : '';
        throw new Error(`Portable Paper document "${document.title}" is missing required license text for managed font ${face.postscriptName || face.id}${listed}. Exact portable reopen is blocked before partial restore.`);
      }
      if (declaredMissing.has(license.id)) {
        throw new Error(`Portable Paper document "${document.title}" declares required license text for managed font ${face.postscriptName || face.id} missing. Exact composition cannot reopen safely.`);
      }
    }
  }
}

/**
 * Explicit missing-asset diagnostics for open: whatever the repository still cannot supply after
 * staging (legacy `.sloom` without the section, or faces excluded by rights policy at save time)
 * is reported through the Paper recovery channel instead of pretending the project is complete.
 */
async function attachPaperMissingAssetDiagnostics(
  paper: FlowProjectDocument['paper'],
  section: PaperPortableAssetsSection | undefined,
): Promise<FlowProjectDocument['paper']> {
  const documents = collectProjectPaperDocuments(paper);
  if (!paper || documents.length === 0) return paper;
  const repairs = await collectMissingPaperAssetDiagnostics(documents, paperAssetRepository, section);
  if (repairs.length === 0) return paper;
  return {
    ...paper,
    recovery: mergePaperSnapshotRecovery(paper.recovery, { quarantinedDocuments: [], repairs }),
  };
}

async function migrateProjectPaperDocuments(
  document: FlowProjectDocument,
): Promise<FlowProjectDocument> {
  if (!document.paper?.document) return document;
  const documents = document.paper.documents
    ? await Promise.all(document.paper.documents.map(async (workspaceDocument) => ({
      ...workspaceDocument,
      document: await migrateLegacyPaperBinaryFields(workspaceDocument.document, paperAssetRepository),
    })))
    : undefined;
  const activeDocument = documents?.find((workspaceDocument) => workspaceDocument.id === document.paper?.activeDocumentId)
    ?? documents?.[0];
  return {
    ...document,
    paper: {
      ...document.paper,
      documents,
      document: activeDocument?.document
        ?? await migrateLegacyPaperBinaryFields(document.paper.document, paperAssetRepository),
    },
  };
}

const MAX_DIRTY_IMAGE_PROJECTION_TITLE_LENGTH = 512;

export interface DirtyImageReplacementDocumentProjection {
  readonly title: string;
}

/**
 * The complete Image data exposed to project-replacement confirmation UI. The shape stays bounded
 * regardless of how many Image documents are open: the UI needs the exact dirty count, and needs a
 * title only when there is exactly one dirty document.
 */
export interface DirtyImageReplacementProjection {
  readonly dirtyDocumentCount: number;
  readonly soleDocument: DirtyImageReplacementDocumentProjection | null;
}

export type DirtyImageReplacementAuthorization = (
  projection: DirtyImageReplacementProjection,
) => Promise<boolean>;

export function buildDirtyImageReplacementConfirmationMessage(
  projection: DirtyImageReplacementProjection,
): string {
  return projection.dirtyDocumentCount === 1
    ? `Discard unsaved layered changes in Image document “${projection.soleDocument?.title ?? 'Untitled Image'}” and replace the project?`
    : `Discard unsaved layered changes in ${projection.dirtyDocumentCount} Image documents and replace the project?`;
}

function boundedDirtyImageProjectionTitle(value: unknown): string {
  if (typeof value !== 'string') return 'Untitled Image';
  if (value.length <= MAX_DIRTY_IMAGE_PROJECTION_TITLE_LENGTH) return value;
  return `${value.slice(0, MAX_DIRTY_IMAGE_PROJECTION_TITLE_LENGTH - 1)}…`;
}

function ownDataDescriptorValue(
  object: object,
  key: PropertyKey,
): Readonly<{ found: boolean; value?: unknown }> | null {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return Object.freeze({ found: false });
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
    return Object.freeze({ found: true, value: descriptor.value });
  } catch {
    return null;
  }
}

function tryBuildDirtyImageReplacementProjection(
  documents: readonly ImageDocument[],
): DirtyImageReplacementProjection | null {
  return tryInspectDirtyImageReplacementDocuments(documents)?.projection ?? null;
}

function tryInspectDirtyImageReplacementDocuments(
  documents: readonly ImageDocument[],
): Readonly<{
  projection: DirtyImageReplacementProjection;
  dirtyDocumentIds: readonly string[];
}> | null {
  if ((typeof documents !== 'object' && typeof documents !== 'function') || documents === null) return null;
  const lengthDescriptor = ownDataDescriptorValue(documents, 'length');
  if (!lengthDescriptor?.found
    || typeof lengthDescriptor.value !== 'number'
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0) return null;

  let dirtyDocumentCount = 0;
  let soleDirtyTitle: unknown;
  const dirtyDocumentIds: string[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const entry = ownDataDescriptorValue(documents, String(index));
    if (!entry) return null;
    if (!entry.found || !entry.value) continue;
    if (typeof entry.value !== 'object' && typeof entry.value !== 'function') return null;
    const document = entry.value as ImageDocument;
    const dirty = ownDataDescriptorValue(document, 'dirty');
    if (!dirty?.found) return null;
    if (dirty.value !== true) continue;
    const id = ownDataDescriptorValue(document, 'id');
    if (!id?.found || typeof id.value !== 'string' || !id.value) return null;
    const title = ownDataDescriptorValue(document, 'title');
    if (!title?.found) return null;
    dirtyDocumentCount += 1;
    dirtyDocumentIds.push(id.value);
    soleDirtyTitle = dirtyDocumentCount === 1 ? title.value : undefined;
  }

  let soleDocument: DirtyImageReplacementDocumentProjection | null = null;
  if (dirtyDocumentCount === 1) {
    soleDocument = Object.freeze({ title: boundedDirtyImageProjectionTitle(soleDirtyTitle) });
  }
  return Object.freeze({
    projection: Object.freeze({ dirtyDocumentCount, soleDocument }),
    dirtyDocumentIds: Object.freeze(dirtyDocumentIds),
  });
}

export interface CompleteRecoveryProjectResetResult {
  capturedDirtyImageDocuments: number;
  capturedDirtyPaperDocuments: number;
}

type CompleteRecoveryProjectResetReason = 'crash-recovery' | 'startup-recovery';

interface CompleteRecoveryProjectResetOptions {
  reason: CompleteRecoveryProjectResetReason;
  operationLabel: string;
  isReplacementRequestCurrent?: ProjectReplacementRequestGuard;
  transactionBookkeeping?: ProjectReplacementTransactionBookkeeping;
}

/**
 * Closed reset boundary for flows that guarantee a blank project while retaining every dirty
 * Image/Paper document as a bounded local recovery. It authorizes only the exact post-capture
 * workspace inside the replacement transaction. An optional outer request epoch keeps delayed
 * startup work from replacing a newer explicit project open.
 */
async function resetProjectDocumentWithCompleteRecoveryReason(
  options: CompleteRecoveryProjectResetOptions,
): Promise<CompleteRecoveryProjectResetResult> {
  const requestId = beginProjectReplacementRequest();
  assertGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent);
  const workspaceToken = captureProjectWorkspaceToken();
  const imageInspection = tryInspectDirtyImageReplacementDocuments(workspaceToken.image.documents);
  if (!imageInspection || !isProjectWorkspaceTokenCurrent(workspaceToken)) {
    throw new Error(`${options.operationLabel} was blocked because Image document metadata could not be inspected safely.`);
  }

  const paperSnapshot = workspaceToken.paper.exportSnapshot();
  const dirtyPaperIds = paperSnapshot.documents
    ?.filter((document) => workspaceToken.paper.isDocumentDirty(document.id))
    .map((document) => document.id) ?? [];
  if (!isGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent)
    || !isProjectWorkspaceTokenCurrent(workspaceToken)) {
    throw new ProjectReplacementPreparationStaleError();
  }

  const preparedImageRecoveries = await workspaceToken.image.prepareDocumentRecovery(
    imageInspection.dirtyDocumentIds,
    options.reason,
  );
  let imageRecoveryCommitted = false;
  let capturedDirtyImageDocuments: number;
  try {
    // Encoding pixels is asynchronous. No recovery or project mutation is allowed until every live
    // store identity/version is proven to still be the one inspected above.
    if (!isGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent)
      || !isProjectWorkspaceTokenCurrent(workspaceToken)) {
      throw new ProjectReplacementPreparationStaleError();
    }
    if (preparedImageRecoveries.length !== imageInspection.dirtyDocumentIds.length) {
      throw new Error(`${options.operationLabel} was blocked because not every dirty Image document could be captured.`);
    }

    capturedDirtyImageDocuments = workspaceToken.image
      .commitPreparedDocumentRecovery(preparedImageRecoveries);
    imageRecoveryCommitted = true;
  } finally {
    if (!imageRecoveryCommitted) {
      workspaceToken.image.disposePreparedDocumentRecovery(preparedImageRecoveries);
    }
  }
  assertGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent);
  const currentPaper = usePaperStore.getState();
  const capturedDirtyPaperDocuments = currentPaper.captureDocumentRecovery(
    dirtyPaperIds,
    options.reason,
  ).length;
  if (capturedDirtyPaperDocuments !== dirtyPaperIds.length) {
    throw new Error(`${options.operationLabel} was blocked because not every dirty Paper document could be captured.`);
  }
  assertGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent);

  const authorization = captureInternalProjectReplacementAuthorization();
  await restoreNormalizedProjectDocument(
    requestId,
    normalizeIncomingProjectDocument(undefined),
    authorization.paper,
    authorization.image,
    options.transactionBookkeeping,
    'reset',
    options.isReplacementRequestCurrent,
  );
  return { capturedDirtyImageDocuments, capturedDirtyPaperDocuments };
}

/** Recovery UI reset after the user explicitly confirms recovery mode. */
export function resetProjectDocumentWithCompleteRecovery(): Promise<CompleteRecoveryProjectResetResult> {
  return resetProjectDocumentWithCompleteRecoveryReason({
    reason: 'crash-recovery',
    operationLabel: 'Crash reset',
  });
}

/**
 * Native blank startup discards hydrated prior-session workspace state from the live canvas, but
 * keeps dirty documents locally recoverable. The startup splash prevents live user edits during
 * this short authority-adoption window; the outer epoch additionally retires delayed requests.
 */
export function resetStartupProjectDocumentWithCompleteRecovery(
  isReplacementRequestCurrent: ProjectReplacementRequestGuard,
): Promise<CompleteRecoveryProjectResetResult> {
  return resetProjectDocumentWithCompleteRecoveryReason({
    reason: 'startup-recovery',
    operationLabel: 'Blank startup reset',
    isReplacementRequestCurrent,
    transactionBookkeeping: 'reset-source-library-native-sync',
  });
}

function captureDirtyImageReplacementAuthorizationCandidate(): Readonly<{
  projection: DirtyImageReplacementProjection;
  authorization: InternalWorkspaceReplacementAuthorization;
  workspaceToken: ProjectWorkspaceToken;
}> | null {
  // Capture every live store identity/version before inspecting document metadata. Descriptor and
  // Proxy traps are untrusted code; any resulting store drift invalidates the whole request.
  const workspaceToken = captureProjectWorkspaceToken();
  const state = workspaceToken.image;
  const projection = tryBuildDirtyImageReplacementProjection(state.documents);
  if (!projection || !isProjectWorkspaceTokenCurrent(workspaceToken)) return null;
  const authorization = captureInternalImageReplacementAuthorizationForState(state);
  if (!isProjectWorkspaceTokenCurrent(workspaceToken)
    || !isInternalImageReplacementAuthorizationCurrent(authorization)) return null;
  return Object.freeze({ projection, authorization, workspaceToken });
}

interface GuardedProjectReplacementOptions {
  key?: string;
  title?: string;
  message?: string;
  save: () => Promise<PaperLossSaveResult>;
  /** A previously completed exact Image authorization, used when Image policy ran first. */
  imageAuthorization?: WorkspaceReplacementAuthorization;
  /** Called only when dirty Image documents still require their independent authorization. */
  authorizeDirtyImageReplacement?: DirtyImageReplacementAuthorization;
  /** Testable ordering; production defaults to Paper first. */
  authorizationOrder?: 'paper-first' | 'image-first';
  /** Closed, synchronous bookkeeping run inside the replacement transaction. */
  transactionBookkeeping?: ProjectReplacementTransactionBookkeeping;
  /** Exact external request/authority epoch that must remain current through commit. */
  isReplacementRequestCurrent?: ProjectReplacementRequestGuard;
}

interface UntrustedGuardedProjectReplacementOptions {
  key?: string;
  title?: string;
  message?: string;
  save: () => Promise<PaperLossSaveResult>;
  imageAuthorizationToken?: string;
  authorizeDirtyImageReplacement?: DirtyImageReplacementAuthorization;
  authorizationOrder?: 'paper-first' | 'image-first';
  transactionBookkeeping?: ProjectReplacementTransactionBookkeeping;
  confirmOtherChanges?: () => Promise<boolean>;
  isReplacementRequestCurrent?: ProjectReplacementRequestGuard;
}

function normalizeGuardedProjectReplacementOptions(
  value: unknown,
  includeBlankConfirmation: boolean,
): UntrustedGuardedProjectReplacementOptions {
  const supportedKeys = new Set([
    'key',
    'title',
    'message',
    'save',
    'imageAuthorization',
    'authorizeDirtyImageReplacement',
    'authorizationOrder',
    'transactionBookkeeping',
    'isReplacementRequestCurrent',
    ...(includeBlankConfirmation ? ['confirmOtherChanges'] : []),
  ]);
  const record = inspectRuntimeDataRecord(value, 'Guarded project replacement options', supportedKeys);
  const save = optionalFunction<() => Promise<PaperLossSaveResult>>(
    record,
    'save',
    'Guarded project replacement options',
  );
  if (!save) throw new Error('Guarded project replacement options.save is required.');
  const authorizationOrder = record.authorizationOrder;
  if (authorizationOrder !== undefined
    && authorizationOrder !== 'paper-first'
    && authorizationOrder !== 'image-first') {
    throw new Error('Guarded project replacement options.authorizationOrder is unsupported.');
  }
  return Object.freeze({
    key: optionalString(record, 'key', 'Guarded project replacement options'),
    title: optionalString(record, 'title', 'Guarded project replacement options'),
    message: optionalString(record, 'message', 'Guarded project replacement options'),
    save,
    imageAuthorizationToken: normalizeImageAuthorizationToken(record.imageAuthorization),
    authorizeDirtyImageReplacement: optionalFunction<DirtyImageReplacementAuthorization>(
      record,
      'authorizeDirtyImageReplacement',
      'Guarded project replacement options',
    ),
    authorizationOrder,
    transactionBookkeeping: normalizeTransactionBookkeeping(record.transactionBookkeeping),
    confirmOtherChanges: includeBlankConfirmation
      ? optionalFunction<() => Promise<boolean>>(
          record,
          'confirmOtherChanges',
          'Guarded project replacement options',
        )
      : undefined,
    isReplacementRequestCurrent: optionalFunction<ProjectReplacementRequestGuard>(
      record,
      'isReplacementRequestCurrent',
      'Guarded project replacement options',
    ),
  });
}

function isGuardedReplacementRequestCurrent(
  requestId: number,
  guard: ProjectReplacementRequestGuard | undefined,
): boolean {
  if (!isProjectReplacementRequestCurrent(requestId)) return false;
  try {
    return guard?.() !== false;
  } catch {
    return false;
  }
}

function assertGuardedReplacementRequestCurrent(
  requestId: number,
  guard: ProjectReplacementRequestGuard | undefined,
): void {
  if (!isGuardedReplacementRequestCurrent(requestId, guard)) {
    throw new ProjectReplacementPreparationStaleError();
  }
}

async function requestDirtyImageReplacementAuthorization(
  options: Pick<UntrustedGuardedProjectReplacementOptions, 'authorizeDirtyImageReplacement'>,
): Promise<InternalWorkspaceReplacementAuthorization | null | undefined> {
  // All live access, including hostile getters/Proxy traps, finishes while this candidate is made.
  // Only its deeply frozen display projection crosses into caller code.
  const candidate = captureDirtyImageReplacementAuthorizationCandidate();
  if (!candidate) return null;
  if (!isProjectWorkspaceTokenCurrent(candidate.workspaceToken)
    || !isInternalImageReplacementAuthorizationCurrent(candidate.authorization)) return null;
  const { projection } = candidate;
  if (projection.dirtyDocumentCount > 0) {
    if (!options.authorizeDirtyImageReplacement) return null;
    const approved = await options.authorizeDirtyImageReplacement(projection);
    if (!isImageConfirmationEnvironmentTokenCurrent(candidate.workspaceToken)
      || !isInternalImageReplacementAuthorizationCurrent(candidate.authorization)) return undefined;
    if (!approved) return null;
  }
  return isImageConfirmationEnvironmentTokenCurrent(candidate.workspaceToken)
    && isInternalImageReplacementAuthorizationCurrent(candidate.authorization)
    ? candidate.authorization
    : undefined;
}

async function requestProjectReplacementAuthorizations(
  requestId: number,
  options: UntrustedGuardedProjectReplacementOptions,
  initialImageAuthorization: InternalWorkspaceReplacementAuthorization | undefined,
): Promise<Required<InternalProjectReplacementAuthorization> | null> {
  let paperAuthorization: InternalPaperReplacementAuthorization | undefined;
  let imageAuthorization = initialImageAuthorization;
  const order = options.authorizationOrder ?? 'paper-first';

  const authorizePaper = async (): Promise<boolean> => {
    if (paperAuthorization && isInternalPaperReplacementAuthorizationCurrent(paperAuthorization)) return true;
    const approved = await requestPaperDestructiveAction({
      key: options.key ?? 'project-replacement',
      title: options.title ?? 'Save Paper changes before opening another project?',
      message: options.message ?? 'Opening another project replaces every open Paper tab. Save the current project, discard with recovery, or cancel.',
      reason: 'project-replacement',
      save: options.save,
    });
    if (!approved || !isGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent)) return false;
    const paper = capturePaperWorkspaceAuthorization();
    paperAuthorization = Object.freeze({ signature: paper.signature });
    return true;
  };

  const authorizeImage = async (): Promise<boolean> => {
    if (imageAuthorization && isInternalImageReplacementAuthorizationCurrent(imageAuthorization)) return true;
    const requested = await requestDirtyImageReplacementAuthorization(options);
    if (requested === null || !isGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent)) return false;
    imageAuthorization = requested;
    return true;
  };

  for (;;) {
    if (!isGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent)) return null;
    const approved = order === 'paper-first'
      ? await authorizePaper() && await authorizeImage()
      : await authorizeImage() && await authorizePaper();
    if (!approved) return null;
    if (
      paperAuthorization
      && imageAuthorization
      && isInternalPaperReplacementAuthorizationCurrent(paperAuthorization)
      && isInternalImageReplacementAuthorizationCurrent(imageAuthorization)
    ) {
      return { paper: paperAuthorization, image: imageAuthorization };
    }
  }
}

/** Guarded project replacement for every user-initiated open/import/library load path. */
export async function replaceProjectDocument(
  document: unknown,
  options: GuardedProjectReplacementOptions,
): Promise<boolean> {
  // Bounded candidate/options checks only. Full incoming validation is deliberately deferred
  // until the exact current replacement is authorized: Cancel never pays deep validation, and
  // unbounded malformed input is never deeply processed merely to show the decision dialog.
  const normalizedOptions = runStableWorkspaceNormalizationPhase(() => {
    assertProjectDocumentReplacementCandidate(document);
    return normalizeGuardedProjectReplacementOptions(options, false);
  });
  // The request identity exists before the decision is shown, so any later request — even one
  // whose payload fails validation afterwards — retires every older pending dialog.
  const requestId = beginProjectReplacementRequest();
  const initialImageAuthorization = consumeImageReplacementAuthorization(
    normalizedOptions.imageAuthorizationToken,
  );
  const authorization = await requestProjectReplacementAuthorizations(
    requestId,
    normalizedOptions,
    initialImageAuthorization,
  );
  if (!authorization || !isGuardedReplacementRequestCurrent(requestId, normalizedOptions.isReplacementRequestCurrent)) return false;
  // Full validation runs only for the authorized request. The stable phase fails closed when the
  // incoming payload mutates any workspace while it is inspected, and the prepared transaction
  // re-proves the request identity plus both authorizations before any store changes.
  const sanitizedDocument = runStableWorkspaceNormalizationPhase(
    () => normalizeIncomingProjectDocument(document),
  );
  assertGuardedReplacementRequestCurrent(requestId, normalizedOptions.isReplacementRequestCurrent);
  return restoreNormalizedProjectDocument(
    requestId,
    sanitizedDocument,
    authorization.paper,
    authorization.image,
    normalizedOptions.transactionBookkeeping,
    'restore',
    normalizedOptions.isReplacementRequestCurrent,
  ).then(() => true);
}

/**
 * Run only the guarded authorization policy (Paper loss prevention plus dirty-Image confirmation)
 * and mint an exact-capability result the caller passes to prepareProjectDocumentTransaction.
 * Used by native two-phase project switches where a native prepared transaction must commit
 * between renderer authorization and renderer finalize; every capability is revalidated inside
 * the closed transaction before any store changes.
 */
export async function requestProjectReplacementAuthorization(
  options: GuardedProjectReplacementOptions,
): Promise<ProjectReplacementAuthorization | null> {
  const normalized = runStableWorkspaceNormalizationPhase(
    () => normalizeGuardedProjectReplacementOptions(options, false),
  );
  const requestId = beginProjectReplacementRequest();
  const initialImageAuthorization = consumeImageReplacementAuthorization(
    normalized.imageAuthorizationToken,
  );
  const authorization = await requestProjectReplacementAuthorizations(
    requestId,
    normalized,
    initialImageAuthorization,
  );
  if (!authorization || !isGuardedReplacementRequestCurrent(requestId, normalized.isReplacementRequestCurrent)) return null;
  return {
    paper: capturePaperWorkspaceAuthorization(),
    image: mintImageReplacementAuthorization(authorization.image),
  };
}

/** Guarded blank-project authorization for native two-phase New Project. See requestProjectReplacementAuthorization. */
export async function requestBlankProjectReplacementAuthorization(options: {
  key?: string;
  title?: string;
  message?: string;
  save: () => Promise<PaperLossSaveResult>;
  confirmOtherChanges?: () => Promise<boolean>;
  imageAuthorization?: WorkspaceReplacementAuthorization;
  authorizeDirtyImageReplacement?: DirtyImageReplacementAuthorization;
  authorizationOrder?: 'paper-first' | 'image-first';
  isReplacementRequestCurrent?: ProjectReplacementRequestGuard;
}): Promise<ProjectReplacementAuthorization | null> {
  const normalized = runStableWorkspaceNormalizationPhase(
    () => normalizeGuardedProjectReplacementOptions(options, true),
  );
  const requestId = beginProjectReplacementRequest();
  const initialImageAuthorization = consumeImageReplacementAuthorization(normalized.imageAuthorizationToken);
  const authorization = await requestBlankProjectReplacementAuthorizations(
    requestId,
    normalized,
    initialImageAuthorization,
  );
  if (!authorization || !isGuardedReplacementRequestCurrent(requestId, normalized.isReplacementRequestCurrent)) return null;
  return {
    paper: capturePaperWorkspaceAuthorization(),
    image: mintImageReplacementAuthorization(authorization.image),
  };
}

/** Guarded blank-project reset for user actions and normal startup. Crash recovery has its own closed reset. */
export async function replaceWithBlankProject(options: {
  key?: string;
  title?: string;
  message?: string;
  save: () => Promise<PaperLossSaveResult>;
  confirmOtherChanges?: () => Promise<boolean>;
  imageAuthorization?: WorkspaceReplacementAuthorization;
  authorizeDirtyImageReplacement?: DirtyImageReplacementAuthorization;
  authorizationOrder?: 'paper-first' | 'image-first';
  transactionBookkeeping?: ProjectReplacementTransactionBookkeeping;
  isReplacementRequestCurrent?: ProjectReplacementRequestGuard;
}): Promise<boolean> {
  const normalized = runStableWorkspaceNormalizationPhase(
    () => normalizeGuardedProjectReplacementOptions(options, true),
  );
  const requestId = beginProjectReplacementRequest();
  const initialImageAuthorization = consumeImageReplacementAuthorization(normalized.imageAuthorizationToken);
  const authorization = await requestBlankProjectReplacementAuthorizations(
    requestId,
    normalized,
    initialImageAuthorization,
  );
  if (!authorization || !isGuardedReplacementRequestCurrent(requestId, normalized.isReplacementRequestCurrent)) return false;
  return restoreNormalizedProjectDocument(
    requestId,
    normalizeIncomingProjectDocument(undefined),
    authorization.paper,
    authorization.image,
    normalized.transactionBookkeeping,
    'reset',
    normalized.isReplacementRequestCurrent,
  ).then(() => true);
}

async function requestBlankProjectReplacementAuthorizations(
  requestId: number,
  options: UntrustedGuardedProjectReplacementOptions,
  initialImageAuthorization: InternalWorkspaceReplacementAuthorization | undefined,
): Promise<Required<InternalProjectReplacementAuthorization> | null> {
  for (;;) {
    let generalConfirmationWasRequested = false;
    const authorization = await requestProjectReplacementAuthorizations(requestId, {
      ...options,
      key: options.key ?? 'project-reset',
      title: options.title ?? 'Save Paper changes before starting a blank project?',
      message: options.message ?? 'Starting a blank project replaces every open Paper tab. Save the current project, discard with recovery, or cancel.',
      authorizeDirtyImageReplacement: async (projection) => {
        if (options.confirmOtherChanges) {
          generalConfirmationWasRequested = true;
          return options.confirmOtherChanges();
        }
        return options.authorizeDirtyImageReplacement?.(projection) ?? false;
      },
    }, initialImageAuthorization);
    if (!authorization || !isGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent)) return null;
    // The general New Project confirmation is still required when Image happens to be clean.
    if (options.confirmOtherChanges && !generalConfirmationWasRequested) {
      const before = captureInternalProjectReplacementAuthorization();
      if (!await options.confirmOtherChanges()
        || !isGuardedReplacementRequestCurrent(requestId, options.isReplacementRequestCurrent)) return null;
      if (!isInternalPaperReplacementAuthorizationCurrent(before.paper)
        || !isInternalImageReplacementAuthorizationCurrent(before.image)) {
        continue;
      }
    }
    return authorization;
  }
}
