import { useEffect, useRef } from 'react';
import { useImageEditorStore } from '../../../store/imageEditorStore';
import { isTypingIntoEditableTarget } from '../../../lib/keyboardShortcuts';
import { screenToDoc as screenToDocMath, docToScreen as docToScreenMath, type Size } from '../viewport';
import type { CompositeRenderer } from '../CompositeRenderer';
import type { EditorTool } from '../../../types/imageEditor';
import type { ToolEnv, ToolHandler, Point, Modifiers } from './types';
import { modsFrom, resolveModeFromMods } from './types';
import { moveTool } from './moveTool';
import { brushTool, eraserTool, backgroundEraserTool, magicEraserTool, brushKeyResize } from './brushTool';
import { cloneStampTool } from './cloneStampTool';
import { spotHealTool } from './spotHealTool';
import { blurBrushTool } from './blurBrushTool';
import { sharpenBrushTool } from './sharpenBrushTool';
import { smudgeBrushTool } from './smudgeBrushTool';
import { burnBrushTool, dodgeBrushTool } from './toneBrushTool';
import { spongeDesaturateBrushTool, spongeSaturateBrushTool } from './spongeBrushTool';
import { paintBucketTool } from './paintBucketTool';
import { gradientTool } from './gradientTool';
import { ellipseShapeTool, rectShapeTool } from './shapeTool';
import { marqueeTool } from './marqueeTool';
import { lassoTool, lassoIsPolygonalActive, lassoPolygonalDoubleClick } from './lassoTool';
import { magicWandTool } from './magicWandTool';
import { penTool, commitActivePenPath } from './penTool';
import { eyedropperTool } from './eyedropperTool';
import { cropTool } from './cropTool';
import { textTool } from './textTool';
import { highBitToolPolicy } from '../pixels/highBitTools';
import { imageCmykDocumentUsesNativeAuthority } from '../cmyk/ImageCmykDocument';

const handTool: ToolHandler = {};

const HANDLERS: Record<EditorTool, ToolHandler> = {
  hand: handTool,
  move: moveTool,
  marquee: marqueeTool,
  lasso: lassoTool,
  magicWand: magicWandTool,
  pen: penTool,
  brush: brushTool,
  eraser: eraserTool,
  backgroundEraser: backgroundEraserTool,
  magicEraser: magicEraserTool,
  cloneStamp: cloneStampTool,
  spotHeal: spotHealTool,
  blurBrush: blurBrushTool,
  sharpenBrush: sharpenBrushTool,
  smudgeBrush: smudgeBrushTool,
  dodgeBrush: dodgeBrushTool,
  burnBrush: burnBrushTool,
  spongeSaturateBrush: spongeSaturateBrushTool,
  spongeDesaturateBrush: spongeDesaturateBrushTool,
  paintBucket: paintBucketTool,
  gradientTool,
  rectShape: rectShapeTool,
  ellipseShape: ellipseShapeTool,
  crop: cropTool,
  text: textTool,
  eyedropper: eyedropperTool,
};

/**
 * Tools where holding Ctrl temporarily acts as the eyedropper — quick colour
 * sampling without switching tools (à la Photoshop/GIMP's Alt-pick).
 */
export const EYEDROPPER_MODIFIER_TOOLS = new Set<EditorTool>([
  'brush', 'eraser', 'paintBucket', 'gradientTool', 'rectShape', 'ellipseShape', 'pen',
]);

export function shouldUseEyedropperOverride(tool: EditorTool, mods: Pick<Modifiers, 'ctrl'>): boolean {
  return mods.ctrl && EYEDROPPER_MODIFIER_TOOLS.has(tool);
}

/**
 * Tools whose stroke repeatedly mutates the active layer's bitmap in place across pointer-moves.
 * While one of these is dragging, the compositor uses the fast cached-backdrop preview path.
 */
export const STROKE_PAINT_TOOLS = new Set<EditorTool>([
  'brush', 'eraser', 'backgroundEraser', 'cloneStamp', 'spotHeal',
  'blurBrush', 'sharpenBrush', 'smudgeBrush', 'dodgeBrush', 'burnBrush',
  'spongeSaturateBrush', 'spongeDesaturateBrush',
]);

