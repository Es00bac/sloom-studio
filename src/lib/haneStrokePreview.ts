import { create } from 'zustand';
import type {
  TiltmarkBrushContactShade,
  TiltmarkBrushDab,
  TiltmarkDabShape,
  TiltmarkFibreContact,
} from '../components/ImageEditor/tiltmark/TiltmarkTypes';
import {
  getHaneLinkProviderCapabilities,
  getRemoteHostPairingState,
  isHaneLinkProviderSession,
  remoteHostFetch,
} from './remoteHostClient';
import { supportsHaneStrokePreview } from './haneLinkProviderContract';
import { getProjectSyncChannel } from './projectSyncService';

export const HANE_STROKE_PREVIEW_MAX_DABS_PER_PACKET = 256;
export const HANE_STROKE_PREVIEW_MAX_PACKET_CHARACTERS = 512 * 1024;
export const HANE_STROKE_PREVIEW_MAX_EVENTS = 64;
export const HANE_STROKE_PREVIEW_MAX_DABS_PER_STROKE = 4096;
export const HANE_STROKE_PREVIEW_MAX_ACTIVE_STROKES = 16;

const PREVIEW_POLL_TIMEOUT_MS = 35_000;
const SNAPSHOT_TIMEOUT_MS = 12_000;
const RECONNECT_DELAY_MS = 800;
const UNPAIRED_DELAY_MS = 500;
const LEASE_RENEW_INTERVAL_MS = 20 * 60 * 1000;
const LEASE_DURATION_MS = 60 * 60 * 1000;
const MAX_DOCUMENT_DIMENSION = 200_000;
const MAX_ABSOLUTE_DAB_COORDINATE = 2_000_000;

interface StrokePreviewBase {
  sessionId: string;
  targetId: string;
  strokeId: string;
  sequence: number;
}

export interface HaneStrokePreviewBegin extends StrokePreviewBase {
  type: 'stroke-preview-begin';
  baseRasterEpoch: number;
  dabs: readonly TiltmarkBrushDab[];
}

export interface HaneStrokePreviewAppend extends StrokePreviewBase {
  type: 'stroke-preview-append';
  dabs: readonly TiltmarkBrushDab[];
}

export interface HaneStrokePreviewCommit extends StrokePreviewBase {
  type: 'stroke-preview-commit';
  acceptedRasterEpoch: number;
}

export interface HaneStrokePreviewCancel extends StrokePreviewBase {
  type: 'stroke-preview-cancel';
  reason:
    | 'input-cancelled'
    | 'target-replaced'
    | 'lease-lost'
    | 'reconnect'
    | 'host-reset';
}

export type HaneStrokePreviewOperation =
  | HaneStrokePreviewBegin
  | HaneStrokePreviewAppend
  | HaneStrokePreviewCommit
  | HaneStrokePreviewCancel;

export interface HaneStrokePreviewEvent {
  version: number;
  channel: 'image-preview';
  change: HaneStrokePreviewOperation;
}

export interface HaneStrokePreviewPoll {
  version: number;
  events: readonly HaneStrokePreviewEvent[];
  gap: boolean;
  action: 'apply-events' | 'discard-overlays-request-snapshot';
}

export interface HaneStrokePreviewOverlay {
  strokeId: string;
  dabs: readonly TiltmarkBrushDab[];
  pendingAcceptedRasterEpoch: number | null;
}

interface ActiveStroke {
  strokeId: string;
  sequence: number;
  baseRasterEpoch: number;
  dabs: TiltmarkBrushDab[];
  pendingAcceptedRasterEpoch: number | null;
}

export interface HaneStrokePreviewApplyResult {
  recoveryRequired: boolean;
  requiredRasterEpoch: number;
  changed: boolean;
}

export interface HaneStrokePreviewStoreState {
  status: 'idle' | 'unsupported' | 'recovering' | 'streaming' | 'error';
  sessionId: string | null;
  targetId: string | null;
  version: number;
  installedRasterEpoch: number;
  documentWidth: number;
  documentHeight: number;
  overlays: readonly HaneStrokePreviewOverlay[];
  error: string | null;
}

