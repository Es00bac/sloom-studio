import type { LayerBitmap } from '../../types/imageEditor';
import type { BrushBackend, BrushOp, BrushSampleSource, Rect, StrokeSession } from './backend';

export interface BrushStrokeOptions {
  source: ImageData;
  sampleSource: BrushSampleSource;
  width: number;
  height: number;
  op: BrushOp;
  size: number;
  strength: number;
}

type Point = { x: number; y: number };

/**
 * Tool-facing orchestration: owns one stroke session, interpolates dabs between move points
 * (matching the existing spacing of `max(1, size/3)`), and commits exactly once. Preview is driven
 * synchronously via `previewInto` from the existing render path (rAF-coalesced by the caller).
 */
export class BrushStrokeController {
  private readonly session: StrokeSession;
  private readonly op: BrushOp;
  private readonly size: number;
  private readonly strength: number;
  private lastPoint: Point | null = null;
  private committed = false;

  constructor(backend: BrushBackend, options: BrushStrokeOptions) {
    this.session = backend.beginStroke({
      source: options.source,
      sampleSource: options.sampleSource,
      width: options.width,
      height: options.height,
    });
    this.op = options.op;
    this.size = options.size;
    this.strength = options.strength;
  }

  /** Set the stroke's starting point WITHOUT stamping a dab (pointer-down anchor). */
  anchor(point: Point): void {
    this.lastPoint = point;
  }

  moveTo(point: Point): void {
    if (!this.lastPoint) {
      this.session.stampDab({ op: this.op, from: point, to: point, size: this.size, strength: this.strength });
      this.lastPoint = point;
      return;
    }
    const from = this.lastPoint;
    const distance = Math.hypot(point.x - from.x, point.y - from.y);
    const step = Math.max(1, this.size / 3);
    const steps = Math.max(1, Math.ceil(distance / step));
    let prev = from;
    for (let index = 1; index <= steps; index += 1) {
      const amount = index / steps;
      const next = { x: from.x + (point.x - from.x) * amount, y: from.y + (point.y - from.y) * amount };
      this.session.stampDab({ op: this.op, from: prev, to: next, size: this.size, strength: this.strength });
      prev = next;
    }
    this.lastPoint = point;
  }

  previewInto(target: LayerBitmap): Rect | null {
    return this.session.previewInto(target);
  }

  commit(target: LayerBitmap): Rect | null {
    if (this.committed) return null;
    this.committed = true;
    const rect = this.session.commit(target);
    this.session.dispose();
    return rect;
  }

  cancel(): void {
    this.session.dispose();
  }
}