/** Pixel-mutating UI tools without an A4 authority route are refused before pointer-down. */
const HIGH_BIT_PROXY_PIXEL_TOOLS = new Set<EditorTool>([
  'backgroundEraser', 'magicEraser', 'cloneStamp', 'spotHeal', 'blurBrush', 'sharpenBrush',
  'smudgeBrush', 'dodgeBrush', 'burnBrush', 'spongeSaturateBrush', 'spongeDesaturateBrush',
  'paintBucket', 'gradientTool', 'rectShape', 'ellipseShape',
]);

/** Native CMYKA has no proxy-write escape hatch: every raster-mutating canvas tool must
 * refuse before pointer capture, otherwise the visible RGB proxy would silently diverge
 * from the authoritative ink samples. Channel edits go through the Channels panel seam. */
const CMYK_PROXY_PIXEL_TOOLS = new Set<EditorTool>([
  'brush', 'eraser', 'backgroundEraser', 'magicEraser', 'cloneStamp', 'spotHeal',
  'blurBrush', 'sharpenBrush', 'smudgeBrush', 'dodgeBrush', 'burnBrush',
  'spongeSaturateBrush', 'spongeDesaturateBrush', 'paintBucket', 'gradientTool',
  'rectShape', 'ellipseShape', 'crop',
]);

/**
 * Selection shape tools rebuild a full-document selection mask on every preview (createMask +
 * rasterize + cloneMask + combineMasks — all O(W*H)). Replaying that for each coalesced sub-sample
 * AND each sub-frame pointermove backs the main thread into a multi-second queue on a 4K document
 * (a 1-second drag takes 10-20s to drain). Only the latest pointer position matters for the shape,
 * so for these tools we coalesce pointermove to at most one preview per animation frame
 * (latest-wins) and skip the coalesced sub-samples. Paint tools are excluded — they need every
 * sub-sample for dab accuracy and already run the cheap dirty-rect fast path.
 */
const RAF_THROTTLED_MOVE_TOOLS = new Set<EditorTool>(['marquee', 'lasso']);

/** How long the live-stroke fast composite path stays warm after a dab, so rapid successive
 * sketch strokes don't each kick the full-quality worker render. */
const PAINT_SETTLE_MS = 220;

export type ImageToolDispatcherMethod = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'keyDown' | 'cancel';
export type ImageToolDispatcherSupportStatus = 'full' | 'partial' | 'inactive';

export interface ImageToolDispatcherSupportItem {
  tool: EditorTool;
  support: ImageToolDispatcherSupportStatus;
  methods: ImageToolDispatcherMethod[];
  caveat: string;
}

export interface ImageToolDispatcherSupportDescriptor {
  descriptorId: 'image-tool-dispatcher-support:v1';
  version: 1;
  tools: ImageToolDispatcherSupportItem[];
  unsupportedTools: EditorTool[];
  partialTools: EditorTool[];
  signature: string;
}

const DISPATCHER_METHOD_ORDER: ImageToolDispatcherMethod[] = [
  'pointerDown',
  'pointerMove',
  'pointerUp',
  'keyDown',
  'cancel',
];

/**
 * The rotation-aware container (view) size for tool coordinate mapping. Tool events arrive as
 * container-local screen points; under canvas view rotation they must be unrotated around the
 * container center before zoom/pan mapping, exactly like the gesture path.
 */
function dispatcherViewSize(state: { viewportContainerSize: { width: number; height: number } }): Size | undefined {
  const size = state.viewportContainerSize;
  return size.width > 0 && size.height > 0 ? size : undefined;
}

function listDispatcherMethods(handler: ToolHandler): ImageToolDispatcherMethod[] {
  const methods: ImageToolDispatcherMethod[] = [];
  if (handler.onPointerDown) methods.push('pointerDown');
  if (handler.onPointerMove) methods.push('pointerMove');
  if (handler.onPointerUp) methods.push('pointerUp');
  if (handler.onKeyDown) methods.push('keyDown');
  if (handler.onCancel) methods.push('cancel');
  return methods;
}

function describeDispatcherSupport(methods: ImageToolDispatcherMethod[]): ImageToolDispatcherSupportStatus {
  if (methods.length === 0) return 'inactive';
  return DISPATCHER_METHOD_ORDER.every((method) => methods.includes(method)) ? 'full' : 'partial';
}