const INITIAL_PREVIEW_STATE: HaneStrokePreviewStoreState = {
  status: 'idle',
  sessionId: null,
  targetId: null,
  version: 0,
  installedRasterEpoch: 0,
  documentWidth: 1,
  documentHeight: 1,
  overlays: [],
  error: null,
};

export const useHaneStrokePreviewStore = create<HaneStrokePreviewStoreState>(
  () => INITIAL_PREVIEW_STATE,
);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeCounter(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function boundedText(value: unknown, maximum = 180): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
  ) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || codePoint === 127) return false;
  }
  return true;
}

function finiteNumber(
  value: unknown,
  minimum = -MAX_ABSOLUTE_DAB_COORDINATE,
  maximum = MAX_ABSOLUTE_DAB_COORDINATE,
): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function optionalFiniteNumber(
  value: unknown,
  minimum = -MAX_ABSOLUTE_DAB_COORDINATE,
  maximum = MAX_ABSOLUTE_DAB_COORDINATE,
): number | undefined {
  return value === undefined || value === null
    ? undefined
    : finiteNumber(value, minimum, maximum) ? value : undefined;
}

function parseContactShade(value: unknown): TiltmarkBrushContactShade | undefined {
  if (value === undefined || value === null) return undefined;
  const source = record(value);
  if (
    !source
    || !finiteNumber(source.darkX, -2, 2)
    || !finiteNumber(source.darkY, -2, 2)
    || !finiteNumber(source.lightX, -2, 2)
    || !finiteNumber(source.lightY, -2, 2)
    || !finiteNumber(source.darkAlpha, 0, 1)
    || !finiteNumber(source.lightAlpha, 0, 1)
  ) return undefined;
  return {
    darkX: source.darkX,
    darkY: source.darkY,
    lightX: source.lightX,
    lightY: source.lightY,
    darkAlpha: source.darkAlpha,
    lightAlpha: source.lightAlpha,
  };
}

function parseFibre(value: unknown): TiltmarkFibreContact | null {
  const source = record(value);
  if (
    !source
    || !safeCounter(source.index)
    || !finiteNumber(source.rootX)
    || !finiteNumber(source.rootY)
    || !finiteNumber(source.controlX)
    || !finiteNumber(source.controlY)
    || !finiteNumber(source.tipX)
    || !finiteNumber(source.tipY)
    || !finiteNumber(source.width, 0, MAX_DOCUMENT_DIMENSION)
    || !finiteNumber(source.opacity, 0, 1)
    || !finiteNumber(source.load, 0, 1.5)
    || !finiteNumber(source.contactLength, 0, MAX_DOCUMENT_DIMENSION)
    || (source.color !== undefined && !boundedText(source.color, 32))
  ) return null;
  return {
    index: source.index,
    rootX: source.rootX,
    rootY: source.rootY,
    controlX: source.controlX,
    controlY: source.controlY,
    tipX: source.tipX,
    tipY: source.tipY,
    width: source.width,
    opacity: source.opacity,
    load: source.load,
    contactLength: source.contactLength,
    ...(typeof source.color === 'string' ? { color: source.color } : {}),
  };
}

const DAB_SHAPES = new Set<TiltmarkDabShape>([
  'ellipse',
  'triangle',
  'chisel',
  'bristle',
  'particle',
  'ribbon',
]);

/**
 * Network commands are copied into a bounded Canvas-facing shape. Unknown
 * fields are stripped; no color, pickup, wetness, or contact physics is
 * derived here.
 */
