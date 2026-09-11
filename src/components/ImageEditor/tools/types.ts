import type {
  BrushSettings,
  BrushSymmetryMode,
  CropToolSettings,
  EditorOperation,
  GradientToolSettings,
  ImageDocument,
  ImageLayer,
  RetouchToolSettings,
  SelectionMode,
  SelectionToolSettings,
  ShapeToolSettings,
} from '../../../types/imageEditor';
import type { useImageEditorStore } from '../../../store/imageEditorStore';

export interface Point {
  x: number;
  y: number;
}

/**
 * Modifier-key snapshot taken from the originating PointerEvent or a synthetic
 * KeyboardEvent. Tools read these to pick selection-mode overrides, axis locks,
 * etc.
 */
export interface Modifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

export interface ToolEnv {
  doc: ImageDocument;
  activeLayer: ImageLayer | null;
  backgroundColor?: string;
  brushSettings: BrushSettings;
  cropToolSettings: CropToolSettings;
  gradientToolSettings?: GradientToolSettings;
  retouchToolSettings?: RetouchToolSettings;
  shapeToolSettings?: ShapeToolSettings;
  selectionToolSettings: SelectionToolSettings;
  /** Convert a screen-local (canvas wrapper) point into document pixel space. */
  screenToDoc: (point: Point) => Point;
  /** Convert a document point back to screen-local coords. */
  docToScreen: (point: Point) => Point;
  /** Push an undo entry. */
  pushOperation: (op: EditorOperation) => void;
  /** Direct access to the zustand store for arbitrary state mutations. */
  store: ReturnType<typeof useImageEditorStore.getState>;
  /** Schedule a re-render of the canvas, optionally invalidating cached bitmap composites. */
  requestRender: (options?: { invalidateBitmapCache?: boolean }) => void;
  /** Report the doc-space region a paint stroke touched this frame so the renderer can recomposite
   * only that rectangle (dirty-rect compositing) instead of the whole document. */
  markDirty?: (rect: { x: number; y: number; width: number; height: number }) => void;
  /** Resolve the effective selection mode for this stroke (modifiers override settings). */
  resolveSelectionMode: (mods: Modifiers) => SelectionMode;
}

export interface ToolHandler {
  onPointerDown?(env: ToolEnv, point: Point, mods: Modifiers, event: PointerEvent): void;
  onPointerMove?(env: ToolEnv, point: Point, mods: Modifiers, event: PointerEvent): void;
  onPointerUp?(env: ToolEnv, point: Point, mods: Modifiers, event: PointerEvent): void;
  onKeyDown?(env: ToolEnv, key: string, mods: Modifiers, event: KeyboardEvent): void;
  /** Cleanup when switching to another tool mid-stroke. */
  onCancel?(env: ToolEnv): void;
}

export type BrushEraserWorkflowRoute = 'pixel-layer' | 'rgb-channel' | 'layer-mask' | 'quick-mask';
export type BrushEraserChannel = 'rgb' | 'red' | 'green' | 'blue';
export type BrushEraserToolSupportStatus = 'supported' | 'partial' | 'unsupported';
export type BrushEraserToolWarningCode =
  | 'background-eraser-unsupported'
  | 'background-eraser-heuristic-limits'
  | 'magic-eraser-unsupported'
  | 'advanced-dynamics-unsupported';

export interface BrushEraserToolWarning {
  code: BrushEraserToolWarningCode;
  field?: string;
  category?: string;
  message: string;
}

export interface BrushEraserRouteDescriptor {
  supported: boolean;
  active: boolean;
  channel?: BrushEraserChannel;
  compositing?: 'source-over' | 'destination-out' | 'source-over-channel-route' | 'alpha-clear';
  brushTarget?: 'reveal-or-conceal-from-color' | 'conceal-mask' | 'selection-coverage-from-color' | 'reveal-selection-coverage';
}

export interface BrushEraserToolDescriptor {
  status: BrushEraserToolSupportStatus;
  operation: string;
  routes: {
    pixelLayer: BrushEraserRouteDescriptor;
    rgbChannel: BrushEraserRouteDescriptor;
    layerMask: BrushEraserRouteDescriptor;
    quickMask: BrushEraserRouteDescriptor;
  };
  warnings: BrushEraserToolWarning[];
}

