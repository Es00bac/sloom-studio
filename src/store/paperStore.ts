import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SourceBinLibraryItem } from './sourceBinStore';
import {
  addFrameToPaperPage,
  addFrameToPaperParentPage,
  addPaperPage,
  addPaperParentPage,
  assignPaperParentPage,
  clearPaperFrameLocalOverrides,
  clearPaperFrameStyleLinks,
  createDefaultPaperDocument,
  deletePaperParentPage,
  detachInheritedPaperFrame,
  duplicatePaperPage,
  nextPaperFrameZIndex,
  parsePaperDocument,
  redefinePaperStyleFromFrame,
  removePaperPage,
  serializePaperDocument,
  updatePaperDocumentSetup,
  updatePaperStyleAutomation,
  updatePaperFrame,
} from '../lib/paperDocument';
import { paperBarcodeSymbolSizeMm } from '../lib/paperBarcode';
import type { PaperPoint } from '../lib/paperLayoutTools';
import {
  addPaperReviewComment,
  addPaperReviewReply,
  deletePaperReviewComment,
  setPaperReviewCommentResolved,
} from '../lib/paperReviewComments';
import {
  createPaperAuthoredNote,
  removePaperAuthoredNote,
  upsertPaperAuthoredNote,
  type PaperAuthoredNoteDraft,
} from '../lib/paperAuthoredNotes';
import { alignPaperFrames, distributePaperFrames, type PaperAlignEdge, type PaperDistributeAxis } from '../lib/paperAlignDistribute';
import { findPaperMatches, replaceAllInText, type PaperFindOptions } from '../lib/paperFindChange';
import type { PaperSwatch } from '../lib/paperSwatches';
import {
  applyPaperFrameContextAction,
  applyPaperFrameGroupContextAction,
  applyPaperPageContextAction,
  addPaperPolygonShapeFrame,
  splitPaperPanelFrame,
  nudgePaperFrame,
  placeSourceAssetOnPaperPage,
  type PaperFrameContextActionId,
  type PaperPageContextActionId,
} from '../lib/paperUsabilityActions';
import {
  applyPaperStyleClipboardPayload,
  copyPaperFrameStyle,
  type PaperStyleClipboardPayload,
} from '../lib/paperStyleClipboard';
import {
  buildPaperComicSfxDecalFrame,
  type PaperComicSfxDesign,
  type PaperComicSfxPresetId,
} from '../lib/paperComicSfx';
import {
  applyPaperDocumentNativeChange,
  isPaperWorkspaceSnapshotChange,
  type PaperDocumentNativeChange,
  type PaperWorkspaceSyncEnvelopeV1,
} from '../lib/paperDocumentNativeSync';
import {
  collectReachablePaperAssetIds,
  migrateLegacyPaperBinaryFields,
} from '../features/paper/assets/PaperDocumentAssets';
import { paperAssetRepository } from '../features/paper/assets/PaperAssetRuntime';
import { canonicalPaperFontObliqueAngle } from '../lib/paperManagedFonts';
import type {
  PaperDocument,
  PaperDiscardedDocumentRecovery,
  PaperDocumentPersistenceState,
  PaperDocumentRecoveryReason,
  PaperDocumentSnapshot,
  PaperBubbleConnectorStyle,
  PaperFrame,
  PaperFramePatch,
  PaperFrameKind,
  PaperGuide,
  PaperImportedFont,
  PaperPagePreset,
  PaperSnapshotRecovery,
  PaperTool,
  PaperWorkspaceDocumentSnapshot,
} from '../types/paper';
import { sanitizePaperSnapshotRecovery } from '../lib/paperSnapshotRecovery';
import { getPaperBubbleChainFrames } from '../lib/paperBubbleChains';
import {
  addPaperLayer,
  assignPaperFramesToLayer,
  movePaperLayer,
  paperFrameLayerIsLocked,
  paperFrameLayerIsVisible,
  renamePaperLayer,
  updatePaperLayer,
} from '../lib/paperLayers';
import { freshenGeneratedPaperDocumentIdentity } from '../lib/paperGeneratedDocumentIdentity';
import { removePaperAnchoredObjectsForFrames } from '../lib/paperAnchoredObjects';
import { applyPaperTrackChange, normalizePaperTrackChanges } from '../lib/paperTrackChanges';

/**
 * Replace one exact family/weight/style/stretch/collection face without collapsing a neighbouring
 * instance. Async font consumers use this same projection before authentication and at durable commit.
 */
export function replacePaperImportedFontFace(
  fonts: readonly PaperImportedFont[] | undefined,
  replacement: PaperImportedFont,
): PaperImportedFont[] {
  const kept = (fonts ?? []).filter(
    (font) => !(
      font.familyId === replacement.familyId
      && font.weight === replacement.weight
      && font.style === replacement.style
      && canonicalPaperFontObliqueAngle(font.style, font.obliqueAngleDeg) === canonicalPaperFontObliqueAngle(replacement.style, replacement.obliqueAngleDeg)
      && font.stretchPercent === replacement.stretchPercent
      && font.collectionIndex === replacement.collectionIndex
    ),
  );
  return [...kept, replacement];
}

interface PaperState {
  documents: PaperWorkspaceDocumentSnapshot[];
  /** Runtime-only identity for each open tab; regenerated when a tab is closed and reopened. */
  documentInstanceIds: Record<string, string>;
  activeDocumentId: string;
  document: PaperDocument;
  selectedPageId: string;
  selectedFrameId: string | null;
  selectedFrameIds: string[];
  tool: PaperTool;
  zoom: number;
  undoStack: PaperHistorySnapshot[];
  redoStack: PaperHistorySnapshot[];
  /**
   * Runtime-only undo/redo stacks stashed for open but inactive tabs, keyed by tab id. The active
   * tab's history stays on `undoStack`/`redoStack`; stacks move between the two surfaces as tab
   * focus changes. Never serialized into snapshots, persistence, or sync payloads.
   */
  documentHistories: Record<string, PaperDocumentHistory>;
  clipboardFrames: PaperFrame[];
  styleClipboard: PaperStyleClipboardPayload | null;
  /** Diagnostics from the last snapshot restore that quarantined or repaired saved tabs. */
  recovery: PaperSnapshotRecovery | null;
  /** Bounded local recovery copies created before explicit destructive Paper actions. */
  discardedDocumentRecoveries: PaperDiscardedDocumentRecovery[];
}

/**
 * Opaque runtime authority captured around an async Paper Inspector operation. The generation is
 * subscription-backed rather than persisted: every live document/selection authority transition
 * advances it, including direct `setState` transitions that React may batch away.
 */
export interface PaperInspectorStoreAuthority {
  readonly generation: number;
}

let paperInspectorStoreAuthorityGeneration = 0;

export function capturePaperInspectorStoreAuthority(): PaperInspectorStoreAuthority {
  return { generation: paperInspectorStoreAuthorityGeneration };
}

export function isPaperInspectorStoreAuthorityCurrent(authority: PaperInspectorStoreAuthority): boolean {
  return authority.generation === paperInspectorStoreAuthorityGeneration;
}

interface PaperActions {
  undo: () => void;
  redo: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  pasteSelection: () => void;
  copySelectedFrameStyle: () => boolean;
  pasteFrameStyleToSelection: () => number;
  deleteSelection: () => void;
  createNewDocument: (options?: { title?: string; preset?: PaperPagePreset; dpi?: number }) => void;
  addGeneratedDocument: (
    document: PaperDocument,
    options: { authorization: PaperWorkspaceAuthorization },
  ) => string | undefined;
  openDocumentJson: (
    json: string,
    options: {
      authorization: PaperWorkspaceAuthorization;
      source?: 'standalone' | 'project';
      path?: string;
    },
  ) => string | undefined;
  importDocumentJson: (json: string) => Promise<void>;
  replaceDocument: (
    documentId: string,
    document: PaperDocument,
    options: {
      authorization: PaperWorkspaceAuthorization;
      recoveryReason?: PaperDocumentRecoveryReason;
    },
  ) => boolean;
  setActiveDocument: (documentId: string) => void;
  closeDocument: (
    documentId: string,
    options?: {
      discard?: boolean;
      recoveryReason?: PaperDocumentRecoveryReason;
      authorization?: PaperWorkspaceAuthorization;
    },
  ) => boolean;
  isDocumentDirty: (documentId?: string) => boolean;
  markDocumentSaved: (
    documentId: string,
    baseline: { kind: 'project' | 'standalone'; path?: string; savedFingerprint?: string },
  ) => void;
  markAllDocumentsProjectSaved: (savedSnapshot?: Partial<PaperDocumentSnapshot>) => void;
  captureDocumentRecovery: (
    documentIds: string[],
    reason: PaperDocumentRecoveryReason,
  ) => string[];
  restoreDiscardedDocument: (recoveryId: string) => string | undefined;
  dismissDiscardedDocumentRecovery: (recoveryId: string) => void;
  exportDocumentJson: () => string;
  updateDocumentSetup: (patch: Parameters<typeof updatePaperDocumentSetup>[1]) => void;
  /** Replace the bounded document-local data-merge source through the normal undo/persistence path. */
  updatePaperDataMerge: (source: unknown) => void;
  /** Replace anchored-object relationships through the normal undo/persistence path. */
  updatePaperAnchoredObjects: (relationships: unknown) => void;
  /** Replace TOC/index/cross-reference targets through the normal undo/persistence path. */
  updatePaperPublicationReferences: (references: unknown) => void;
  updatePaperTrackChanges: (changes: unknown) => void;
  decidePaperTrackChange: (id: string, decision: 'accept' | 'reject') => void;
  /** Add one bounded authored footnote or endnote to the active document. */
  addAuthoredNote: (draft: PaperAuthoredNoteDraft) => string | undefined;
  /** Update one existing authored footnote or endnote while retaining its creation timestamp. */
  updateAuthoredNote: (draft: PaperAuthoredNoteDraft & { id: string }) => string | undefined;
  /** Remove one authored note from the active document. */
  removeAuthoredNote: (noteId: string) => void;
  /** Replace GREP-style rules and/or nested-style steps (sanitized in the pure document layer). */
  updateStyleAutomation: (patch: { grepStyleRules?: unknown; nestedStyleSteps?: unknown }) => void;
  setTool: (tool: PaperTool) => void;
  setZoom: (zoom: number) => void;
  selectPage: (pageId: string) => void;
  selectFrame: (frameId: string | null) => void;
  selectFrameWithMode: (frameId: string | null, mode?: 'replace' | 'add' | 'toggle') => void;
  addPage: () => void;
  addParentPage: (name?: string) => string | undefined;
  deleteParentPage: (parentPageId: string) => void;
  assignParentPage: (pageId: string, parentPageId?: string) => void;
  addFrameToParentPage: (parentPageId: string, kind: PaperFrameKind, patch?: Partial<PaperFrame>) => string | undefined;
  detachInheritedFrame: (pageId: string, inheritedFrameId: string) => void;
  duplicatePage: () => void;
  deletePage: () => void;
  addFrame: (kind: PaperFrameKind, patch?: Partial<PaperFrame>) => string | undefined;
  addFrameToPage: (pageId: string, kind: PaperFrameKind, patch?: PaperFramePatch) => string | undefined;
  addLayer: (name?: string) => string | undefined;
  renameLayer: (layerId: string, name: string) => void;
  moveLayer: (layerId: string, direction: 'backward' | 'forward') => void;
  setLayerVisibility: (layerId: string, visible: boolean) => void;
  setLayerPrintability: (layerId: string, printable: boolean) => void;
  setLayerLocked: (layerId: string, locked: boolean) => void;
  assignSelectionToLayer: (layerId: string) => void;
  /** Add one open review-comment thread (history-tracked; never affects layout or export). */
  addReviewComment: (draft: { pageId: string; frameId?: string; author: string; body: string }) => string | undefined;
  /** Append one bounded reply to a review-comment thread. */
  addReviewReply: (commentId: string, draft: { author: string; body: string }) => string | undefined;
  /** Resolve or reopen a review-comment thread. */
  setReviewCommentResolved: (commentId: string, resolved: boolean) => void;
  /** Remove one review-comment thread. */
  deleteReviewComment: (commentId: string) => void;
  addPolygonShapeToPage: (pageId: string, points: PaperPoint[]) => string | undefined;
  splitPanelFrames: (pageId: string, start: PaperPoint, current: PaperPoint) => void;
  updateFrame: (pageId: string, frameId: string, patch: PaperFramePatch) => void;
  updateSelectedFrame: (patch: PaperFramePatch) => void;
  /** Atomically pin a bundled face and apply typography to the exact Inspector target that initiated it. */
  commitBundledFrameTypography: (target: {
    authority: PaperInspectorStoreAuthority;
    document: PaperDocument;
    page: PaperDocument['pages'][number];
    frame: PaperFrame;
    patch: PaperFramePatch;
    importedFont: PaperImportedFont;
  }) => boolean;
  redefineSelectedStyle: (kind: 'paragraph' | 'character' | 'object') => void;
  clearSelectedStyleLinks: () => void;
  clearSelectedStyleOverrides: () => void;
  chainSelectedBubbles: (style?: PaperBubbleConnectorStyle) => void;
  chainSelectedBubbleWith: (targetFrameId: string, style?: PaperBubbleConnectorStyle) => void;
  moveSelectedBubbleInChain: (direction: 'earlier' | 'later') => void;
  unchainBubble: (frameId: string) => void;
  unchainSelectedBubbles: () => void;
  addPaperSwatch: (swatch: PaperSwatch) => void;
  removePaperSwatch: (swatchId: string) => void;
  /** Add (or replace, by family+weight+style) a vetted imported font on the document. */
  addImportedFont: (font: PaperImportedFont) => void;
  removeImportedFont: (fontId: string) => void;
  threadSelectedFrames: () => void;
  unthreadSelectedFrames: () => void;
  alignSelectedFrames: (edge: PaperAlignEdge) => void;
  distributeSelectedFrames: (axis: PaperDistributeAxis) => void;
  replaceAllInPaperText: (query: string, replacement: string, options?: PaperFindOptions) => number;
  addComicSfx: (
    presetId: PaperComicSfxPresetId,
    options?: { pageId?: string; point?: PaperPoint; text?: string; design?: PaperComicSfxDesign },
  ) => string | undefined;
  nudgeSelectedFrame: (deltaXMm: number, deltaYMm: number) => void;
  selectAllFramesOnSelectedPage: () => void;
  deselectFrames: () => void;
  invertFrameSelectionOnSelectedPage: () => void;
  addGuideToPage: (pageId: string, guide: Omit<PaperGuide, 'id'> & { id?: string }) => string | undefined;
  updateGuide: (pageId: string, guideId: string, patch: Partial<Omit<PaperGuide, 'id'>>) => void;
  placeSourceAsset: (item: SourceBinLibraryItem, targetFrameId?: string) => void;
  placeSourceAssetAt: (options: {
    item: SourceBinLibraryItem;
    pageId?: string;
    targetFrameId?: string | null;
    point?: PaperPoint;
  }) => void;
  runFrameContextAction: (pageId: string, frameId: string, actionId: PaperFrameContextActionId) => void;
  runPageContextAction: (
    pageId: string,
    actionId: PaperPageContextActionId,
    options?: { point?: PaperPoint; sourceItem?: SourceBinLibraryItem },
  ) => void;
  toggleViewOption: (option: keyof PaperDocument['view']) => void;
  setViewOption: <K extends keyof PaperDocument['view']>(option: K, value: PaperDocument['view'][K]) => void;
  exportSnapshot: (options?: { includeLocalPersistence?: boolean }) => PaperDocumentSnapshot;
  restoreSnapshot: (
    snapshot?: Partial<PaperDocumentSnapshot>,
    options?: { baseline?: 'new' | 'project' | 'preserve' },
  ) => void;
  /**
   * Apply a remote Paper op from the unified cross-device sync (#52) to the live document, **without
   * pushing undo history or re-broadcasting** (the echo guard lives in `paperSyncChannel`). Reconciles
   * the local selection if a selected frame/page was removed by the op. Returns whether the document
   * actually changed (so a self-echoed op never thrashes).
   */
  applyRemotePaperDocumentChange: (change: PaperDocumentNativeChange) => boolean;
  /** Atomically replace the remotely-authenticated Paper tab catalog and active tab. */
  applyRemotePaperWorkspaceSnapshot: (workspace: PaperWorkspaceSyncEnvelopeV1) => boolean;
  /**
   * Apply one live layout-agent mutation atomically: the mutator runs inside `set()` against the
   * CURRENT document, so edits a person makes while the agent is mid-turn are never folded against
   * a stale snapshot. Pushes a single undo entry and reconciles the selection without stealing it.
   * Returns whether the document actually changed.
   */
  mutatePaperDocumentForLiveAgent: (
    mutate: (document: PaperDocument) => { document: PaperDocument; changed: boolean },
  ) => boolean;
}