export function parseHaneStrokePreviewDab(value: unknown): TiltmarkBrushDab | null {
  const source = record(value);
  if (
    !source
    || !safeCounter(source.index)
    || !finiteNumber(source.x)
    || !finiteNumber(source.y)
    || !finiteNumber(source.width, 0.0001, MAX_DOCUMENT_DIMENSION)
    || !finiteNumber(source.height, 0.0001, MAX_DOCUMENT_DIMENSION)
    || !finiteNumber(source.rotationRad, -Math.PI * 4096, Math.PI * 4096)
    || typeof source.shape !== 'string'
    || !DAB_SHAPES.has(source.shape as TiltmarkDabShape)
    || !boundedText(source.color, 32)
    || !finiteNumber(source.opacity, 0, 1)
    || !finiteNumber(source.flow, 0, 1)
    || !finiteNumber(source.hardness, 0, 1)
    || !finiteNumber(source.grain, 0, 1)
    || !finiteNumber(source.wetness, 0, 1)
    || !finiteNumber(source.solvent, 0, 1)
    || !safeCounter(source.strandCount)
    || source.strandCount > 512
    || !safeCounter(source.particleCount)
    || source.particleCount > 2048
    || !finiteNumber(source.spread, 0, 16)
    || !['paint', 'smudge', 'mix', 'lift'].includes(String(source.interaction))
    || !finiteNumber(source.pickup, 0, 2)
    || !finiteNumber(source.colorMix, 0, 2)
    || !finiteNumber(source.bristleBend, -4, 4)
    || !finiteNumber(source.bristleSplay, 0, 4)
    || !finiteNumber(source.bristleCohesion, 0, 1)
    || !finiteNumber(source.paintLoad, 0, 2)
    || !safeCounter(source.seed)
    || typeof source.eraser !== 'boolean'
  ) return null;

  const fibresInput = source.fibres;
  let fibres: TiltmarkFibreContact[] | undefined;
  if (fibresInput !== undefined) {
    if (!Array.isArray(fibresInput) || fibresInput.length > 512) return null;
    fibres = [];
    for (const fibreInput of fibresInput) {
      const fibre = parseFibre(fibreInput);
      if (!fibre) return null;
      fibres.push(fibre);
    }
  }
  const contactShade = parseContactShade(source.contactShade);
  if (source.contactShade !== undefined && !contactShade) return null;
  const renderOpacity = optionalFiniteNumber(source.renderOpacity, 0, 1);
  if (source.renderOpacity !== undefined && renderOpacity === undefined) return null;
  const medium = source.medium;
  if (medium !== undefined && !boundedText(medium, 80)) return null;

  return {
    index: source.index,
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    rotationRad: source.rotationRad,
    shape: source.shape as TiltmarkDabShape,
    ...(contactShade ? { contactShade } : {}),
    ...(typeof medium === 'string' ? { medium } : {}),
    ...(optionalFiniteNumber(source.timeMs, 0, Number.MAX_SAFE_INTEGER) !== undefined
      ? { timeMs: source.timeMs as number }
      : {}),
    ...(optionalFiniteNumber(source.velocityPxPerMs, 0, 100_000) !== undefined
      ? { velocityPxPerMs: source.velocityPxPerMs as number }
      : {}),
    ...(optionalFiniteNumber(source.pressure, 0, 1) !== undefined
      ? { pressure: source.pressure as number }
      : {}),
    ...(optionalFiniteNumber(source.chiselCornerRadius, 0, 0.5) !== undefined
      ? { chiselCornerRadius: source.chiselCornerRadius as number }
      : {}),
    color: source.color,
    opacity: source.opacity,
    ...(renderOpacity !== undefined ? { renderOpacity } : {}),
    flow: source.flow,
    hardness: source.hardness,
    grain: source.grain,
    wetness: source.wetness,
    solvent: source.solvent,
    strandCount: source.strandCount,
    particleCount: source.particleCount,
    spread: source.spread,
    interaction: source.interaction as TiltmarkBrushDab['interaction'],
    pickup: source.pickup,
    colorMix: source.colorMix,
    bristleBend: source.bristleBend,
    bristleSplay: source.bristleSplay,
    bristleCohesion: source.bristleCohesion,
    ...(fibres ? { fibres } : {}),
    paintLoad: source.paintLoad,
    seed: source.seed,
    eraser: source.eraser,
  };
}

function parseDabPacket(value: unknown): readonly TiltmarkBrushDab[] | null {
  if (!Array.isArray(value) || value.length > HANE_STROKE_PREVIEW_MAX_DABS_PER_PACKET) {
    return null;
  }
  try {
    if (JSON.stringify(value).length > HANE_STROKE_PREVIEW_MAX_PACKET_CHARACTERS) return null;
  } catch {
    return null;
  }
  const dabs: TiltmarkBrushDab[] = [];
  for (const input of value) {
    const dab = parseHaneStrokePreviewDab(input);
    if (!dab) return null;
    dabs.push(dab);
  }
  return dabs;
}

