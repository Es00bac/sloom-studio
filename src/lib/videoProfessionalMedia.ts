/** Pure domain planning for professional media. This module never reads, copies, or deletes files. */

export type ProfessionalMediaKind = 'video' | 'audio';
export type ProxyCodec = 'h264' | 'prores-proxy' | 'dnxhr-lb';
export type MediaLocationState = 'online' | 'offline' | 'stale' | 'unverified';

export interface MediaFingerprint {
  fileName: string;
  byteSize: number;
  durationMs?: number;
  /** A caller-computed cryptographic digest. This module does not hash file contents. */
  contentHash?: string;
}

export interface MediaCapabilityLocator {
  /** Opaque authority token resolved by the native bridge. It is deliberately not a file path. */
  capabilityHandle: string;
  displayPath?: string;
  projectRelativePath?: string;
}

export interface ProfessionalMediaLocation {
  locator: MediaCapabilityLocator;
  fingerprint: MediaFingerprint;
}

export interface ProfessionalMediaAsset {
  id: string;
  label: string;
  kind: ProfessionalMediaKind;
  original: ProfessionalMediaLocation;
  proxy?: ProfessionalMediaLocation & {
    codec: ProxyCodec;
    widthPx: number;
    heightPx: number;
  };
}

export interface MediaCapabilityObservation {
  capabilityHandle: string;
  exists: boolean;
  byteSize?: number;
  durationMs?: number;
  contentHash?: string;
}

export interface VerifiedMediaLocation {
  state: MediaLocationState;
  reason?: string;
}

export interface VerifiedProfessionalMediaAsset {
  assetId: string;
  original: VerifiedMediaLocation;
  proxy?: VerifiedMediaLocation;
}

export interface ResolvedMediaForOperation {
  assetId: string;
  operation: 'preview' | 'export';
  role: 'proxy' | 'original' | 'unavailable';
  locator?: MediaCapabilityLocator;
  reason?: string;
}

export interface RelinkCandidate {
  id: string;
  locator: MediaCapabilityLocator;
  fingerprint: MediaFingerprint;
}

export type RelinkDecision =
  | { assetId: string; status: 'matched'; candidateId: string; locator: MediaCapabilityLocator; basis: 'exact-hash' | 'name-size-duration' }
  | { assetId: string; status: 'ambiguous'; candidateIds: string[]; basis: 'exact-hash' | 'name-size-duration' }
  | { assetId: string; status: 'unmatched'; reason: string };

export interface ProxyHostCapabilities {
  codecs: readonly ProxyCodec[];
  maxWidthPx: number;
  maxHeightPx: number;
  maxConcurrentJobs: number;
}

export interface ProxyJobRequest {
  codec: ProxyCodec;
  scale: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  audioBitrateKbps?: number;
}

export interface ProxySourceDescriptor {
  asset: ProfessionalMediaAsset;
  sourceWidthPx: number;
  sourceHeightPx: number;
}

export interface ProxyJobSpecification {
  id: string;
  assetId: string;
  sourceCapabilityHandle: string;
  outputCapabilityHandle: string;
  codec: ProxyCodec;
  widthPx: number;
  heightPx: number;
  audioBitrateKbps: number;
  requiredCapabilities: string[];
}

export interface ProxyJobPlan {
  concurrency: number;
  jobs: ProxyJobSpecification[];
  errors: Array<{ assetId: string; message: string }>;
}

export interface ConsolidationPlanEntry {
  assetId: string;
  sourceCapabilityHandle: string;
  targetCapabilityHandle: string;
  targetProjectRelativePath: string;
  expectedFingerprint: MediaFingerprint;
}

export interface ConsolidationPlan {
  targetDirectory: string;
  entries: ConsolidationPlanEntry[];
  skippedAssetIds: string[];
  /** Always false: execution belongs to an authorized native bridge. */
  performsIo: false;
}

const MAX_PROXY_DIMENSION = 1920;
const MAX_PROXY_JOBS = 10_000;
const DURATION_TOLERANCE_MS = 50;

export function verifyProfessionalMediaAssets(
  assets: readonly ProfessionalMediaAsset[],
  observations: readonly MediaCapabilityObservation[],
): VerifiedProfessionalMediaAsset[] {
  const byHandle = new Map(observations.map((item) => [item.capabilityHandle, item]));
  return assets.map((asset) => ({
    assetId: asset.id,
    original: verifyLocation(asset.original, byHandle.get(asset.original.locator.capabilityHandle)),
    ...(asset.proxy ? { proxy: verifyLocation(asset.proxy, byHandle.get(asset.proxy.locator.capabilityHandle)) } : {}),
  }));
}