const initialDocument = createDefaultPaperDocument({ title: 'Untitled Paper Layout' });
const initialDocumentId = initialDocument.id || 'paper-document-initial';
const PAPER_TOOLS: readonly PaperTool[] = ['select', 'hand', 'text', 'image', 'speech', 'thought', 'caption', 'panel', 'shape', 'line', 'ellipse', 'triangle', 'pentagon', 'hexagon', 'eyedropper', 'gutterKnife', 'tiltmark', 'barcode'];
const MAX_PAPER_HISTORY = 50;
const MAX_PAPER_RECOVERY_BATCHES = 8;

interface PaperHistorySnapshot {
  document: PaperDocument;
  selectedPageId: string;
  selectedFrameId: string | null;
  selectedFrameIds: string[];
  tool: PaperTool;
  zoom: number;
}

interface PaperDocumentHistory {
  undoStack: PaperHistorySnapshot[];
  redoStack: PaperHistorySnapshot[];
}

export function mergePersistedPaperWorkspace(
  persisted: unknown,
  current: PaperState & PaperActions,
): PaperState & PaperActions {
  if (persisted === undefined) return current;
  return {
    ...current,
    ...sanitizePaperSnapshot(persisted, 'preserve'),
  };
}

/**
 * The exact persisted projection: local workspace truth only, never runtime undo/redo history.
 * Recovery records persist their document snapshot but shed their stacks — history is
 * session-scoped everywhere, including inside deliberate-recovery copies.
 */
export function projectPersistedPaperWorkspace(state: PaperState) {
  return {
    document: state.document,
    documents: syncActivePaperDocument(state),
    activeDocumentId: state.activeDocumentId,
    selectedPageId: state.selectedPageId,
    selectedFrameId: state.selectedFrameId,
    selectedFrameIds: state.selectedFrameIds,
    tool: state.tool,
    zoom: state.zoom,
    discardedDocumentRecoveries: state.discardedDocumentRecoveries.map(
      ({ undoStack: _undoStack, redoStack: _redoStack, ...persistable }) => persistable,
    ),
  };
}

