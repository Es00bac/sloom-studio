/**
 * Pure planning and immutable state transitions for multi-deliverable Video jobs.
 *
 * This module performs no IPC, rendering, file writes, checksums, or manifest writes. It freezes
 * an authored composition signature and records explicit execution/checksum/manifest intentions
 * for a host scheduler. Browser work is always labeled session-only. Native work is merely marked
 * eligible for host-managed restart; durable execution still requires a native queue implementation.
 */

export const VIDEO_DELIVERY_PROFILE_VERSION = 1 as const;
export const VIDEO_DELIVERY_JOB_VERSION = 1 as const;
export const MAX_VIDEO_DELIVERABLES_PER_PROFILE = 32;
export const MAX_VIDEO_DELIVERY_CAPABILITIES = 128;
export const MAX_VIDEO_DELIVERY_FILENAME_LENGTH = 180;
export const MAX_CONCURRENT_NATIVE_VIDEO_DELIVERY_JOBS = 1;

export type VideoDeliveryExecutionTarget = 'native' | 'browser';
export type VideoDeliveryRequestedTarget = VideoDeliveryExecutionTarget | 'auto';
export type VideoDeliveryChecksumAlgorithm = 'sha256' | 'none';
export type VideoDeliveryOutputStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'canceled';
export type VideoDeliveryJobStatus = 'queued' | 'running' | 'completed' | 'partial-failure' | 'failed' | 'blocked' | 'canceled';

export interface VideoDeliveryProfileOutput {
  id: string;
  label: string;
  extension: string;
  container: string;
  codec: string;
  fileNameTemplate?: string;
  requestedTarget?: VideoDeliveryRequestedTarget;
  supportedTargets?: readonly VideoDeliveryExecutionTarget[];
  requiredCapabilities?: readonly string[];
  checksum?: VideoDeliveryChecksumAlgorithm;
  writeManifest?: boolean;
}

export interface VideoDeliveryProfile {
  version: typeof VIDEO_DELIVERY_PROFILE_VERSION;
  id: string;
  name: string;
  fileNameTemplate?: string;
  outputs: readonly VideoDeliveryProfileOutput[];
}

export interface VideoDeliveryCompositionSnapshot {
  compositionId: string;
  compositionName: string;
  compositionSignature: string;
  revision?: string;
}

export interface VideoDeliveryTargetCapabilities {
  available: boolean;
  capabilities: readonly string[];
}

export interface VideoDeliveryPlanningEnvironment {
  native: VideoDeliveryTargetCapabilities;
  browser: VideoDeliveryTargetCapabilities;
}

export interface VideoDeliveryFileNameTokens {
  project: string;
  composition?: string;
  profile?: string;
  deliverable?: string;
  date: string;
  time?: string;
  revision?: string;
}

export interface VideoDeliveryOutputResult {
  byteSize?: number;
  checksum?: string;
  manifestPath?: string;
}

export interface PlannedVideoDeliveryOutput {
  id: string;
  label: string;
  extension: string;
  container: string;
  codec: string;
  fileName: string;
  target?: VideoDeliveryExecutionTarget;
  status: VideoDeliveryOutputStatus;
  attempts: number;
  missingCapabilities: readonly string[];
  blockedReason?: string;
  checksumIntent: VideoDeliveryChecksumAlgorithm;
  manifestIntent: 'write-json' | 'none';
  executionDurability: 'native-host-resume-required' | 'browser-session-only' | 'blocked';
  truthfulnessNote: string;
  error?: string;
  result?: Readonly<VideoDeliveryOutputResult>;
}

export interface VideoDeliveryManifestIntent {
  format: 'sloom-video-delivery-manifest-v1';
  includeFrozenCompositionSignature: true;
  includeOutputChecksums: boolean;
}

export interface VideoDeliveryJob {
  version: typeof VIDEO_DELIVERY_JOB_VERSION;
  id: string;
  createdAt: string;
  profileId: string;
  profileName: string;
  compositionId: string;
  compositionName: string;
  frozenCompositionSignature: string;
  frozenRevision?: string;
  status: VideoDeliveryJobStatus;
  outputs: readonly PlannedVideoDeliveryOutput[];
  manifestIntent: Readonly<VideoDeliveryManifestIntent>;
}