export function resolveMediaForOperation(
  asset: ProfessionalMediaAsset,
  verified: VerifiedProfessionalMediaAsset,
  operation: 'preview' | 'export',
): ResolvedMediaForOperation {
  if (operation === 'export') {
    return verified.original.state === 'online'
      ? { assetId: asset.id, operation, role: 'original', locator: asset.original.locator }
      : { assetId: asset.id, operation, role: 'unavailable', reason: `Original media is ${verified.original.state}; export never substitutes a proxy.` };
  }
  if (asset.proxy && verified.proxy?.state === 'online') {
    return { assetId: asset.id, operation, role: 'proxy', locator: asset.proxy.locator };
  }
  if (verified.original.state === 'online') {
    return { assetId: asset.id, operation, role: 'original', locator: asset.original.locator };
  }
  return { assetId: asset.id, operation, role: 'unavailable', reason: 'Neither a verified proxy nor the original is online.' };
}

export function planBatchRelink(
  assets: readonly ProfessionalMediaAsset[],
  candidates: readonly RelinkCandidate[],
): RelinkDecision[] {
  const orderedCandidates = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  return assets.map((asset) => {
    const hash = normalizedHash(asset.original.fingerprint.contentHash);
    if (hash) {
      const matches = orderedCandidates.filter((candidate) => normalizedHash(candidate.fingerprint.contentHash) === hash);
      if (matches.length === 1) return matched(asset.id, matches[0], 'exact-hash');
      if (matches.length > 1) return ambiguous(asset.id, matches, 'exact-hash');
    }
    const matches = orderedCandidates.filter((candidate) => {
      const candidateHash = normalizedHash(candidate.fingerprint.contentHash);
      return (!hash || !candidateHash) && fingerprintMetadataMatches(asset.original.fingerprint, candidate.fingerprint);
    });
    if (matches.length === 1) return matched(asset.id, matches[0], 'name-size-duration');
    if (matches.length > 1) return ambiguous(asset.id, matches, 'name-size-duration');
    return { assetId: asset.id, status: 'unmatched', reason: 'No candidate matched by hash or by filename, size, and duration.' };
  });
}

export function buildProxyJobSpecifications(
  sources: readonly ProxySourceDescriptor[],
  request: ProxyJobRequest,
  host: ProxyHostCapabilities,
): ProxyJobPlan {
  validateProxyRequest(request, host);
  if (sources.length > MAX_PROXY_JOBS) throw new Error(`Proxy request exceeds the ${MAX_PROXY_JOBS}-asset safety limit.`);
  const jobs: ProxyJobSpecification[] = [];
  const errors: ProxyJobPlan['errors'] = [];
  for (const source of sources) {
    if (source.asset.kind !== 'video' || source.sourceWidthPx <= 0 || source.sourceHeightPx <= 0) {
      errors.push({ assetId: source.asset.id, message: 'Proxy generation requires video media with positive source dimensions.' });
      continue;
    }
    const maxWidth = Math.min(request.maxWidthPx ?? MAX_PROXY_DIMENSION, host.maxWidthPx, MAX_PROXY_DIMENSION);
    const maxHeight = Math.min(request.maxHeightPx ?? MAX_PROXY_DIMENSION, host.maxHeightPx, MAX_PROXY_DIMENSION);
    const ratio = Math.min(request.scale, maxWidth / source.sourceWidthPx, maxHeight / source.sourceHeightPx, 1);
    const widthPx = evenDimension(source.sourceWidthPx * ratio);
    const heightPx = evenDimension(source.sourceHeightPx * ratio);
    jobs.push({
      id: `proxy:${source.asset.id}`,
      assetId: source.asset.id,
      sourceCapabilityHandle: source.asset.original.locator.capabilityHandle,
      outputCapabilityHandle: `proxy-output:${source.asset.id}:${request.codec}`,
      codec: request.codec,
      widthPx,
      heightPx,
      audioBitrateKbps: clampInteger(request.audioBitrateKbps ?? 128, 64, 320),
      requiredCapabilities: [`decode:${source.asset.kind}`, `encode:${request.codec}`, 'write:project-media'],
    });
  }
  return { concurrency: clampInteger(host.maxConcurrentJobs, 1, 8), jobs, errors };
}

