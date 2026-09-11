import type {
  ImageAnimationFrame,
  ImageAnimationPlaybackCursor,
  ImageDocument,
  ImageFrameAnimation,
  LayerBitmap,
} from '../../types/imageEditor';
import { renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';
import { createBitmap } from './LayerBitmap';

const DEFAULT_ONION = { enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 };

export function getImageFrameAnimation(document: ImageDocument): ImageFrameAnimation {
  const existing = document.metadata?.animation as unknown;
  if (isValidImageFrameAnimation(existing)) return existing;
  return buildDefaultImageFrameAnimation(document);
}

function buildDefaultImageFrameAnimation(document: ImageDocument): ImageFrameAnimation {
  const first = frameFromDocument(document, 'frame-1', 'Frame 1');
  return { version: 1, frameRate: 12, currentFrameId: first.id, onionSkin: { ...DEFAULT_ONION }, frames: [first] };
}

function isValidImageFrameAnimation(value: unknown): value is ImageFrameAnimation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ImageFrameAnimation>;
  const frameRate = candidate.frameRate;
  if (candidate.version !== 1 || typeof frameRate !== 'number' || !Number.isFinite(frameRate) || frameRate <= 0
    || typeof candidate.currentFrameId !== 'string' || candidate.currentFrameId.length === 0
    || typeof candidate.onionSkin !== 'object' || candidate.onionSkin === null
    || !Array.isArray(candidate.frames) || candidate.frames.length === 0) return false;
  const onion = candidate.onionSkin as { enabled?: unknown; previousOpacity?: unknown; nextOpacity?: unknown };
  const previousOpacity = onion.previousOpacity;
  const nextOpacity = onion.nextOpacity;
  if (typeof onion.enabled !== 'boolean'
    || typeof previousOpacity !== 'number' || !Number.isFinite(previousOpacity) || previousOpacity < 0 || previousOpacity > 1
    || typeof nextOpacity !== 'number' || !Number.isFinite(nextOpacity) || nextOpacity < 0 || nextOpacity > 1) return false;
  return candidate.frames.every((frame) => {
    if (typeof frame !== 'object' || frame === null) return false;
    const item = frame as Partial<ImageAnimationFrame>;
    const durationMs = item.durationMs;
    if (typeof item.id !== 'string' || item.id.length === 0 || typeof item.name !== 'string'
      || typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0
      || typeof item.layerVisibility !== 'object' || item.layerVisibility === null
      || Array.isArray(item.layerVisibility)) return false;
    return Object.values(item.layerVisibility as Record<string, unknown>).every((visible) => typeof visible === 'boolean');
  });
}

/** Normalize a persisted animation at the .slimg read seam. Absent metadata stays absent so
 * ordinary documents do not acquire authored animation state; malformed records become a safe
 * synthesized single-frame animation and retain a user-visible warning instead of crashing the
 * panel/canvas on first draw. */
export function normalizeImageFrameAnimationDocument(document: ImageDocument): ImageDocument {
  const existing = document.metadata?.animation as unknown;
  if (existing === undefined || isValidImageFrameAnimation(existing)) return document;
  const fallback = buildDefaultImageFrameAnimation(document);
  const warnings = document.metadata?.warnings ?? [];
  return {
    ...document,
    metadata: {
      ...document.metadata,
      animation: fallback,
      warnings: [...warnings, 'Malformed Image frame animation metadata was reset to a safe single frame.'],
    },
  };
}

export function frameFromDocument(document: ImageDocument, id: string, name: string): ImageAnimationFrame {
  return { id, name, durationMs: 1000 / 12, layerVisibility: Object.fromEntries(document.layers.map((layer) => [layer.id, layer.visible])) };
}

/**
 * Frame identity must never collide after remove-then-add cycles or against hostile persisted
 * files, so the ordinal is derived from the highest id/name suffix already present instead of
 * from array length (`frames.length + 1` handed out duplicate 'frame-3' ids that made one trash
 * click delete two frames). The bump loop keeps the guarantee even if a reopened file already
 * holds exactly the derived id.
 */