export const usePaperStore = create<PaperState & PaperActions>()(
  persist(
    (set, get) => ({
      documents: [createPaperWorkspaceDocumentSnapshot(initialDocumentId, initialDocument, {
        // This tab is the renderer's representation of main's canonical blank project, not a
        // user-authored unsaved publication. Treating it as `new` makes fresh-profile startup
        // loss prevention wait for a decision before native external-open draining can register.
        // Tabs created by the user still enter through createNewDocument with `kind: 'new'`.
        persistence: createSavedPaperPersistence(initialDocument, 'project'),
      })],
      documentInstanceIds: { [initialDocumentId]: makePaperRuntimeId('paper-tab-instance') },
      activeDocumentId: initialDocumentId,
      document: initialDocument,
      selectedPageId: initialDocument.pages[0].id,
      selectedFrameId: null,
      selectedFrameIds: [],
      tool: 'select',
      zoom: 0.8,
      undoStack: [],
      redoStack: [],
      documentHistories: {},
      clipboardFrames: [],
      styleClipboard: null,
      recovery: null,
      discardedDocumentRecoveries: [],

      undo: () => {
        const state = get();
        const snapshot = state.undoStack.at(-1);
        if (!snapshot) return;
        set({
          ...snapshot,
          undoStack: state.undoStack.slice(0, -1),
          redoStack: [...state.redoStack, createPaperHistorySnapshot(state)].slice(-MAX_PAPER_HISTORY),
        });
      },

      redo: () => {
        const state = get();
        const snapshot = state.redoStack.at(-1);
        if (!snapshot) return;
        set({
          ...snapshot,
          redoStack: state.redoStack.slice(0, -1),
          undoStack: [...state.undoStack, createPaperHistorySnapshot(state)].slice(-MAX_PAPER_HISTORY),
        });
      },

      copySelection: () => {
        const state = get();
        set({ clipboardFrames: getSelectedPaperFrames(state).map(clonePaperFrame) });
      },

      cutSelection: () => {
        const state = get();
        const frames = getSelectedPaperFrames(state).map(clonePaperFrame);
        if (!frames.length) return;
        const deletion = deletePaperSelectionPatch(state);
        if (deletion.document === state.document) return;
        set({
          ...deletion,
          clipboardFrames: frames,
          undoStack: pushPaperHistory(state),
          redoStack: [],
        });
      },

      pasteSelection: () => {
        const state = get();
        if (!state.clipboardFrames.length) return;
        const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
        if (!page) return;
        const fallbackLayerId = state.document.layers.find((layer) => !layer.locked)?.id;
        if (!fallbackLayerId) return;
        let nextZIndex = nextPaperFrameZIndex(page.frames);
        const pastedFrames = state.clipboardFrames.map((frame, index) => ({
          ...clonePaperFrame(frame),
          id: makePaperRuntimeId(`frame-paste-${index}`),
          label: frame.label.endsWith(' copy') ? frame.label : `${frame.label} copy`,
          xMm: roundPaperMm(frame.xMm + 4),
          yMm: roundPaperMm(frame.yMm + 4),
          zIndex: nextZIndex++,
          locked: false,
          inherited: false,
          parentFrameId: undefined,
          parentPageId: undefined,
          layerId: paperFrameLayerIsLocked(state.document, frame) ? fallbackLayerId : frame.layerId,
        }));
        const selectedFrameIds = pastedFrames.map((frame) => frame.id);
        set({
          document: {
            ...state.document,
            pages: state.document.pages.map((candidate) =>
              candidate.id === page.id
                ? { ...candidate, frames: [...candidate.frames, ...pastedFrames] }
                : candidate,
            ),
            updatedAt: Date.now(),
          },
          selectedFrameId: selectedFrameIds[0] ?? null,
          selectedFrameIds,
          tool: 'select',
          undoStack: pushPaperHistory(state),
          redoStack: [],
        });
      },

      copySelectedFrameStyle: () => {
        const state = get();
        const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
        const activeFrameId = state.selectedFrameId ?? state.selectedFrameIds[0] ?? null;
        const activeFrame = page?.frames.find((frame) => frame.id === activeFrameId);
        if (!activeFrame) return false;
        set({ styleClipboard: copyPaperFrameStyle(activeFrame) });
        return true;
      },

      pasteFrameStyleToSelection: () => {
        const state = get();
        if (!state.styleClipboard) return 0;
        const selectedFrameIds = getSelectedPaperFrameIds(state);
        if (!selectedFrameIds.length) return 0;

        const patch = applyPaperStyleClipboardPayload(state.styleClipboard);
        let document = state.document;
        let changedCount = 0;
        for (const frameId of selectedFrameIds) {
          const nextDocument = updatePaperFrame(document, state.selectedPageId, frameId, patch);
          if (nextDocument !== document) {
            changedCount += 1;
            document = nextDocument;
          }
        }

        if (!changedCount) return 0;
        set(withPaperHistory(state, { document }));
        return changedCount;
      },

      deleteSelection: () => {
        const state = get();
        const frameIds = getSelectedPaperFrameIds(state);
        if (!frameIds.length) return;
        const deletion = deletePaperSelectionPatch(state);
        if (deletion.document === state.document) return;
        set({
          ...deletion,
          undoStack: pushPaperHistory(state),
          redoStack: [],
        });
      },

      createNewDocument: (options) => {
        const state = get();
        const document = createDefaultPaperDocument({
          title: options?.title || 'Untitled Paper Layout',
          preset: options?.preset ?? 'us-letter',
          dpi: options?.dpi,
        });
        const documentId = makeUniquePaperDocumentTabId(document.id, state.documents);
        const workspaceDocument = createPaperWorkspaceDocumentSnapshot(documentId, document, {
          persistence: { kind: 'new' },
        });
        set({
          documents: [...syncActivePaperDocument(state), workspaceDocument],
          documentInstanceIds: {
            ...state.documentInstanceIds,
            [documentId]: makePaperRuntimeId('paper-tab-instance'),
          },
          activeDocumentId: documentId,
          document,
          selectedPageId: workspaceDocument.selectedPageId ?? '',
          selectedFrameId: null,
          selectedFrameIds: [],
          tool: 'select',
          zoom: 0.8,
          ...freshPaperDocumentHistoryPatch(stashActivePaperDocumentHistory(state), documentId),
        });
      },

      addGeneratedDocument: (inputDocument, options) => {
        const parsedDocument = parsePaperDocument(JSON.stringify(inputDocument));
        const state = get();
        if (!isPaperWorkspaceAuthorizationCurrentForState(options.authorization, state)) return undefined;
        const document = freshenGeneratedPaperDocumentIdentity(parsedDocument);
        const documentId = makeUniquePaperDocumentTabId(document.id, state.documents);
        const workspaceDocument = createPaperWorkspaceDocumentSnapshot(documentId, document, {
          persistence: { kind: 'new' },
        });
        set({
          documents: [...syncActivePaperDocument(state), workspaceDocument],
          documentInstanceIds: {
            ...state.documentInstanceIds,
            [documentId]: makePaperRuntimeId('paper-tab-instance'),
          },
          activeDocumentId: documentId,
          ...paperStatePatchFromWorkspaceSnapshot(workspaceDocument),
          ...freshPaperDocumentHistoryPatch(stashActivePaperDocumentHistory(state), documentId),
        });
        return documentId;
      },

      openDocumentJson: (json, options) => {
        // Standalone package decoding/migration is prepared outside this synchronous commit. The
        // exact workspace authorization prevents a delayed open from appending to a newer project
        // or tab catalog; no callback/await may be inserted between this check and set().
        const document = parsePaperDocument(json);
        const state = get();
        if (!isPaperWorkspaceAuthorizationCurrentForState(options.authorization, state)) return undefined;
        const documentId = makeUniquePaperDocumentTabId(document.id, state.documents);
        const documentInstanceId = makePaperRuntimeId('paper-tab-instance');
        const source = options?.source ?? 'standalone';
        const workspaceDocument = createPaperWorkspaceDocumentSnapshot(documentId, document, {
          persistence: source === 'standalone'
            ? {
                kind: 'standalone',
                savedFingerprint: fingerprintPaperAuthoredContent(document),
                ...(options?.path ? { path: options.path } : {}),
              }
            : {
                kind: 'project',
                savedFingerprint: fingerprintPaperAuthoredContent(document),
              },
        });
        const nextState = {
          documents: [...syncActivePaperDocument(state), workspaceDocument],
          documentInstanceIds: {
            ...state.documentInstanceIds,
            [documentId]: documentInstanceId,
          },
          activeDocumentId: documentId,
          ...paperStatePatchFromWorkspaceSnapshot(workspaceDocument),
          ...freshPaperDocumentHistoryPatch(stashActivePaperDocumentHistory(state), documentId),
        };
        try {
          set(nextState);
        } catch (error) {
          // Zustand assigns state before notifying subscribers. A bad observer must not turn a
          // committed tab into an apparent failure that makes the outer transaction remove its
          // managed records. Re-throw only when the state assignment itself did not land.
          const current = get();
          if (current.activeDocumentId !== documentId
            || current.documentInstanceIds[documentId] !== documentInstanceId
            || !current.documents.some((candidate) => candidate.id === documentId)) {
            throw error;
          }
        }
        return documentId;
      },

      importDocumentJson: async (json) => {
        const requestedState = get();
        const targetDocumentId = requestedState.activeDocumentId;
        const targetInstanceId = requestedState.documentInstanceIds[targetDocumentId];
        const rawDocument = JSON.parse(json) as PaperDocument;
        const migratedDocument = await migrateLegacyPaperBinaryFields(rawDocument, paperAssetRepository);
        const document = parsePaperDocument(JSON.stringify(migratedDocument));
        set((state) => {
          if (targetInstanceId
            && state.documentInstanceIds[targetDocumentId] !== targetInstanceId) return {};
          const documents = syncActivePaperDocument(state);
          const currentWorkspaceDocument = documents.find((candidate) => candidate.id === targetDocumentId);
          if (!currentWorkspaceDocument) return {};
          const workspaceDocument = createPaperWorkspaceDocumentSnapshot(targetDocumentId, document, {
            persistence: currentWorkspaceDocument.persistence ?? { kind: 'new' },
          });
          const nextDocuments = documents.map((candidate) =>
            candidate.id === targetDocumentId ? workspaceDocument : candidate);
          if (state.activeDocumentId !== targetDocumentId) {
            return {
              documents: nextDocuments,
              documentHistories: removePaperDocumentHistory(state.documentHistories, targetDocumentId),
            };
          }
          return {
            documents: nextDocuments,
            ...paperStatePatchFromWorkspaceSnapshot(workspaceDocument),
            ...freshPaperDocumentHistoryPatch(state.documentHistories, targetDocumentId),
          };
        });
      },

      replaceDocument: (documentId, document, options) => {
        const state = get();
        // Authorization and mutation are deliberately synchronous. No callback or await may be
        // inserted between this exact workspace check and the set() below.
        if (!isPaperWorkspaceAuthorizationCurrentForState(options.authorization, state)) return false;
        const documents = syncActivePaperDocument(state);
        const replacedIndex = documents.findIndex((candidate) => candidate.id === documentId);
        if (replacedIndex < 0) return false;
        const replacedDocument = documents[replacedIndex];
        const workspaceDocument = createPaperWorkspaceDocumentSnapshot(documentId, document, {
          persistence: replacedDocument.persistence ?? { kind: 'new' },
        });
        const discardedDocumentRecoveries = options.recoveryReason
          ? appendPaperDocumentRecoveries(
              state.discardedDocumentRecoveries,
              [createPaperDiscardRecovery(
                state,
                replacedDocument,
                replacedIndex,
                options.recoveryReason,
              )],
            )
          : state.discardedDocumentRecoveries;
        const nextDocuments = documents.map((candidate) =>
          candidate.id === documentId ? workspaceDocument : candidate);

        if (documentId !== state.activeDocumentId) {
          set({
            documents: nextDocuments,
            documentHistories: removePaperDocumentHistory(state.documentHistories, documentId),
            discardedDocumentRecoveries,
          });
          return true;
        }
        set({
          documents: nextDocuments,
          ...paperStatePatchFromWorkspaceSnapshot(workspaceDocument),
          ...freshPaperDocumentHistoryPatch(state.documentHistories, documentId),
          discardedDocumentRecoveries,
        });
        return true;
      },

      setActiveDocument: (documentId) => {
        const state = get();
        if (documentId === state.activeDocumentId) return;
        const documents = syncActivePaperDocument(state);
        const workspaceDocument = documents.find((candidate) => candidate.id === documentId);
        if (!workspaceDocument) return;
        set({
          documents,
          activeDocumentId: documentId,
          ...paperStatePatchFromWorkspaceSnapshot(workspaceDocument),
          ...restorePaperDocumentHistoryPatch(stashActivePaperDocumentHistory(state), documentId),
        });
      },

      closeDocument: (documentId, options) => {
        const state = get();
        if (options?.authorization
          && !isPaperWorkspaceAuthorizationCurrentForState(options.authorization, state)) return false;
        const documents = syncActivePaperDocument(state);
        const closedIndex = documents.findIndex((candidate) => candidate.id === documentId);
        if (closedIndex < 0) return false;
        const isDirty = isPaperWorkspaceDocumentDirty(documents[closedIndex]);
        if (isDirty && !options?.discard) return false;
        const discardedDocumentRecoveries = isDirty
          ? appendPaperDocumentRecoveries(
              state.discardedDocumentRecoveries,
              [createPaperDiscardRecovery(state, documents[closedIndex], closedIndex, options?.recoveryReason ?? 'discard')],
            )
          : state.discardedDocumentRecoveries;
        const remainingDocuments = documents.filter((candidate) => candidate.id !== documentId);
        const documentInstanceIds = { ...state.documentInstanceIds };
        delete documentInstanceIds[documentId];

        if (documentId !== state.activeDocumentId) {
          set({
            documents: remainingDocuments,
            documentInstanceIds,
            documentHistories: removePaperDocumentHistory(state.documentHistories, documentId),
            discardedDocumentRecoveries,
          });
          return true;
        }

        let nextDocument = remainingDocuments[Math.min(closedIndex, remainingDocuments.length - 1)];
        if (!nextDocument) {
          const document = createDefaultPaperDocument({ title: 'Untitled Paper Layout' });
          const nextId = makeUniquePaperDocumentTabId(document.id, documents);
          nextDocument = createPaperWorkspaceDocumentSnapshot(nextId, document, {
            persistence: { kind: 'new' },
          });
          remainingDocuments.push(nextDocument);
          documentInstanceIds[nextId] = makePaperRuntimeId('paper-tab-instance');
        }

        set({
          documents: remainingDocuments,
          documentInstanceIds,
          activeDocumentId: nextDocument.id,
          ...paperStatePatchFromWorkspaceSnapshot(nextDocument),
          ...restorePaperDocumentHistoryPatch(
            removePaperDocumentHistory(state.documentHistories, documentId),
            nextDocument.id,
          ),
          discardedDocumentRecoveries,
        });
        return true;
      },

      isDocumentDirty: (documentId) => {
        const state = get();
        const resolvedId = documentId ?? state.activeDocumentId;
        const workspaceDocument = syncActivePaperDocument(state)
          .find((candidate) => candidate.id === resolvedId);
        return workspaceDocument ? isPaperWorkspaceDocumentDirty(workspaceDocument) : false;
      },

      markDocumentSaved: (documentId, baseline) => {
        const state = get();
        const documents = syncActivePaperDocument(state);
        const workspaceDocument = documents.find((candidate) => candidate.id === documentId);
        if (!workspaceDocument) return;
        const persistence: PaperDocumentPersistenceState = {
          kind: baseline.kind,
          savedFingerprint: baseline.savedFingerprint
            ?? fingerprintPaperAuthoredContent(workspaceDocument.document),
          ...(baseline.path ? { path: baseline.path } : {}),
        };
        set({
          documents: documents.map((candidate) => candidate.id === documentId
            ? { ...candidate, persistence }
            : candidate),
        });
      },

      markAllDocumentsProjectSaved: (savedSnapshot) => {
        const state = get();
        const savedDocuments = savedSnapshot?.documents?.length
          ? savedSnapshot.documents
          : savedSnapshot?.document
            ? [{
                id: savedSnapshot.activeDocumentId ?? state.activeDocumentId,
                document: savedSnapshot.document,
              }]
            : undefined;
        const savedFingerprints = savedDocuments
          ? new Map(savedDocuments.map((workspaceDocument) => [
              workspaceDocument.id,
              fingerprintPaperAuthoredContent(workspaceDocument.document),
            ]))
          : undefined;
        const documents = syncActivePaperDocument(state).map((workspaceDocument) => {
          const savedFingerprint = savedFingerprints?.get(workspaceDocument.id)
            ?? (savedFingerprints ? undefined : fingerprintPaperAuthoredContent(workspaceDocument.document));
          return savedFingerprint
            ? {
                ...workspaceDocument,
                persistence: {
                  kind: 'project' as const,
                  savedFingerprint,
                },
              }
            : workspaceDocument;
        });
        set({ documents });
      },

      captureDocumentRecovery: (documentIds, reason) => {
        const state = get();
        const documents = syncActivePaperDocument(state);
        const requestedIds = new Set(documentIds);
        const batchId = makePaperRuntimeId('paper-recovery-batch');
        const recoveries = documents.flatMap((workspaceDocument, index) =>
          requestedIds.has(workspaceDocument.id)
            ? [createPaperDiscardRecovery(state, workspaceDocument, index, reason, batchId)]
            : [],
        );
        if (!recoveries.length) return [];
        set({
          documents,
          discardedDocumentRecoveries: appendPaperDocumentRecoveries(
            state.discardedDocumentRecoveries,
            recoveries,
          ),
        });
        return recoveries.map((recovery) => recovery.id);
      },

      restoreDiscardedDocument: (recoveryId) => {
        const state = get();
        const recovery = state.discardedDocumentRecoveries.find((candidate) => candidate.id === recoveryId);
        if (!recovery) return undefined;
        const documents = syncActivePaperDocument(state);
        const restoredId = makeUniquePaperDocumentTabId(recovery.snapshot.id, documents);
        const restoredSnapshot = {
          ...recovery.snapshot,
          id: restoredId,
        };
        const insertIndex = Math.max(0, Math.min(recovery.originalIndex, documents.length));
        const nextDocuments = [...documents];
        nextDocuments.splice(insertIndex, 0, restoredSnapshot);
        set({
          documents: nextDocuments,
          documentInstanceIds: {
            ...state.documentInstanceIds,
            [restoredId]: makePaperRuntimeId('paper-tab-instance'),
          },
          activeDocumentId: restoredId,
          ...paperStatePatchFromWorkspaceSnapshot(restoredSnapshot),
          documentHistories: removePaperDocumentHistory(stashActivePaperDocumentHistory(state), restoredId),
          undoStack: recovery.undoStack ?? [],
          redoStack: recovery.redoStack ?? [],
          discardedDocumentRecoveries: state.discardedDocumentRecoveries
            .filter((candidate) => candidate.id !== recoveryId),
        });
        return restoredId;
      },

      dismissDiscardedDocumentRecovery: (recoveryId) =>
        set((state) => ({
          discardedDocumentRecoveries: state.discardedDocumentRecoveries
            .filter((candidate) => candidate.id !== recoveryId),
        })),

      exportDocumentJson: () => serializePaperDocument(get().document),

      updateDocumentSetup: (patch) =>
        set((state) => withPaperHistory(state, {
          document: updatePaperDocumentSetup(state.document, patch),
        })),

      updatePaperDataMerge: (source) =>
        set((state) => withPaperHistory(state, {
          document: updatePaperDocumentSetup(state.document, { dataMerge: source }),
        })),

      updatePaperAnchoredObjects: (relationships) =>
        set((state) => withPaperHistory(state, {
          document: updatePaperDocumentSetup(state.document, { anchoredObjects: relationships }),
        })),

      updatePaperPublicationReferences: (references) =>
        set((state) => withPaperHistory(state, {
          document: updatePaperDocumentSetup(state.document, { publicationReferences: references }),
        })),

      updatePaperTrackChanges: (changes) =>
        set((state) => withPaperHistory(state, { document: updatePaperDocumentSetup(state.document, { trackChanges: changes }) })),

      decidePaperTrackChange: (id, decision) => set((state) => {
        const change = normalizePaperTrackChanges(state.document.trackChanges).find((candidate) => candidate.id === id);
        if (!change || change.status !== 'pending') return state;
        return withPaperHistory(state, { document: applyPaperTrackChange(state.document, change, decision) });
      }),
      addAuthoredNote: (draft) => {
        const state = get();
        const note = createPaperAuthoredNote(state.document, draft);
        if (!note) return undefined;
        const document = upsertPaperAuthoredNote(state.document, {
          ...draft,
          id: note.id,
          now: note.updatedAt,
        });
        if (document === state.document) return undefined;
        set(withPaperHistory(state, { document }));
        return note.id;
      },

      updateAuthoredNote: (draft) => {
        const state = get();
        if (!state.document.authoredNotes?.some((note) => note.id === draft.id)) return undefined;
        const document = upsertPaperAuthoredNote(state.document, draft);
        if (document === state.document) return undefined;
        set(withPaperHistory(state, { document }));
        return draft.id;
      },

      removeAuthoredNote: (noteId) =>
        set((state) => {
          const document = removePaperAuthoredNote(state.document, noteId);
          return document === state.document ? state : withPaperHistory(state, { document });
        }),

      updateStyleAutomation: (patch) =>
        set((state) => withPaperHistory(state, {
          document: updatePaperStyleAutomation(state.document, patch),
        })),

      setTool: (tool) => set({ tool }),
      setZoom: (zoom) => set({ zoom: Math.max(0.15, Math.min(3, zoom)) }),
      selectPage: (selectedPageId) => set({ selectedPageId, selectedFrameId: null, selectedFrameIds: [] }),
      selectFrame: (selectedFrameId) => set({ selectedFrameId, selectedFrameIds: selectedFrameId ? [selectedFrameId] : [] }),
      selectFrameWithMode: (frameId, mode = 'replace') =>
        set((state) => {
          if (!frameId || mode === 'replace') {
            return { selectedFrameId: frameId, selectedFrameIds: frameId ? [frameId] : [] };
          }

          const existing = state.selectedFrameIds;
          if (mode === 'add') {
            const selectedFrameIds = existing.includes(frameId) ? existing : [...existing, frameId];
            return { selectedFrameId: frameId, selectedFrameIds };
          }

          const selectedFrameIds = existing.includes(frameId)
            ? existing.filter((selectedId) => selectedId !== frameId)
            : [...existing, frameId];
          return {
            selectedFrameId: selectedFrameIds.includes(frameId)
              ? frameId
              : selectedFrameIds[selectedFrameIds.length - 1] ?? null,
            selectedFrameIds,
          };
        }),

      addPage: () =>
        set((state) => {
          const document = addPaperPage(state.document);
          return withPaperHistory(state, {
            document,
            selectedPageId: document.pages[document.pages.length - 1].id,
            selectedFrameId: null,
            selectedFrameIds: [],
          });
        }),

      addParentPage: (name) => {
        const state = get();
        const document = addPaperParentPage(state.document, name);
        const parentId = document.parentPages[document.parentPages.length - 1]?.id;
        set(withPaperHistory(state, { document }));
        return parentId;
      },

      deleteParentPage: (parentPageId) =>
        set((state) => withPaperHistory(state, { document: deletePaperParentPage(state.document, parentPageId) })),

      assignParentPage: (pageId, parentPageId) =>
        set((state) => withPaperHistory(state, { document: assignPaperParentPage(state.document, pageId, parentPageId) })),

      addFrameToParentPage: (parentPageId, kind, patch) => {
        const state = get();
        const requestedLayer = patch?.layerId
          ? state.document.layers.find((layer) => layer.id === patch.layerId && !layer.locked)
          : undefined;
        const layerId = requestedLayer?.id ?? state.document.layers.find((layer) => !layer.locked)?.id;
        if (!layerId) return undefined;
        const { document, frameId } = addFrameToPaperParentPage(state.document, parentPageId, {
          kind,
          xMm: patch?.xMm ?? 12,
          yMm: patch?.yMm ?? 12,
          widthMm: patch?.widthMm ?? defaultFrameWidth(kind),
          heightMm: patch?.heightMm ?? defaultFrameHeight(kind),
          ...patch,
          layerId,
        });
        set(withPaperHistory(state, { document }));
        return frameId;
      },

      detachInheritedFrame: (pageId, inheritedFrameId) =>
        set((state) => {
          const result = detachInheritedPaperFrame(state.document, pageId, inheritedFrameId);
          const detached = result.frameId
            ? result.document.pages.find((page) => page.id === pageId)?.frames.find((frame) => frame.id === result.frameId)
            : undefined;
          if (detached && paperFrameLayerIsLocked(state.document, detached)) return state;
          return withPaperHistory(state, {
            document: result.document,
            selectedPageId: pageId,
            selectedFrameId: result.frameId ?? state.selectedFrameId,
            selectedFrameIds: result.frameId ? [result.frameId] : state.selectedFrameIds,
          });
        }),

      duplicatePage: () =>
        set((state) => {
          const document = duplicatePaperPage(state.document, state.selectedPageId);
          return withPaperHistory(state, {
            document,
            selectedPageId: document.pages[document.pages.length - 1].id,
            selectedFrameId: null,
            selectedFrameIds: [],
          });
        }),

      deletePage: () =>
        set((state) => {
          const deletedIndex = state.document.pages.findIndex((page) => page.id === state.selectedPageId);
          const document = removePaperPage(state.document, state.selectedPageId);
          const selectedIndex = Math.min(
            Math.max(0, deletedIndex),
            Math.max(0, document.pages.length - 1),
          );
          return withPaperHistory(state, {
            document,
            selectedPageId: document.pages[selectedIndex]?.id ?? '',
            selectedFrameId: null,
            selectedFrameIds: [],
          });
        }),

      addFrame: (kind, patch) => {
        const state = get();
        const pageId = state.selectedPageId || state.document.pages[0]?.id;
        if (!pageId) return undefined;
        return state.addFrameToPage(pageId, kind, patch);
      },

      addFrameToPage: (pageId, kind, patch) => {
        const state = get();
        const requestedLayer = patch?.layerId
          ? state.document.layers.find((layer) => layer.id === patch.layerId && !layer.locked)
          : undefined;
        const layerId = requestedLayer?.id ?? state.document.layers.find((layer) => !layer.locked)?.id;
        if (!layerId) return undefined;
        const { document, frameId } = addFrameToPaperPage(state.document, pageId, {
          kind,
          xMm: patch?.xMm ?? 24,
          yMm: patch?.yMm ?? 24,
          widthMm: patch?.widthMm ?? defaultFrameWidth(kind),
          heightMm: patch?.heightMm ?? defaultFrameHeight(kind),
          ...patch,
          layerId,
        });
        set(withPaperHistory(state, { document, selectedPageId: pageId, selectedFrameId: frameId, selectedFrameIds: [frameId], tool: 'select' }));
        return frameId;
      },

      addLayer: (name) => {
        const state = get();
        const result = addPaperLayer(state.document, name);
        if (!result.layerId || result.document === state.document) return undefined;
        set(withPaperHistory(state, { document: result.document }));
        return result.layerId;
      },

      renameLayer: (layerId, name) =>
        set((state) => {
          const document = renamePaperLayer(state.document, layerId, name);
          return document === state.document ? state : withPaperHistory(state, { document });
        }),

      moveLayer: (layerId, direction) =>
        set((state) => {
          const document = movePaperLayer(state.document, layerId, direction);
          return document === state.document ? state : withPaperHistory(state, { document });
        }),

      setLayerVisibility: (layerId, visible) =>
        set((state) => {
          const document = updatePaperLayer(state.document, layerId, { visible });
          if (document === state.document) return state;
          return withPaperHistory(state, {
            document,
            ...(!visible ? reconcilePaperSelection(state, document) : {}),
          });
        }),

      setLayerPrintability: (layerId, printable) =>
        set((state) => {
          const document = updatePaperLayer(state.document, layerId, { printable });
          return document === state.document ? state : withPaperHistory(state, { document });
        }),

      setLayerLocked: (layerId, locked) =>
        set((state) => {
          const document = updatePaperLayer(state.document, layerId, { locked });
          return document === state.document ? state : withPaperHistory(state, { document });
        }),

      assignSelectionToLayer: (layerId) =>
        set((state) => {
          const document = assignPaperFramesToLayer(
            state.document,
            state.selectedPageId,
            getSelectedPaperFrameIds(state),
            layerId,
          );
          return document === state.document ? state : withPaperHistory(state, { document });
        }),

      addReviewComment: (draft) => {
        const state = get();
        const result = addPaperReviewComment(state.document, draft);
        if (!result.comment) return undefined;
        set(withPaperHistory(state, { document: result.document }));
        return result.comment.id;
      },

      addReviewReply: (commentId, draft) => {
        const state = get();
        const result = addPaperReviewReply(state.document, commentId, draft);
        if (!result.reply) return undefined;
        set(withPaperHistory(state, { document: result.document }));
        return result.reply.id;
      },

      setReviewCommentResolved: (commentId, resolved) =>
        set((state) => {
          const document = setPaperReviewCommentResolved(state.document, commentId, resolved);
          return document === state.document ? state : withPaperHistory(state, { document });
        }),

      deleteReviewComment: (commentId) =>
        set((state) => {
          const document = deletePaperReviewComment(state.document, commentId);
          return document === state.document ? state : withPaperHistory(state, { document });
        }),

      addPolygonShapeToPage: (pageId, points) => {
        const state = get();
        const result = addPaperPolygonShapeFrame(state.document, pageId, points);
        if (!result.selectedFrameId) return undefined;
        set(withPaperHistory(state, {
          document: result.document,
          selectedPageId: result.selectedPageId ?? pageId,
          selectedFrameId: result.selectedFrameId,
          selectedFrameIds: result.selectedFrameId ? [result.selectedFrameId] : [],
          tool: 'select',
        }));
        return result.selectedFrameId;
      },

      splitPanelFrames: (pageId, start, current) => {
        const state = get();
        const result = splitPaperPanelFrame(state.document, pageId, start, current);
        if (result.document === state.document) return;
        const lockedLayerFrameIds = new Set(state.document.pages
          .find((page) => page.id === pageId)?.frames
          .filter((frame) => paperFrameLayerIsLocked(state.document, frame))
          .map((frame) => frame.id) ?? []);
        const resultFrameIds = new Set(result.document.pages
          .find((page) => page.id === pageId)?.frames.map((frame) => frame.id) ?? []);
        if ([...lockedLayerFrameIds].some((frameId) => !resultFrameIds.has(frameId))) return;
        set(withPaperHistory(state, {
          document: result.document,
          selectedPageId: result.selectedPageId ?? pageId,
          selectedFrameId: result.selectedFrameId ?? null,
          selectedFrameIds: result.selectedFrameId ? [result.selectedFrameId] : [],
        }));
      },

      updateFrame: (pageId, frameId, patch) =>
        set((state) => {
          const document = updatePaperFrame(state.document, pageId, frameId, patch);
          if (document === state.document) return state;
          return withPaperHistory(state, { document });
        }),

      updateSelectedFrame: (patch) => {
        const state = get();
        if (!state.selectedFrameId) return;
        const document = updatePaperFrame(
          state.document,
          state.selectedPageId,
          state.selectedFrameId,
          patch,
        );
        if (document === state.document) return;
        set(withPaperHistory(state, { document }));
      },

      commitBundledFrameTypography: (target) => {
        const state = get();
        // Object identities are deliberate: a reopened/replaced document, page, or same-ID frame is a
        // different Inspector authority and must not be revived by an old exact-face authentication.
        if (
          !isPaperInspectorStoreAuthorityCurrent(target.authority)
          || state.document !== target.document
          || state.selectedPageId !== target.page.id
          || state.selectedFrameId !== target.frame.id
        ) return false;
        const page = state.document.pages.find((candidate) => candidate.id === target.page.id);
        const frame = page?.frames.find((candidate) => candidate.id === target.frame.id);
        if (page !== target.page || frame !== target.frame) return false;
        const updated = updatePaperFrame(state.document, target.page.id, target.frame.id, target.patch);
        if (updated === state.document) return false;
        set(withPaperHistory(state, {
          document: {
            ...updated,
            importedFonts: replacePaperImportedFontFace(updated.importedFonts, target.importedFont),
          },
        }));
        return true;
      },

      redefineSelectedStyle: (kind) => {
        const state = get();
        const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
        const frame = page?.frames.find((candidate) => candidate.id === state.selectedFrameId);
        if (!frame || !isEditablePaperFrame(state.document, frame)) return;
        set(withPaperHistory(state, { document: redefinePaperStyleFromFrame(state.document, frame, kind) }));
      },

      clearSelectedStyleLinks: () => {
        const state = get();
        if (!state.selectedFrameId) return;
        set(withPaperHistory(state, { document: clearPaperFrameStyleLinks(state.document, state.selectedPageId, state.selectedFrameId) }));
      },

      clearSelectedStyleOverrides: () => {
        const state = get();
        if (!state.selectedFrameId) return;
        set(withPaperHistory(state, { document: clearPaperFrameLocalOverrides(state.document, state.selectedPageId, state.selectedFrameId) }));
      },

      chainSelectedBubbles: (style = 'line') =>
        set((state) => {
          const patch = chainSelectedPaperBubblesPatch(state, style);
          return patch ? withPaperHistory(state, patch) : state;
        }),

      chainSelectedBubbleWith: (targetFrameId, style = 'bridge') =>
        set((state) => {
          const patch = chainSelectedPaperBubbleWithPatch(state, targetFrameId, style);
          return patch ? withPaperHistory(state, patch) : state;
        }),

      moveSelectedBubbleInChain: (direction) =>
        set((state) => {
          const patch = moveSelectedPaperBubbleInChainPatch(state, direction);
          return patch ? withPaperHistory(state, patch) : state;
        }),

      unchainBubble: (frameId) =>
        set((state) => {
          const patch = unchainPaperBubblesPatch(state, new Set([frameId]));
          return patch ? withPaperHistory(state, patch) : state;
        }),

      unchainSelectedBubbles: () =>
        set((state) => {
          const patch = unchainSelectedPaperBubblesPatch(state);
          return patch ? withPaperHistory(state, patch) : state;
        }),

      addPaperSwatch: (swatch) =>
        set((state) => withPaperHistory(state, {
          document: { ...state.document, swatches: [...(state.document.swatches ?? []), swatch] },
        })),

      removePaperSwatch: (swatchId) =>
        set((state) => withPaperHistory(state, {
          document: { ...state.document, swatches: (state.document.swatches ?? []).filter((swatch) => swatch.id !== swatchId) },
        })),

      addImportedFont: (font) =>
        set((state) => {
          return withPaperHistory(state, {
            document: {
              ...state.document,
              importedFonts: replacePaperImportedFontFace(state.document.importedFonts, font),
            },
          });
        }),

      removeImportedFont: (fontId) =>
        set((state) => withPaperHistory(state, {
          document: { ...state.document, importedFonts: (state.document.importedFonts ?? []).filter((f) => f.id !== fontId) },
        })),

      threadSelectedFrames: () =>
        set((state) => {
          const patch = threadSelectedPaperFramesPatch(state);
          return patch ? withPaperHistory(state, patch) : state;
        }),

      unthreadSelectedFrames: () =>
        set((state) => {
          const patch = unthreadSelectedPaperFramesPatch(state);
          return patch ? withPaperHistory(state, patch) : state;
        }),

      alignSelectedFrames: (edge) =>
        set((state) => {
          const patch = arrangeSelectedPaperFramesPatch(state, (frames) => alignPaperFrames(frames, edge));
          return patch ? withPaperHistory(state, patch) : state;
        }),

      distributeSelectedFrames: (axis) =>
        set((state) => {
          const patch = arrangeSelectedPaperFramesPatch(state, (frames) => distributePaperFrames(frames, axis));
          return patch ? withPaperHistory(state, patch) : state;
        }),

      replaceAllInPaperText: (query, replacement, options = {}) => {
        const state = get();
        const { patch, count } = replaceAllInPaperTextPatch(state, query, replacement, options);
        if (patch) set(withPaperHistory(state, patch));
        return count;
      },

      addComicSfx: (presetId, options) => {
        const state = get();
        const pageId = options?.pageId || state.selectedPageId || state.document.pages[0]?.id;
        const page = state.document.pages.find((candidate) => candidate.id === pageId);
        if (!page) return undefined;
        const layerId = state.document.layers.find((layer) => !layer.locked)?.id;
        if (!layerId) return undefined;
        const origin = options?.point ?? {
          xMm: 20 + (page.frames.length % 4) * 8,
          yMm: 24 + (page.frames.length % 5) * 6,
        };
        const result = buildPaperComicSfxDecalFrame({
          presetId,
          origin,
          text: options?.text,
          design: options?.design,
          zIndexStart: nextPaperFrameZIndex(page.frames),
        });
        const document = addFrameToPaperPage(state.document, pageId, { ...result.frame, layerId }).document;

        set(withPaperHistory(state, {
          document,
          selectedPageId: pageId,
          selectedFrameId: result.primaryFrameId,
          selectedFrameIds: result.selectedFrameIds,
          tool: 'select',
        }));
        return result.primaryFrameId;
      },

      nudgeSelectedFrame: (deltaXMm, deltaYMm) => {
        const state = get();
        const frameIds = state.selectedFrameIds.length ? state.selectedFrameIds : state.selectedFrameId ? [state.selectedFrameId] : [];
        if (!frameIds.length) return;
        let document = state.document;
        let selectedPageId = state.selectedPageId;
        for (const frameId of frameIds) {
          const frame = document.pages
            .find((page) => page.id === selectedPageId)
            ?.frames.find((candidate) => candidate.id === frameId);
          if (!frame || !isEditablePaperFrame(document, frame)) continue;
          const result = nudgePaperFrame(
            document,
            selectedPageId,
            frameId,
            deltaXMm,
            deltaYMm,
          );
          document = result.document;
          selectedPageId = result.selectedPageId ?? selectedPageId;
        }
        if (document === state.document) return;
        set(withPaperHistory(state, {
          document,
          selectedPageId,
          selectedFrameId: state.selectedFrameId,
          selectedFrameIds: frameIds,
        }));
      },

      selectAllFramesOnSelectedPage: () =>
        set((state) => {
          const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
          const selectedFrameIds = page?.frames
            .filter((frame) => paperFrameLayerIsVisible(state.document, frame))
            .map((frame) => frame.id) ?? [];
          return { selectedFrameId: selectedFrameIds[0] ?? null, selectedFrameIds };
        }),

      deselectFrames: () => set({ selectedFrameId: null, selectedFrameIds: [] }),

      invertFrameSelectionOnSelectedPage: () =>
        set((state) => {
          const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
          if (!page?.frames.length) return { selectedFrameId: null };
          const selected = new Set(state.selectedFrameIds);
          const selectedFrameIds = page.frames
            .filter((frame) => paperFrameLayerIsVisible(state.document, frame))
            .map((frame) => frame.id)
            .filter((frameId) => !selected.has(frameId));
          return { selectedFrameId: selectedFrameIds[0] ?? null, selectedFrameIds };
        }),

      addGuideToPage: (pageId, guide) => {
        const guideId = guide.id ?? `guide-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
        set((state) => withPaperHistory(state, {
          document: {
            ...state.document,
            view: {
              ...state.document.view,
              showGuides: true,
            },
            pages: state.document.pages.map((page) =>
              page.id === pageId
                ? {
                    ...page,
                    guides: [
                      ...page.guides,
                      {
                        ...guide,
                        id: guideId,
                        positionMm: Math.max(0, guide.positionMm),
                      },
                    ],
                  }
                : page,
            ),
            updatedAt: Date.now(),
          },
          selectedPageId: pageId,
        }));
        return guideId;
      },

      updateGuide: (pageId, guideId, patch) =>
        set((state) => withPaperHistory(state, {
          document: {
            ...state.document,
            pages: state.document.pages.map((page) =>
              page.id === pageId
                ? {
                    ...page,
                    guides: page.guides.map((guide) =>
                      guide.id === guideId
                        ? { ...guide, ...patch }
                        : guide,
                    ),
                  }
                : page,
            ),
            updatedAt: Date.now(),
          },
        })),

      placeSourceAsset: (item, targetFrameId) => {
        const state = get();
        const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
        if (!page) return;
        get().placeSourceAssetAt({
          item,
          pageId: page.id,
          targetFrameId: targetFrameId ?? state.selectedFrameId,
          point: targetFrameId || state.selectedFrameId
            ? undefined
            : { xMm: 24, yMm: 24 + page.frames.length * 8 },
        });
      },

      placeSourceAssetAt: ({ item, pageId, targetFrameId, point }) =>
        set((state) => {
          const resolvedPageId = pageId || state.selectedPageId || state.document.pages[0]?.id;
          if (!resolvedPageId) return state;
          const targetFrame = targetFrameId
            ? state.document.pages.find((page) => page.id === resolvedPageId)?.frames.find((frame) => frame.id === targetFrameId)
            : undefined;
          if (targetFrame && !isEditablePaperFrame(state.document, targetFrame)) return state;
          const result = placeSourceAssetOnPaperPage(state.document, {
            pageId: resolvedPageId,
            frameId: targetFrameId,
            item,
            point,
          });
          const document = targetFrame
            ? result.document
            : assignNewPaperFramesToFirstUnlockedLayer(state.document, result.document, resolvedPageId);
          if (document === state.document) return state;
          return withPaperHistory(state, {
            document,
            selectedPageId: result.selectedPageId ?? resolvedPageId,
            selectedFrameId: result.selectedFrameId ?? null,
            selectedFrameIds: result.selectedFrameId ? [result.selectedFrameId] : [],
            tool: 'select',
          });
        }),

      runFrameContextAction: (pageId, frameId, actionId) =>
        set((state) => {
          const activeSelection = state.selectedFrameIds.includes(frameId) && state.selectedFrameIds.length > 1
            ? state.selectedFrameIds
            : [frameId];
          const page = state.document.pages.find((candidate) => candidate.id === pageId);
          if ((page?.frames ?? [])
            .filter((frame) => activeSelection.includes(frame.id))
            .some((frame) => (
              frame.inherited
              || paperFrameLayerIsLocked(state.document, frame)
              || (frame.locked && actionId !== 'unlock-frame')
            ))) return state;
          const result = activeSelection.length > 1
            ? applyPaperFrameGroupContextAction(state.document, pageId, activeSelection, actionId)
            : applyPaperFrameContextAction(state.document, pageId, frameId, actionId);
          return withPaperHistory(state, {
            document: result.document,
            selectedPageId: result.selectedPageId ?? pageId,
            selectedFrameId: result.selectedFrameId === undefined ? frameId : result.selectedFrameId,
            selectedFrameIds: activeSelection.length > 1 && result.selectedFrameId
              ? activeSelection.filter((selectedId) =>
                result.document.pages
                  .find((page) => page.id === (result.selectedPageId ?? pageId))
                  ?.frames.some((candidate) => candidate.id === selectedId),
              )
              : result.selectedFrameId === undefined
                ? [frameId]
                : result.selectedFrameId
                  ? [result.selectedFrameId]
                : [],
            tool: 'select',
          });
        }),

      runPageContextAction: (pageId, actionId, options) =>
        set((state) => {
          const result = applyPaperPageContextAction(state.document, pageId, actionId, options);
          const document = actionId.startsWith('add-')
            ? assignNewPaperFramesToFirstUnlockedLayer(state.document, result.document, pageId)
            : result.document;
          if (document === state.document) return state;
          return withPaperHistory(state, {
            document,
            selectedPageId: result.selectedPageId ?? pageId,
            selectedFrameId: result.selectedFrameId ?? null,
            selectedFrameIds: result.selectedFrameId ? [result.selectedFrameId] : [],
            tool: 'select',
          });
        }),

      toggleViewOption: (option) =>
        set((state) => withPaperHistory(state, {
          document: {
            ...state.document,
            view: {
              ...state.document.view,
              [option]: !state.document.view[option],
            },
            updatedAt: Date.now(),
          },
        })),

      setViewOption: (option, value) =>
        set((state) => withPaperHistory(state, {
          document: {
            ...state.document,
            view: {
              ...state.document.view,
              [option]: value,
            },
            updatedAt: Date.now(),
          },
        })),

      exportSnapshot: (options) => {
        const state = get();
        const documents = syncActivePaperDocument(state);
        const assetIds = [...new Set(documents.flatMap((workspaceDocument) => workspaceDocument.assetIds ?? []))];
        const exportedDocuments = options?.includeLocalPersistence
          ? documents
          : documents.map(({ persistence: _persistence, ...workspaceDocument }) => workspaceDocument);
        return {
          document: state.document,
          assetIds,
          selectedPageId: state.selectedPageId,
          selectedFrameId: state.selectedFrameId ?? undefined,
          selectedFrameIds: state.selectedFrameIds,
          tool: state.tool,
          zoom: state.zoom,
          documents: exportedDocuments,
          activeDocumentId: state.activeDocumentId,
          // Carrying the recovery record through saves keeps quarantined tab payloads
          // recoverable instead of silently destroying them on the next write.
          ...(state.recovery ? { recovery: state.recovery } : {}),
        };
      },

      restoreSnapshot: (snapshot, options) => {
        const nextState = sanitizePaperSnapshot(
          snapshot,
          options?.baseline ?? (snapshot === undefined ? 'new' : 'project'),
        );
        if (nextState.recovery) {
          console.warn(
            `[paper] Restored with recovery diagnostics: ${nextState.recovery.quarantinedDocuments.length} quarantined tab(s), ${nextState.recovery.repairs.length} repair note(s).`,
            nextState.recovery,
          );
        }
        set({
          ...nextState,
          undoStack: [],
          redoStack: [],
          clipboardFrames: get().clipboardFrames,
          styleClipboard: get().styleClipboard,
          // Deliberate-discard copies are local recovery state and survive project replacement.
          discardedDocumentRecoveries: get().discardedDocumentRecoveries,
        });
      },

      applyRemotePaperDocumentChange: (change) => {
        if (isPaperWorkspaceSnapshotChange(change)) {
          return get().applyRemotePaperWorkspaceSnapshot(change.workspace);
        }
        let changed = false;
        set((state) => {
          const documents = syncActivePaperDocument(state);
          const targetId = findLegacyPaperChangeTarget(documents, state.activeDocumentId, change);
          if (!targetId) return {};
          const target = documents.find((candidate) => candidate.id === targetId);
          if (!target) return {};
          const nextDocument = applyPaperDocumentNativeChange(target.document, change);
          if (nextDocument === target.document) return {};
          changed = true;
          const selection = reconcilePaperWorkspaceSelection(target, nextDocument);
          const nextDocuments = documents.map((candidate) => candidate.id === targetId
            ? {
              ...candidate,
              document: nextDocument,
              assetIds: collectReachablePaperAssetIds(nextDocument),
              ...selection,
            }
            : candidate);
          if (targetId !== state.activeDocumentId) {
            return {
              documents: nextDocuments,
            };
          }
          return {
            documents: nextDocuments,
            document: nextDocument,
            ...reconcilePaperSelection(state, nextDocument),
            // A legacy peer's remote operation is collaboration, not a destructive document
            // replacement. Preserve this device's per-tab Undo/Redo ownership just like the current
            // workspace-envelope path below.
            undoStack: state.undoStack,
            redoStack: state.redoStack,
            documentHistories: state.documentHistories,
          };
        });
        return changed;
      },

      applyRemotePaperWorkspaceSnapshot: (workspace) => {
        let changed = false;
        set((state) => {
          const declaredActive = workspace.documents.find(
            (candidate) => candidate.id === workspace.activeDocumentId,
          );
          if (!declaredActive) return {};
          const sanitized = sanitizePaperSnapshot({
            document: declaredActive.document,
            documents: workspace.documents,
            activeDocumentId: workspace.activeDocumentId,
          }, 'preserve');
          const existingById = new Map(syncActivePaperDocument(state).map((candidate) => [candidate.id, candidate]));
          const nextDocuments = sanitized.documents.map((candidate) => ({
            ...candidate,
            persistence: existingById.get(candidate.id)?.persistence ?? { kind: 'new' as const },
          }));
          const active = nextDocuments.find((candidate) => candidate.id === sanitized.activeDocumentId);
          if (!active) return {};
          if (samePaperWorkspaceSyncState(state, nextDocuments, active.id)) return {};
          changed = true;
          const documentInstanceIds = Object.fromEntries(nextDocuments.map((candidate) => [
            candidate.id,
            state.documentInstanceIds[candidate.id] ?? makePaperRuntimeId('paper-tab-instance'),
          ]));
          return {
            documents: nextDocuments,
            documentInstanceIds,
            activeDocumentId: active.id,
            ...paperStatePatchFromWorkspaceSnapshot(active),
            // Cross-device reconciliation is not a destructive workspace replacement. Preserve each
            // tab's session-local history; clearing every stack on every phone/desktop edit made Undo
            // appear randomly broken during collaboration.
            undoStack: state.undoStack,
            redoStack: state.redoStack,
            documentHistories: state.documentHistories,
          };
        });
        return changed;
      },

      mutatePaperDocumentForLiveAgent: (mutate) => {
        let changed = false;
        set((state) => {
          const result = mutate(state.document);
          if (!result.changed || result.document === state.document) return state;
          changed = true;
          return withPaperHistory(state, {
            document: result.document,
            ...reconcilePaperSelection(state, result.document),
          });
        });
        return changed;
      },
    }),
    {
      name: 'signal-loom-paper-workspace',
      partialize: projectPersistedPaperWorkspace,
      // createJSONStorage reports an absent profile record as `undefined`. The helper keeps the
      // exact boot-created canonical blank baseline in that one case; real persisted records
      // still pass through the fail-closed sanitizer.
      merge: mergePersistedPaperWorkspace,
    },
  ),
);

function samePaperFrameSelection(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((frameId, index) => frameId === right[index]);
}

usePaperStore.subscribe((state, previous) => {
  // These are exactly the live inputs used by Inspector authority. Runtime/UI-only updates such as
  // zoom, tool, clipboard, persistence bookkeeping, or background-tab metadata do not revoke it.
  if (
    state.activeDocumentId !== previous.activeDocumentId
    || state.document !== previous.document
    || state.selectedPageId !== previous.selectedPageId
    || state.selectedFrameId !== previous.selectedFrameId
    || !samePaperFrameSelection(state.selectedFrameIds, previous.selectedFrameIds)
  ) {
    paperInspectorStoreAuthorityGeneration += 1;
  }
});

function sanitizePaperSnapshot(
  snapshot: unknown,
  baseline: 'new' | 'project' | 'preserve' = 'project',
): PaperState {
  const input = isRecord(snapshot) ? snapshot : {};
  const fallbackDocument = sanitizePaperDocument(input.document);
  const legacyWorkspaceDocument = sanitizePaperWorkspaceDocumentSnapshot({
    id: fallbackDocument.id || initialDocumentId,
    document: fallbackDocument,
    selectedPageId: input.selectedPageId,
    selectedFrameId: input.selectedFrameId,
    selectedFrameIds: input.selectedFrameIds,
    tool: input.tool,
    zoom: input.zoom,
  }, baseline) ?? createPaperWorkspaceDocumentSnapshot(initialDocumentId, fallbackDocument, {
    persistence: baseline === 'project'
      ? createSavedPaperPersistence(fallbackDocument, 'project')
      : { kind: 'new' },
  });
  const documents = Array.isArray(input.documents)
    ? input.documents
      .map((candidate) => sanitizePaperWorkspaceDocumentSnapshot(candidate, baseline))
      .filter((candidate): candidate is PaperWorkspaceDocumentSnapshot => candidate !== null)
    : [];
  const uniqueDocuments = deduplicatePaperWorkspaceDocuments(documents.length ? documents : [legacyWorkspaceDocument]);
  const requestedActiveDocumentId = typeof input.activeDocumentId === 'string' ? input.activeDocumentId : '';
  const activeWorkspaceDocument = uniqueDocuments.find((candidate) => candidate.id === requestedActiveDocumentId)
    ?? uniqueDocuments[0]
    ?? legacyWorkspaceDocument;
  const document = activeWorkspaceDocument.document;
  const selectedPageId = activeWorkspaceDocument.selectedPageId ?? document.pages[0]?.id ?? '';
  const selectedFrameId = activeWorkspaceDocument.selectedFrameId ?? null;
  const selectedFrameIds = activeWorkspaceDocument.selectedFrameIds ?? (selectedFrameId ? [selectedFrameId] : []);
  return {
    documents: uniqueDocuments.length ? uniqueDocuments : [activeWorkspaceDocument],
    documentInstanceIds: Object.fromEntries(
      (uniqueDocuments.length ? uniqueDocuments : [activeWorkspaceDocument])
        .map((workspaceDocument) => [workspaceDocument.id, makePaperRuntimeId('paper-tab-instance')]),
    ),
    activeDocumentId: activeWorkspaceDocument.id,
    document,
    selectedPageId,
    selectedFrameId,
    selectedFrameIds,
    tool: activeWorkspaceDocument.tool,
    zoom: activeWorkspaceDocument.zoom,
    undoStack: [],
    redoStack: [],
    documentHistories: {},
    clipboardFrames: [],
    styleClipboard: null,
    recovery: sanitizePaperSnapshotRecovery(input.recovery) ?? null,
    discardedDocumentRecoveries: sanitizePaperDiscardRecoveries(input.discardedDocumentRecoveries),
  };
}

function sanitizePaperWorkspaceDocumentSnapshot(
  value: unknown,
  baseline: 'new' | 'project' | 'preserve' = 'preserve',
): PaperWorkspaceDocumentSnapshot | null {
  if (!isRecord(value)) return null;
  const document = sanitizePaperDocument(value.document);
  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id
    : document.id || makePaperRuntimeId('paper-document');
  const selectedPageId = typeof value.selectedPageId === 'string' && document.pages.some((page) => page.id === value.selectedPageId)
    ? value.selectedPageId
    : document.pages[0]?.id ?? '';
  const selectedPage = document.pages.find((page) => page.id === selectedPageId);
  const selectedFrameId = typeof value.selectedFrameId === 'string' && selectedPage?.frames.some((frame) => frame.id === value.selectedFrameId)
    ? value.selectedFrameId
    : null;
  const validFrameIds = new Set(selectedPage?.frames.map((frame) => frame.id) ?? []);
  const selectedFrameIds = Array.isArray(value.selectedFrameIds)
    ? value.selectedFrameIds.filter((frameId): frameId is string => typeof frameId === 'string' && validFrameIds.has(frameId))
    : selectedFrameId
      ? [selectedFrameId]
      : [];
  const persistence = baseline === 'project'
    ? createSavedPaperPersistence(document, 'project')
    : baseline === 'new'
      ? { kind: 'new' as const }
      : sanitizePaperPersistence(value.persistence) ?? { kind: 'new' as const };
  return {
    id,
    document,
    assetIds: collectReachablePaperAssetIds(document),
    selectedPageId,
    selectedFrameId: selectedFrameId ?? selectedFrameIds[0] ?? undefined,
    selectedFrameIds,
    tool: isPaperTool(value.tool) ? value.tool : 'select',
    zoom: clampZoom(value.zoom),
    persistence,
  };
}

function createPaperWorkspaceDocumentSnapshot(
  id: string,
  document: PaperDocument,
  options: Partial<Omit<PaperWorkspaceDocumentSnapshot, 'id' | 'document' | 'assetIds'>> = {},
): PaperWorkspaceDocumentSnapshot {
  return sanitizePaperWorkspaceDocumentSnapshot({
    id,
    document,
    selectedPageId: options.selectedPageId,
    selectedFrameId: options.selectedFrameId,
    selectedFrameIds: options.selectedFrameIds,
    tool: options.tool ?? 'select',
    zoom: options.zoom ?? 0.8,
    persistence: options.persistence ?? { kind: 'new' },
  }, 'preserve') ?? {
    id,
    document,
    assetIds: collectReachablePaperAssetIds(document),
    selectedPageId: document.pages[0]?.id ?? '',
    selectedFrameIds: [],
    tool: 'select',
    zoom: 0.8,
    persistence: options.persistence ?? { kind: 'new' },
  };
}

function snapshotActivePaperDocument(state: PaperState): PaperWorkspaceDocumentSnapshot {
  const currentPersistence = state.documents
    .find((candidate) => candidate.id === state.activeDocumentId)?.persistence;
  return createPaperWorkspaceDocumentSnapshot(state.activeDocumentId, state.document, {
    selectedPageId: state.selectedPageId,
    selectedFrameId: state.selectedFrameId ?? undefined,
    selectedFrameIds: state.selectedFrameIds,
    tool: state.tool,
    zoom: state.zoom,
    persistence: currentPersistence ?? { kind: 'new' },
  });
}

function syncActivePaperDocument(state: PaperState): PaperWorkspaceDocumentSnapshot[] {
  const activeDocument = snapshotActivePaperDocument(state);
  const activeIndex = state.documents.findIndex((candidate) => candidate.id === state.activeDocumentId);
  if (activeIndex < 0) return [...state.documents, activeDocument];
  return state.documents.map((candidate, index) => index === activeIndex ? activeDocument : candidate);
}

/**
 * Old clients address one document implicitly. Route their ops only when identity is unambiguous;
 * this preserves single-tab interoperability without letting a tab switch overwrite an unrelated
 * active body on a modern multi-tab receiver.
 */
function findLegacyPaperChangeTarget(
  documents: PaperWorkspaceDocumentSnapshot[],
  activeDocumentId: string,
  change: PaperDocumentNativeChange,
): string | null {
  if (change.type === 'paper-document-snapshot') {
    const matches = documents.filter((candidate) =>
      candidate.id === change.document.id || candidate.document.id === change.document.id);
    if (matches.length === 1) return matches[0].id;
    if (matches.length === 0 && documents.length === 1) return documents[0].id;
    return null;
  }

  const matches = documents.filter((candidate) =>
    candidate.document.pages.some((page) => page.id === change.pageId));
  if (matches.length === 1) return matches[0].id;
  // Duplicate page identities are malformed/ambiguous. Even preferring the active tab could apply an
  // older sender's edit to unrelated content, so fail closed.
  if (matches.length > 1) return null;
  const active = documents.find((candidate) => candidate.id === activeDocumentId);
  return active?.document.pages.some((page) => page.id === change.pageId) ? active.id : null;
}

function reconcilePaperWorkspaceSelection(
  workspaceDocument: PaperWorkspaceDocumentSnapshot,
  document: PaperDocument,
): Pick<PaperWorkspaceDocumentSnapshot, 'selectedPageId' | 'selectedFrameId' | 'selectedFrameIds'> {
  const selectedPageId = workspaceDocument.selectedPageId
    && document.pages.some((page) => page.id === workspaceDocument.selectedPageId)
    ? workspaceDocument.selectedPageId
    : document.pages[0]?.id ?? '';
  const page = document.pages.find((candidate) => candidate.id === selectedPageId);
  const validFrameIds = new Set(page?.frames
    .filter((frame) => paperFrameLayerIsVisible(document, frame))
    .map((frame) => frame.id) ?? []);
  const selectedFrameId = workspaceDocument.selectedFrameId
    && validFrameIds.has(workspaceDocument.selectedFrameId)
    ? workspaceDocument.selectedFrameId
    : undefined;
  const selectedFrameIds = (workspaceDocument.selectedFrameIds ?? [])
    .filter((frameId) => validFrameIds.has(frameId));
  return {
    selectedPageId,
    selectedFrameId: selectedFrameId ?? selectedFrameIds[0],
    selectedFrameIds,
  };
}

function samePaperWorkspaceSyncState(
  state: PaperState,
  nextDocuments: PaperWorkspaceDocumentSnapshot[],
  nextActiveDocumentId: string,
): boolean {
  if (state.activeDocumentId !== nextActiveDocumentId) return false;
  const syncProjection = (documents: PaperWorkspaceDocumentSnapshot[]) => documents.map(
    ({ persistence: _localPersistence, ...candidate }) => candidate,
  );
  return JSON.stringify(syncProjection(syncActivePaperDocument(state)))
    === JSON.stringify(syncProjection(nextDocuments));
}

function paperStatePatchFromWorkspaceSnapshot(
  workspaceDocument: PaperWorkspaceDocumentSnapshot,
): Pick<PaperState, 'document' | 'selectedPageId' | 'selectedFrameId' | 'selectedFrameIds' | 'tool' | 'zoom'> {
  return {
    document: workspaceDocument.document,
    selectedPageId: workspaceDocument.selectedPageId ?? workspaceDocument.document.pages[0]?.id ?? '',
    selectedFrameId: workspaceDocument.selectedFrameId ?? null,
    selectedFrameIds: workspaceDocument.selectedFrameIds ?? [],
    tool: workspaceDocument.tool,
    zoom: workspaceDocument.zoom,
  };
}

function deduplicatePaperWorkspaceDocuments(
  documents: PaperWorkspaceDocumentSnapshot[],
): PaperWorkspaceDocumentSnapshot[] {
  const seen = new Set<string>();
  return documents.map((document) => {
    let id = document.id;
    if (seen.has(id)) {
      let suffix = 2;
      while (seen.has(`${document.id}-${suffix}`)) suffix += 1;
      id = `${document.id}-${suffix}`;
    }
    seen.add(id);
    return id === document.id ? document : { ...document, id };
  });
}

function makeUniquePaperDocumentTabId(
  preferredId: string | undefined,
  documents: Pick<PaperWorkspaceDocumentSnapshot, 'id'>[],
): string {
  const baseId = preferredId?.trim() || makePaperRuntimeId('paper-document');
  const existingIds = new Set(documents.map((document) => document.id));
  if (!existingIds.has(baseId)) return baseId;
  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

function createPaperHistorySnapshot(state: PaperState): PaperHistorySnapshot {
  return {
    document: state.document,
    selectedPageId: state.selectedPageId,
    selectedFrameId: state.selectedFrameId,
    selectedFrameIds: state.selectedFrameIds,
    tool: state.tool,
    zoom: state.zoom,
  };
}

function pushPaperHistory(state: PaperState): PaperHistorySnapshot[] {
  return [...state.undoStack, createPaperHistorySnapshot(state)].slice(-MAX_PAPER_HISTORY);
}

function withPaperHistory<TPatch extends Partial<PaperState>>(state: PaperState, patch: TPatch): TPatch & Pick<PaperState, 'undoStack' | 'redoStack'> {
  return {
    ...patch,
    undoStack: pushPaperHistory(state),
    redoStack: [],
  };
}

function removePaperDocumentHistory(
  documentHistories: Record<string, PaperDocumentHistory>,
  documentId: string,
): Record<string, PaperDocumentHistory> {
  if (!(documentId in documentHistories)) return documentHistories;
  const { [documentId]: _removed, ...retained } = documentHistories;
  return retained;
}

/** Stash the active tab's live stacks under its id before focus moves away; empty stacks stay unstored. */
function stashActivePaperDocumentHistory(state: PaperState): Record<string, PaperDocumentHistory> {
  if (!state.undoStack.length && !state.redoStack.length) {
    return removePaperDocumentHistory(state.documentHistories, state.activeDocumentId);
  }
  return {
    ...state.documentHistories,
    [state.activeDocumentId]: { undoStack: state.undoStack, redoStack: state.redoStack },
  };
}

/** Promote a tab's stashed stacks onto the live undo/redo surface as it becomes active. */
function restorePaperDocumentHistoryPatch(
  documentHistories: Record<string, PaperDocumentHistory>,
  documentId: string,
): Pick<PaperState, 'documentHistories' | 'undoStack' | 'redoStack'> {
  const stored = documentHistories[documentId];
  return {
    documentHistories: removePaperDocumentHistory(documentHistories, documentId),
    undoStack: stored?.undoStack ?? [],
    redoStack: stored?.redoStack ?? [],
  };
}

/** A created, opened, or replaced document starts with no history and never inherits a stale stash. */
function freshPaperDocumentHistoryPatch(
  documentHistories: Record<string, PaperDocumentHistory>,
  documentId: string,
): Pick<PaperState, 'documentHistories' | 'undoStack' | 'redoStack'> {
  return {
    documentHistories: removePaperDocumentHistory(documentHistories, documentId),
    undoStack: [],
    redoStack: [],
  };
}

/** A tab's own history wherever it currently lives: the live stacks when active, its stash otherwise. */
function paperHistoryForDocument(state: PaperState, documentId: string): PaperDocumentHistory {
  if (documentId === state.activeDocumentId) {
    return { undoStack: state.undoStack, redoStack: state.redoStack };
  }
  return state.documentHistories[documentId] ?? { undoStack: [], redoStack: [] };
}

/**
 * After a remote op replaces the document, keep the local selection valid: fall back to the first page
 * if the selected page vanished, and drop any selected frame ids that no longer exist on the selected
 * page. View state (tool/zoom) is intentionally left alone — each client keeps its own viewport.
 */
function reconcilePaperSelection(
  state: PaperState,
  document: PaperDocument,
): Pick<PaperState, 'selectedPageId' | 'selectedFrameId' | 'selectedFrameIds'> {
  const pageExists = document.pages.some((page) => page.id === state.selectedPageId);
  const selectedPageId = pageExists ? state.selectedPageId : document.pages[0]?.id ?? state.selectedPageId;
  const page = document.pages.find((candidate) => candidate.id === selectedPageId);
  const validFrameIds = new Set(page?.frames
    .filter((frame) => paperFrameLayerIsVisible(document, frame))
    .map((frame) => frame.id) ?? []);
  const selectedFrameId =
    state.selectedFrameId && validFrameIds.has(state.selectedFrameId) ? state.selectedFrameId : null;
  const selectedFrameIds = state.selectedFrameIds.filter((frameId) => validFrameIds.has(frameId));
  return { selectedPageId, selectedFrameId, selectedFrameIds };
}

function getSelectedPaperFrameIds(state: PaperState): string[] {
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  if (!page) return [];
  const validIds = new Set(page.frames.map((frame) => frame.id));
  const selectedIds = state.selectedFrameIds.length
    ? state.selectedFrameIds
    : state.selectedFrameId
      ? [state.selectedFrameId]
      : [];
  return selectedIds.filter((frameId) => validIds.has(frameId));
}

function getSelectedPaperFrames(state: PaperState): PaperFrame[] {
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  if (!page) return [];
  const selectedIds = new Set(getSelectedPaperFrameIds(state));
  return page.frames.filter((frame) => selectedIds.has(frame.id));
}

/** Route newly created page objects onto the first unlocked layer without changing existing objects. */
function assignNewPaperFramesToFirstUnlockedLayer(
  before: PaperDocument,
  after: PaperDocument,
  pageId: string,
): PaperDocument {
  if (after === before) return before;
  const layerId = before.layers.find((layer) => !layer.locked)?.id;
  if (!layerId) return before;
  const existingIds = new Set(before.pages.find((page) => page.id === pageId)?.frames.map((frame) => frame.id) ?? []);
  let changed = false;
  const pages = after.pages.map((page) => {
    if (page.id !== pageId) return page;
    const frames = page.frames.map((frame) => {
      if (existingIds.has(frame.id) || frame.layerId === layerId) return frame;
      changed = true;
      return { ...frame, layerId };
    });
    return changed ? { ...page, frames } : page;
  });
  return changed ? { ...after, pages } : after;
}

function deletePaperSelectionPatch(state: PaperState): Pick<PaperState, 'document' | 'selectedFrameId' | 'selectedFrameIds'> {
  const selectedIds = new Set(getSelectedPaperFrameIds(state));
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  const deletableIds = new Set((page?.frames ?? [])
    .filter((frame) => (
      selectedIds.has(frame.id)
      && !frame.locked
      && !frame.inherited
      && !paperFrameLayerIsLocked(state.document, frame)
    ))
    .map((frame) => frame.id));
  if (!deletableIds.size) {
    return {
      document: state.document,
      selectedFrameId: state.selectedFrameId,
      selectedFrameIds: state.selectedFrameIds,
    };
  }

  const documentWithoutFrames: PaperDocument = {
    ...state.document,
    pages: state.document.pages.map((page) =>
      page.id === state.selectedPageId
        ? { ...page, frames: page.frames.filter((frame) => !deletableIds.has(frame.id)) }
        : page,
    ),
    updatedAt: Date.now(),
  };
  return {
    document: removePaperAnchoredObjectsForFrames(documentWithoutFrames, deletableIds),
    selectedFrameId: null,
    selectedFrameIds: [],
  };
}

function replaceAllInPaperTextPatch(
  state: PaperState,
  query: string,
  replacement: string,
  options: PaperFindOptions,
): { patch?: Pick<PaperState, 'document'>; count: number } {
  const refs = state.document.pages.flatMap((page) =>
    page.frames
      .filter((frame) => frame.kind === 'text' && isEditablePaperFrame(state.document, frame))
      .map((frame) => ({ pageId: page.id, frameId: frame.id, text: frame.text ?? '' })));
  const count = findPaperMatches(refs, query, options).length;
  if (count === 0) return { count: 0 };

  const document = {
    ...state.document,
    pages: state.document.pages.map((page) => ({
      ...page,
      frames: page.frames.map((frame) => (frame.kind === 'text' && frame.text && isEditablePaperFrame(state.document, frame)
        ? { ...frame, text: replaceAllInText(frame.text, query, replacement, options) }
        : frame)),
    })),
    updatedAt: Date.now(),
  };
  return { patch: { document }, count };
}

function arrangeSelectedPaperFramesPatch(
  state: PaperState,
  compute: (frames: { id: string; xMm: number; yMm: number; widthMm: number; heightMm: number }[]) => Map<string, { xMm?: number; yMm?: number }>,
): Pick<PaperState, 'document'> | undefined {
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  if (!page) return undefined;
  const selectedIds = new Set(getSelectedPaperFrameIds(state));
  const selected = page.frames.filter((frame) => (
    selectedIds.has(frame.id)
    && !frame.locked
    && !frame.inherited
    && !paperFrameLayerIsLocked(state.document, frame)
  ));
  const patches = compute(selected.map((frame) => ({ id: frame.id, xMm: frame.xMm, yMm: frame.yMm, widthMm: frame.widthMm, heightMm: frame.heightMm })));
  if (patches.size === 0) return undefined;

  const document = {
    ...state.document,
    pages: state.document.pages.map((candidate) => candidate.id === page.id
      ? { ...candidate, frames: candidate.frames.map((frame) => patches.has(frame.id) ? { ...frame, ...patches.get(frame.id) } : frame) }
      : candidate),
    updatedAt: Date.now(),
  };
  return { document };
}

function threadSelectedPaperFramesPatch(state: PaperState): Pick<PaperState, 'document'> | undefined {
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  if (!page) return undefined;
  const selectedOrder = getSelectedPaperFrameIds(state);
  const selectedOrderIndex = new Map(selectedOrder.map((frameId, index) => [frameId, index]));
  const selectedTextFrames = page.frames
    .filter((frame) => (
      selectedOrderIndex.has(frame.id)
      && frame.kind === 'text'
      && isEditablePaperFrame(state.document, frame)
    ))
    .sort((a, b) => selectedOrderIndex.get(a.id)! - selectedOrderIndex.get(b.id)!);

  if (selectedTextFrames.length < 2) return undefined;

  const threadId = makePaperRuntimeId('text-thread');
  const order = new Map(selectedTextFrames.map((frame, index) => [frame.id, index + 1]));
  const document = {
    ...state.document,
    pages: state.document.pages.map((candidate) => candidate.id === page.id
      ? {
          ...candidate,
          frames: candidate.frames.map((frame) => order.has(frame.id)
            ? { ...frame, threadId, threadOrder: order.get(frame.id)! }
            : frame),
        }
      : candidate),
    updatedAt: Date.now(),
  };
  return { document };
}

function unthreadSelectedPaperFramesPatch(state: PaperState): Pick<PaperState, 'document'> | undefined {
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  if (!page) return undefined;
  const selectedIds = new Set(getSelectedPaperFrameIds(state));
  if (!page.frames.some((frame) => (
    selectedIds.has(frame.id)
    && Boolean(frame.threadId)
    && isEditablePaperFrame(state.document, frame)
  ))) return undefined;

  const document = {
    ...state.document,
    pages: state.document.pages.map((candidate) => candidate.id === page.id
      ? {
          ...candidate,
          frames: candidate.frames.map((frame) => (
            selectedIds.has(frame.id)
            && frame.threadId
            && isEditablePaperFrame(state.document, frame)
          )
            ? { ...frame, threadId: undefined, threadOrder: undefined }
            : frame),
        }
      : candidate),
    updatedAt: Date.now(),
  };
  return { document };
}

function chainSelectedPaperBubblesPatch(
  state: PaperState,
  style: PaperBubbleConnectorStyle,
): Pick<PaperState, 'document'> | undefined {
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  if (!page) return undefined;
  const selectedOrder = getSelectedPaperFrameIds(state);
  const selectedOrderIndex = new Map(selectedOrder.map((frameId, index) => [frameId, index]));
  const selectedBubbles = page.frames
    .filter((frame) => selectedOrderIndex.has(frame.id) && isPaperBubbleFrame(frame))
    .sort((a, b) => selectedOrderIndex.get(a.id)! - selectedOrderIndex.get(b.id)!);

  if (selectedBubbles.length < 2) return undefined;
  const orderedBubbles = selectedBubbles
    .flatMap((frame) => frame.bubbleChainId
      ? getPaperBubbleChainFrames(page.frames, frame.bubbleChainId)
      : [frame])
    .filter((frame, index, frames) => frames.findIndex((candidate) => candidate.id === frame.id) === index);
  if (orderedBubbles.some((frame) => !isMutablePaperBubbleFrame(state.document, frame))) return undefined;

  const chainId = makePaperRuntimeId('bubble-chain');
  const frameIds = new Set(orderedBubbles.map((frame) => frame.id));
  const chainOrderById = new Map(orderedBubbles.map((frame, index) => [frame.id, index + 1]));
  const document = {
    ...state.document,
    pages: state.document.pages.map((candidate) => candidate.id === page.id
      ? {
          ...candidate,
          frames: candidate.frames.map((frame) => frameIds.has(frame.id)
            ? {
                ...frame,
                bubbleChainId: chainId,
                bubbleChainOrder: chainOrderById.get(frame.id)!,
                bubbleConnectorStyle: style,
                bubbleConnectorAnchor: frame.bubbleConnectorAnchor ?? 'auto',
              }
            : frame),
        }
      : candidate),
    updatedAt: Date.now(),
  };

  return { document };
}

function chainSelectedPaperBubbleWithPatch(
  state: PaperState,
  targetFrameId: string,
  style: PaperBubbleConnectorStyle,
): Pick<PaperState, 'document'> | undefined {
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  const source = page?.frames.find((frame) => frame.id === state.selectedFrameId);
  const target = page?.frames.find((frame) => frame.id === targetFrameId);
  if (!page || !source || !target || source.id === target.id || !isPaperBubbleFrame(source) || !isPaperBubbleFrame(target)) {
    return undefined;
  }

  const sourceChainId = source.bubbleChainId;
  const targetChainId = target.bubbleChainId;
  const chainId = targetChainId ?? sourceChainId ?? makePaperRuntimeId('bubble-chain');
  const sourceChain = sourceChainId ? getPaperBubbleChainFrames(page.frames, sourceChainId) : [source];
  const targetChain = targetChainId ? getPaperBubbleChainFrames(page.frames, targetChainId) : [target];
  if ([...sourceChain, ...targetChain].some((frame) => !isMutablePaperBubbleFrame(state.document, frame))) return undefined;
  const primary = targetChainId ? targetChain : sourceChainId ? sourceChain : targetChain;
  const secondary = targetChainId ? sourceChain : sourceChainId ? targetChain : sourceChain;
  const ordered = [...primary, ...secondary].filter((frame, index, frames) =>
    frames.findIndex((candidate) => candidate.id === frame.id) === index
  );
  const orderById = new Map(ordered.map((frame, index) => [frame.id, index + 1]));
  let changed = false;

  const nextFrames = page.frames.map((frame) => {
    const order = orderById.get(frame.id);
    if (order === undefined) return frame;
    const next = {
      ...frame,
      bubbleChainId: chainId,
      bubbleChainOrder: order,
      bubbleConnectorStyle: style,
      bubbleConnectorAnchor: frame.bubbleConnectorAnchor ?? 'auto' as const,
    };
    if (
      frame.bubbleChainId !== next.bubbleChainId
      || frame.bubbleChainOrder !== next.bubbleChainOrder
      || frame.bubbleConnectorStyle !== next.bubbleConnectorStyle
      || frame.bubbleConnectorAnchor !== next.bubbleConnectorAnchor
    ) changed = true;
    return next;
  });
  if (!changed) return undefined;

  return {
    document: {
      ...state.document,
      pages: state.document.pages.map((candidate) => candidate.id === page.id
        ? { ...candidate, frames: nextFrames }
        : candidate),
      updatedAt: Date.now(),
    },
  };
}

function moveSelectedPaperBubbleInChainPatch(
  state: PaperState,
  direction: 'earlier' | 'later',
): Pick<PaperState, 'document'> | undefined {
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  const selected = page?.frames.find((frame) => frame.id === state.selectedFrameId);
  if (!page || !selected || !isPaperBubbleFrame(selected) || !selected.bubbleChainId) return undefined;

  const ordered = getPaperBubbleChainFrames(page.frames, selected.bubbleChainId);
  if (!isMutablePaperBubbleFrame(state.document, selected) || ordered.some((frame) => !isMutablePaperBubbleFrame(state.document, frame))) return undefined;
  const index = ordered.findIndex((frame) => frame.id === selected.id);
  const targetIndex = direction === 'earlier' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return undefined;
  [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
  const orderById = new Map(ordered.map((frame, orderIndex) => [frame.id, orderIndex + 1]));

  return {
    document: {
      ...state.document,
      pages: state.document.pages.map((candidate) => candidate.id === page.id
        ? {
            ...candidate,
            frames: candidate.frames.map((frame) => orderById.has(frame.id)
              ? { ...frame, bubbleChainOrder: orderById.get(frame.id)! }
              : frame),
          }
        : candidate),
      updatedAt: Date.now(),
    },
  };
}

function unchainSelectedPaperBubblesPatch(state: PaperState): Pick<PaperState, 'document'> | undefined {
  const selectedIds = new Set(getSelectedPaperFrameIds(state));
  if (!selectedIds.size) return undefined;
  return unchainPaperBubblesPatch(state, selectedIds);
}

function unchainPaperBubblesPatch(
  state: PaperState,
  selectedIds: ReadonlySet<string>,
): Pick<PaperState, 'document'> | undefined {
  const page = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
  if (!page) return undefined;
  const selectedBubbles = page.frames.filter((frame) => selectedIds.has(frame.id) && isPaperBubbleFrame(frame));
  if (!selectedBubbles.length || selectedBubbles.some((frame) => !isMutablePaperBubbleFrame(state.document, frame))) return undefined;
  const affectedChainIds = new Set(selectedBubbles.flatMap((frame) => frame.bubbleChainId ? [frame.bubbleChainId] : []));
  for (const chainId of affectedChainIds) {
    if (getPaperBubbleChainFrames(page.frames, chainId).some((frame) => !isMutablePaperBubbleFrame(state.document, frame))) return undefined;
  }
  const survivorOrders = new Map<string, number>();
  const dissolvedSurvivorIds = new Set<string>();
  for (const chainId of affectedChainIds) {
    const survivors = getPaperBubbleChainFrames(page.frames, chainId).filter((frame) => !selectedIds.has(frame.id));
    if (survivors.length < 2) {
      survivors.forEach((frame) => dissolvedSurvivorIds.add(frame.id));
    } else {
      survivors.forEach((frame, index) => survivorOrders.set(frame.id, index + 1));
    }
  }
  let changed = false;

  const document = {
    ...state.document,
    pages: state.document.pages.map((candidate) => candidate.id === page.id
      ? {
          ...candidate,
          frames: candidate.frames.map((frame) => {
            const shouldClear = (selectedIds.has(frame.id) && isPaperBubbleFrame(frame))
              || dissolvedSurvivorIds.has(frame.id);
            const survivorOrder = survivorOrders.get(frame.id);
            if (!shouldClear && survivorOrder === undefined) return frame;
            if (survivorOrder !== undefined) {
              if (frame.bubbleChainOrder === survivorOrder) return frame;
              changed = true;
              return { ...frame, bubbleChainOrder: survivorOrder };
            }
            if (
              frame.bubbleChainId === undefined &&
              frame.bubbleChainOrder === undefined &&
              frame.bubbleConnectorStyle === undefined &&
              frame.bubbleConnectorAnchor === undefined &&
              frame.bubbleConnectorGeometry === undefined
            ) {
              return frame;
            }
            changed = true;
            return {
              ...frame,
              bubbleChainId: undefined,
              bubbleChainOrder: undefined,
              bubbleConnectorStyle: undefined,
              bubbleConnectorAnchor: undefined,
              bubbleConnectorGeometry: undefined,
            };
          }),
        }
      : candidate),
    updatedAt: Date.now(),
  };

  return changed ? { document } : undefined;
}

function isPaperBubbleFrame(frame: PaperFrame): boolean {
  return frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble';
}

function isEditablePaperFrame(document: PaperDocument, frame: PaperFrame): boolean {
  return !frame.locked && !frame.inherited && !paperFrameLayerIsLocked(document, frame);
}

function isMutablePaperBubbleFrame(document: PaperDocument, frame: PaperFrame): boolean {
  return isPaperBubbleFrame(frame) && isEditablePaperFrame(document, frame);
}

function clonePaperFrame(frame: PaperFrame): PaperFrame {
  return structuredCloneAvailable()
    ? globalThis.structuredClone(frame)
    : JSON.parse(JSON.stringify(frame)) as PaperFrame;
}

function structuredCloneAvailable(): boolean {
  return typeof globalThis.structuredClone === 'function';
}

function makePaperRuntimeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1000)}`}`;
}

function roundPaperMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Dirty truth is based only on editable publication content. Editor navigation and presentation
 * toggles are deliberately excluded, while binding direction remains because it changes authored
 * page order in print/reader output.
 */
export function fingerprintPaperAuthoredContent(document: PaperDocument): string {
  const { createdAt: _createdAt, updatedAt: _updatedAt, view, ...authored } = document;
  return stablePaperStringify({
    ...authored,
    binding: {
      startOnRight: view.startOnRight,
      ...(view.rtlBinding === undefined ? {} : { rtlBinding: view.rtlBinding }),
    },
  });
}

interface PaperWorkspaceAuthorizationDocument {
  id: string;
  instanceId: string;
  authoredFingerprint: string;
  dirty: boolean;
  dirtyBaseline: PaperDocumentPersistenceState | null;
}

/**
 * Exact runtime authorization for a Paper workspace decision. The projection intentionally binds
 * ordered topology, active selection, per-tab runtime identity, authored content, and save/dirty
 * baselines. Runtime tab identity makes close-then-reopen distinguishable even when the restored
 * tab reuses the same persisted id and content.
 */
export interface PaperWorkspaceAuthorization {
  activeDocumentId: string;
  documents: PaperWorkspaceAuthorizationDocument[];
  signature: string;
}

function projectPaperWorkspaceAuthorization(state: PaperState): Omit<PaperWorkspaceAuthorization, 'signature'> {
  const documents = syncActivePaperDocument(state).map((workspaceDocument) => ({
    id: workspaceDocument.id,
    instanceId: state.documentInstanceIds[workspaceDocument.id] ?? 'missing-runtime-instance',
    authoredFingerprint: fingerprintPaperAuthoredContent(workspaceDocument.document),
    dirty: isPaperWorkspaceDocumentDirty(workspaceDocument),
    dirtyBaseline: workspaceDocument.persistence
      ? { ...workspaceDocument.persistence }
      : null,
  }));
  return { activeDocumentId: state.activeDocumentId, documents };
}

function paperWorkspaceAuthorizationForState(state: PaperState): PaperWorkspaceAuthorization {
  const projection = projectPaperWorkspaceAuthorization(state);
  return {
    ...projection,
    signature: stablePaperStringify(projection),
  };
}

export function capturePaperWorkspaceAuthorization(): PaperWorkspaceAuthorization {
  return paperWorkspaceAuthorizationForState(usePaperStore.getState());
}

function isPaperWorkspaceAuthorizationCurrentForState(
  authorization: PaperWorkspaceAuthorization,
  state: PaperState,
): boolean {
  return authorization.signature === paperWorkspaceAuthorizationForState(state).signature;
}

export function isPaperWorkspaceAuthorizationCurrent(
  authorization: PaperWorkspaceAuthorization,
): boolean {
  return isPaperWorkspaceAuthorizationCurrentForState(authorization, usePaperStore.getState());
}

/**
 * Save is the only authorized transition permitted while a per-tab decision is open: the exact
 * target may change only its persistence baseline from dirty to clean. Any authored, active-tab,
 * topology, runtime-identity, or unrelated-tab baseline drift rejects the transition.
 */
export function isPaperWorkspaceAuthorizationCurrentAfterTargetSave(
  authorization: PaperWorkspaceAuthorization,
  documentId: string,
): boolean {
  const current = paperWorkspaceAuthorizationForState(usePaperStore.getState());
  if (current.activeDocumentId !== authorization.activeDocumentId
    || current.documents.length !== authorization.documents.length) return false;

  return authorization.documents.every((before, index) => {
    const after = current.documents[index];
    if (!after
      || after.id !== before.id
      || after.instanceId !== before.instanceId
      || after.authoredFingerprint !== before.authoredFingerprint) return false;
    if (before.id === documentId) return !after.dirty;
    return after.dirty === before.dirty
      && stablePaperStringify(after.dirtyBaseline) === stablePaperStringify(before.dirtyBaseline);
  });
}

function stablePaperStringify(value: unknown): string {
  return JSON.stringify(value, (_key, candidate) => {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return Object.keys(candidate as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = (candidate as Record<string, unknown>)[key];
          return sorted;
        }, {});
    }
    return candidate;
  });
}

function createSavedPaperPersistence(
  document: PaperDocument,
  kind: 'project' | 'standalone',
  path?: string,
): PaperDocumentPersistenceState {
  return {
    kind,
    savedFingerprint: fingerprintPaperAuthoredContent(document),
    ...(path ? { path } : {}),
  };
}

function sanitizePaperPersistence(value: unknown): PaperDocumentPersistenceState | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.kind;
  if (kind !== 'new' && kind !== 'project' && kind !== 'standalone') return undefined;
  const savedFingerprint = typeof value.savedFingerprint === 'string' && value.savedFingerprint
    ? value.savedFingerprint
    : undefined;
  const path = typeof value.path === 'string' && value.path.trim() ? value.path : undefined;
  return {
    kind,
    ...(savedFingerprint ? { savedFingerprint } : {}),
    ...(path ? { path } : {}),
  };
}

function isPaperWorkspaceDocumentDirty(workspaceDocument: PaperWorkspaceDocumentSnapshot): boolean {
  const savedFingerprint = workspaceDocument.persistence?.savedFingerprint;
  return !savedFingerprint
    || fingerprintPaperAuthoredContent(workspaceDocument.document) !== savedFingerprint;
}

function createPaperDiscardRecovery(
  state: PaperState,
  snapshot: PaperWorkspaceDocumentSnapshot,
  originalIndex: number,
  reason: PaperDocumentRecoveryReason,
  batchId = makePaperRuntimeId('paper-recovery-batch'),
): PaperDiscardedDocumentRecovery {
  const wasActive = snapshot.id === state.activeDocumentId;
  const history = paperHistoryForDocument(state, snapshot.id);
  return {
    id: makePaperRuntimeId('paper-recovery'),
    batchId,
    reason,
    capturedAt: Date.now(),
    originalIndex,
    wasActive,
    snapshot,
    ...(history.undoStack.length ? { undoStack: history.undoStack } : {}),
    ...(history.redoStack.length ? { redoStack: history.redoStack } : {}),
  };
}

function appendPaperDocumentRecoveries(
  existing: PaperDiscardedDocumentRecovery[],
  incoming: PaperDiscardedDocumentRecovery[],
): PaperDiscardedDocumentRecovery[] {
  let next = [...existing];
  for (const recovery of incoming) {
    const fingerprint = fingerprintPaperAuthoredContent(recovery.snapshot.document);
    next = next.filter((candidate) => !(
      candidate.reason === recovery.reason
      && candidate.snapshot.id === recovery.snapshot.id
      && fingerprintPaperAuthoredContent(candidate.snapshot.document) === fingerprint
    ));
    next.push(recovery);
  }
  const retainedBatchIds = [...new Set(next.map((recovery) => recovery.batchId ?? recovery.id))]
    .slice(-MAX_PAPER_RECOVERY_BATCHES);
  const retained = new Set(retainedBatchIds);
  return next.filter((recovery) => retained.has(recovery.batchId ?? recovery.id));
}

function sanitizePaperDiscardRecoveries(value: unknown): PaperDiscardedDocumentRecovery[] {
  if (!Array.isArray(value)) return [];
  const recoveries = value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const snapshot = sanitizePaperWorkspaceDocumentSnapshot(candidate.snapshot, 'preserve');
    const reason = candidate.reason;
    if (
      !snapshot
      || (reason !== 'discard'
        && reason !== 'document-replacement'
        && reason !== 'project-replacement'
        && reason !== 'crash-recovery'
        && reason !== 'startup-recovery'
        && reason !== 'shutdown'
        && reason !== 'baton-handoff')
    ) return [];
    const recoveryReason = reason as PaperDocumentRecoveryReason;
    return [{
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : makePaperRuntimeId('paper-recovery'),
      ...(typeof candidate.batchId === 'string' && candidate.batchId ? { batchId: candidate.batchId } : {}),
      reason: recoveryReason,
      capturedAt: typeof candidate.capturedAt === 'number' && Number.isFinite(candidate.capturedAt)
        ? candidate.capturedAt
        : Date.now(),
      originalIndex: typeof candidate.originalIndex === 'number' && Number.isInteger(candidate.originalIndex)
        ? Math.max(0, candidate.originalIndex)
        : 0,
      wasActive: candidate.wasActive === true,
      // History fields in stored records (older or hostile) are deliberately ignored: recovery
      // stacks are session-scoped and never round-trip through persistence.
      snapshot,
    }];
  });
  const retainedBatchIds = [...new Set(recoveries.map((recovery) => recovery.batchId ?? recovery.id))]
    .slice(-MAX_PAPER_RECOVERY_BATCHES);
  const retained = new Set(retainedBatchIds);
  return recoveries.filter((recovery) => retained.has(recovery.batchId ?? recovery.id));
}

function sanitizePaperDocument(value: unknown): PaperDocument {
  if (!isRecord(value)) return initialDocument;
  try {
    return parsePaperDocument(JSON.stringify(value));
  } catch {
    return initialDocument;
  }
}

function clampZoom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0.15, Math.min(3, value)) : 0.8;
}

function isPaperTool(value: unknown): value is PaperTool {
  return typeof value === 'string' && PAPER_TOOLS.includes(value as PaperTool);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function defaultFrameWidth(kind: PaperFrameKind): number {
  if (kind === 'caption') return 72;
  if (kind === 'speechBubble' || kind === 'thoughtBubble') return 58;
  if (kind === 'shape') return 48;
  if (kind === 'document') return 96;
  if (kind === 'barcode') return paperBarcodeSymbolSizeMm(1, true).widthMm;
  return 84;
}

// Register the Paper workspace on the unified cross-device sync (#52) lazily when this store loads, so
// channel-init is tied to the Paper workspace being present with zero app-startup cost. Mirrors flowStore.
// Skipped under the test runner so a unit test importing this store can't spawn a floating channel-init
// side-effect that races vitest's multi-file module evaluation; the channel's own tests init explicitly.
if (import.meta.env?.MODE !== 'test') {
  void import('../lib/paperSyncChannel')
    .then((module) => module.initializePaperSyncChannel())
    .catch(() => undefined);
}

function defaultFrameHeight(kind: PaperFrameKind): number {
  if (kind === 'caption') return 22;
  if (kind === 'speechBubble' || kind === 'thoughtBubble') return 34;
  if (kind === 'shape') return 48;
  if (kind === 'document') return 110;
  if (kind === 'barcode') return paperBarcodeSymbolSizeMm(1, true).heightMm;
  return kind === 'text' ? 58 : 62;
}
