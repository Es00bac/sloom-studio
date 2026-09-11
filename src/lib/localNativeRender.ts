import type {
  ProviderSettings,
  RenderBackendPreference,
  VideoRenderAssemblyManifestData,
  VideoRenderAssemblyResultData,
} from '../types/flow';
import type { NativeRenderExecutionBackend } from './nativeRenderSupport';
import { buildProvenanceLabel } from './exportProvenance';

interface NativeRenderHealthResponse {
  ok: boolean;
  availableBackends: NativeRenderExecutionBackend[];
  recommendedBackend: NativeRenderExecutionBackend;
}

interface NativeRenderInput {
  name: string;
  url?: string;
  /** Desktop-local source path. Native FFmpeg links it into the job instead of base64 encoding it. */
  filePath?: string;
}

interface NativeRenderRequestInput {
  name: string;
  mimeType: string;
  base64?: string;
  filePath?: string;
}

export type NativeRenderAssemblyManifest = VideoRenderAssemblyManifestData;
export type NativeRenderAssemblyResult = VideoRenderAssemblyResultData;

interface NativeRenderRequest {
  outputName: string;
  outputDirectoryPath?: string;
  command: string[];
  backend: NativeRenderExecutionBackend;
  inputs: NativeRenderRequestInput[];
  assemblyManifest?: NativeRenderAssemblyManifest;
  returnSegmentArtifacts?: boolean;
}

interface NativeLoudnessAnalysisRequest {
  command: string[];
  backend: NativeRenderExecutionBackend;
  inputs: NativeRenderRequestInput[];
}

interface ResolvedNativeRenderTarget {
  endpoint: string;
  backend: NativeRenderExecutionBackend;
}

export interface NativeRenderSegmentArtifact {
  key: string;
  signature: string;
  startMs: number;
  endMs: number;
  fileName: string;
  mimeType: string;
  base64: string;
}

export interface NativeRenderWithArtifactsResult {
  blob: Blob;
  segmentArtifacts: NativeRenderSegmentArtifact[];
  assemblyResult?: NativeRenderAssemblyResult;
}

export interface NativeRenderFileResult {
  filePath: string;
  fileName: string;
}

let cachedHealth:
  | {
      endpoint: string;
      expiresAt: number;
      health: NativeRenderHealthResponse;
    }
  | undefined;

export async function resolveNativeRenderTarget(
  providerSettings: ProviderSettings,
): Promise<ResolvedNativeRenderTarget | null> {
  const preference = providerSettings.renderBackendPreference;

  if (preference === 'browser') {
    return null;
  }

  const endpoint = normalizeEndpoint(providerSettings.localNativeRenderUrl);
  const health = await fetchNativeRendererHealth(endpoint);

  if (!health) {
    if (preference === 'auto') {
      return null;
    }

    throw new Error(
      `The local native render service is unavailable at ${endpoint}. Switch the render backend to Browser or start the Sloom Studio native render service.`,
    );
  }

  const backend = resolveRequestedBackend(preference, health);

  if (!backend) {
    return null;
  }

  return {
    endpoint,
    backend,
  };
}

/**
 * Container-level provenance on video renders (licensing spec Part 2 §6): ffmpeg's output path is
 * its final argument, so the `-metadata comment=` pair slots in right before it. Commands whose
 * final argument is not the output file (unexpected shapes) pass through untouched — provenance
 * must never break a render.
 */
function withProvenanceMetadata(command: string[], outputName: string): string[] {
  if (command.length === 0 || command[command.length - 1] !== outputName) {
    return command;
  }

  return [
    ...command.slice(0, -1),
    '-metadata',
    `comment=${buildProvenanceLabel()}`,
    outputName,
  ];
}