function parseOperation(value: unknown): HaneStrokePreviewOperation | null {
  const source = record(value);
  if (
    !source
    || !boundedText(source.sessionId)
    || !boundedText(source.targetId)
    || !boundedText(source.strokeId)
    || !safeCounter(source.sequence)
    || typeof source.type !== 'string'
  ) return null;
  const base = {
    sessionId: source.sessionId,
    targetId: source.targetId,
    strokeId: source.strokeId,
    sequence: source.sequence,
  };
  if (source.type === 'stroke-preview-begin') {
    const dabs = parseDabPacket(source.dabs);
    return safeCounter(source.baseRasterEpoch) && dabs
      ? { ...base, type: source.type, baseRasterEpoch: source.baseRasterEpoch, dabs }
      : null;
  }
  if (source.type === 'stroke-preview-append') {
    const dabs = parseDabPacket(source.dabs);
    return dabs ? { ...base, type: source.type, dabs } : null;
  }
  if (source.type === 'stroke-preview-commit') {
    return safeCounter(source.acceptedRasterEpoch)
      ? { ...base, type: source.type, acceptedRasterEpoch: source.acceptedRasterEpoch }
      : null;
  }
  if (source.type === 'stroke-preview-cancel') {
    return [
      'input-cancelled',
      'target-replaced',
      'lease-lost',
      'reconnect',
      'host-reset',
    ].includes(String(source.reason))
      ? { ...base, type: source.type, reason: source.reason as HaneStrokePreviewCancel['reason'] }
      : null;
  }
  return null;
}

export function parseHaneStrokePreviewPoll(value: unknown): HaneStrokePreviewPoll | null {
  const source = record(value);
  if (
    !source
    || !safeCounter(source.version)
    || typeof source.gap !== 'boolean'
    || !['apply-events', 'discard-overlays-request-snapshot'].includes(String(source.action))
    || !Array.isArray(source.events)
    || source.events.length > HANE_STROKE_PREVIEW_MAX_EVENTS
  ) return null;
  const events: HaneStrokePreviewEvent[] = [];
  for (const input of source.events) {
    const event = record(input);
    const change = parseOperation(event?.change);
    if (
      !event
      || !safeCounter(event.version)
      || event.channel !== 'image-preview'
      || !change
    ) return null;
    events.push({ version: event.version, channel: 'image-preview', change });
  }
  return {
    version: source.version,
    events,
    gap: source.gap,
    action: source.action as HaneStrokePreviewPoll['action'],
  };
}

export class HaneStrokePreviewConsumer {
  private version = 0;
  private installedRasterEpoch = 0;
  private readonly strokes = new Map<string, ActiveStroke>();
  readonly sessionId: string;
  readonly targetId: string;