export function describeImageToolDispatcherSupport(): ImageToolDispatcherSupportDescriptor {
  const tools = (Object.entries(HANDLERS) as Array<[EditorTool, ToolHandler]>).map(([tool, handler]) => {
    const methods = listDispatcherMethods(handler);
    const support = describeDispatcherSupport(methods);
    return {
      tool,
      support,
      methods,
      caveat:
        support === 'inactive'
          ? 'Toolbar/shortcut selection exists, but no canvas ToolHandler callbacks are registered.'
          : support === 'partial'
            ? 'Tool has a canvas handler, but not every pointer/key/cancel callback is registered.'
            : 'Tool has pointer, keyboard, and cancel canvas handler callbacks registered.',
    };
  });

  return {
    descriptorId: 'image-tool-dispatcher-support:v1',
    version: 1,
    tools,
    unsupportedTools: tools.filter((tool) => tool.support === 'inactive').map((tool) => tool.tool),
    partialTools: tools.filter((tool) => tool.support === 'partial').map((tool) => tool.tool),
    signature: tools
      .map((tool) => `${tool.tool}:${tool.methods.length ? tool.methods.join(',') : 'none'}`)
      .join('|'),
  };
}

interface DispatcherOptions {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  rendererRef: React.RefObject<CompositeRenderer | null>;
}

export const IMAGE_CANVAS_INTERACTION_OVERLAY_ATTRIBUTE = 'data-image-canvas-interaction-overlay';

export function shouldIgnoreImageCanvasToolEvent(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && target.closest(`[${IMAGE_CANVAS_INTERACTION_OVERLAY_ATTRIBUTE}="true"]`) !== null;
}

/**
 * The sub-frame pointer samples the OS batched into one `pointermove`. High-rate styli (Wacom
 * Cintiq, S Pen) and trackpads emit several samples per display frame; `getCoalescedEvents()`
 * exposes them so a fast stroke is sampled accurately instead of as straight segments between
 * frame-spaced points. Falls back to the event itself where the API is unavailable (older WebKit)
 * or returns nothing.
 */
export function coalescedPointerEvents(event: PointerEvent): PointerEvent[] {
  const getter = (event as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }).getCoalescedEvents;
  if (typeof getter !== 'function') return [event];
  const samples = getter.call(event);
  return samples && samples.length > 0 ? samples : [event];
}

/**
 * Wires pointer/keyboard events on the canvas wrapper to the active tool's
 * handler. Builds a ToolEnv per-event with the current store snapshot.
 */