export async function renderViaLocalNativeFFmpeg({
  providerSettings,
  outputName,
  command: rawCommand,
  inputs,
  assemblyManifest,
}: {
  providerSettings: ProviderSettings;
  outputName: string;
  command: string[];
  inputs: NativeRenderInput[];
  assemblyManifest?: NativeRenderAssemblyManifest;
}): Promise<Blob | null> {
  const command = withProvenanceMetadata(rawCommand, outputName);
  const target = await resolveNativeRenderTarget(providerSettings);

  if (!target) {
    return null;
  }

  const token = providerSettings.localNativeRenderToken?.trim();
  const response = await fetch(`${target.endpoint}/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Signal-Loom-Render-Token': token } : {}),
    },
    body: JSON.stringify({
      outputName,
      command,
      backend: target.backend,
      inputs: await Promise.all(inputs.map(serializeRenderInput)),
      ...(assemblyManifest ? { assemblyManifest } : {}),
    } satisfies NativeRenderRequest),
  });

  if (!response.ok) {
    throw new Error(await extractNativeRenderError(response));
  }

  return await response.blob();
}

/** Runs the measured loudnorm first pass inside the existing localhost FFmpeg
 * service. The response is only FFmpeg's compact JSON report; no source paths,
 * PCM, or rendered output are returned to the browser. */
export async function analyzeLoudnessViaLocalNativeFFmpeg({
  providerSettings,
  command,
  inputs,
}: {
  providerSettings: ProviderSettings;
  command: string[];
  inputs: NativeRenderInput[];
}): Promise<string | null> {
  const target = await resolveNativeRenderTarget(providerSettings);
  if (!target) return null;

  const token = providerSettings.localNativeRenderToken?.trim();
  const response = await fetch(`${target.endpoint}/analyze-loudness`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Signal-Loom-Render-Token': token } : {}),
    },
    body: JSON.stringify({
      command,
      backend: target.backend,
      inputs: await Promise.all(inputs.map(serializeRenderInput)),
    } satisfies NativeLoudnessAnalysisRequest),
  });

  if (!response.ok) {
    throw new Error(`Offline loudness analysis failed: ${await extractNativeRenderError(response)}`);
  }

  const payload = await response.json() as { report?: unknown };
  if (typeof payload.report !== 'string' || payload.report.length === 0 || payload.report.length > 16_384) {
    throw new Error('The local native render service returned an invalid loudness analysis report.');
  }
  return payload.report;
}

/** Feature-length output transport: FFmpeg writes directly into the desktop project scratch
 * directory and returns only the path, avoiding a multi-gigabyte response/blob round trip. */
export async function renderViaLocalNativeFFmpegToFile({
  providerSettings,
  outputName,
  outputDirectoryPath,
  command: rawCommand,
  inputs,
}: {
  providerSettings: ProviderSettings;
  outputName: string;
  outputDirectoryPath: string;
  command: string[];
  inputs: NativeRenderInput[];
}): Promise<NativeRenderFileResult | null> {
  const command = withProvenanceMetadata(rawCommand, outputName);
  const target = await resolveNativeRenderTarget(providerSettings);

  if (!target) {
    return null;
  }

  const token = providerSettings.localNativeRenderToken?.trim();
  const response = await fetch(`${target.endpoint}/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Signal-Loom-Render-Token': token } : {}),
    },
    body: JSON.stringify({
      outputName,
      outputDirectoryPath,
      command,
      backend: target.backend,
      inputs: await Promise.all(inputs.map(serializeRenderInput)),
    } satisfies NativeRenderRequest),
  });

  if (!response.ok) {
    throw new Error(await extractNativeRenderError(response));
  }

  const payload = await response.json() as { filePath?: unknown; fileName?: unknown };
  if (typeof payload.filePath !== 'string' || !payload.filePath.trim()) {
    throw new Error('The local native render service did not return a feature-length output path.');
  }

  return {
    filePath: payload.filePath,
    fileName: typeof payload.fileName === 'string' && payload.fileName.trim()
      ? payload.fileName
      : outputName,
  };
}