  constructor(
    sessionId: string,
    targetId: string,
  ) {
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  resetForReconnect(): void {
    this.version = 0;
    this.strokes.clear();
  }

  discardTransient(): void {
    this.strokes.clear();
  }

  installRasterEpoch(epoch: number): void {
    if (!safeCounter(epoch)) return;
    this.installedRasterEpoch = Math.max(this.installedRasterEpoch, epoch);
    for (const [strokeId, stroke] of this.strokes) {
      if (
        stroke.pendingAcceptedRasterEpoch !== null
        && stroke.pendingAcceptedRasterEpoch <= this.installedRasterEpoch
      ) {
        this.strokes.delete(strokeId);
      }
    }
  }

  applyPoll(poll: HaneStrokePreviewPoll): HaneStrokePreviewApplyResult {
    if (poll.gap || poll.action === 'discard-overlays-request-snapshot') {
      const changed = this.strokes.size > 0;
      this.strokes.clear();
      this.version = Math.max(this.version, poll.version);
      return {
        recoveryRequired: true,
        requiredRasterEpoch: this.installedRasterEpoch,
        changed,
      };
    }

    let changed = false;
    const events = [...poll.events].sort((left, right) => left.version - right.version);
    for (const event of events) {
      if (event.version <= this.version) continue;
      this.version = event.version;
      const operation = event.change;
      if (operation.sessionId !== this.sessionId || operation.targetId !== this.targetId) continue;

      if (operation.type === 'stroke-preview-begin') {
        if (operation.baseRasterEpoch < this.installedRasterEpoch) continue;
        if (
          !this.strokes.has(operation.strokeId)
          && this.strokes.size >= HANE_STROKE_PREVIEW_MAX_ACTIVE_STROKES
        ) {
          const oldest = this.strokes.keys().next().value as string | undefined;
          if (oldest) this.strokes.delete(oldest);
        }
        this.strokes.set(operation.strokeId, {
          strokeId: operation.strokeId,
          sequence: operation.sequence,
          baseRasterEpoch: operation.baseRasterEpoch,
          dabs: [...operation.dabs].slice(-HANE_STROKE_PREVIEW_MAX_DABS_PER_STROKE),
          pendingAcceptedRasterEpoch: null,
        });
        changed = true;
        continue;
      }

      const active = this.strokes.get(operation.strokeId);
      if (!active || operation.sequence <= active.sequence) continue;
      active.sequence = operation.sequence;
      if (operation.type === 'stroke-preview-append') {
        active.dabs.push(...operation.dabs);
        if (active.dabs.length > HANE_STROKE_PREVIEW_MAX_DABS_PER_STROKE) {
          active.dabs.splice(
            0,
            active.dabs.length - HANE_STROKE_PREVIEW_MAX_DABS_PER_STROKE,
          );
        }
        changed = true;
      } else if (operation.type === 'stroke-preview-commit') {
        active.pendingAcceptedRasterEpoch = operation.acceptedRasterEpoch;
        if (operation.acceptedRasterEpoch <= this.installedRasterEpoch) {
          this.strokes.delete(operation.strokeId);
        }
        changed = true;
      } else {
        this.strokes.delete(operation.strokeId);
        changed = true;
      }
    }
    this.version = Math.max(this.version, poll.version);
    return {
      recoveryRequired: false,
      requiredRasterEpoch: this.requiredRasterEpoch(),
      changed,
    };
  }

  requiredRasterEpoch(): number {
    let required = this.installedRasterEpoch;
    for (const stroke of this.strokes.values()) {
      required = Math.max(
        required,
        stroke.baseRasterEpoch,
        stroke.pendingAcceptedRasterEpoch ?? 0,
      );
    }
    return required;
  }

  snapshot(): Pick<
    HaneStrokePreviewStoreState,
    'version' | 'installedRasterEpoch' | 'overlays'
  > {
    return {
      version: this.version,
      installedRasterEpoch: this.installedRasterEpoch,
      overlays: [...this.strokes.values()].map((stroke) => ({
        strokeId: stroke.strokeId,
        dabs: stroke.dabs,
        pendingAcceptedRasterEpoch: stroke.pendingAcceptedRasterEpoch,
      })),
    };
  }
}

interface DurableImageSnapshot {
  rasterEpoch: number;
  snapshot: unknown;
  width: number;
  height: number;
}

function parseDurableImageSnapshot(
  value: unknown,
  documentId: string,
): DurableImageSnapshot | null {
  const source = record(value);
  const snapshot = record(source?.snapshot);
  const document = record(snapshot?.document);
  if (
    !source
    || !safeCounter(source.rasterEpoch)
    || !snapshot
    || snapshot.type !== 'image-document-snapshot'
    || !document
    || document.id !== documentId
    || !safeCounter(document.width)
    || document.width <= 0
    || document.width > MAX_DOCUMENT_DIMENSION
    || !safeCounter(document.height)
    || document.height <= 0
    || document.height > MAX_DOCUMENT_DIMENSION
  ) return null;
  return {
    rasterEpoch: source.rasterEpoch,
    snapshot: source.snapshot,
    width: document.width,
    height: document.height,
  };
}

interface HaneStrokePreviewStreamInput {
  sessionId: string;
  targetId: string;
  documentId: string;
  onDurableSnapshotInstalled: (rasterEpoch: number) => Promise<void>;
  onLeaseLost?: () => void;
}

interface ActiveStream {
  generation: number;
  input: HaneStrokePreviewStreamInput;
  consumer: HaneStrokePreviewConsumer;
  controller: AbortController;
  documentWidth: number;
  documentHeight: number;
  installTail: Promise<boolean>;
  run: Promise<void>;
}

let streamGeneration = 0;
let activeStream: ActiveStream | null = null;

const delay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

function isCurrent(stream: ActiveStream): boolean {
  return activeStream === stream
    && stream.generation === streamGeneration
    && !stream.controller.signal.aborted;
}

function publishStream(
  stream: ActiveStream,
  status: HaneStrokePreviewStoreState['status'],
  error: string | null = null,
): void {
  const snapshot = stream.consumer.snapshot();
  useHaneStrokePreviewStore.setState({
    status,
    sessionId: stream.input.sessionId,
    targetId: stream.input.targetId,
    version: snapshot.version,
    installedRasterEpoch: snapshot.installedRasterEpoch,
    documentWidth: stream.documentWidth,
    documentHeight: stream.documentHeight,
    overlays: snapshot.overlays,
    error,
  });
}

async function installLatestDurableSnapshot(
  stream: ActiveStream,
  minimumRasterEpoch: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!isCurrent(stream)) return false;
    const response = await remoteHostFetch('/project/image/snapshot', {
      timeoutMs: SNAPSHOT_TIMEOUT_MS,
      signal: stream.controller.signal,
    });
    if (!response?.ok || !isCurrent(stream)) return false;
    const payload = parseDurableImageSnapshot(
      await response.json().catch(() => null),
      stream.input.documentId,
    );
    if (!payload) return false;
    const imageSync = await import('./imageSyncChannel');
    imageSync.initializeImageSyncChannel();
    const channel = getProjectSyncChannel('image');
    if (!channel) return false;
    await channel.applyRemote(payload.snapshot);
    if (!isCurrent(stream)) return false;
    await stream.input.onDurableSnapshotInstalled(payload.rasterEpoch);
    if (!isCurrent(stream)) return false;
    stream.documentWidth = payload.width;
    stream.documentHeight = payload.height;
    stream.consumer.installRasterEpoch(payload.rasterEpoch);
    if (payload.rasterEpoch >= minimumRasterEpoch) return true;
    await delay(120);
  }
  return false;
}