export function buildUsedMediaConsolidationPlan({
  assets,
  usedAssetIds,
  targetDirectory = 'Media',
  targetCapabilityHandle,
}: {
  assets: readonly ProfessionalMediaAsset[];
  usedAssetIds: ReadonlySet<string>;
  targetDirectory?: string;
  targetCapabilityHandle: string;
}): ConsolidationPlan {
  const safeDirectory = normalizeProjectRelativePath(targetDirectory);
  if (!targetCapabilityHandle.trim()) throw new Error('A target directory capability handle is required.');
  const usedNames = new Set<string>();
  const entries: ConsolidationPlanEntry[] = [];
  const skippedAssetIds: string[] = [];
  for (const asset of assets) {
    if (!usedAssetIds.has(asset.id)) {
      skippedAssetIds.push(asset.id);
      continue;
    }
    const fileName = uniqueFileName(sanitizeFileName(asset.original.fingerprint.fileName || asset.label), usedNames);
    entries.push({
      assetId: asset.id,
      sourceCapabilityHandle: asset.original.locator.capabilityHandle,
      targetCapabilityHandle,
      targetProjectRelativePath: `${safeDirectory}/${fileName}`,
      expectedFingerprint: { ...asset.original.fingerprint },
    });
  }
  return { targetDirectory: safeDirectory, entries, skippedAssetIds, performsIo: false };
}

function verifyLocation(location: ProfessionalMediaLocation, observation: MediaCapabilityObservation | undefined): VerifiedMediaLocation {
  if (!observation) return { state: 'unverified', reason: 'No capability observation was supplied.' };
  if (!observation.exists) return { state: 'offline', reason: 'The capability target does not exist.' };
  const expected = location.fingerprint;
  if (observation.byteSize !== undefined && observation.byteSize !== expected.byteSize) {
    return { state: 'stale', reason: 'File size differs from the ingested fingerprint.' };
  }
  const expectedHash = normalizedHash(expected.contentHash);
  const observedHash = normalizedHash(observation.contentHash);
  if (expectedHash && observedHash && expectedHash !== observedHash) {
    return { state: 'stale', reason: 'Content hash differs from the ingested fingerprint.' };
  }
  if (expected.durationMs !== undefined && observation.durationMs !== undefined
      && Math.abs(expected.durationMs - observation.durationMs) > DURATION_TOLERANCE_MS) {
    return { state: 'stale', reason: 'Media duration differs from the ingested fingerprint.' };
  }
  return { state: 'online' };
}

function matched(assetId: string, candidate: RelinkCandidate, basis: 'exact-hash' | 'name-size-duration'): RelinkDecision {
  return { assetId, status: 'matched', candidateId: candidate.id, locator: candidate.locator, basis };
}

function ambiguous(assetId: string, candidates: RelinkCandidate[], basis: 'exact-hash' | 'name-size-duration'): RelinkDecision {
  return { assetId, status: 'ambiguous', candidateIds: candidates.map((item) => item.id), basis };
}

function fingerprintMetadataMatches(expected: MediaFingerprint, actual: MediaFingerprint): boolean {
  return expected.fileName.toLocaleLowerCase() === actual.fileName.toLocaleLowerCase()
    && expected.byteSize === actual.byteSize
    && (expected.durationMs === undefined || actual.durationMs === undefined
      ? expected.durationMs === actual.durationMs
      : Math.abs(expected.durationMs - actual.durationMs) <= DURATION_TOLERANCE_MS);
}

function normalizedHash(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized || undefined;
}

function validateProxyRequest(request: ProxyJobRequest, host: ProxyHostCapabilities): void {
  if (!host.codecs.includes(request.codec)) throw new Error(`Proxy codec ${request.codec} is not supported by this host.`);
  if (!Number.isFinite(host.maxWidthPx) || host.maxWidthPx < 16 || !Number.isFinite(host.maxHeightPx) || host.maxHeightPx < 16) {
    throw new Error('Proxy host dimensions must be finite and at least 16 pixels.');
  }
  if (!Number.isFinite(request.scale) || request.scale < 0.1 || request.scale > 1) throw new Error('Proxy scale must be between 0.1 and 1.');
  for (const value of [request.maxWidthPx, request.maxHeightPx]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 16 || value > MAX_PROXY_DIMENSION)) {
      throw new Error(`Proxy dimensions must be between 16 and ${MAX_PROXY_DIMENSION} pixels.`);
    }
  }
}

function evenDimension(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function normalizeProjectRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Consolidation target must be a non-empty project-relative directory without traversal.');
  }
  return normalized;
}

function sanitizeFileName(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned || 'media';
}

function uniqueFileName(fileName: string, used: Set<string>): string {
  const normalized = fileName.toLocaleLowerCase();
  if (!used.has(normalized)) {
    used.add(normalized);
    return fileName;
  }
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '';
  let suffix = 2;
  while (used.has(`${stem} (${suffix})${extension}`.toLocaleLowerCase())) suffix += 1;
  const candidate = `${stem} (${suffix})${extension}`;
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}