export interface UnsupportedEraserVariantDescriptor {
  status: 'unsupported';
  operation: string;
  routes: Record<string, never>;
  warnings: BrushEraserToolWarning[];
}

export interface UnsupportedBackgroundEraserRouteDescriptor {
  supported: false;
  active: boolean;
  reason: string;
}

export interface BackgroundEraserToolDescriptor {
  status: 'partial';
  operation: 'brush-bounded-background-alpha-clear';
  routes: {
    pixelLayer: BrushEraserRouteDescriptor;
    rgbChannel: UnsupportedBackgroundEraserRouteDescriptor;
    layerMask: UnsupportedBackgroundEraserRouteDescriptor;
    quickMask: UnsupportedBackgroundEraserRouteDescriptor;
  };
  tolerance: {
    value: number;
    metric: 'rgb-euclidean-distance';
  };
  matching: {
    scope: 'brush-bounded';
    contiguous: boolean;
    limits: 'contiguous' | 'discontiguous';
  };
  sampling: {
    mode: 'once' | 'continuous';
    source: 'pointer-sample' | 'background-swatch';
  };
  protectForeground: {
    enabled: boolean;
    color: string | null;
    semantics: 'heuristic-rgb-distance';
  };
  output: {
    target: 'active-pixel-layer-alpha';
    alpha: 0;
    undoable: true;
    edgeCleanup: {
      supported: true;
      antiAliasSetting: 'selection-anti-alias';
      model: 'one-pixel-alpha-fringe';
      fringePixels: 1;
    };
  };
  warnings: BrushEraserToolWarning[];
}

export interface UnsupportedMagicEraserRouteDescriptor {
  supported: false;
  active: boolean;
  reason: string;
}

export interface MagicEraserToolDescriptor {
  status: 'supported';
  operation: 'remove-contiguous-color-by-tolerance';
  routes: {
    pixelLayer: BrushEraserRouteDescriptor;
    rgbChannel: UnsupportedMagicEraserRouteDescriptor;
    layerMask: UnsupportedMagicEraserRouteDescriptor;
    quickMask: UnsupportedMagicEraserRouteDescriptor;
  };
  tolerance: {
    value: number;
    metric: 'rgb-euclidean-distance';
  };
  matching: {
    scope: 'contiguous' | 'global';
    connectivity: 4 | 'layer-wide';
  };
  output: {
    target: 'active-pixel-layer-alpha';
    alpha: 0;
    undoable: true;
    edgeCleanup: {
      supported: true;
      antiAliasSetting: 'selection-anti-alias';
      model: 'one-pixel-alpha-fringe';
      fringePixels: 1;
    };
  };
  warnings: BrushEraserToolWarning[];
}

export interface BrushEraserWorkflowDescriptor {
  descriptorId: 'image-brush-eraser-workflow:v1';
  version: 1;
  deterministic: true;
  activeRoute: BrushEraserWorkflowRoute;
  tools: {
    brush: BrushEraserToolDescriptor;
    eraser: BrushEraserToolDescriptor;
    backgroundEraser: BackgroundEraserToolDescriptor;
    magicEraser: MagicEraserToolDescriptor;
  };
  behavior: {
    opacity: { value: number; affects: Array<'dab-alpha'> };
    flow: { value: number; affects: Array<'dab-build-up'> };
    hardness: { value: number; affects: Array<'dab-edge-falloff'> };
    smoothing: { value: number; followFactor: number };
    symmetry: {
      mode: BrushSymmetryMode;
      axes: Array<'vertical' | 'horizontal'>;
      mirroredDabMultiplier: 1 | 2 | 4;
    };
  };
  preview: {
    deterministic: true;
    from: Point;
    to: Point;
    smoothedTo: Point;
    seed: number;
    pressure: number;
    dabCount: number;
    sampleDabCount: number;
    activeRoute: BrushEraserWorkflowRoute;
    channel: BrushEraserChannel;
    signature: string;
  };
  warnings: BrushEraserToolWarning[];
  signature: string;
}

export function modsFrom(event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Modifiers {
  return {
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
  };
}

export function resolveModeFromMods(
  base: SelectionMode,
  mods: Modifiers,
): SelectionMode {
  if (mods.shift && mods.alt) return 'intersect';
  if (mods.shift) return 'add';
  if (mods.alt) return 'subtract';
  return base;
}