export interface VideoDeliveryWorkSelection {
  jobId: string;
  outputId: string;
  target: VideoDeliveryExecutionTarget;
}

const DEFAULT_FILENAME_TEMPLATE = '{project}-{composition}-{deliverable}';
const ALLOWED_FILENAME_TOKENS = new Set(['project', 'composition', 'profile', 'deliverable', 'date', 'time', 'revision', 'extension']);

export function planVideoDeliveryJob({
  jobId,
  createdAt,
  profile,
  composition,
  environment,
  fileNameTokens,
  existingFileNames = [],
}: {
  jobId: string;
  createdAt: string;
  profile: VideoDeliveryProfile;
  composition: VideoDeliveryCompositionSnapshot;
  environment: VideoDeliveryPlanningEnvironment;
  fileNameTokens: VideoDeliveryFileNameTokens;
  existingFileNames?: readonly string[];
}): VideoDeliveryJob {
  const normalizedJobId = requiredText(jobId, 'Delivery job ID', 160);
  const normalizedCreatedAt = normalizeIsoDate(createdAt);
  const profileId = requiredText(profile.id, 'Delivery profile ID', 160);
  const profileName = requiredText(profile.name, 'Delivery profile name', 240);
  const compositionId = requiredText(composition.compositionId, 'Composition ID', 160);
  const compositionName = requiredText(composition.compositionName, 'Composition name', 240);
  const compositionSignature = requiredText(composition.compositionSignature, 'Composition signature', 2_048);

  if (profile.version !== VIDEO_DELIVERY_PROFILE_VERSION) {
    throw new Error(`Unsupported Video delivery profile version ${String(profile.version)}.`);
  }
  if (profile.outputs.length === 0 || profile.outputs.length > MAX_VIDEO_DELIVERABLES_PER_PROFILE) {
    throw new Error(`Delivery profiles require 1-${MAX_VIDEO_DELIVERABLES_PER_PROFILE} outputs.`);
  }

  const outputIds = new Set<string>();
  const reservedFileNames = new Set(existingFileNames.map(normalizeCollisionKey));
  const outputs = profile.outputs.map((output): PlannedVideoDeliveryOutput => {
    const id = requiredText(output.id, 'Delivery output ID', 160);
    if (outputIds.has(id)) throw new Error(`Duplicate delivery output ID ${id}.`);
    outputIds.add(id);
    const label = requiredText(output.label, 'Delivery output label', 240);
    const extension = normalizeExtension(output.extension);
    const requiredCapabilities = normalizeCapabilities(output.requiredCapabilities);
    const resolution = resolveExecutionTarget(output, environment, requiredCapabilities);
    const template = output.fileNameTemplate ?? profile.fileNameTemplate ?? DEFAULT_FILENAME_TEMPLATE;
    if (template.length > 1_024) throw new Error('Delivery filename template exceeds 1024 characters.');
    const fileName = resolveVideoDeliveryFileName({
      template,
      extension,
      tokens: {
        ...fileNameTokens,
        composition: fileNameTokens.composition ?? compositionName,
        profile: fileNameTokens.profile ?? profileName,
        deliverable: fileNameTokens.deliverable ?? label,
        revision: fileNameTokens.revision ?? composition.revision,
      },
      reservedFileNames,
    });
    reservedFileNames.add(normalizeCollisionKey(fileName));
    const checksumIntent = output.checksum ?? 'sha256';
    const manifestIntent = output.writeManifest === false ? 'none' : 'write-json';

    if (!resolution.target) {
      return {
        id,
        label,
        extension,
        container: requiredText(output.container, 'Delivery container', 120),
        codec: requiredText(output.codec, 'Delivery codec', 120),
        fileName,
        status: 'blocked',
        attempts: 0,
        missingCapabilities: resolution.missingCapabilities,
        blockedReason: resolution.reason,
        checksumIntent,
        manifestIntent,
        executionDurability: 'blocked',
        truthfulnessNote: 'Planning is blocked; no renderer target currently satisfies this output contract.',
      };
    }

    return {
      id,
      label,
      extension,
      container: requiredText(output.container, 'Delivery container', 120),
      codec: requiredText(output.codec, 'Delivery codec', 120),
      fileName,
      target: resolution.target,
      status: 'queued',
      attempts: 0,
      missingCapabilities: [],
      checksumIntent,
      manifestIntent,
      executionDurability: resolution.target === 'browser' ? 'browser-session-only' : 'native-host-resume-required',
      truthfulnessNote: resolution.target === 'browser'
        ? 'Browser delivery is session-only and cannot resume after the renderer closes or reloads.'
        : 'Native delivery is eligible for host-managed resume, but this planner performs no IPC and does not itself persist execution.',
    };
  });

  return freezeJob({
    version: VIDEO_DELIVERY_JOB_VERSION,
    id: normalizedJobId,
    createdAt: normalizedCreatedAt,
    profileId,
    profileName,
    compositionId,
    compositionName,
    frozenCompositionSignature: compositionSignature,
    ...(composition.revision?.trim() ? { frozenRevision: composition.revision.trim().slice(0, 240) } : {}),
    status: deriveJobStatus(outputs),
    outputs,
    manifestIntent: {
      format: 'sloom-video-delivery-manifest-v1',
      includeFrozenCompositionSignature: true,
      includeOutputChecksums: outputs.some((output) => output.checksumIntent !== 'none'),
    },
  });
}