function queueDurableInstall(
  stream: ActiveStream,
  minimumRasterEpoch: number,
): Promise<boolean> {
  const work = stream.installTail
    .catch(() => false)
    .then(() => installLatestDurableSnapshot(stream, minimumRasterEpoch));
  stream.installTail = work;
  return work;
}

async function renewLinkedEditLease(stream: ActiveStream): Promise<boolean> {
  const response = await remoteHostFetch(
    `/linked-edit/lease/${encodeURIComponent(stream.input.sessionId)}/renew`,
    {
      method: 'POST',
      body: JSON.stringify({ leaseDurationMs: LEASE_DURATION_MS }),
      timeoutMs: SNAPSHOT_TIMEOUT_MS,
      signal: stream.controller.signal,
    },
  );
  const payload = await response?.json().catch(() => null) as
    | { ok?: boolean; error?: string; targetId?: string }
    | null;
  if (
    response?.ok
    && payload?.ok === true
    && payload.targetId === stream.input.targetId
  ) return true;
  if (payload?.error === 'linked-edit-lease-not-owned') {
    stream.consumer.discardTransient();
    publishStream(stream, 'error', 'Hane’s linked-edit lease is no longer owned by this device.');
    stream.input.onLeaseLost?.();
  }
  return false;
}

async function runPreviewStream(stream: ActiveStream): Promise<void> {
  let recoveryRequired = true;
  let nextLeaseRenewAt = Date.now() + LEASE_RENEW_INTERVAL_MS;
  while (isCurrent(stream)) {
    const capabilities = getHaneLinkProviderCapabilities();
    if (
      !isHaneLinkProviderSession()
      || !supportsHaneStrokePreview(capabilities)
    ) {
      stream.consumer.discardTransient();
      publishStream(stream, capabilities ? 'unsupported' : 'recovering');
      await delay(UNPAIRED_DELAY_MS);
      recoveryRequired = true;
      continue;
    }
    if (getRemoteHostPairingState() !== 'paired') {
      stream.consumer.discardTransient();
      publishStream(stream, 'recovering');
      await delay(UNPAIRED_DELAY_MS);
      recoveryRequired = true;
      continue;
    }

    try {
      if (recoveryRequired) {
        stream.consumer.resetForReconnect();
        publishStream(stream, 'recovering');
        if (!await queueDurableInstall(stream, 0)) throw new Error('durable-snapshot-unavailable');
        recoveryRequired = false;
        publishStream(stream, 'streaming');
      }
      if (Date.now() >= nextLeaseRenewAt) {
        await renewLinkedEditLease(stream);
        nextLeaseRenewAt = Date.now() + LEASE_RENEW_INTERVAL_MS;
      }

      const since = stream.consumer.snapshot().version;
      const response = await remoteHostFetch(
        `/project/image/preview-events?since=${since}`,
        {
          timeoutMs: PREVIEW_POLL_TIMEOUT_MS,
          signal: stream.controller.signal,
        },
      );
      if (!response?.ok || !isCurrent(stream)) throw new Error('preview-stream-unavailable');
      const poll = parseHaneStrokePreviewPoll(await response.json().catch(() => null));
      if (!poll) throw new Error('invalid-preview-packet');
      const result = stream.consumer.applyPoll(poll);
      if (result.recoveryRequired) {
        publishStream(stream, 'recovering');
        if (!await queueDurableInstall(stream, 0)) throw new Error('durable-snapshot-unavailable');
      } else if (
        result.requiredRasterEpoch > stream.consumer.snapshot().installedRasterEpoch
        && !await queueDurableInstall(stream, result.requiredRasterEpoch)
      ) {
        throw new Error('accepted-raster-epoch-unavailable');
      }
      publishStream(stream, 'streaming');
    } catch (error) {
      if (!isCurrent(stream)) break;
      stream.consumer.resetForReconnect();
      publishStream(
        stream,
        'recovering',
        error instanceof Error ? error.message : 'Hane preview stream is reconnecting.',
      );
      recoveryRequired = true;
      await delay(RECONNECT_DELAY_MS);
    }
  }
}