export function useToolDispatcher({ wrapperRef, rendererRef }: DispatcherOptions): void {
  const lastToolRef = useRef<EditorTool | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const buildEnv = (): ToolEnv | null => {
      const state = useImageEditorStore.getState();
      const doc = state.documents.find((d) => d.id === state.activeDocId);
      if (!doc) return null;
      const activeLayer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? null;
      const viewport = doc.viewport;
      const view = dispatcherViewSize(state);
      const requestRender: ToolEnv['requestRender'] = (options) => {
        rendererRef.current?.requestRender(options);
      };
      const markDirty: ToolEnv['markDirty'] = (rect) => {
        rendererRef.current?.markStrokeDirty(rect.x, rect.y, rect.width, rect.height);
      };
      return {
        doc,
        activeLayer,
        backgroundColor: state.backgroundColor,
        brushSettings: state.brushSettings,
        cropToolSettings: state.cropToolSettings,
        gradientToolSettings: state.gradientToolSettings,
        retouchToolSettings: state.retouchToolSettings,
        shapeToolSettings: state.shapeToolSettings,
        selectionToolSettings: state.selectionToolSettings,
        screenToDoc: (point: Point) => screenToDocMath(point, viewport, view),
        docToScreen: (point: Point) => docToScreenMath(point, viewport, view),
        pushOperation: state.pushOperation,
        store: state,
        requestRender,
        markDirty,
        resolveSelectionMode: (mods: Modifiers) =>
          resolveModeFromMods(state.selectionToolSettings.mode, mods),
      };
    };

    // Cache the canvas client rect for the duration of a gesture. `getBoundingClientRect()` can
    // force a synchronous layout, and calling it on every (120-240Hz) stylus sample is pure
    // overhead since the canvas position is stable during a stroke. Refresh on pointer-down and
    // invalidate on scroll/resize so it stays correct.
    let cachedRect: DOMRect | null = null;
    // While sketching, the user lifts and re-touches the pen many times a second. Rather than drop
    // out of the cheap live-stroke composite path and kick the full-quality worker after every tiny
    // dab (which is what overloads rapid sketching), we keep the paint path "warm" for a short
    // settle window after each stroke; a new stroke within it cancels the cool-down, and only a
    // genuine pause triggers the one full-quality render. This is how Krita-style apps stay snappy.
    let paintSettleTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelPaintSettle = (): void => {
      if (paintSettleTimer !== null) {
        clearTimeout(paintSettleTimer);
        paintSettleTimer = null;
      }
    };
    // rAF coalescing for selection shape tools (see RAF_THROTTLED_MOVE_TOOLS): hold only the latest
    // pointer event and run one preview per frame. flush before pointer-up so the final position is
    // applied before the selection commits.
    let pendingSelectionMoveEvent: PointerEvent | null = null;
    let selectionMoveRafId: number | null = null;
    const runPendingSelectionMove = (): void => {
      const ev = pendingSelectionMoveEvent;
      pendingSelectionMoveEvent = null;
      if (!ev) return;
      const env = buildEnv();
      if (!env) return;
      const handler = currentHandler();
      handler.onPointerMove?.(env, env.screenToDoc(screenPoint(ev)), modsFrom(ev), ev);
    };
    const flushSelectionMove = (): void => {
      if (selectionMoveRafId !== null) {
        cancelAnimationFrame(selectionMoveRafId);
        selectionMoveRafId = null;
      }
      runPendingSelectionMove();
    };
    const getRect = (): DOMRect => (cachedRect ??= el.getBoundingClientRect());
    const invalidateRect = (): void => {
      cachedRect = null;
    };
    const screenPoint = (event: PointerEvent): Point => {
      const rect = getRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // True for the duration of a Ctrl-held stroke that started on a paint tool —
    // the whole interaction samples colour (eyedropper) instead of painting.
    let eyedropperOverride = false;
    // Pointer events can be delivered concurrently by touch and pen hardware. A canvas gesture
    // has one owner: secondary pointers and events from another pointer must not replace its
    // module-level tool state or commit a preview captured from the wrong stroke.
    let activePointerId: number | null = null;
    let activePointerDocId: string | null = null;
    let activePointerEnv: ToolEnv | null = null;
    let activePointerTool: EditorTool | null = null;
    const ownsActivePointer = (event: PointerEvent): boolean =>
      activePointerId !== null && event.pointerId === activePointerId;
    const clearActivePointer = (): void => {
      activePointerId = null;
      activePointerDocId = null;
      activePointerEnv = null;
      activePointerTool = null;
      eyedropperOverride = false;
    };
    const cancelActivePointer = (): void => {
      const env = activePointerEnv;
      const tool = activePointerTool;
      if (env && tool) {
        HANDLERS[tool].onCancel?.(env);
      }
      pendingSelectionMoveEvent = null;
      if (selectionMoveRafId !== null) {
        cancelAnimationFrame(selectionMoveRafId);
        selectionMoveRafId = null;
      }
      if (activePointerId !== null) {
        try {
          el.releasePointerCapture(activePointerId);
        } catch {
          // ignore: pointer was already released or never captured
        }
      }
      if (activePointerEnv && STROKE_PAINT_TOOLS.has(activePointerTool ?? 'hand')) {
        activePointerEnv.store.setPaintingStroke(false);
      }
      cancelPaintSettle();
      clearActivePointer();
    };
    const onDown = (event: PointerEvent) => {
      if (shouldIgnoreImageCanvasToolEvent(event)) return;
      if (activePointerId !== null || event.isPrimary === false) return;
      invalidateRect(); // start of a gesture — re-measure once, then reuse for every move
      const env = buildEnv();
      if (!env) return;
      const selectedTool = useImageEditorStore.getState().tool;
      if (imageCmykDocumentUsesNativeAuthority(env.doc) && CMYK_PROXY_PIXEL_TOOLS.has(selectedTool)) {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sloom-cmyk-tool-refused', {
          detail: { tool: selectedTool, disclosure: 'This tool is not yet wired to CMYK ink authority; no pixels were changed.' },
        }));
        return;
      }
      activePointerId = event.pointerId;
      activePointerDocId = env.doc.id;
      activePointerEnv = env;
      activePointerTool = useImageEditorStore.getState().tool;
      const docPoint = env.screenToDoc(screenPoint(event));
      const mods = modsFrom(event);
      el.setPointerCapture(event.pointerId);
      const highBitCropRefused = selectedTool === 'crop'
        && (env.cropToolSettings.cornerFillMode === 'content-aware'
          || (env.cropToolSettings.rotationDeg ?? 0) !== 0);
      if ((env.doc.metadata?.bitDepth === 16 || env.doc.metadata?.bitDepth === 32)
        && (HIGH_BIT_PROXY_PIXEL_TOOLS.has(selectedTool) || highBitCropRefused)) {
        const policy = highBitToolPolicy(selectedTool);
        const disclosure = policy.supported
          ? `Refused before mutation: ${selectedTool} has no wired A4 authority commit on this build; the 8-bit display proxy would lose precision.`
          : policy.disclosure;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sloom-high-bit-tool-refused', {
            detail: { tool: selectedTool, source: 'proxy', precisionLossy: true, disclosure },
          }));
        }
        return;
      }
      if (shouldUseEyedropperOverride(useImageEditorStore.getState().tool, mods)) {
        eyedropperOverride = true;
        eyedropperTool.onPointerDown?.(env, docPoint, mods, event);
        return;
      }
      eyedropperOverride = false;
      if (STROKE_PAINT_TOOLS.has(useImageEditorStore.getState().tool)) {
        cancelPaintSettle(); // a new dab within the settle window keeps the fast path warm
        env.store.setPaintingStroke(true);
      }
      currentHandler().onPointerDown?.(env, docPoint, mods, event);
    };
    const onMove = (event: PointerEvent) => {
      if (shouldIgnoreImageCanvasToolEvent(event)) return;
      if (!ownsActivePointer(event)) return;
      const env = buildEnv();
      if (!env) return;
      if (env.doc.id !== activePointerDocId) {
        cancelActivePointer();
        return;
      }
      const mods = modsFrom(event);
      if (eyedropperOverride) {
        // Continuous sampling while Ctrl-dragging — a single sample is enough for colour pick.
        eyedropperTool.onPointerDown?.(env, env.screenToDoc(screenPoint(event)), mods, event);
        return;
      }
      if (RAF_THROTTLED_MOVE_TOOLS.has(useImageEditorStore.getState().tool)) {
        // Coalesce to one preview per frame, latest position wins — see RAF_THROTTLED_MOVE_TOOLS.
        pendingSelectionMoveEvent = event;
        if (selectionMoveRafId === null) {
          selectionMoveRafId = requestAnimationFrame(() => {
            selectionMoveRafId = null;
            runPendingSelectionMove();
          });
        }
        return;
      }
      // Replay every sub-frame pointer sample the browser batched into this event. On a 120-240Hz
      // stylus (Cintiq / S Pen) the OS coalesces several moves per frame; feeding each one (with its
      // own pressure/tilt/timestamp) keeps fast strokes smooth instead of cutting corners into
      // polygons. The composite is still rAF-coalesced downstream, so this adds dab accuracy, not
      // extra repaints.
      const handler = currentHandler();
      const onPointerMove = handler.onPointerMove;
      if (!onPointerMove) return;
      for (const sample of coalescedPointerEvents(event)) {
        onPointerMove.call(handler, env, env.screenToDoc(screenPoint(sample)), mods, sample);
      }
    };
    const onUp = (event: PointerEvent) => {
      if (shouldIgnoreImageCanvasToolEvent(event)) return;
      if (!ownsActivePointer(event)) return;
      const env = buildEnv();
      if (!env || env.doc.id !== activePointerDocId) {
        cancelActivePointer();
        return;
      }
      flushSelectionMove(); // apply the final throttled selection position before committing
      const docPoint = env.screenToDoc(screenPoint(event));
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        // ignore: pointer was already released or never captured
      }
      if (eyedropperOverride) {
        clearActivePointer();
        return;
      }
      const wasStroke = STROKE_PAINT_TOOLS.has(useImageEditorStore.getState().tool);
      currentHandler().onPointerUp?.(env, docPoint, modsFrom(event), event);
      if (wasStroke) {
        // Stay on the fast composite path briefly so rapid successive dabs don't each trigger the
        // full-quality worker render. Show the committed dab now (fast path), then settle to the
        // full-quality render only once the user actually pauses.
        rendererRef.current?.requestRender();
        cancelPaintSettle();
        paintSettleTimer = setTimeout(() => {
          paintSettleTimer = null;
          useImageEditorStore.getState().setPaintingStroke(false);
          rendererRef.current?.requestRender();
        }, PAINT_SETTLE_MS);
      } else {
        env.store.setPaintingStroke(false);
      }
      clearActivePointer();
    };
    const onCancel = (event: PointerEvent) => {
      if (shouldIgnoreImageCanvasToolEvent(event) || !ownsActivePointer(event)) return;
      // Browser pointer cancellation is not a successful commit. Restore the pre-gesture state
      // and release ownership so a later pointer can begin a fresh operation.
      cancelActivePointer();
    };
    const onDouble = (event: MouseEvent) => {
      if (shouldIgnoreImageCanvasToolEvent(event)) return;
      // Polygonal lasso: double-click closes the polygon.
      if (lassoIsPolygonalActive()) {
        const fakeEnv = buildEnv();
        if (fakeEnv) lassoPolygonalDoubleClick(fakeEnv);
        return;
      }
      // Pen: double-click finishes (commits) the path in progress — the familiar finish gesture, so
      // users aren't stuck pressing Escape to get out of path creation.
      if (useImageEditorStore.getState().tool === 'pen') {
        const env = buildEnv();
        if (env) commitActivePenPath(env);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      // Ignore key events that belong to text entry (input/textarea/select/contenteditable, and the
      // focused element) so brush-size / tool keys don't fire while typing.
      if (isTypingIntoEditableTarget(event)) return;
      const env = buildEnv();
      if (!env) return;
      const handler = currentHandler();
      const mods = modsFrom(event);
      // brush size shortcuts apply globally during brush-like tools
      const tool = useImageEditorStore.getState().tool;
      if (
        (tool === 'brush' ||
          tool === 'eraser' ||
          tool === 'backgroundEraser' ||
          tool === 'cloneStamp' ||
          tool === 'spotHeal' ||
          tool === 'blurBrush' ||
          tool === 'sharpenBrush' ||
          tool === 'smudgeBrush' ||
          tool === 'dodgeBrush' ||
          tool === 'burnBrush' ||
          tool === 'spongeSaturateBrush' ||
          tool === 'spongeDesaturateBrush') &&
        brushKeyResize(env, event.key)
      ) {
        event.preventDefault();
        return;
      }
      handler.onKeyDown?.(env, event.key, mods, event);
    };

    function currentHandler(): ToolHandler {
      const state = useImageEditorStore.getState();
      const tool = state.tool;
      if (lastToolRef.current && lastToolRef.current !== tool) {
        // Switching tools mid-stroke — cancel the previous one cleanly.
        const env = (() => {
          const doc = state.documents.find((d) => d.id === state.activeDocId);
          if (!doc) return null;
          return {
            doc,
            activeLayer: doc.layers.find((l) => l.id === doc.activeLayerId) ?? null,
            backgroundColor: state.backgroundColor,
            brushSettings: state.brushSettings,
            cropToolSettings: state.cropToolSettings,
            gradientToolSettings: state.gradientToolSettings,
            retouchToolSettings: state.retouchToolSettings,
            shapeToolSettings: state.shapeToolSettings,
            selectionToolSettings: state.selectionToolSettings,
            screenToDoc: (point: Point) => screenToDocMath(point, doc.viewport, dispatcherViewSize(state)),
            docToScreen: (point: Point) => docToScreenMath(point, doc.viewport, dispatcherViewSize(state)),
            pushOperation: state.pushOperation,
            store: state,
            requestRender: (options) => rendererRef.current?.requestRender(options),
            resolveSelectionMode: (mods: Modifiers) =>
              resolveModeFromMods(state.selectionToolSettings.mode, mods),
          } as ToolEnv;
        })();
        if (env) HANDLERS[lastToolRef.current].onCancel?.(env);
      }
      lastToolRef.current = tool;
      return HANDLERS[tool];
    }

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('dblclick', onDouble);
    window.addEventListener('keydown', onKey);
    // Scrolling or resizing can move the canvas; drop the cached rect so it re-measures lazily.
    window.addEventListener('scroll', invalidateRect, { capture: true, passive: true });
    window.addEventListener('resize', invalidateRect);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('dblclick', onDouble);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', invalidateRect, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', invalidateRect);
      cancelActivePointer();
      cancelPaintSettle();
      if (selectionMoveRafId !== null) {
        cancelAnimationFrame(selectionMoveRafId);
        selectionMoveRafId = null;
      }
      pendingSelectionMoveEvent = null;
    };
  }, [wrapperRef, rendererRef]);
}