export function resolveVideoDeliveryFileName({
  template,
  extension,
  tokens,
  reservedFileNames = new Set<string>(),
}: {
  template: string;
  extension: string;
  tokens: VideoDeliveryFileNameTokens;
  reservedFileNames?: ReadonlySet<string>;
}): string {
  const normalizedExtension = normalizeExtension(extension);
  const unknownTokens = [...template.matchAll(/\{([^{}]+)\}/gu)]
    .map((match) => match[1])
    .filter((token) => !ALLOWED_FILENAME_TOKENS.has(token));
  if (unknownTokens.length) throw new Error(`Unknown delivery filename token {${unknownTokens[0]}}.`);

  const values: Record<string, string> = {
    project: tokens.project,
    composition: tokens.composition ?? '',
    profile: tokens.profile ?? '',
    deliverable: tokens.deliverable ?? '',
    date: tokens.date,
    time: tokens.time ?? '',
    revision: tokens.revision ?? '',
    extension: normalizedExtension,
  };
  let base = template.replace(/\{([^{}]+)\}/gu, (_match, token: string) => values[token] ?? '');
  base = sanitizeFilename(base);
  if (!base) base = 'video-delivery';
  const suffix = `.${normalizedExtension}`;
  if (!base.toLowerCase().endsWith(suffix.toLowerCase())) base += suffix;
  base = truncateFilename(base, normalizedExtension);

  if (!reservedFileNames.has(normalizeCollisionKey(base))) return base;
  const stem = base.slice(0, -(normalizedExtension.length + 1));
  for (let index = 2; index <= 10_000; index += 1) {
    const candidate = truncateFilename(`${stem}-${index}.${normalizedExtension}`, normalizedExtension);
    if (!reservedFileNames.has(normalizeCollisionKey(candidate))) return candidate;
  }
  throw new Error('Could not resolve a unique delivery filename within the bounded collision limit.');
}

export function selectNextVideoDeliveryWork(
  jobs: readonly VideoDeliveryJob[],
  options: { activeNativeJobs?: number; browserSessionAvailable?: boolean } = {},
): VideoDeliveryWorkSelection | undefined {
  const activeNativeJobs = clampInteger(options.activeNativeJobs ?? 0, 0, MAX_CONCURRENT_NATIVE_VIDEO_DELIVERY_JOBS)
    + jobs.reduce((count, job) => count + job.outputs.filter((output) => output.target === 'native' && output.status === 'running').length, 0);
  const browserSessionAvailable = options.browserSessionAvailable ?? true;
  const orderedJobs = [...jobs].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

  for (const job of orderedJobs) {
    for (const output of job.outputs) {
      if (output.status !== 'queued' || !output.target) continue;
      if (output.target === 'native' && activeNativeJobs >= MAX_CONCURRENT_NATIVE_VIDEO_DELIVERY_JOBS) continue;
      if (output.target === 'browser' && !browserSessionAvailable) continue;
      return { jobId: job.id, outputId: output.id, target: output.target };
    }
  }
  return undefined;
}