export function startHaneStrokePreviewStream(
  input: HaneStrokePreviewStreamInput,
): void {
  stopHaneStrokePreviewStream();
  const capabilities = getHaneLinkProviderCapabilities();
  if (!supportsHaneStrokePreview(capabilities)) {
    useHaneStrokePreviewStore.setState({
      ...INITIAL_PREVIEW_STATE,
      status: capabilities ? 'unsupported' : 'idle',
      sessionId: input.sessionId,
      targetId: input.targetId,
    });
    return;
  }
  const generation = ++streamGeneration;
  const stream = {
    generation,
    input,
    consumer: new HaneStrokePreviewConsumer(input.sessionId, input.targetId),
    controller: new AbortController(),
    documentWidth: 1,
    documentHeight: 1,
    installTail: Promise.resolve(true),
    run: Promise.resolve(),
  } satisfies ActiveStream;
  activeStream = stream;
  publishStream(stream, 'recovering');
  stream.run = runPreviewStream(stream);
}

export async function synchronizeHaneStrokePreviewDurable(): Promise<boolean> {
  const stream = activeStream;
  if (!stream || !isCurrent(stream)) return false;
  const synchronized = await queueDurableInstall(
    stream,
    stream.consumer.requiredRasterEpoch(),
  ).catch(() => false);
  if (synchronized && isCurrent(stream)) publishStream(stream, 'streaming');
  return synchronized;
}

export function stopHaneStrokePreviewStream(): void {
  const stream = activeStream;
  streamGeneration += 1;
  activeStream = null;
  stream?.controller.abort();
  useHaneStrokePreviewStore.setState(INITIAL_PREVIEW_STATE);
}

export function __resetHaneStrokePreviewForTests(): void {
  stopHaneStrokePreviewStream();
  streamGeneration = 0;
}
