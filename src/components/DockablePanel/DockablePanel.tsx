import { type AriaRole, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, Minus, PanelLeft, PanelRight, ChevronDown, ChevronUp } from 'lucide-react';
import { DockExpandContext } from './dockExpandContext';
import { useImageEditorStore } from '../../store/imageEditorStore';
import {
  attachDockablePanelGlobalPointerDragListeners,
  COLLAPSED_FLOATING_PANEL_MIN_WIDTH,
  DEFAULT_VIEWPORT_MARGIN,
  isCollapsedFloatingDockablePanel,
  normalizeFloatingPanelRect,
  resolveDetachedFloatingPanelRect,
  resolveDockedPanelStyleMetrics,
  resolveDockablePanelSnapPreviewRect,
  resolveDockablePanelSnapTarget,
  type DockablePanelLayout,
  type DockablePanelSnapTarget,
  type DockablePanelStackRect,
  type DockZone,
  type PanelRect,
  type ResizeDelta,
  type ViewportSize,
} from '../../lib/dockablePanel';
import {
  buildFloatingPanelWindowFeatures,
  createExternalFloatingPanelDragAnchor,
  resolveFloatingPanelOwnerRect,
  resolveFloatingPanelScreenRect,
  resolveExternalFloatingPanelOuterSize,
  resolveExternalFloatingPanelResizeRect,
  resolveExternalFloatingPanelWindowSize,
  resolveExternalFloatingPanelWindowPosition,
  resolveExternalFloatingPanelMoveEndRect,
  type ExternalFloatingPanelDragAnchor,
  shouldResizeExternalFloatingPanelWindow,
  shouldRenderFloatingPanelInOwnerWindow,
  shouldUseExternalFloatingPanelWindow,
} from '../../lib/floatingPanelWindow';
import { getSignalLoomNativeBridge } from '../../lib/nativeApp';
import { Z_INDEX, zIndexForFloatingPanel } from '../../lib/zIndex';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { ErrorBoundary } from '../Recovery/ErrorBoundary';

export interface DockablePanelProps {
  layout: DockablePanelLayout;
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  allowedDockZones?: DockZone[];
  chrome?: DockablePanelChrome;
  fixedSize?: boolean;
  viewport?: ViewportSize;
  role?: AriaRole;
  ariaModal?: boolean;
  onClose?: () => void;
  tabs?: ReactNode;
  externalWindowKey?: string;
  /**
   * Whether this panel may occupy its own split slot in the center zone
   * (centerDockPresentation === 'split'). Panels that can't (e.g. Inspector) tab-join the
   * reference panel when dropped ANYWHERE on a center panel — inserting them as a bare center
   * sibling would degrade the whole center split to a one-visible-entry tab strip.
   */
  centerSplitCapable?: boolean;
}

export type DockablePanelChrome = 'standard' | 'compact-floating';

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  action: 'move' | 'floating-resize' | 'docked-resize';
  startedFloating?: boolean;
  detachedFromDock?: boolean;
  originRect?: PanelRect;
  pointerOffsetX?: number;
  pointerOffsetY?: number;
  captureElement?: HTMLElement;
  ownerWindow?: Window;
  cleanupGlobalPointerDrag?: () => void;
  externalWindowDrag?: {
    anchor: ExternalFloatingPanelDragAnchor;
    ownerScreenX: number;
    ownerScreenY: number;
    width: number;
    height: number;
  };
  resize?: Pick<ResizeDelta, 'edgeX' | 'edgeY'>;
}