export function startVideoDeliveryOutput(
  job: VideoDeliveryJob,
  outputId: string,
  options: { activeNativeJobs?: number; browserSessionAvailable?: boolean } = {},
): VideoDeliveryJob {
  const output = findOutput(job, outputId);
  if (output.status !== 'queued' || !output.target) {
    throw new Error(`Delivery output ${outputId} is not queued for execution.`);
  }
  if (output.target === 'native' && (options.activeNativeJobs ?? 0) >= MAX_CONCURRENT_NATIVE_VIDEO_DELIVERY_JOBS) {
    throw new Error('Only one native Video delivery job may run at a time.');
  }
  if (output.target === 'native' && job.outputs.some((candidate) => candidate.id !== outputId && candidate.target === 'native' && candidate.status === 'running')) {
    throw new Error('Only one native Video delivery job may run at a time.');
  }
  if (output.target === 'browser' && options.browserSessionAvailable === false) {
    throw new Error('Browser delivery cannot start without an active renderer session.');
  }
  return replaceOutput(job, outputId, {
    ...output,
    status: 'running',
    attempts: output.attempts + 1,
    error: undefined,
    result: undefined,
  });
}

export function succeedVideoDeliveryOutput(
  job: VideoDeliveryJob,
  outputId: string,
  result: VideoDeliveryOutputResult = {},
): VideoDeliveryJob {
  const output = findRunningOutput(job, outputId);
  const normalizedResult: VideoDeliveryOutputResult = {};
  if (result.byteSize !== undefined) {
    if (!Number.isSafeInteger(result.byteSize) || result.byteSize < 0) throw new Error('Delivery byte size must be a non-negative safe integer.');
    normalizedResult.byteSize = result.byteSize;
  }
  if (result.checksum?.trim()) normalizedResult.checksum = result.checksum.trim().slice(0, 512);
  if (result.manifestPath?.trim()) normalizedResult.manifestPath = result.manifestPath.trim().slice(0, 2_048);
  return replaceOutput(job, outputId, { ...output, status: 'succeeded', result: normalizedResult });
}

export function failVideoDeliveryOutput(job: VideoDeliveryJob, outputId: string, error: string): VideoDeliveryJob {
  const output = findRunningOutput(job, outputId);
  return replaceOutput(job, outputId, {
    ...output,
    status: 'failed',
    error: requiredText(error, 'Delivery failure', 2_048),
  });
}

export function retryFailedVideoDeliveryOutputs(job: VideoDeliveryJob): VideoDeliveryJob {
  const outputs = job.outputs.map((output) => output.status === 'failed'
    ? { ...output, status: 'queued' as const, error: undefined, result: undefined }
    : output);
  return freezeJob({ ...job, outputs, status: deriveJobStatus(outputs) });
}

export function cancelVideoDeliveryJob(job: VideoDeliveryJob): VideoDeliveryJob {
  const outputs = job.outputs.map((output) => output.status === 'queued' || output.status === 'running'
    ? { ...output, status: 'canceled' as const, error: undefined }
    : output);
  return freezeJob({ ...job, outputs, status: deriveJobStatus(outputs) });
}

export function isVideoDeliveryJobForCompositionSignature(job: VideoDeliveryJob, signature: string): boolean {
  return job.frozenCompositionSignature === signature;
}

function resolveExecutionTarget(
  output: VideoDeliveryProfileOutput,
  environment: VideoDeliveryPlanningEnvironment,
  requiredCapabilities: readonly string[],
): { target?: VideoDeliveryExecutionTarget; missingCapabilities: string[]; reason?: string } {
  const requested = output.requestedTarget ?? 'auto';
  const supported = new Set(output.supportedTargets ?? ['native', 'browser']);
  const targetOrder: VideoDeliveryExecutionTarget[] = requested === 'auto' ? ['native', 'browser'] : [requested];
  let bestMissing: string[] = [...requiredCapabilities];

  for (const target of targetOrder) {
    if (!supported.has(target)) continue;
    const capability = environment[target];
    if (!capability.available) continue;
    const available = new Set(normalizeCapabilities(capability.capabilities));
    const missing = requiredCapabilities.filter((item) => !available.has(item));
    if (missing.length === 0) return { target, missingCapabilities: [] };
    if (missing.length < bestMissing.length) bestMissing = missing;
  }

  const requestedLabel = requested === 'auto' ? 'native or browser' : requested;
  return {
    missingCapabilities: bestMissing,
    reason: bestMissing.length
      ? `No available ${requestedLabel} target provides: ${bestMissing.join(', ')}.`
      : `No supported ${requestedLabel} renderer target is available.`,
  };
}