export async function renderViaLocalNativeFFmpegWithArtifacts({
  providerSettings,
  outputName,
  command: rawCommand,
  inputs,
  assemblyManifest,
}: {
  providerSettings: ProviderSettings;
  outputName: string;
  command: string[];
  inputs: NativeRenderInput[];
  assemblyManifest?: NativeRenderAssemblyManifest;
}): Promise<NativeRenderWithArtifactsResult | null> {
  const command = withProvenanceMetadata(rawCommand, outputName);
  const target = await resolveNativeRenderTarget(providerSettings);

  if (!target) {
    return null;
  }

  const token = providerSettings.localNativeRenderToken?.trim();
  const response = await fetch(`${target.endpoint}/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Signal-Loom-Render-Token': token } : {}),
    },
    body: JSON.stringify({
      outputName,
      command,
      backend: target.backend,
      inputs: await Promise.all(inputs.map(serializeRenderInput)),
      ...(assemblyManifest ? { assemblyManifest } : {}),
      returnSegmentArtifacts: true,
    } satisfies NativeRenderRequest),
  });

  if (!response.ok) {
    throw new Error(await extractNativeRenderError(response));
  }

  const payload = await response.json() as {
    outputBase64?: unknown;
    mimeType?: unknown;
    segmentArtifacts?: unknown;
    assembledFromSegments?: unknown;
    assemblyUnavailableReason?: unknown;
  };
  const outputBase64 = typeof payload.outputBase64 === 'string' ? payload.outputBase64 : undefined;

  if (!outputBase64) {
    throw new Error('The local native render service returned an invalid artifact response.');
  }

  const assemblyResult = normalizeNativeRenderAssemblyResult(payload);

  return {
    blob: new Blob([base64ToArrayBuffer(outputBase64)], {
      type: typeof payload.mimeType === 'string' ? payload.mimeType : 'video/mp4',
    }),
    segmentArtifacts: normalizeNativeRenderSegmentArtifacts(payload.segmentArtifacts),
    ...(assemblyResult ? { assemblyResult } : {}),
  };
}

function normalizeNativeRenderAssemblyResult(payload: {
  assembledFromSegments?: unknown;
  assemblyUnavailableReason?: unknown;
}): NativeRenderAssemblyResult | undefined {
  if (typeof payload.assembledFromSegments !== 'boolean') {
    return undefined;
  }

  const reason = typeof payload.assemblyUnavailableReason === 'string'
    ? payload.assemblyUnavailableReason.trim()
    : '';

  return {
    assembledFromSegments: payload.assembledFromSegments,
    ...(reason ? { assemblyUnavailableReason: reason } : {}),
  };
}

async function fetchNativeRendererHealth(endpoint: string): Promise<NativeRenderHealthResponse | null> {
  const now = Date.now();

  if (cachedHealth && cachedHealth.endpoint === endpoint && cachedHealth.expiresAt > now) {
    return cachedHealth.health;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch(`${endpoint}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const health = normalizeNativeRenderHealth(await response.json());

    if (!health) {
      return null;
    }

    cachedHealth = {
      endpoint,
      expiresAt: now + 15_000,
      health,
    };
    return health;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeNativeRenderHealth(value: unknown): NativeRenderHealthResponse | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const payload = value as Partial<NativeRenderHealthResponse>;

  if (!Array.isArray(payload.availableBackends)) {
    return null;
  }

  const availableBackends = payload.availableBackends.filter(isNativeRenderExecutionBackend);

  if (availableBackends.length === 0) {
    return null;
  }

  const recommendedBackend = isNativeRenderExecutionBackend(payload.recommendedBackend)
    ? payload.recommendedBackend
    : availableBackends[0];

  return {
    ok: Boolean(payload.ok),
    availableBackends,
    recommendedBackend,
  };
}

function isNativeRenderExecutionBackend(value: unknown): value is NativeRenderExecutionBackend {
  return value === 'cpu' || value === 'amd-vaapi' || value === 'nvidia-nvenc' || value === 'intel-qsv';
}

function resolveRequestedBackend(
  preference: RenderBackendPreference,
  health: NativeRenderHealthResponse,
): NativeRenderExecutionBackend | null {
  if (preference === 'auto') {
    if (health.availableBackends.includes('amd-vaapi')) {
      return 'amd-vaapi';
    }

    if (health.availableBackends.includes('nvidia-nvenc')) {
      return 'nvidia-nvenc';
    }

    if (health.availableBackends.includes('intel-qsv')) {
      return 'intel-qsv';
    }

    return health.availableBackends.includes('cpu') ? 'cpu' : null;
  }

  if (preference === 'native-cpu') {
    if (health.availableBackends.includes('cpu')) {
      return 'cpu';
    }

    throw new Error('The local native render service is up, but CPU rendering is not available.');
  }

  if (preference === 'native-amd-vaapi') {
    if (health.availableBackends.includes('amd-vaapi')) {
      return 'amd-vaapi';
    }

    throw new Error(
      'AMD VAAPI rendering is not available on this machine. Switch to Auto, another available hardware backend, or Native FFmpeg CPU.',
    );
  }

  if (preference === 'native-nvidia-nvenc') {
    if (health.availableBackends.includes('nvidia-nvenc')) return 'nvidia-nvenc';
    throw new Error('NVIDIA NVENC rendering is not available on this machine. Switch to Auto or an available render backend.');
  }

  if (preference === 'native-intel-qsv') {
    if (health.availableBackends.includes('intel-qsv')) return 'intel-qsv';
    throw new Error('Intel Quick Sync rendering is not available on this machine. Switch to Auto or an available render backend.');
  }

  return null;
}

async function serializeRenderInput(input: NativeRenderInput): Promise<NativeRenderRequestInput> {
  if (input.filePath?.trim()) {
    return {
      name: input.name,
      mimeType: guessMimeType(input.name),
      filePath: input.filePath,
    };
  }

  if (!input.url) {
    throw new Error(`Unable to prepare local native render input "${input.name}" because it has no URL or linked file path.`);
  }

  const response = await fetch(input.url);

  if (!response.ok) {
    throw new Error(`Unable to prepare local native render input "${input.name}".`);
  }

  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();

  return {
    name: input.name,
    mimeType: blob.type || guessMimeType(input.name),
    base64: arrayBufferToBase64(buffer),
  };
}

async function extractNativeRenderError(response: Response): Promise<string> {
  const text = await response.text();

  if (!text.trim()) {
    return 'The local native render service returned an empty error response.';
  }

  try {
    const payload = JSON.parse(text) as { error?: string };
    return payload.error || text;
  } catch {
    return text;
  }
}

function normalizeEndpoint(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function normalizeNativeRenderSegmentArtifacts(value: unknown): NativeRenderSegmentArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const artifact = entry as Partial<NativeRenderSegmentArtifact>;

    if (
      typeof artifact.key !== 'string'
      || typeof artifact.signature !== 'string'
      || typeof artifact.startMs !== 'number'
      || typeof artifact.endMs !== 'number'
      || typeof artifact.fileName !== 'string'
      || typeof artifact.base64 !== 'string'
    ) {
      return [];
    }

    return [{
      key: artifact.key,
      signature: artifact.signature,
      startMs: artifact.startMs,
      endMs: artifact.endMs,
      fileName: artifact.fileName,
      mimeType: typeof artifact.mimeType === 'string' ? artifact.mimeType : 'video/mp4',
      base64: artifact.base64,
    }];
  });
}

function guessMimeType(name: string): string {
  const lowerName = name.toLowerCase();

  if (lowerName.endsWith('.png')) {
    return 'image/png';
  }

  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (lowerName.endsWith('.webp')) {
    return 'image/webp';
  }

  if (lowerName.endsWith('.mp4')) {
    return 'video/mp4';
  }

  if (lowerName.endsWith('.mp3')) {
    return 'audio/mpeg';
  }

  return 'application/octet-stream';
}