const RESIZE_HANDLES: Array<Pick<ResizeDelta, 'edgeX' | 'edgeY'> & { label: string; className: string }> = [
  { edgeX: 0, edgeY: -1, label: 'Resize top', className: 'left-3 right-3 top-0 h-1 cursor-ns-resize' },
  { edgeX: 0, edgeY: 1, label: 'Resize bottom', className: 'bottom-0 left-3 right-3 h-1 cursor-ns-resize' },
  { edgeX: -1, edgeY: 0, label: 'Resize left', className: 'bottom-3 left-0 top-3 w-1 cursor-ew-resize' },
  { edgeX: 1, edgeY: 0, label: 'Resize right', className: 'bottom-3 right-0 top-3 w-1 cursor-ew-resize' },
  { edgeX: -1, edgeY: -1, label: 'Resize top left', className: 'left-0 top-0 h-3 w-3 cursor-nwse-resize' },
  { edgeX: 1, edgeY: -1, label: 'Resize top right', className: 'right-0 top-0 h-3 w-3 cursor-nesw-resize' },
  { edgeX: -1, edgeY: 1, label: 'Resize bottom left', className: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize' },
  { edgeX: 1, edgeY: 1, label: 'Resize bottom right', className: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize' },
];

const DOCKED_RESIZE_HANDLES: Partial<Record<DockZone, Pick<ResizeDelta, 'edgeX' | 'edgeY'> & { label: string; className: string }>> = {
  left: {
    edgeX: 1,
    edgeY: 0,
    label: 'Resize right divider',
    className: 'bottom-0 right-0 top-0 z-20 w-2 cursor-ew-resize border-r border-cyan-200/0 bg-cyan-300/0 hover:border-cyan-200/50 hover:bg-cyan-300/20',
  },
  right: {
    edgeX: -1,
    edgeY: 0,
    label: 'Resize left divider',
    className: 'bottom-0 left-0 top-0 z-20 w-2 cursor-ew-resize border-l border-cyan-200/0 bg-cyan-300/0 hover:border-cyan-200/50 hover:bg-cyan-300/20',
  },
  top: {
    edgeX: 0,
    edgeY: 1,
    label: 'Resize bottom divider',
    className: 'bottom-0 left-0 right-0 z-20 h-2 cursor-ns-resize border-b border-cyan-200/0 bg-cyan-300/0 hover:border-cyan-200/50 hover:bg-cyan-300/20',
  },
  bottom: {
    edgeX: 0,
    edgeY: -1,
    label: 'Resize top divider',
    className: 'left-0 right-0 top-0 z-20 h-2 cursor-ns-resize border-t border-cyan-200/0 bg-cyan-300/0 hover:border-cyan-200/50 hover:bg-cyan-300/20',
  },
};

const FLOATING_PANEL_THEME_CSS_VARIABLES = [
  '--sl-bg',
  '--sl-surface',
  '--sl-panel',
  '--sl-border',
  '--sl-text',
  '--sl-muted',
  '--sl-accent',
  '--sl-accent-contrast',
  '--sl-danger',
];
const DEFAULT_DOCKABLE_PANEL_BODY_CLASS_NAME = 'min-h-0 overflow-auto p-3';
// Scroll-region classes added to a side-docked panel body (padding is supplied by
// the caller's bodyClassName). A side-docked panel's body scrolls within the
// height the column gives it, so resizing a stacked panel grows/shrinks its
// content (e.g. the Layers list) instead of pushing the whole column.
const SIDE_DOCKED_BODY_SCROLL_CLASS_NAME = 'min-h-0 overflow-y-auto overscroll-contain';

/**
 * Library guarantee for side-docked (vertically stacked) panels: the body fills
 * the height it's given and scrolls its own content. Strips any flex/overflow
 * hints the caller passed (which targeted the older "expand to content"
 * behaviour) and adds a scroll region — unless the panel manages its own scroll
 * (opted out via overflow-hidden / overflow-auto), in which case its overflow is
 * preserved. Reused by every workspace host (Image / Paper / Video).
 */
function resolveSideDockedBodyClassName(bodyClassName: string): string {
  const tokens = bodyClassName.split(/\s+/).filter(Boolean);
  const managesOwnScroll = tokens.some(
    (token) => token === 'overflow-hidden' || token === 'overflow-auto' || token === 'overflow-y-auto',
  );
  const content = tokens
    .filter((token) => token !== 'flex-none' && token !== 'flex-1' && token !== 'overflow-visible' && token !== 'min-h-0')
    .join(' ');
  return managesOwnScroll ? `min-h-0 ${content}`.trim() : `${SIDE_DOCKED_BODY_SCROLL_CLASS_NAME} ${content}`.trim();
}

export function DockablePanel({
  layout,
  title,
  children,
  className = '',
  bodyClassName = DEFAULT_DOCKABLE_PANEL_BODY_CLASS_NAME,
  allowedDockZones = ['left', 'right', 'top', 'bottom', 'center', 'overlay'],
  chrome = 'standard',
  fixedSize = false,
  viewport,
  role = 'region',
  ariaModal,
  onClose,
  tabs,
  externalWindowKey,
  centerSplitCapable = true,
}: DockablePanelProps) {
  const dragState = useRef<DragState | null>(null);
  const mountedRef = useRef(false);
  const externalWindowRef = useRef<Window | null>(null);
  const [snapPreviewRect, setSnapPreviewRect] = useState<PanelRect | null>(null);
  const [externalPanelRoot, setExternalPanelRoot] = useState<HTMLElement | null>(null);
  const floatPanel = useDockablePanelStore((state) => state.floatPanel);
  const dockPanel = useDockablePanelStore((state) => state.dockPanel);
  const setPanelMode = useDockablePanelStore((state) => state.setPanelMode);
  const setPanelDockColumn = useDockablePanelStore((state) => state.setPanelDockColumn);
  const snapPanelToDockTarget = useDockablePanelStore((state) => state.snapPanelToDockTarget);
  const groupPanelWithPanel = useDockablePanelStore((state) => state.groupPanelWithPanel);
  // A non-split-capable panel dropped ANYWHERE on a center panel tab-joins it: inserting it as a
  // bare center sibling (the before/after edge bands) would degrade the whole center split to a
  // one-visible-entry tab strip, hiding a monitor.
  const adjustCenterSnapTarget = (target: DockablePanelSnapTarget): DockablePanelSnapTarget =>
    !centerSplitCapable
      && target.mode === 'docked'
      && target.dockZone === 'center'
      && target.referencePanelId
      ? { mode: 'tab', dockZone: 'center', referencePanelId: target.referencePanelId }
      : target;
  const moveFloatingPanel = useDockablePanelStore((state) => state.moveFloatingPanel);
  const resizeFloatingPanel = useDockablePanelStore((state) => state.resizeFloatingPanel);
  const resizeDockedPanel = useDockablePanelStore((state) => state.resizeDockedPanel);
  const bringPanelToFront = useDockablePanelStore((state) => state.bringPanelToFront);
  const collapsePanel = useDockablePanelStore((state) => state.collapsePanel);
  const toolsCollapsed = useImageEditorStore((s) => s.toolsCollapsed);
  const setToolsCollapsed = useImageEditorStore((s) => s.setToolsCollapsed);
  const isImageToolsPanel = layout.workspaceId === 'image' && layout.panelId === 'tools';
  const isImageToolsCollapsed = isImageToolsPanel && toolsCollapsed;
  const resolvedViewport = useMemo(() => viewport ?? readViewport(), [viewport]);
  const resolvedViewportRef = useRef(resolvedViewport);
  const layoutIdentityRef = useRef({ workspaceId: layout.workspaceId, panelId: layout.panelId });
  useEffect(() => {
    resolvedViewportRef.current = resolvedViewport;
    layoutIdentityRef.current = { workspaceId: layout.workspaceId, panelId: layout.panelId };
  }, [layout.panelId, layout.workspaceId, resolvedViewport]);
  const isFloating = layout.mode === 'floating';
  const isCompactFloatingChrome = chrome === 'compact-floating' && isFloating;
  const hasFixedFloatingGeometry = fixedSize || isCompactFloatingChrome;
  const floatingRectSpace = layout.floatingRectSpace === 'screen' ? 'screen' : 'owner';
  const floatingWindowKey = externalWindowKey ?? layout.panelId;
  // The compact tools palette (~66px wide) must NOT become its own native OS window: the window
  // manager enforces a minimum window width (~100px), so a 66px palette gets a ~101px window and an
  // empty strip to the right of the content. Render it in the owner window instead — identical to the
  // browser and mobile shells (which is why the strip only ever appeared on desktop Electron). Wider
  // fixed palettes (e.g. Color, 180px) stay above the OS minimum and remain real native windows.
  const shouldUseExternalWindow = shouldUseExternalFloatingPanelWindow({
    isNative: Boolean(getSignalLoomNativeBridge()),
    mode: layout.mode,
    externalWindowsSupported: getSignalLoomNativeBridge()?.supportsExternalFloatingPanelWindows,
  }) && !isCompactFloatingChrome;
  const shouldRenderInOwnerWindow = shouldRenderFloatingPanelInOwnerWindow({
    shouldUseExternalWindow,
    externalPanelRootAvailable: Boolean(externalPanelRoot),
    externalWindowClosed: false,
  });
  const useExternalPanelChrome = shouldUseExternalWindow && !shouldRenderInOwnerWindow;
  const isCollapsed = layout.mode === 'collapsed';
  // A collapsed panel in a zone without an edge strip (overlay/center) is a minimized
  // floating panel: it keeps its floating geometry and renders as a slim strip.
  const isCollapsedFloating = isCollapsedFloatingDockablePanel(layout);
  // Minimizing to a floating strip applies only to zones without a docked edge
  // strip (overlay/center); side/top/bottom panels already collapse to their
  // docked edge handle instead.
  const canMinimizeFloating = isFloating && (layout.dockZone === 'overlay' || layout.dockZone === 'center');
  const isHorizontalDock = layout.dockZone === 'top' || layout.dockZone === 'bottom';
  const isVerticalDock = layout.dockZone === 'left' || layout.dockZone === 'right';
  const ownerFloatingRect = useMemo(
    () => resolveFloatingPanelOwnerRect({
      rect: layout.floatingRect,
      ownerScreenX: typeof window === 'undefined' ? 0 : window.screenX,
      ownerScreenY: typeof window === 'undefined' ? 0 : window.screenY,
      floatingRectSpace,
    }),
    [floatingRectSpace, layout.floatingRect],
  );
  const renderedFloatingRect = useMemo(
    () => normalizeFloatingPanelRect(
      ownerFloatingRect,
      resolvedViewport,
      layout.minSize,
      { constrainPosition: shouldRenderInOwnerWindow },
    ),
    [ownerFloatingRect, layout.minSize, resolvedViewport, shouldRenderInOwnerWindow],
  );
  const externalFloatingRect = useMemo(
    () => normalizeFloatingPanelRect(
      layout.floatingRect,
      resolvedViewport,
      layout.minSize,
      { constrainPosition: false, constrainSize: false },
    ),
    [layout.floatingRect, layout.minSize, resolvedViewport],
  );
  const externalFloatingRectRef = useRef(externalFloatingRect);
  const lastExternalResizeTargetRef = useRef<{ width: number; height: number } | null>(null);
  const panelStyle: CSSProperties = isFloating || isCollapsedFloating
    ? useExternalPanelChrome
      ? {
        left: 0,
        top: 0,
        width: hasFixedFloatingGeometry ? externalFloatingRect.width : '100vw',
        height: isCollapsed ? undefined : hasFixedFloatingGeometry ? externalFloatingRect.height : '100vh',
        minWidth: layout.minSize.width,
        minHeight: isCollapsed ? undefined : layout.minSize.height,
        zIndex: zIndexForFloatingPanel(layout.zOrder),
      }
      : {
        left: renderedFloatingRect.x,
        top: renderedFloatingRect.y,
        width: isCollapsedFloating
          ? Math.max(COLLAPSED_FLOATING_PANEL_MIN_WIDTH, renderedFloatingRect.width)
          : renderedFloatingRect.width,
        height: isCollapsed ? undefined : isImageToolsCollapsed ? 76 : renderedFloatingRect.height,
        minWidth: isCollapsedFloating ? undefined : layout.minSize.width,
        minHeight: isCollapsed ? undefined : isImageToolsCollapsed ? 76 : layout.minSize.height,
        // Compact tool palettes are pinned above all other panels + the source bin (and portaled to
        // <body> below so this z wins globally instead of being trapped in the workspace's stacking).
        zIndex: isCompactFloatingChrome ? Z_INDEX.pinnedPalette : zIndexForFloatingPanel(layout.zOrder),
      }
    : {
        ...resolveDockedPanelStyleMetrics(layout),
      };
  // Side-docked (vertical) and centre docks fill their allotted height so the
  // body's scroll region is bounded; horizontal docks and floating panels stay
  // content-sized.
  const dockedFullHeightClassName = !isFloating && !isHorizontalDock ? 'h-full' : '';
  const isSideDockedBody = !isFloating && isVerticalDock;
  // Side-docked panels fill the height they're given in the column so resizing a
  // stacked panel grows/shrinks its content; compact floating palettes stay
  // content-sized.
  const bodyFlexClassName = isCompactFloatingChrome ? 'flex-none' : 'flex-1';
  const resolvedBodyClassName = isSideDockedBody
    ? resolveSideDockedBodyClassName(bodyClassName)
    : bodyClassName;
  const dockedResizeHandle = !isFloating && !isCollapsed ? DOCKED_RESIZE_HANDLES[layout.dockZone] : undefined;
  const canDockFloatingPanel = isFloating
    && !hasFixedFloatingGeometry
    && layout.dockZone !== 'overlay'
    && allowedDockZones.includes(layout.dockZone);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (dragState.current?.cleanupGlobalPointerDrag && !dragState.current.detachedFromDock) {
        dragState.current.cleanupGlobalPointerDrag();
        dragState.current = null;
      }
    };
  }, []);

  useEffect(() => {
    externalFloatingRectRef.current = externalFloatingRect;
  }, [externalFloatingRect]);

  useEffect(() => {
    let disposed = false;
    const setExternalPanelRootLater = (root: HTMLElement | null) => {
      queueMicrotask(() => {
        if (!disposed) {
          setExternalPanelRoot(root);
        }
      });
    };

    if (!shouldUseExternalWindow || !isFloating || typeof window === 'undefined') {
      if (externalWindowRef.current && !externalWindowRef.current.closed) {
        externalWindowRef.current.close();
      }
      externalWindowRef.current = null;
      lastExternalResizeTargetRef.current = null;
      setExternalPanelRootLater(null);
      return () => {
        disposed = true;
      };
    }

    const popup = window.open(
      '',
      `signal-loom-${layout.workspaceId}-${floatingWindowKey}`,
      buildFloatingPanelWindowFeatures(externalFloatingRectRef.current, {
        screenX: window.screenX,
        screenY: window.screenY,
      }, {
        ...(hasFixedFloatingGeometry ? { resizable: false } : {}),
        floatingRectSpace,
      }),
    );

    if (!popup) {
      lastExternalResizeTargetRef.current = null;
      setExternalPanelRootLater(null);
      return () => {
        disposed = true;
      };
    }

    externalWindowRef.current = popup;
    lastExternalResizeTargetRef.current = null;
    popup.document.title = title;
    prepareExternalPanelDocument(popup.document);
    let root = popup.document.getElementById('signal-loom-floating-panel-root');
    if (!root) {
      root = popup.document.createElement('div');
      root.id = 'signal-loom-floating-panel-root';
      popup.document.body.append(root);
    }
    configureExternalPanelDocumentGeometry(
      popup.document,
      root,
      hasFixedFloatingGeometry ? externalFloatingRectRef.current : undefined,
    );
    setExternalPanelRootLater(root);

    const handlePopupClosed = () => {
      if (externalWindowRef.current === popup) {
        externalWindowRef.current = null;
      }
      lastExternalResizeTargetRef.current = null;
      setExternalPanelRootLater(null);
    };
    const closePopup = () => {
      if (!popup.closed) {
        popup.close();
      }
    };
    const handlePopupResize = () => {
      if (hasFixedFloatingGeometry || popup.closed) return;
      const currentRect = externalFloatingRectRef.current;
      const popupSize = resolveExternalFloatingPanelWindowSize({
        innerWidth: popup.innerWidth,
        innerHeight: popup.innerHeight,
        outerWidth: popup.outerWidth,
        outerHeight: popup.outerHeight,
        fallbackWidth: currentRect.width,
        fallbackHeight: currentRect.height,
      });
      const width = Math.max(1, Math.round(popupSize.width));
      const height = Math.max(1, Math.round(popupSize.height));
      const lastRequested = lastExternalResizeTargetRef.current;
      if (
        (lastRequested?.width === width && lastRequested.height === height)
        || (Math.round(currentRect.width) === width && Math.round(currentRect.height) === height)
      ) {
        return;
      }

      const nextRect = resolveExternalFloatingPanelResizeRect({
        ownerScreenX: window.screenX,
        ownerScreenY: window.screenY,
        windowScreenX: popup.screenX,
        windowScreenY: popup.screenY,
        width,
        height,
        floatingRectSpace,
      });
      // Treat an OS resize as the new source of truth. Marking it as the latest
      // requested size also prevents the ensuing layout render from asking the
      // native window to resize back to the stale pre-event dimensions.
      lastExternalResizeTargetRef.current = { width, height };
      externalFloatingRectRef.current = nextRect;
      const activeLayoutIdentity = layoutIdentityRef.current;
      floatPanel(
        activeLayoutIdentity.workspaceId,
        activeLayoutIdentity.panelId,
        nextRect,
        resolvedViewportRef.current,
        { constrainSize: false, floatingRectSpace },
      );
    };
    popup.addEventListener('beforeunload', handlePopupClosed);
    popup.addEventListener('pagehide', handlePopupClosed);
    popup.addEventListener('resize', handlePopupResize);
    window.addEventListener('beforeunload', closePopup);

    return () => {
      disposed = true;
      popup.removeEventListener('beforeunload', handlePopupClosed);
      popup.removeEventListener('pagehide', handlePopupClosed);
      popup.removeEventListener('resize', handlePopupResize);
      window.removeEventListener('beforeunload', closePopup);
      if (!popup.closed) {
        popup.close();
      }
      if (externalWindowRef.current === popup) {
        externalWindowRef.current = null;
      }
      lastExternalResizeTargetRef.current = null;
    };
  }, [
    floatingRectSpace,
    hasFixedFloatingGeometry,
    floatingWindowKey,
    isFloating,
    layout.workspaceId,
    shouldUseExternalWindow,
  ]);

  useEffect(() => {
    const popup = externalWindowRef.current;
    if (!popup || popup.closed) return;
    popup.document.title = title;
  }, [externalPanelRoot, title]);

  useEffect(() => {
    if (!externalPanelRoot) return;
    configureExternalPanelDocumentGeometry(
      externalPanelRoot.ownerDocument,
      externalPanelRoot,
      hasFixedFloatingGeometry ? externalFloatingRect : undefined,
    );
  }, [externalFloatingRect, externalPanelRoot, hasFixedFloatingGeometry]);

  useEffect(() => {
    if (!shouldUseExternalWindow || !isFloating || !externalPanelRoot) return;
    let disposed = false;
    const popup = externalWindowRef.current;
    if (!popup || popup.closed || dragState.current?.externalWindowDrag) return;
    const targetScreenRect = resolveFloatingPanelScreenRect({
      rect: externalFloatingRect,
      ownerScreenX: window.screenX,
      ownerScreenY: window.screenY,
      floatingRectSpace,
    });
    const targetX = Math.round(targetScreenRect.x);
    const targetY = Math.round(targetScreenRect.y);
    const targetWidth = Math.max(1, Math.round(externalFloatingRect.width));
    const targetHeight = Math.max(1, Math.round(externalFloatingRect.height));

    try {
      if (Math.round(popup.screenX) !== targetX || Math.round(popup.screenY) !== targetY) {
        popup.moveTo(targetX, targetY);
      }
      const popupSize = resolveExternalFloatingPanelWindowSize({
        innerWidth: popup.innerWidth,
        innerHeight: popup.innerHeight,
        outerWidth: popup.outerWidth,
        outerHeight: popup.outerHeight,
        fallbackWidth: externalFloatingRect.width,
        fallbackHeight: externalFloatingRect.height,
      });
      const shouldResize = shouldResizeExternalFloatingPanelWindow({
        targetWidth,
        targetHeight,
        currentWidth: popupSize.width,
        currentHeight: popupSize.height,
        lastRequestedWidth: lastExternalResizeTargetRef.current?.width,
        lastRequestedHeight: lastExternalResizeTargetRef.current?.height,
      });
      if (shouldResize) {
        lastExternalResizeTargetRef.current = { width: targetWidth, height: targetHeight };
        if (popupSize.width !== targetWidth || popupSize.height !== targetHeight) {
          const outerSize = resolveExternalFloatingPanelOuterSize({
            targetInnerWidth: targetWidth,
            targetInnerHeight: targetHeight,
            currentInnerWidth: popup.innerWidth,
            currentInnerHeight: popup.innerHeight,
            currentOuterWidth: popup.outerWidth,
            currentOuterHeight: popup.outerHeight,
          });
          popup.resizeTo(outerSize.width, outerSize.height);
        }
      }
    } catch {
      queueMicrotask(() => {
        if (!disposed) {
          setExternalPanelRoot(null);
        }
      });
    }
    return () => {
      disposed = true;
    };
  }, [externalFloatingRect, externalPanelRoot, hasFixedFloatingGeometry, floatingRectSpace, isFloating, shouldUseExternalWindow]);

  if (layout.mode === 'hidden') return null;

  const rebaseOwnerRenderedFloatingRect = () => {
    if (
      !isFloating
      || !shouldRenderInOwnerWindow
      || (
        floatingRectSpace !== 'screen'
        && arePanelRectsEqual(layout.floatingRect, renderedFloatingRect)
      )
    ) {
      return;
    }
    // Persist the clamped owner-window geometry before applying pointer
    // deltas. Otherwise a first move or resize continues from an offscreen
    // persisted rect while the user manipulates its onscreen recovery position.
    floatPanel(
      layout.workspaceId,
      layout.panelId,
      renderedFloatingRect,
      resolvedViewport,
      { constrainSize: false, floatingRectSpace: 'owner' },
    );
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    bringPanelToFront(layout.workspaceId, layout.panelId);
    rebaseOwnerRenderedFloatingRect();
    const panelRect = readElementRect(event.currentTarget.closest('[data-dockable-panel-id]'));
    const originRect = panelRect ?? renderedFloatingRect;
    const eventWindow = event.currentTarget.ownerDocument.defaultView;
    const captureElement = event.currentTarget;
    const cleanupGlobalPointerDrag = attachDockablePanelGlobalPointerDragListeners(
      eventWindow ?? window,
      event.pointerId,
      {
        onMove: continueDrag,
        onEnd: endDrag,
      },
    );
    const externalWindowDrag = useExternalPanelChrome && eventWindow
      ? {
          anchor: createExternalFloatingPanelDragAnchor({
            pointerScreenX: event.screenX,
            pointerScreenY: event.screenY,
            windowScreenX: eventWindow.screenX,
            windowScreenY: eventWindow.screenY,
          }),
          ownerScreenX: window.screenX,
          ownerScreenY: window.screenY,
          width: externalFloatingRect.width,
          height: externalFloatingRect.height,
        }
      : undefined;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      action: 'move',
      // A minimized (collapsed floating) strip drags like a floating panel: the
      // move must keep it collapsed instead of detaching/re-floating it.
      startedFloating: isFloating || isCollapsedFloating,
      detachedFromDock: isFloating || isCollapsedFloating,
      originRect,
      pointerOffsetX: event.clientX - originRect.x,
      pointerOffsetY: event.clientY - originRect.y,
      captureElement,
      ownerWindow: eventWindow ?? window,
      cleanupGlobalPointerDrag,
      externalWindowDrag,
    };
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, resize: Pick<ResizeDelta, 'edgeX' | 'edgeY'>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    bringPanelToFront(layout.workspaceId, layout.panelId);
    rebaseOwnerRenderedFloatingRect();
    const eventWindow = event.currentTarget.ownerDocument.defaultView;
    const captureElement = event.currentTarget;
    const cleanupGlobalPointerDrag = attachDockablePanelGlobalPointerDragListeners(
      eventWindow ?? window,
      event.pointerId,
      {
        onMove: continueDrag,
        onEnd: endDrag,
      },
    );
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      action: isFloating ? 'floating-resize' : 'docked-resize',
      resize,
      captureElement,
      ownerWindow: eventWindow ?? window,
      cleanupGlobalPointerDrag,
    };
  };

  const continueDrag = (event: ReactPointerEvent<HTMLDivElement> | PointerEvent) => {
    const current = dragState.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const deltaX = event.clientX - current.lastX;
    const deltaY = event.clientY - current.lastY;
    if (current.action === 'floating-resize' && current.resize) {
      resizeFloatingPanel(
        layout.workspaceId,
        layout.panelId,
        { ...current.resize, deltaX, deltaY },
        resolvedViewport,
        {
          constrainPosition: shouldRenderInOwnerWindow,
          constrainSize: !useExternalPanelChrome,
        },
      );
      dragState.current = { ...current, lastX: event.clientX, lastY: event.clientY };
    } else if (current.action === 'docked-resize' && current.resize) {
      resizeDockedPanel(
        layout.workspaceId,
        layout.panelId,
        { ...current.resize, deltaX, deltaY },
        resolvedViewport,
      );
      dragState.current = { ...current, lastX: event.clientX, lastY: event.clientY };
    } else if (current.action === 'move') {
      if (current.externalWindowDrag) {
        const popup = externalWindowRef.current ?? current.ownerWindow;
        if (popup && !popup.closed) {
          const nextPosition = resolveExternalFloatingPanelWindowPosition({
            pointerScreenX: event.screenX,
            pointerScreenY: event.screenY,
            anchor: current.externalWindowDrag.anchor,
          });
          try {
            popup.moveTo(nextPosition.screenX, nextPosition.screenY);
            const targetWidth = Math.max(1, Math.round(current.externalWindowDrag.width));
            const targetHeight = Math.max(1, Math.round(current.externalWindowDrag.height));
            const popupSize = resolveExternalFloatingPanelWindowSize({
              innerWidth: popup.innerWidth,
              innerHeight: popup.innerHeight,
              outerWidth: popup.outerWidth,
              outerHeight: popup.outerHeight,
              fallbackWidth: targetWidth,
              fallbackHeight: targetHeight,
            });
            if (shouldResizeExternalFloatingPanelWindow({
              targetWidth,
              targetHeight,
              currentWidth: popupSize.width,
              currentHeight: popupSize.height,
              lastRequestedWidth: targetWidth,
              lastRequestedHeight: targetHeight,
            })) {
              const outerSize = resolveExternalFloatingPanelOuterSize({
                targetInnerWidth: targetWidth,
                targetInnerHeight: targetHeight,
                currentInnerWidth: popup.innerWidth,
                currentInnerHeight: popup.innerHeight,
                currentOuterWidth: popup.outerWidth,
                currentOuterHeight: popup.outerHeight,
              });
              popup.resizeTo(outerSize.width, outerSize.height);
            }
          } catch {
            setExternalPanelRoot(null);
          }
        }
        dragState.current = { ...current, lastX: event.clientX, lastY: event.clientY };
        return;
      }
      if (!current.detachedFromDock) {
        const totalDeltaX = event.clientX - current.startX;
        const totalDeltaY = event.clientY - current.startY;
        if (Math.abs(totalDeltaX) < 4 && Math.abs(totalDeltaY) < 4) {
          return;
        }
        const originRect = current.originRect ?? renderedFloatingRect;
        floatPanel(
          layout.workspaceId,
          layout.panelId,
          resolveDetachedFloatingPanelRect({
            layout,
            originRect,
            pointerX: event.clientX,
            pointerY: event.clientY,
            pointerOffsetX: current.pointerOffsetX ?? originRect.width / 2,
            pointerOffsetY: current.pointerOffsetY ?? 24,
          }),
          resolvedViewport,
          { constrainPosition: shouldRenderInOwnerWindow },
        );
        dragState.current = { ...current, detachedFromDock: true, lastX: event.clientX, lastY: event.clientY };
        return;
      }
      moveFloatingPanel(
        layout.workspaceId,
        layout.panelId,
        deltaX,
        deltaY,
        resolvedViewport,
        { constrainPosition: shouldRenderInOwnerWindow },
      );
      const stackRects = collectDockedPanelStackRects(layout.workspaceId, layout.panelId);
      // Repositioning an already-floating panel stays floating. A panel being detached from a dock
      // can still snap into a new target; Ctrl/Cmd suppresses that snap for fully tiled workspaces.
      const snapTarget = current.startedFloating || event.ctrlKey || event.metaKey
        ? ({ mode: 'floating' } as const)
        : adjustCenterSnapTarget(resolveDockablePanelSnapTarget(
            { x: event.clientX, y: event.clientY },
            resolvedViewport,
            stackRects,
            allowedDockZones,
          ));
      if (mountedRef.current) {
        setSnapPreviewRect(resolveDockablePanelSnapPreviewRect(snapTarget, resolvedViewport, stackRects) ?? null);
      }
      dragState.current = { ...current, lastX: event.clientX, lastY: event.clientY };
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement> | PointerEvent) => {
    const current = dragState.current;
    if (current?.pointerId !== event.pointerId) return;
    current.cleanupGlobalPointerDrag?.();
    if (current.captureElement?.hasPointerCapture?.(event.pointerId)) {
      current.captureElement.releasePointerCapture(event.pointerId);
    }
    if (current.action === 'move' && current.externalWindowDrag) {
      const popup = externalWindowRef.current ?? current.ownerWindow;
      const fallbackPosition = resolveExternalFloatingPanelWindowPosition({
        pointerScreenX: event.screenX,
        pointerScreenY: event.screenY,
        anchor: current.externalWindowDrag.anchor,
      });
      const nextRect = resolveExternalFloatingPanelMoveEndRect({
        ownerScreenX: current.externalWindowDrag.ownerScreenX,
        ownerScreenY: current.externalWindowDrag.ownerScreenY,
        windowScreenX: popup && !popup.closed ? popup.screenX : fallbackPosition.screenX,
        windowScreenY: popup && !popup.closed ? popup.screenY : fallbackPosition.screenY,
        dragStartWidth: current.externalWindowDrag.width,
        dragStartHeight: current.externalWindowDrag.height,
        floatingRectSpace: 'screen',
      });
      floatPanel(layout.workspaceId, layout.panelId, nextRect, resolvedViewport, { constrainSize: false, floatingRectSpace: 'screen' });
    } else if (
      current.action === 'move'
      && current.detachedFromDock
      && !current.startedFloating
      && !(event.ctrlKey || event.metaKey)
    ) {
      // Ctrl/Cmd released the panel as floating — skip the snap entirely (matches the preview).
      const snapTarget = adjustCenterSnapTarget(resolveDockablePanelSnapTarget(
        { x: event.clientX, y: event.clientY },
        resolvedViewport,
        collectDockedPanelStackRects(layout.workspaceId, layout.panelId),
        allowedDockZones,
      ));
      if (snapTarget.mode === 'docked') {
        snapPanelToDockTarget(layout.workspaceId, layout.panelId, snapTarget);
      } else if (snapTarget.mode === 'tab') {
        groupPanelWithPanel(layout.workspaceId, layout.panelId, snapTarget.referencePanelId);
      }
    }
    dragState.current = null;
    if (mountedRef.current) {
      setSnapPreviewRect(null);
    }
  };

  const panel = (
    <section
      aria-label={title}
      aria-modal={ariaModal}
      className={isCollapsedFloating
        ? `theme-popover fixed flex min-h-0 flex-col overflow-hidden rounded-[3px] border border-cyan-300/25 bg-[#11131a]/95 text-cyan-50 shadow-2xl ${className}`
        : isCollapsed && !isFloating
        ? `theme-popover relative flex flex-col items-center justify-center bg-[#08111d]/95 font-bold uppercase tracking-widest text-cyan-100 shadow-xl backdrop-blur-md transition-colors hover:bg-cyan-400/15 border-cyan-300/35 border ${
            isVerticalDock
              ? `h-24 w-7 py-3 text-xs [writing-mode:vertical-rl] ${
                  layout.dockZone === 'left' ? 'rounded-r-lg border-l-0' : 'rounded-l-lg border-r-0'
                }`
              : `h-7 w-24 px-3 text-xs ${
                  layout.dockZone === 'top' ? 'rounded-b-lg border-t-0' : 'rounded-t-lg border-b-0'
                }`
          } ${className}`
        : isCompactFloatingChrome
        ? `theme-popover fixed flex min-h-0 flex-col overflow-hidden rounded-[3px] border border-cyan-300/25 bg-[#11131a]/95 text-cyan-50 shadow-2xl ${className}`
        : `theme-popover ${isFloating ? 'fixed flex min-h-0 flex-col' : `relative flex min-h-0 flex-col ${dockedFullHeightClassName}`} overflow-hidden rounded-xl border border-cyan-300/15 bg-[#0d1522]/95 text-cyan-50 shadow-2xl ${className}`}
      data-dock-zone={layout.dockZone}
      data-dockable-dock-column={layout.dockColumn ?? 0}
      data-dockable-panel-chrome={chrome}
      data-dockable-panel-mode={layout.mode}
      data-dockable-panel-id={layout.panelId}
      data-dockable-tab-target={!isCompactFloatingChrome && !fixedSize && allowedDockZones.length > 0 ? 'true' : undefined}
      data-dockable-workspace-id={layout.workspaceId}
      onPointerDown={() => bringPanelToFront(layout.workspaceId, layout.panelId)}
      role={role}
      style={panelStyle}
    >
      {isCollapsedFloating ? (
        <div
          aria-label={`${title} minimized strip`}
          className="relative z-10 flex h-7 shrink-0 touch-none cursor-grab items-center gap-2 px-2 active:cursor-grabbing"
          onDoubleClick={() => {
            setPanelMode(layout.workspaceId, layout.panelId, 'floating');
          }}
          onPointerDown={startDrag}
          role="button"
          tabIndex={0}
          title={`${title} — drag to move; double-click or Expand to restore`}
        >
          <GripHorizontal aria-hidden size={11} className="shrink-0 text-cyan-100/50" />
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/70">
            {title}
          </span>
          <button
            aria-label={`Expand ${title}`}
            className="flex items-center justify-center rounded bg-cyan-950/20 p-0.5 text-cyan-100/50 transition-colors pointer-events-auto hover:bg-cyan-950/40 hover:text-cyan-400 active:text-cyan-500"
            onClick={(event) => {
              event.stopPropagation();
              setPanelMode(layout.workspaceId, layout.panelId, 'floating');
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title={`Expand ${title}`}
            type="button"
          >
            <ChevronUp size={10} />
          </button>
        </div>
      ) : isCollapsed && !isFloating ? (
        <button
          aria-label={`Expand ${title}`}
          className="h-full w-full outline-none flex items-center justify-center pointer-events-auto"
          onClick={(event) => {
            event.stopPropagation();
            setPanelMode(layout.workspaceId, layout.panelId, 'docked');
          }}
          title={`Expand ${title}`}
          type="button"
        >
          {title}
        </button>
      ) : (
        isCompactFloatingChrome ? (
          <div
            aria-label={`${title} drag handle`}
            className="relative z-10 flex h-4 shrink-0 touch-none cursor-grab items-center justify-center border-b border-cyan-300/20 bg-[#171a22] active:cursor-grabbing"
            onPointerDown={startDrag}
            role="button"
            tabIndex={0}
            title={`${title} drag handle`}
          >
            <GripHorizontal aria-hidden size={11} className="shrink-0 text-cyan-100/50" />
            {canMinimizeFloating ? (
              <button
                aria-label={`Minimize ${title}`}
                className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center text-cyan-100/50 hover:text-cyan-400 active:text-cyan-500 rounded bg-cyan-950/20 hover:bg-cyan-950/40 p-0.5 transition-colors pointer-events-auto"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  collapsePanel(layout.workspaceId, layout.panelId);
                }}
                title={`Minimize ${title}`}
                type="button"
              >
                <Minus size={10} />
              </button>
            ) : null}
            {isImageToolsPanel ? (
              <button
                className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center text-cyan-100/50 hover:text-cyan-400 active:text-cyan-500 rounded bg-cyan-950/20 hover:bg-cyan-950/40 p-0.5 transition-colors pointer-events-auto"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setToolsCollapsed(!toolsCollapsed);
                }}
                title={toolsCollapsed ? 'Expand Tools' : 'Collapse Tools'}
                type="button"
              >
                {toolsCollapsed ? (
                  <ChevronDown size={10} />
                ) : (
                  <ChevronUp size={10} />
                )}
              </button>
            ) : null}
          </div>
        ) : (
          <div
            aria-label={`${title} drag handle`}
            className="theme-header relative z-10 flex touch-none cursor-grab items-center gap-2 border-b border-cyan-300/10 bg-[#111c2c] px-2 py-1.5 active:cursor-grabbing"
            onPointerDown={startDrag}
            onDoubleClick={() => {
              if (isCollapsed) {
                setPanelMode(layout.workspaceId, layout.panelId, isFloating ? 'floating' : 'docked');
              }
            }}
            role="button"
            tabIndex={0}
            title={isFloating
              ? `${title} — drag to move; use Dock to reattach`
              : `${title} — drag to move, Ctrl-drag to float`}
          >
            <GripHorizontal aria-hidden size={14} className="shrink-0 text-cyan-100/45" />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100/80">
              {title}
            </span>
            {isVerticalDock && !isFloating ? (
              <>
                {(layout.dockColumn ?? 0) > 0 ? (
                  <button
                    aria-label={`Move ${title} to previous column`}
                    className="theme-button flex h-6 w-6 items-center justify-center rounded border border-cyan-300/15 text-cyan-100/60 hover:border-cyan-200/50 hover:text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPanelDockColumn(layout.workspaceId, layout.panelId, (layout.dockColumn ?? 0) - 1);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    title="Move to previous column"
                    type="button"
                  >
                    <PanelLeft aria-hidden size={13} />
                  </button>
                ) : null}
                <button
                  aria-label={`Move ${title} to next column`}
                  className="theme-button flex h-6 w-6 items-center justify-center rounded border border-cyan-300/15 text-cyan-100/60 hover:border-cyan-200/50 hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPanelDockColumn(layout.workspaceId, layout.panelId, (layout.dockColumn ?? 0) + 1);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  title="Move to next column"
                  type="button"
                >
                  <PanelRight aria-hidden size={13} />
                </button>
              </>
            ) : null}
            {canMinimizeFloating ? (
              <button
                aria-label={`Minimize ${title}`}
                className="theme-button flex h-6 w-6 items-center justify-center rounded border border-cyan-300/15 text-cyan-100/60 hover:border-cyan-200/50 hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  collapsePanel(layout.workspaceId, layout.panelId);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                title={`Minimize ${title}`}
                type="button"
              >
                <Minus aria-hidden size={13} />
              </button>
            ) : null}
            {canDockFloatingPanel ? (
              <button
                className="theme-button rounded border border-cyan-300/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/70 hover:border-cyan-200/50 hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  dockPanel(layout.workspaceId, layout.panelId, layout.dockZone);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                Dock
              </button>
            ) : null}
            {onClose ? (
              <button
                className="theme-button rounded border border-cyan-300/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/70 hover:border-cyan-200/50 hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                Close
              </button>
            ) : null}
          </div>
        )
      )}
      {!isCollapsed && tabs ? (
        <div
          className="shrink-0 border-b border-cyan-300/10 bg-[#0a1320]/95"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {tabs}
        </div>
      ) : null}
      {!isCollapsed ? (
        <div
          className={`min-h-0 ${bodyFlexClassName} ${resolvedBodyClassName}`}
          data-dockable-panel-body={layout.panelId}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ErrorBoundary
            className="min-h-full"
            level="panel"
            resetKeys={[layout.workspaceId, layout.panelId, layout.mode]}
            title={`${title} Panel`}
          >
            <DockExpandContext.Provider value={!isCollapsed}>
              {children}
            </DockExpandContext.Provider>
          </ErrorBoundary>
        </div>
      ) : null}
      {isFloating && !isCollapsed && !fixedSize && !isCompactFloatingChrome
        ? RESIZE_HANDLES.map((handle) => (
            <div
              aria-label={`${title} ${handle.label.toLowerCase()}`}
              className={`absolute touch-none ${handle.className}`}
              key={handle.label}
              onPointerDown={(event) => startResize(event, handle)}
              role="separator"
            />
          ))
        : null}
      {dockedResizeHandle ? (
        <div
          aria-label={`${title} ${dockedResizeHandle.label.toLowerCase()}`}
          className={`absolute touch-none transition-colors ${dockedResizeHandle.className}`}
          onPointerDown={(event) => startResize(event, dockedResizeHandle)}
          role="separator"
          title={`${title} resize handle`}
        />
      ) : null}
      {snapPreviewRect ? <DockSnapPreview rect={snapPreviewRect} /> : null}
    </section>
  );

  if (shouldUseExternalWindow && externalPanelRoot && !shouldRenderInOwnerWindow) {
    return createPortal(panel, externalPanelRoot);
  }

  // Pin the compact tool palette above everything (source bin, docked + floating panels) by escaping
  // the workspace's z-30 stacking context: portal it to <body> where its pinnedPalette z wins globally.
  if (isCompactFloatingChrome && typeof document !== 'undefined') {
    return createPortal(panel, document.body);
  }

  return panel;
}

