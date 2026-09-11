import type { LayerBitmap } from '../../types/imageEditor';

export type BrushBackendId = 'webgpu' | 'webgl2' | 'cpu';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrushOp = 'smudge' | 'blur' | 'sharpen';

/** A single stamped dab in LAYER-LOCAL pixel coordinates. */
export interface BrushDab {
  op: BrushOp;
  /** previous point (for sample-and-blend ops like smudge); equals `to` for the first dab. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  size: number;
  /** 0..1 strength/opacity for this dab. */
  strength: number;
}

export interface BrushSampleSource {
  /** Pixels sampled by sample-and-blend ops. For P1 this is the layer snapshot at stroke start. */
  imageData: ImageData;
}

export interface StrokeSession {
  /** Apply one dab to the resident working buffer; accumulates the dirty rect. */
  stampDab(dab: BrushDab): void;
  /** The union of all dab rects so far, clamped to bounds, or null if nothing stamped. */
  dirtyRect(): Rect | null;
  /** Draw the current resident result into the layer bitmap for live preview (no undo emit). */
  previewInto(target: LayerBitmap): Rect | null;
  /** Write the accumulated dirty region into the layer bitmap once; returns the dirty rect. */
  commit(target: LayerBitmap): Rect | null;
  dispose(): void;
}

export interface BrushBackend {
  readonly id: BrushBackendId;
  beginStroke(input: {
    /** layer snapshot at stroke start (seeds the resident working copy) */
    source: ImageData;
    sampleSource: BrushSampleSource;
    width: number;
    height: number;
  }): StrokeSession;
}