export function deriveNextFrameIdentity(animation: Pick<ImageFrameAnimation, 'frames'>): { id: string; name: string } {
  let maxSuffix = animation.frames.length;
  for (const frame of animation.frames) {
    for (const value of [/^frame-(\d+)$/.exec(frame.id)?.[1], /^Frame (\d+)$/.exec(frame.name)?.[1]]) {
      const parsed = value === undefined ? NaN : Number.parseInt(value, 10);
      if (Number.isSafeInteger(parsed)) maxSuffix = Math.max(maxSuffix, parsed);
    }
  }
  const taken = new Set(animation.frames.map((frame) => frame.id));
  let suffix = maxSuffix >= Number.MAX_SAFE_INTEGER ? 1 : maxSuffix + 1;
  while (taken.has(`frame-${suffix}`)) {
    suffix = suffix >= Number.MAX_SAFE_INTEGER ? 1 : suffix + 1;
  }
  return { id: `frame-${suffix}`, name: `Frame ${suffix}` };
}

/** Select/remove-proof application by array position: an entry with any id (including duplicates
 * imported from a hostile file) can be targeted without ever matching a second twin by accident. */
export function applyAnimationFrameAt(document: ImageDocument, animation: ImageFrameAnimation, frameIndex: number): ImageDocument {
  const frame = animation.frames[frameIndex];
  if (!frame) return document;
  return {
    ...document,
    layers: document.layers.map((layer) => ({ ...layer, visible: frame.layerVisibility[layer.id] ?? false })),
    metadata: { ...document.metadata, animation: { ...animation, currentFrameId: frame.id } },
  };
}

/** Resolution by id for callers that hold a frame id: dangling ids clamp to the first frame,
 * matching the pre-existing contract for reopened files whose selection no longer resolves. */
export function applyAnimationFrame(document: ImageDocument, animation: ImageFrameAnimation, frameId: string): ImageDocument {
  const index = animation.frames.findIndex((candidate) => candidate.id === frameId);
  if (index < 0) {
    return animation.frames.length > 0
      ? applyAnimationFrameAt(document, animation, 0)
      : document;
  }
  return applyAnimationFrameAt(document, animation, index);
}

export function appendAnimationFrame(document: ImageDocument): ImageFrameAnimation {
  const animation = getImageFrameAnimation(document);
  const identity = deriveNextFrameIdentity(animation);
  const frame = frameFromDocument(document, identity.id, identity.name);
  return { ...animation, currentFrameId: frame.id, frames: [...animation.frames, frame] };
}

/** Ephemeral playback pointer kept OUTSIDE document state: the interval writes only this cursor,
 * so visible cels change without touching dirty flags, history stacks, or anything `.slimg`
 * persists. Cleared on pause/unmount/document close by the owner. */
export type { ImageAnimationPlaybackCursor };

/** The frame the display should show: the playback cursor when it targets this document,
 * otherwise the authored selection. Unresolvable cursors and authored ids left dangling by
 * hostile reopened files both fall back to the first frame instead of surprising callers. */
export function resolveAnimationDisplayFrameId(
  animation: ImageFrameAnimation,
  docId: string,
  cursor: ImageAnimationPlaybackCursor | null,
): string {
  if (cursor && cursor.docId === docId && animation.frames.some((frame) => frame.id === cursor.frameId)) {
    return cursor.frameId;
  }
  const authoredResolves = animation.frames.some((frame) => frame.id === animation.currentFrameId);
  if (authoredResolves || animation.frames.length === 0) return animation.currentFrameId;
  return animation.frames[0]!.id;
}

/**
 * One finite wrap-around playback step for the ephemeral cursor. Single-frame (or empty)
 * animations cannot play, so they stop the session outright. The cursor is display state only —
 * this function never sees, let alone mutates, document/history/dirty data.
 */
export function advanceAnimationPlaybackCursor(
  animation: ImageFrameAnimation,
  docId: string,
  cursor: ImageAnimationPlaybackCursor | null,
): ImageAnimationPlaybackCursor | null {
  if (animation.frames.length < 2) return null;
  const fromIndex = Math.max(
    0,
    animation.frames.findIndex((frame) => frame.id === resolveAnimationDisplayFrameId(animation, docId, cursor)),
  );
  const next = animation.frames[(fromIndex + 1) % animation.frames.length];
  return next ? { docId, frameId: next.id } : null;
}

export interface AnimationFrameDisplayPlan {
  /** Draw these previous/next ghosts at their configured opacity beneath the shown frame. */
  ghosts: Array<{ frameId: string; opacity: number }>;
  /** Non-null only while playback owns the view: rebase the displayed pixels onto this frame's
   * cel instead of trusting live layer visibility (which playback no longer mutates). */
  celFrameId: string | null;
}

export interface AnimationFrameDisplayParts {
  ghosts: LayerBitmap | null;
  cel: LayerBitmap | null;
}