function DockSnapPreview({ rect }: { rect: PanelRect }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      aria-hidden
      className="fixed pointer-events-none rounded-sm border border-cyan-100/80 bg-cyan-300/20 shadow-[0_0_24px_rgba(103,232,249,0.65),0_0_2px_rgba(255,255,255,0.9)_inset]"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex: zIndexForFloatingPanel(900),
      }}
    />,
    document.body,
  );
}

function readViewport(): ViewportSize {
  if (typeof window === 'undefined') return { width: 1280, height: 720 };
  return {
    width: Math.max(DEFAULT_VIEWPORT_MARGIN * 2 + 1, window.innerWidth),
    height: Math.max(DEFAULT_VIEWPORT_MARGIN * 2 + 1, window.innerHeight),
  };
}

function arePanelRectsEqual(a: PanelRect, b: PanelRect): boolean {
  return a.x === b.x
    && a.y === b.y
    && a.width === b.width
    && a.height === b.height;
}

function readElementRect(element: Element | null): PanelRect | undefined {
  if (!(element instanceof HTMLElement)) return undefined;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function prepareExternalPanelDocument(targetDocument: Document): void {
  const themedRoot = document.querySelector<HTMLElement>('.signal-loom-themed');
  const themedRootStyle = themedRoot ? getComputedStyle(themedRoot) : null;

  targetDocument.documentElement.classList.add('signal-loom-themed');
  targetDocument.documentElement.style.margin = '0';
  targetDocument.documentElement.style.background = themedRootStyle?.getPropertyValue('--sl-bg') || '#08111d';
  targetDocument.body.style.margin = '0';
  targetDocument.body.style.overflow = 'hidden';
  targetDocument.body.style.background = themedRootStyle?.getPropertyValue('--sl-bg') || '#08111d';
  targetDocument.body.classList.add('signal-loom-themed');

  if (themedRootStyle) {
    for (const variable of FLOATING_PANEL_THEME_CSS_VARIABLES) {
      const value = themedRootStyle.getPropertyValue(variable).trim();
      if (value) {
        targetDocument.documentElement.style.setProperty(variable, value);
      }
    }
  }

  if (targetDocument.getElementById('signal-loom-floating-panel-style-copy')) {
    return;
  }

  let copiedStyle = false;
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    const clone = node.cloneNode(true) as HTMLElement;
    if (clone.tagName === 'LINK') {
      // The popup opens as about:blank, so a cloned relative/root-relative href
      // (e.g. "./assets/index-*.css" in a production build) would resolve against
      // about:blank and fail to load, leaving the panel completely unstyled.
      // Reading the live element's .href yields the already-resolved absolute URL.
      const absoluteHref = (node as HTMLLinkElement).href;
      if (absoluteHref) {
        clone.setAttribute('href', absoluteHref);
      }
    }
    if (!copiedStyle && clone.tagName === 'STYLE') {
      clone.id = 'signal-loom-floating-panel-style-copy';
      copiedStyle = true;
    }
    targetDocument.head.append(clone);
  }

  if (!copiedStyle) {
    const marker = targetDocument.createElement('style');
    marker.id = 'signal-loom-floating-panel-style-copy';
    targetDocument.head.append(marker);
  }
}

