import {
  applyPinch,
  panBy,
  rotateViewTo,
  VIEW_TWIST_MIN_DELTA_DEG,
  type Size,
} from './viewport';
import type { DocumentViewport } from '../../types/imageEditor';

export interface CanvasGesturePort {
  getViewport: () => DocumentViewport | null;
  setViewport: (viewport: DocumentViewport) => void;
  requestRender: () => void;
  getRect: () => { left: number; top: number };
  /** Container (view) size in CSS pixels; enables rotation-aware pan/pinch and two-finger twist. */
  getViewSize?: () => Size | null;
}

export type CanvasGestureKind = 'pinch' | 'pan' | 'none';

interface PointerInput {
  pointerType: string;
  pointerId: number;
  clientX: number;
  clientY: number;
}

/**
 * Pan + two-finger pinch-zoom state machine for the image canvas viewport.
 *
 * Crucially, two touch points ALWAYS pinch — even when single-finger pan is allowed
 * (touch-navigation on, or the Hand tool). This is the fix for the bug where each of
 * the two fingers independently drove a single-finger pan, so the view "jumped"
 * between the fingers instead of zooming. The owning capture-phase handler turns the
 * returned kind into DOM side effects (preventDefault/stopPropagation/pointer capture).
 */
export class CanvasViewportGesture {
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinching = false;
  private lastPinch: { dist: number; midX: number; midY: number } | null = null;
  private lastTwistDeg: number | null = null;
  private panning = false;
  private panStart: { x: number; y: number } | null = null;
  private panOrigin: { panX: number; panY: number } | null = null;
  private readonly port: CanvasGesturePort;

  constructor(port: CanvasGesturePort) {
    this.port = port;
  }

  /** `panAllowed` = touch-navigation active, middle button, space held, or Hand tool. */
  pointerDown(input: PointerInput & { panAllowed: boolean }): CanvasGestureKind {
    if (input.pointerType === 'touch') {
      this.touches.set(input.pointerId, { x: input.clientX, y: input.clientY });
      if (this.touches.size >= 2) {
        // Second finger: take over as a pinch, abandoning any one-finger pan.
        this.panning = false;
        this.panStart = null;
        this.panOrigin = null;
        this.pinching = true;
        this.lastPinch = this.sample();
        this.lastTwistDeg = this.twistSample();
        return 'pinch';
      }
      if (this.pinching) return 'pinch';
    }
    if (input.panAllowed) {
      const viewport = this.port.getViewport();
      if (!viewport) return 'none';
      this.panning = true;
      this.panStart = { x: input.clientX, y: input.clientY };
      this.panOrigin = { panX: viewport.panX, panY: viewport.panY };
      return 'pan';
    }
    return 'none';
  }

  pointerMove(input: PointerInput): CanvasGestureKind {
    if (input.pointerType === 'touch' && this.touches.has(input.pointerId)) {
      this.touches.set(input.pointerId, { x: input.clientX, y: input.clientY });
    }
    if (this.pinching) {
      if (this.touches.size >= 2 && this.lastPinch) {
        const viewport = this.port.getViewport();
        if (viewport) {
          const sample = this.sample();
          const pinched = applyPinch(viewport, this.lastPinch, sample, this.viewSize() ?? undefined);
          this.port.setViewport(this.applyTwist(pinched));
          this.port.requestRender();
          this.lastPinch = sample;
          this.lastTwistDeg = this.twistSample();
        }
      }
      return 'pinch';
    }
    if (this.panning && this.panStart && this.panOrigin) {
      const viewport = this.port.getViewport();
      if (viewport) {
        const dx = input.clientX - this.panStart.x;
        const dy = input.clientY - this.panStart.y;
        this.port.setViewport(
          panBy({ zoom: viewport.zoom, panX: this.panOrigin.panX, panY: this.panOrigin.panY, ...(viewport.rotationDeg ? { rotationDeg: viewport.rotationDeg } : {}) }, dx, dy, this.viewSize() ?? undefined),
        );
        this.port.requestRender();
      }
      return 'pan';
    }
    return 'none';
  }

  pointerUp(input: { pointerType: string; pointerId: number }): CanvasGestureKind {
    if (input.pointerType === 'touch') {
      this.touches.delete(input.pointerId);
      if (this.touches.size < 2) {
        this.lastPinch = null;
        this.lastTwistDeg = null;
      }
      if (this.pinching) {
        if (this.touches.size === 0) this.pinching = false;
        return 'pinch';
      }
    }
    if (this.panning) {
      this.panning = false;
      this.panStart = null;
      this.panOrigin = null;
      return 'pan';
    }
    return 'none';
  }

  isActive(): boolean {
    return this.panning || this.pinching;
  }

  private applyTwist(viewport: DocumentViewport): DocumentViewport {
    if (!this.lastTwistDeg) return viewport;
    const current = this.twistSample();
    if (current === null) return viewport;
    const delta = normalizeTwistDelta(current - this.lastTwistDeg);
    if (Math.abs(delta) < VIEW_TWIST_MIN_DELTA_DEG) return viewport;
    return rotateViewTo(viewport, (viewport.rotationDeg ?? 0) + delta);
  }

  private twistSample(): number | null {
    const pts = [...this.touches.values()];
    if (pts.length < 2) return null;
    const ax = pts[0].x;
    const ay = pts[0].y;
    const bx = pts[1].x;
    const by = pts[1].y;
    return (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  }

  private viewSize(): Size | null {
    return this.port.getViewSize?.() ?? null;
  }

  private sample(): { dist: number; midX: number; midY: number } {
    const rect = this.port.getRect();
    const pts = [...this.touches.values()];
    const ax = pts[0].x - rect.left;
    const ay = pts[0].y - rect.top;
    const bx = pts[1].x - rect.left;
    const by = pts[1].y - rect.top;
    return { dist: Math.hypot(ax - bx, ay - by), midX: (ax + bx) / 2, midY: (ay + by) / 2 };
  }
}

function normalizeTwistDelta(delta: number): number {
  let value = delta;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}