/**
 * Pure description of what the editor-only animation preview must draw for the current state.
 * `null` means "draw nothing extra" — every ordinary path (including the high-res worker result)
 * must stay byte-identical whenever onion skin cannot contribute imagery.
 */
export function planAnimationFrameDisplay(
  document: ImageDocument,
  cursor: ImageAnimationPlaybackCursor | null,
): AnimationFrameDisplayPlan | null {
  const animation = getImageFrameAnimation(document);
  const playbackActive = cursor?.docId === document.id;
  const celFrameId = playbackActive
    ? resolveAnimationDisplayFrameId(animation, document.id, cursor)
    : null;
  const ghosts: Array<{ frameId: string; opacity: number }> = [];
  if (animation.onionSkin.enabled && animation.frames.length >= 2) {
    const displayId = resolveAnimationDisplayFrameId(animation, document.id, cursor);
    const index = Math.max(0, animation.frames.findIndex((frame) => frame.id === displayId));
    const candidate = (frame: ImageAnimationFrame | undefined, opacity: number) => {
      if (frame && opacity > 0) ghosts.push({ frameId: frame.id, opacity });
    };
    candidate(animation.frames[index - 1], animation.onionSkin.previousOpacity);
    candidate(animation.frames[index + 1], animation.onionSkin.nextOpacity);
  }
  if (!playbackActive && ghosts.length === 0) return null;
  return { ghosts, celFrameId };
}

/** Render the expensive frame-dependent layers once per display plan. Live stroke and slider
 * paths reuse these parts while updating their cheap base projection, avoiding a full document
 * composite on every pointer event. */
export function renderAnimationFrameDisplayParts(
  document: ImageDocument,
  cursor: ImageAnimationPlaybackCursor | null,
): AnimationFrameDisplayParts | null {
  const plan = planAnimationFrameDisplay(document, cursor);
  if (!plan) return null;
  const animation = getImageFrameAnimation(document);
  const ghosts = plan.ghosts.length > 0 ? createBitmap(document.width, document.height) : null;
  if (ghosts) {
    const context = ghosts.getContext('2d')!;
    for (const ghostPlan of plan.ghosts) {
      const ghostIndex = animation.frames.findIndex((frame) => frame.id === ghostPlan.frameId);
      if (ghostIndex < 0) continue;
      const rendered = renderImageDocumentLayersToBitmap(applyAnimationFrameAt(document, animation, ghostIndex));
      context.save();
      context.globalAlpha = ghostPlan.opacity;
      context.drawImage(rendered, 0, 0);
      context.restore();
    }
  }
  const celIndex = plan.celFrameId === null ? -1 : animation.frames.findIndex((frame) => frame.id === plan.celFrameId);
  return {
    ghosts,
    cel: celIndex >= 0 ? renderImageDocumentLayersToBitmap(applyAnimationFrameAt(document, animation, celIndex)) : null,
  };
}

/**
 * Editor-only display composition shared by every preview route. `base` may come from the
 * high-res worker or the synchronous compositor — ghost underlay wraps whichever bytes were
 * chosen, so onion skin looks identical with and without worker support while export keeps
 * calling the pure document compositor and can never contain ghost imagery.
 */
export function composeAnimationFrameDisplay<T extends LayerBitmap | HTMLCanvasElement | ImageBitmap>(
  base: T,
  document: ImageDocument,
  cursor: ImageAnimationPlaybackCursor | null,
): T | LayerBitmap {
  const plan = planAnimationFrameDisplay(document, cursor);
  if (!plan) return base;
  const parts = renderAnimationFrameDisplayParts(document, cursor);
  if (!parts) return base;
  const output = createBitmap(document.width, document.height);
  const context = output.getContext('2d')!;
  if (parts.ghosts) context.drawImage(parts.ghosts, 0, 0);
  context.drawImage(parts.cel ?? base, 0, 0);
  return output;
}

/** Complete synchronous display composite for routes that have no base yet (worker-unavailable
 * fallback, live-stroke branches): rebases onto the playback cel when playback owns the view. */
export function renderAnimationFrameDisplay(
  document: ImageDocument,
  cursor: ImageAnimationPlaybackCursor | null,
): LayerBitmap {
  const plan = planAnimationFrameDisplay(document, cursor);
  const base = renderImageDocumentLayersToBitmap(document);
  if (!plan) return base;
  return composeAnimationFrameDisplay(base, document, cursor);
}

/** Legacy name kept for callers/tests that only need the authored-selection view. */
export function renderAnimationOnionPreview(document: ImageDocument): LayerBitmap {
  return renderAnimationFrameDisplay(document, null);
}