function configureExternalPanelDocumentGeometry(
  targetDocument: Document,
  root: HTMLElement,
  fixedRect?: PanelRect,
): void {
  if (!fixedRect) {
    targetDocument.documentElement.style.width = '';
    targetDocument.documentElement.style.height = '';
    targetDocument.documentElement.style.overflow = '';
    targetDocument.body.style.width = '';
    targetDocument.body.style.height = '';
    targetDocument.body.style.overflow = 'hidden';
    root.style.width = '';
    root.style.height = '';
    root.style.overflow = '';
    return;
  }

  const width = `${Math.max(1, Math.round(fixedRect.width))}px`;
  const height = `${Math.max(1, Math.round(fixedRect.height))}px`;
  targetDocument.documentElement.style.width = width;
  targetDocument.documentElement.style.height = height;
  targetDocument.documentElement.style.overflow = 'hidden';
  targetDocument.documentElement.style.background = 'transparent';
  targetDocument.body.style.width = width;
  targetDocument.body.style.height = height;
  targetDocument.body.style.overflow = 'hidden';
  targetDocument.body.style.background = 'transparent';
  root.style.width = width;
  root.style.height = height;
  root.style.overflow = 'hidden';
}

function collectDockedPanelStackRects(workspaceId: string, activePanelId: string): DockablePanelStackRect[] {
  if (typeof document === 'undefined') return [];
  const elements = document.querySelectorAll<HTMLElement>('[data-dockable-panel-id][data-dockable-workspace-id][data-dock-zone][data-dockable-tab-target="true"]');
  const rects: DockablePanelStackRect[] = [];

  elements.forEach((element) => {
    if (element.dataset.dockableWorkspaceId !== workspaceId) return;
    const panelId = element.dataset.dockablePanelId;
    if (!panelId || panelId === activePanelId) return;
    if (
      element.dataset.dockablePanelMode !== 'docked'
      && element.dataset.dockablePanelMode !== 'collapsed'
      && element.dataset.dockablePanelMode !== 'floating'
    ) return;
    const dockZone = element.dataset.dockZone;
    if (!isDockZone(dockZone)) return;
    const rect = readElementRect(element);
    if (!rect) return;
    const columnValue = Number.parseInt(element.dataset.dockableDockColumn ?? '', 10);
    rects.push({
      panelId,
      dockZone,
      rect,
      dockColumn: Number.isFinite(columnValue) ? Math.max(0, columnValue) : undefined,
    });
  });

  return rects;
}

function isDockZone(value: unknown): value is DockZone {
  return value === 'left'
    || value === 'right'
    || value === 'top'
    || value === 'bottom'
    || value === 'center'
    || value === 'overlay';
}