function replaceOutput(
  job: VideoDeliveryJob,
  outputId: string,
  replacement: PlannedVideoDeliveryOutput,
): VideoDeliveryJob {
  let replaced = false;
  const outputs = job.outputs.map((output) => {
    if (output.id !== outputId) return output;
    replaced = true;
    return replacement;
  });
  if (!replaced) throw new Error(`Unknown delivery output ${outputId}.`);
  return freezeJob({ ...job, outputs, status: deriveJobStatus(outputs) });
}

function findOutput(job: VideoDeliveryJob, outputId: string): PlannedVideoDeliveryOutput {
  const output = job.outputs.find((candidate) => candidate.id === outputId);
  if (!output) throw new Error(`Unknown delivery output ${outputId}.`);
  return output;
}

function findRunningOutput(job: VideoDeliveryJob, outputId: string): PlannedVideoDeliveryOutput {
  const output = findOutput(job, outputId);
  if (output.status !== 'running') throw new Error(`Delivery output ${outputId} is not running.`);
  return output;
}

function deriveJobStatus(outputs: readonly PlannedVideoDeliveryOutput[]): VideoDeliveryJobStatus {
  if (outputs.some((output) => output.status === 'running')) return 'running';
  if (outputs.some((output) => output.status === 'queued')) return 'queued';
  if (outputs.every((output) => output.status === 'blocked')) return 'blocked';
  if (outputs.every((output) => output.status === 'succeeded')) return 'completed';
  if (outputs.some((output) => output.status === 'canceled')) return 'canceled';
  const succeeded = outputs.filter((output) => output.status === 'succeeded').length;
  const failedOrBlocked = outputs.filter((output) => output.status === 'failed' || output.status === 'blocked').length;
  if (succeeded > 0 && failedOrBlocked > 0) return 'partial-failure';
  if (failedOrBlocked > 0) return 'failed';
  return 'canceled';
}

function freezeJob(job: VideoDeliveryJob): VideoDeliveryJob {
  const outputs = job.outputs.map((output) => Object.freeze({
    ...output,
    missingCapabilities: Object.freeze([...output.missingCapabilities]),
    ...(output.result ? { result: Object.freeze({ ...output.result }) } : {}),
  }));
  return Object.freeze({
    ...job,
    outputs: Object.freeze(outputs),
    manifestIntent: Object.freeze({ ...job.manifestIntent }),
  });
}

function normalizeCapabilities(values: readonly string[] | undefined): string[] {
  const normalized = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
  if (normalized.length > MAX_VIDEO_DELIVERY_CAPABILITIES) {
    throw new Error(`Delivery capability list exceeds the ${MAX_VIDEO_DELIVERY_CAPABILITIES}-item safety limit.`);
  }
  if (normalized.some((value) => value.length > 160)) {
    throw new Error('Delivery capability identifiers cannot exceed 160 characters.');
  }
  return normalized;
}

function normalizeExtension(value: string): string {
  const normalized = value.trim().replace(/^\.+/u, '').toLowerCase();
  if (!/^[a-z0-9]{1,12}$/u.test(normalized)) throw new Error('Delivery extension must contain 1-12 letters or digits.');
  return normalized;
}

function normalizeIsoDate(value: string): string {
  const parsed = new Date(value);
  if (!value.trim() || Number.isNaN(parsed.getTime())) throw new Error('Delivery creation time must be a valid date.');
  return parsed.toISOString();
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return normalized;
}

function sanitizeFilename(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\p{Cc}<>:"/\\|?*]+/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[- ]{2,}/gu, '-')
    .replace(/^[. -]+|[. -]+$/gu, '');
}

function truncateFilename(value: string, extension: string): string {
  if (value.length <= MAX_VIDEO_DELIVERY_FILENAME_LENGTH) return value;
  const suffix = `.${extension}`;
  const stemLimit = Math.max(1, MAX_VIDEO_DELIVERY_FILENAME_LENGTH - suffix.length);
  const withoutSuffix = value.toLowerCase().endsWith(suffix.toLowerCase())
    ? value.slice(0, -suffix.length)
    : value;
  return `${withoutSuffix.slice(0, stemLimit).replace(/[. -]+$/gu, '') || 'video'}${suffix}`;
}

function normalizeCollisionKey(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
