import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Command, Download, EyeOff, FolderOpen, History, Library, Maximize2, Menu, Minimize2, Minus, Play, Plus, Redo2, Settings, Undo2, Wifi, WifiOff } from 'lucide-react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useSettingsStore } from '../../store/settingsStore';
import { useFlowStore } from '../../store/flowStore';
import { useEditorStore } from '../../store/editorStore';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { useSourceBinStore } from '../../store/sourceBinStore';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { ProjectLibraryModal } from './ProjectLibraryModal';
import { ProjectHistoryModal } from './ProjectHistoryModal';
import { buildAppMenuGroups, shouldShowIntegratedAppMenu } from '../../lib/appMenuModel';
import { dispatchNativeRendererCommand, getSignalLoomNativeBridge, type NativeMenuCommand } from '../../lib/nativeApp';
import type { ActivityTrailSource } from '../../lib/activityTrail';
import {
  applyVideoDockablePanelVisibility,
  type VideoPanelVisibilityKey,
} from '../../lib/videoDockablePanelVisibility';
import { fitToContainer, zoomViewportStepAroundCenter } from '../ImageEditor/viewport';
import { PAPER_TOPBAR_SLOT_ID } from '../../lib/paperTopbarSlot';
import { IMAGE_TOPBAR_CENTER_SLOT_ID, IMAGE_TOPBAR_RIGHT_SLOT_ID } from '../../lib/imageTopbarSlots';
import { BottomToolbar } from './BottomToolbar';
import { AppClassicMenuBar } from './AppClassicMenuBar';
import { EditBatonControl } from './EditBatonControl';
import type { FlowNodeType, NodeData, WorkspaceView } from '../../types/flow';
import { FunctionLibraryDrawer } from '../Common/FunctionLibraryDrawer';
import { FlowWorkspaceSwitcher } from '../../features/flow/workspace/FlowWorkspaceSwitcher';
import { useFlowWorkspaceCommands } from '../../features/flow/workspace/useFlowWorkspaceCommands';
import {
  createFunctionNodeDataFromLibraryFunction,
  createLibraryFunctionFromFunctionNode,
  getFunctionLibraryEntries,
  type StandardLibraryFunction,
} from '../../lib/standardLibrary';
import { useMobileInterfaceStore } from '../../store/mobileInterfaceStore';
import { useMobilePhoneInterfaceDescriptor } from '../../lib/mobilePhoneInterface';
import { isAndroidNativeFullscreenAvailable, setAndroidFullscreen } from '../../lib/androidSystemUi';
import {
  isAndroidLanServerAvailable,
  OPEN_ANDROID_LAN_SERVER_EVENT,
} from '../../lib/androidLanServer';
import { UsageBar } from './UsageBar';
import { useI18n } from '../../lib/useI18n';
import type { MessageKey } from '../../lib/i18n';
import { WorkspaceLayoutControl } from './WorkspaceLayoutControl';

const flowIcon = new URL('../../assets/icon-flow.svg', import.meta.url).href;
const editorIcon = new URL('../../assets/icon-editor.svg', import.meta.url).href;
const imageIcon = new URL('../../assets/icon-image.svg', import.meta.url).href;
const paperIcon = new URL('../../assets/icon-paper.svg', import.meta.url).href;

const WORKSPACE_TABS = [
  {
    id: 'flow' as WorkspaceView,
    label: 'Flow',
    command: 'view:flow' as NativeMenuCommand,
    icon: flowIcon,
    activeClass: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-100 shadow-[0_0_14px_rgba(217,70,239,0.2)]',
    dotClass: 'bg-fuchsia-400',
    hoverClass: 'hover:bg-fuchsia-500/5 hover:text-fuchsia-100',
    descKey: 'nav.workspace.flow.desc' as MessageKey,
  },
  {
    id: 'editor' as WorkspaceView,
    label: 'Video',
    command: 'view:editor' as NativeMenuCommand,
    icon: editorIcon,
    activeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-100 shadow-[0_0_14px_rgba(14,165,233,0.2)]',
    dotClass: 'bg-sky-400',
    hoverClass: 'hover:bg-sky-500/5 hover:text-sky-100',
    descKey: 'nav.workspace.editor.desc' as MessageKey,
  },
  {
    id: 'image' as WorkspaceView,
    label: 'Image',
    command: 'view:image' as NativeMenuCommand,
    icon: imageIcon,
    activeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-100 shadow-[0_0_14px_rgba(244,63,94,0.2)]',
    dotClass: 'bg-rose-400',
    hoverClass: 'hover:bg-rose-500/5 hover:text-rose-100',
    descKey: 'nav.workspace.image.desc' as MessageKey,
  },
  {
    id: 'paper' as WorkspaceView,
    label: 'Paper',
    command: 'view:paper' as NativeMenuCommand,
    icon: paperIcon,
    activeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-100 shadow-[0_0_14px_rgba(245,158,11,0.2)]',
    dotClass: 'bg-amber-400',
    hoverClass: 'hover:bg-amber-500/5 hover:text-amber-100',
    descKey: 'nav.workspace.paper.desc' as MessageKey,
  },
];

interface TopNavbarProps {
  activeFlowSourceBinId?: string;
  onMenuCommand?: (command: NativeMenuCommand, source?: ActivityTrailSource) => void;
  onActiveFlowSourceBinChange?: (binId: string | undefined) => void;
  onImportNodePack?: () => void;
  onInsertStarterTemplate?: (templateId: string) => void;
  flowWorkspaceMetricLabel?: string;
  sourceBins?: Array<{ id: string; name: string; items: unknown[] }>;
  workspaceView?: WorkspaceView;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  activeFlowSourceBinId,
  onMenuCommand,
  onActiveFlowSourceBinChange,
  onImportNodePack,
  onInsertStarterTemplate,
  flowWorkspaceMetricLabel,
  sourceBins = [],
  workspaceView: workspaceViewOverride,
}) => {
  const { t, locale } = useI18n();
  const toggleSettings = useSettingsStore((state) => state.toggleSettings);
  const keyboardShortcuts = useSettingsStore((state) => state.keyboardShortcuts);
  const appMenuStyle = useSettingsStore((state) => state.appMenuStyle);
  const setAppMenuStyle = useSettingsStore((state) => state.setAppMenuStyle);
  const lanServerEnabled = useSettingsStore((state) => Boolean(state.providerSettings.androidLanServerEnabled));
  const setProviderSetting = useSettingsStore((state) => state.setProviderSetting);
  // Only the native Android phone app can host the LAN server; the toggle is hidden everywhere else.
  const lanServerAvailable = isAndroidLanServerAvailable();
  const exportFlow = useFlowStore((state) => state.exportFlow);
  const nodes = useFlowStore((state) => state.nodes);
  const addNode = useFlowStore((state) => state.addNode);
  const runNode = useFlowStore((state) => state.runNode);
  const storedWorkspaceView = useEditorStore((state) => state.workspaceView);
  const workspaceView = workspaceViewOverride ?? storedWorkspaceView;
  const isImageWorkspace = workspaceView === 'image';
  const isPaperWorkspace = workspaceView === 'paper';
  const activeCompositionId = useEditorStore((state) => state.activeCompositionId);
  const sourceBinVisible = useEditorStore((state) => state.sourceBinVisible);
  const sourceMonitorVisible = useEditorStore((state) => state.sourceMonitorVisible);
  const programMonitorVisible = useEditorStore((state) => state.programMonitorVisible);
  const inspectorVisible = useEditorStore((state) => state.inspectorVisible);
  const setActiveSourceBinId = useEditorStore((state) => state.setActiveSourceBinId);
  const setActiveCompositionId = useEditorStore((state) => state.setActiveCompositionId);
  const setPanelVisibility = useEditorStore((state) => state.setPanelVisibility);
  const dockVideoPanel = useDockablePanelStore((state) => state.dockPanel);
  const hideVideoPanel = useDockablePanelStore((state) => state.hidePanel);
  const activeImageDocument = useImageEditorStore((state) =>
    state.documents.find((doc) => doc.id === state.activeDocId) ?? null,
  );
  const imageViewportContainerSize = useImageEditorStore((state) => state.viewportContainerSize);
  const setImageViewport = useImageEditorStore((state) => state.setViewport);
  const sourceBinItemCount = useSourceBinStore((state) => state.bins.reduce((sum, bin) => sum + bin.items.length, 0));
  const { zoom } = useViewport();
  const { fitView, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow();
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'error'>('idle');
  const [isProjectLibraryOpen, setProjectLibraryOpen] = React.useState(false);
  const [isProjectHistoryOpen, setProjectHistoryOpen] = React.useState(false);
  const [isFunctionLibraryOpen, setFunctionLibraryOpen] = React.useState(false);
  const [isFullscreen, setFullscreen] = React.useState(Boolean(document.fullscreenElement));
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
  // The desktop app-menu dropdown is portaled to <body> so it escapes the horizontally-scrollable,
  // z-20 nav-bar container (which otherwise clips it and stacks it behind the workspace surface —
  // making the menu unusable on web/DeX). `menuAnchorRect` positions the portal under its button.
  const [menuAnchorRect, setMenuAnchorRect] = React.useState<DOMRect | null>(null);
  const menuPortalRef = React.useRef<HTMLDivElement | null>(null);
  const [showIntegratedMenu] = React.useState(() => {
    const bridge = getSignalLoomNativeBridge();
    // Detect the desktop OS from the Electron renderer userAgent (synchronous + reliable). On
    // Linux the native menu bar is unreliable, so we render the integrated React menu instead.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const platform = /Android/.test(ua) ? 'android'
      : /Mac OS X|Macintosh/.test(ua) ? 'darwin'
        : /Windows/.test(ua) ? 'win32'
          : /Linux/.test(ua) ? 'linux'
            : undefined;
    return shouldShowIntegratedAppMenu(Boolean(bridge), platform);
  });
  const mobilePhoneInterface = useMobilePhoneInterfaceDescriptor();
  const mobileChromeMode = useMobileInterfaceStore((state) => state.chromeMode);
  const activeMobileEdgeDrawer = useMobileInterfaceStore((state) => state.activeEdgeDrawer);
  const setActiveMobileEdgeDrawer = useMobileInterfaceStore((state) => state.setActiveEdgeDrawer);
  const toggleMobileEdgeDrawer = useMobileInterfaceStore((state) => state.toggleEdgeDrawer);
  const hideMobileInterface = useMobileInterfaceStore((state) => state.hideInterface);
  const restoreMobileInterface = useMobileInterfaceStore((state) => state.restoreInterface);
  const appMenuRef = React.useRef<HTMLDivElement | null>(null);
  const mobileMenuRef = React.useRef<HTMLDivElement | null>(null);
  const sourceBinNodeCount = React.useMemo(
    () => nodes.filter((node) => node.type === 'sourceBin').length,
    [nodes],
  );
  const compositionNodes = React.useMemo(
    () => nodes.filter((node) => node.type === 'composition'),
    [nodes],
  );
  const customFunctionLibraryEntries = React.useMemo(
    () => nodes.flatMap((node) => createLibraryFunctionFromFunctionNode(node) ?? []),
    [nodes],
  );
  const activeComposition = compositionNodes.find((node) => node.id === activeCompositionId);
  const isCompositionRendering = Boolean(activeComposition?.data.isRunning);
  const activeIcon = {
    flow: flowIcon,
    editor: editorIcon,
    image: imageIcon,
    paper: paperIcon,
  }[workspaceView];
  // Flow owns the React Flow viewport. Image, Video, and Paper each expose
  // workspace-specific navigation, so repeating Flow zoom here is both
  // misleading and visually redundant.
  const showGenericViewportControls = workspaceView === 'flow';
  const appMenuGroups = React.useMemo(() => buildAppMenuGroups(workspaceView, keyboardShortcuts, locale), [keyboardShortcuts, locale, workspaceView]);
  const imageViewportReady =
    Boolean(activeImageDocument) &&
    imageViewportContainerSize.width > 0 &&
    imageViewportContainerSize.height > 0;
  const visibleZoom =
    isImageWorkspace && activeImageDocument ? activeImageDocument.viewport.zoom : zoom;
  // The bar wraps to extra rows when it can't fit one line (never scroll/overlap), so the primary
  // controls flow + wrap naturally rather than competing for flex space. No `ml-auto` — in a
  // flex-wrap row it forces a phantom early wrap (an empty second row even when everything fits).
  const primaryControlsFlexClass =
    'min-w-0 max-w-full flex-wrap max-[999px]:w-full max-[999px]:justify-start';
  const flowWorkspaceCommands = useFlowWorkspaceCommands();
  const flowTargetBinId = React.useMemo(() => {
    if (activeFlowSourceBinId && sourceBins.some((bin) => bin.id === activeFlowSourceBinId)) {
      return activeFlowSourceBinId;
    }

    return sourceBins[0]?.id ?? '';
  }, [activeFlowSourceBinId, sourceBins]);

  React.useEffect(() => {
    const updateFullscreenState = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', updateFullscreenState);

    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState);
    };
  }, []);

  React.useEffect(() => {
    if (!openMenuId) {
      return;
    }

    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node;
      // Guard BOTH the desktop menu bar and the mobile interface drawer — the
      // expanded phone app-menu renders in the drawer, not inside appMenuRef, so
      // without this every drawer tap counted as "outside" and dismissed it.
      if (
        appMenuRef.current?.contains(target)
        || mobileMenuRef.current?.contains(target)
        || menuPortalRef.current?.contains(target)
      ) {
        return;
      }

      setOpenMenuId(null);
    };

    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, [openMenuId]);

  const handleCopyFlow = async () => {
    try {
      await navigator.clipboard.writeText(exportFlow());
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  const toggleFullscreen = async () => {
    // Android WebView ignores the web Fullscreen API, so toggle native immersive mode.
    if (isAndroidNativeFullscreenAvailable()) {
      const next = !isFullscreen;
      try {
        const applied = await setAndroidFullscreen(next);
        setFullscreen(applied);
      } catch {
        // Leave the toggle state unchanged if the native call fails.
      }
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await document.documentElement.requestFullscreen();
  };

  const handleMenuCommand = (command: NativeMenuCommand, source: ActivityTrailSource = 'menu') => {
    setOpenMenuId(null);
    onMenuCommand?.(command, source);
  };

  const getNewFlowNodePosition = React.useCallback(() => (
    screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  ), [screenToFlowPosition]);

  const addEditorSourceBin = React.useCallback(() => {
    const id = addNode('sourceBin', getNewFlowNodePosition());
    setActiveSourceBinId(id);
  }, [addNode, getNewFlowNodePosition, setActiveSourceBinId]);

  const addEditorComposition = React.useCallback(() => {
    setActiveCompositionId(addNode('composition', getNewFlowNodePosition()));
  }, [addNode, getNewFlowNodePosition, setActiveCompositionId]);

  const addFlowNodeFromTopbar = React.useCallback((type: FlowNodeType, initialData?: Partial<NodeData>) => {
    addNode(type, getNewFlowNodePosition(), initialData);
  }, [addNode, getNewFlowNodePosition]);

  const insertFunctionLibraryEntry = React.useCallback((func: StandardLibraryFunction) => {
    addFlowNodeFromTopbar('functionNode', createFunctionNodeDataFromLibraryFunction(func));
    setFunctionLibraryOpen(false);
  }, [addFlowNodeFromTopbar]);

  const renderActiveComposition = React.useCallback(() => {
    if (!activeComposition || isCompositionRendering) {
      return;
    }

    void runNode(activeComposition.id);
  }, [activeComposition, isCompositionRendering, runNode]);

  const toggleVideoPanel = React.useCallback(
    (panel: VideoPanelVisibilityKey, visible: boolean) => {
      applyVideoDockablePanelVisibility(panel, visible, {
        dockPanel: dockVideoPanel,
        hidePanel: hideVideoPanel,
        setPanelVisibility,
      });
    },
    [dockVideoPanel, hideVideoPanel, setPanelVisibility],
  );

  const handleZoomOut = React.useCallback(() => {
    if (isImageWorkspace) {
      if (!activeImageDocument || !imageViewportReady) return;
      setImageViewport(
        activeImageDocument.id,
        zoomViewportStepAroundCenter(
          activeImageDocument.viewport,
          imageViewportContainerSize,
          'out',
        ),
      );
      return;
    }

    void zoomOut();
  }, [
    activeImageDocument,
    imageViewportContainerSize,
    imageViewportReady,
    isImageWorkspace,
    setImageViewport,
    zoomOut,
  ]);

  const handleZoomFit = React.useCallback(() => {
    if (isImageWorkspace) {
      if (!activeImageDocument || !imageViewportReady) return;
      setImageViewport(
        activeImageDocument.id,
        fitToContainer(
          { width: activeImageDocument.width, height: activeImageDocument.height },
          imageViewportContainerSize,
        ),
      );
      return;
    }

    void fitView({ padding: 0.2, duration: 300 });
  }, [
    activeImageDocument,
    fitView,
    imageViewportContainerSize,
    imageViewportReady,
    isImageWorkspace,
    setImageViewport,
  ]);

  const handleZoomIn = React.useCallback(() => {
    if (isImageWorkspace) {
      if (!activeImageDocument || !imageViewportReady) return;
      setImageViewport(
        activeImageDocument.id,
        zoomViewportStepAroundCenter(
          activeImageDocument.viewport,
          imageViewportContainerSize,
          'in',
        ),
      );
      return;
    }

    void zoomIn();
  }, [
    activeImageDocument,
    imageViewportContainerSize,
    imageViewportReady,
    isImageWorkspace,
    setImageViewport,
    zoomIn,
  ]);

  const renderMobileTopbarOverlays = () => (
    <>
      <ProjectLibraryModal
        isOpen={isProjectLibraryOpen}
        onClose={() => setProjectLibraryOpen(false)}
      />
      <ProjectHistoryModal
        isOpen={isProjectHistoryOpen}
        onClose={() => setProjectHistoryOpen(false)}
      />
      <FunctionLibraryDrawer
        builtInFunctions={getFunctionLibraryEntries([]).filter((entry) => entry.source !== 'custom')}
        customFunctions={customFunctionLibraryEntries}
        onClose={() => setFunctionLibraryOpen(false)}
        onInsertBuiltIn={insertFunctionLibraryEntry}
        onInsertCustom={insertFunctionLibraryEntry}
        open={isFunctionLibraryOpen}
      />
    </>
  );

  if (!mobilePhoneInterface.enabled && mobileChromeMode === 'hidden') {
    return (
      <>
        <button
          aria-label={t('nav.showInterface')}
          className="theme-topbar absolute left-3 top-3 z-[90] flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/30 bg-[#0b1421]/95 text-cyan-100 shadow-[0_10px_28px_rgba(0,0,0,0.35)] backdrop-blur-md"
          data-application-chrome-restore="true"
          onClick={restoreMobileInterface}
          type="button"
        >
          <Menu size={20} />
        </button>
        {renderMobileTopbarOverlays()}
      </>
    );
  }

  if (mobilePhoneInterface.enabled) {
    const drawerExpanded = mobileChromeMode === 'expanded' || activeMobileEdgeDrawer === 'top';

    if (mobileChromeMode === 'hidden') {
      return (
        <>
          <button
            aria-label={t('nav.showInterface')}
            className="theme-topbar absolute left-3 top-3 z-[90] flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/30 bg-[#0b1421]/95 text-cyan-100 shadow-[0_10px_28px_rgba(0,0,0,0.35)] backdrop-blur-md"
            data-mobile-phone-topbar="hidden"
            data-mobile-phone-orientation={mobilePhoneInterface.orientation}
            onClick={restoreMobileInterface}
            type="button"
          >
            <Menu size={20} />
          </button>
          {renderMobileTopbarOverlays()}
        </>
      );
    }

    return (
      <div
        className="theme-topbar absolute top-0 left-0 right-0 z-[80] flex flex-col overflow-hidden border-b shadow-[0_10px_28px_rgba(0,0,0,0.22)] transition-[max-height] duration-200"
        data-mobile-phone-topbar="true"
        data-mobile-phone-orientation={mobilePhoneInterface.orientation}
        data-mobile-phone-drawer={drawerExpanded ? 'expanded' : 'collapsed'}
        style={{ maxHeight: drawerExpanded ? mobilePhoneInterface.expandedDrawerMaxHeightCss : `${mobilePhoneInterface.topbarHeightPx}px` }}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 px-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-cyan-300/25 bg-[#0b1421] shadow-[0_0_18px_rgba(34,211,238,0.16)]">
            <img
              alt={`${workspaceView} Icon`}
              className="h-full w-full object-contain p-1.5"
              src={activeIcon}
            />
          </div>

          <div
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-full border border-cyan-300/10 bg-[#09101d]/65 p-1"
            data-mobile-workspace-switcher="true"
          >
            {WORKSPACE_TABS.map((tab) => {
              const isActive = workspaceView === tab.id;
              return (
                <button
                  aria-label={`${tab.label} ${t('nav.workspaceSuffix')}`}
                  className={`flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 transition-colors ${
                    isActive
                      ? tab.activeClass
                      : `border-transparent text-cyan-100/60 ${tab.hoverClass}`
                  }`}
                  key={tab.id}
                  onClick={() => handleMenuCommand(tab.command, 'topbar')}
                  title={`${tab.label} ${t('nav.workspaceSuffix')}`}
                  type="button"
                >
                  <img src={tab.icon} alt="" className="h-6 w-6 rounded-md object-contain" />
                  <span className="text-xs font-semibold">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <IconButton
            icon={drawerExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            label={drawerExpanded ? t('nav.drawer.collapse') : t('nav.drawer.expand')}
            onClick={() => toggleMobileEdgeDrawer('top')}
          />
          <IconButton
            icon={<EyeOff size={18} />}
            label={t('nav.hideInterface')}
            onClick={hideMobileInterface}
          />
        </div>

        {drawerExpanded ? (
          <div
            className="flex max-h-[calc(100vh-3rem)] flex-col gap-2 overflow-y-auto border-t border-cyan-300/15 p-2"
            data-mobile-interface-drawer-panel="true"
            ref={mobileMenuRef}
          >
            {showIntegratedMenu ? (
              <div className="grid grid-cols-3 gap-1" data-mobile-app-menu="true">
                {appMenuGroups.map((group) => (
                  <button
                    className="rounded-md border border-cyan-300/15 bg-cyan-400/10 px-2 py-2 text-xs font-semibold text-cyan-50 transition-colors hover:border-cyan-300/40"
                    key={group.id}
                    onClick={() => setOpenMenuId((current) => current === group.id ? null : group.id)}
                    type="button"
                  >
                    {group.label}
                  </button>
                ))}
              </div>
            ) : null}

            {openMenuId ? (
              <div className="grid gap-1 rounded-lg border border-cyan-300/15 bg-[#0d1725] p-1" data-mobile-app-menu-items="true">
                {appMenuGroups.find((group) => group.id === openMenuId)?.items.map((item) => (
                  <button
                    className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-cyan-50/80 transition-colors hover:bg-cyan-400/10 hover:text-white"
                    key={item.command}
                    onClick={() => handleMenuCommand(item.command)}
                    type="button"
                  >
                    <span>{item.label}</span>
                    {item.shortcut ? <span className="text-xs text-cyan-100/35">{item.shortcut}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}

            {workspaceView === 'flow' ? (
              <div className="overflow-x-auto rounded-lg border border-cyan-300/10 bg-[#09101d]/65 p-1" data-mobile-flow-toolbar="true">
                <BottomToolbar onAddNode={addFlowNodeFromTopbar} onImportNodePack={onImportNodePack} onInsertStarterTemplate={onInsertStarterTemplate} variant="topbar" />
              </div>
            ) : null}

            {isPaperWorkspace ? (
              <div
                className="min-h-10 overflow-x-auto rounded-lg border border-cyan-300/10 bg-[#09101d]/65 p-1"
                data-mobile-paper-topbar-slot="true"
                id={PAPER_TOPBAR_SLOT_ID}
              />
            ) : null}

            {workspaceView === 'editor' ? (
              <MobileEditorPanelControls
                inspectorVisible={inspectorVisible}
                isCompositionRendering={isCompositionRendering}
                onAddComposition={addEditorComposition}
                onAddSourceBin={addEditorSourceBin}
                onHelp={() => dispatchNativeRendererCommand('help:keyboard-shortcuts')}
                onRedo={() => dispatchNativeRendererCommand('edit:redo')}
                onRender={renderActiveComposition}
                onTogglePanel={toggleVideoPanel}
                onUndo={() => dispatchNativeRendererCommand('edit:undo')}
                programMonitorVisible={programMonitorVisible}
                renderDisabled={!activeComposition?.id || isCompositionRendering}
                sourceBinVisible={sourceBinVisible}
                sourceMonitorVisible={sourceMonitorVisible}
              />
            ) : null}

            <div className="grid grid-cols-2 gap-2" data-mobile-primary-actions="true">
              <EditBatonControl variant="mobile" />
              {showGenericViewportControls ? (
                <div className="theme-control col-span-2 flex items-center justify-between rounded-lg border px-2 py-1">
                  <span className="px-2 text-sm font-semibold text-cyan-100/70">{Math.round(visibleZoom * 100)}%</span>
                  <div className="flex items-center gap-1">
                    <IconButton
                      disabled={isImageWorkspace && !imageViewportReady}
                      icon={<Minus size={16} />}
                      label={t('nav.zoom.out')}
                      onClick={handleZoomOut}
                    />
                    <button
                      className="rounded-full px-2.5 py-2 text-sm text-cyan-100/75 transition-colors hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:text-cyan-100/30 disabled:hover:bg-transparent"
                      disabled={isImageWorkspace && !imageViewportReady}
                      onClick={handleZoomFit}
                      type="button"
                    >
                      {t('nav.zoom.fit')}
                    </button>
                    <IconButton
                      disabled={isImageWorkspace && !imageViewportReady}
                      icon={<Plus size={16} />}
                      label={t('nav.zoom.in')}
                      onClick={handleZoomIn}
                    />
                  </div>
                </div>
              ) : null}

              <MobileDrawerActionButton icon={<Command size={16} />} label={t('nav.commands')} onClick={() => handleMenuCommand('view:command-palette', 'topbar')} />
              <MobileDrawerActionButton icon={<FolderOpen size={16} />} label={t('nav.projects')} onClick={() => setProjectLibraryOpen(true)} />
              <MobileDrawerActionButton icon={isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />} label={isFullscreen ? t('nav.fullscreen.exitShort') : t('nav.fullscreen.enterShort')} onClick={() => void toggleFullscreen()} />
              <MobileDrawerActionButton icon={<Settings size={16} />} label={t('common.settings')} onClick={toggleSettings} />
              {lanServerAvailable ? (
                <MobileDrawerActionButton
                  active={lanServerEnabled}
                  icon={lanServerEnabled ? <Wifi size={16} /> : <WifiOff size={16} />}
                  label={lanServerEnabled ? t('nav.serving') : t('nav.serveToDesktop')}
                  onClick={() => {
                    if (!lanServerEnabled) {
                      setProviderSetting('androidLanServerEnabled', true);
                    }
                    setActiveMobileEdgeDrawer(null);
                    window.dispatchEvent(new Event(OPEN_ANDROID_LAN_SERVER_EVENT));
                  }}
                />
              ) : null}

              {workspaceView === 'flow' ? (
                <>
                  <MobileDrawerActionButton icon={<Library size={16} />} label={t('nav.functions')} onClick={() => setFunctionLibraryOpen(true)} />
                  <MobileDrawerActionButton
                    icon={<Download size={16} />}
                    label={copyState === 'copied' ? t('nav.export.copied') : copyState === 'error' ? t('nav.export.failed') : t('nav.export')}
                    onClick={() => void handleCopyFlow()}
                  />
                </>
              ) : null}
            </div>
            <UsageBar placement="mobile-drawer" workspaceView={workspaceView} />
          </div>
        ) : null}

        {renderMobileTopbarOverlays()}
      </div>
    );
  }

  return (
    <>
    <div className="theme-topbar relative z-[80] flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.22)]">
      <div
        className="pointer-events-none relative z-20 flex items-center gap-2"
        data-topbar-left-controls="true"
      >
        {showIntegratedMenu && appMenuStyle === 'compact' ? (
          <div
            ref={appMenuRef}
            className="pointer-events-auto relative flex shrink-0 items-center border-r border-cyan-300/15 pr-2"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpenMenuId(null);
              }
            }}
          >
            <button
              aria-expanded={openMenuId === '__app__'}
              aria-label={t('nav.appMenu')}
              className={`flex items-center gap-1 rounded px-2 py-1.5 text-cyan-100/70 transition-colors hover:bg-cyan-400/10 hover:text-white ${
                openMenuId === '__app__' ? 'bg-cyan-400/10 text-white' : ''
              }`}
              onClick={(event) => {
                setMenuAnchorRect(event.currentTarget.getBoundingClientRect());
                setOpenMenuId((current) => (current === '__app__' ? null : '__app__'));
              }}
              title={t('nav.menu')}
              type="button"
            >
              <Menu size={16} />
              <ChevronDown size={12} className="opacity-60" />
            </button>
            {openMenuId === '__app__' && menuAnchorRect
              ? createPortal(
                  <div
                    className="fixed z-[200] max-h-[72vh] min-w-60 overflow-y-auto rounded-md border border-cyan-300/20 bg-[#0d1725] py-1 shadow-2xl shadow-black/40"
                    ref={menuPortalRef}
                    style={{ top: menuAnchorRect.bottom + 6, left: menuAnchorRect.left }}
                  >
                    {appMenuGroups.map((group, groupIndex) => (
                      <div className={groupIndex > 0 ? 'mt-1 border-t border-cyan-300/10 pt-1' : ''} key={group.id}>
                        <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/40">
                          {group.label}
                        </div>
                        {group.items.map((item) => (
                          <button
                            className="flex w-full items-center justify-between gap-5 px-3 py-1.5 text-left text-sm text-cyan-50/80 transition-colors hover:bg-cyan-400/10 hover:text-white"
                            key={item.command}
                            onClick={() => {
                              handleMenuCommand(item.command);
                              setOpenMenuId(null);
                            }}
                            type="button"
                          >
                            <span>{item.label}</span>
                            {item.shortcut ? (
                              <span className="text-xs text-cyan-100/35">{item.shortcut}</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ))}
                    <div className="mt-1 border-t border-cyan-300/10 pt-1">
                      <button
                        className="flex w-full items-center px-3 py-1.5 text-left text-xs font-medium text-cyan-100/55 transition-colors hover:bg-cyan-400/10 hover:text-white"
                        data-app-menu-style-switch="menubar"
                        onClick={() => {
                          setAppMenuStyle('menubar');
                          setOpenMenuId(null);
                        }}
                        type="button"
                      >
                        {t('nav.switchToClassicMenu')}
                      </button>
                    </div>
                  </div>,
                  document.body,
                )
              : null}
          </div>
        ) : null}

        <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full border border-cyan-300/10 bg-[#09101d]/65 p-1 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md" data-testid="workspace-switcher">
          {WORKSPACE_TABS.map((tab) => {
            const isActive = workspaceView === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleMenuCommand(tab.command, 'topbar')}
                className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold tracking-wide border transition-all duration-300 ${
                  isActive
                    ? tab.activeClass
                    : `border-transparent text-cyan-100/50 ${tab.hoverClass}`
                }`}
                title={`${tab.label} ${t('nav.workspaceSuffix')} — ${t(tab.descKey)}`}
                type="button"
              >
                <img
                  src={tab.icon}
                  alt={tab.label}
                  className="h-5 w-5 rounded-md object-contain transition-transform duration-300 group-hover:scale-110"
                />
                {isActive && (
                  <span className={`h-1.5 w-1.5 rounded-full ${tab.dotClass} shrink-0 animate-pulse`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {workspaceView === 'flow' ? (
        <div
          className="pointer-events-none relative z-10 flex min-w-0 shrink items-center"
          data-flow-node-toolbar-layer="true"
        >
          <div className="pointer-events-auto flex flex-wrap items-center">
            <BottomToolbar onAddNode={addFlowNodeFromTopbar} onImportNodePack={onImportNodePack} onInsertStarterTemplate={onInsertStarterTemplate} variant="topbar" />
          </div>
        </div>
      ) : null}

      {isPaperWorkspace ? (
        <div
          className="flex min-w-0 flex-1 items-center overflow-hidden"
          id={PAPER_TOPBAR_SLOT_ID}
        />
      ) : null}

      {workspaceView === 'image' ? (
        <div
          className="pointer-events-auto relative z-10 flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto [scrollbar-width:none]"
          id={IMAGE_TOPBAR_CENTER_SLOT_ID}
        />
      ) : null}

      {/* Empty, collapsible spacer right-pins the primary controls without a content-bearing
          flex-grow element eating the line (which wrapped them to a phantom row, worse the wider
          the window). basis-0 means it can't push anything to a new line; it just fills slack. */}
      {workspaceView === 'flow' ? <div className="pointer-events-none flex-1" aria-hidden="true" /> : null}

      <div
        className={`pointer-events-none relative z-20 flex shrink-0 items-center justify-end gap-2 ${primaryControlsFlexClass}`}
        data-topbar-primary-controls="true"
      >
        <EditBatonControl />
        {workspaceView === 'image' ? (
          <div
            className="pointer-events-auto flex shrink-0 items-center"
            id={IMAGE_TOPBAR_RIGHT_SLOT_ID}
          />
        ) : null}
        {workspaceView === 'editor' ? (
          <EditorTitlebarControls
            activeCompositionId={activeComposition?.id}
            compositionOptions={compositionNodes.map((node) => ({ value: node.id, label: node.id }))}
            inspectorVisible={inspectorVisible}
            isCompositionRendering={isCompositionRendering}
            onAddComposition={addEditorComposition}
            onAddSourceBin={addEditorSourceBin}
            onCompositionChange={(value) => setActiveCompositionId(value || undefined)}
            onHelp={() => dispatchNativeRendererCommand('help:keyboard-shortcuts')}
            onRedo={() => dispatchNativeRendererCommand('edit:redo')}
            onRender={renderActiveComposition}
            onTogglePanel={toggleVideoPanel}
            onUndo={() => dispatchNativeRendererCommand('edit:undo')}
            programMonitorVisible={programMonitorVisible}
            sourceBinCount={sourceBinItemCount}
            sourceBinNodeCount={sourceBinNodeCount}
            sourceBinVisible={sourceBinVisible}
            sourceMonitorVisible={sourceMonitorVisible}
          />
        ) : null}

        {workspaceView === 'flow' && sourceBins.length > 0 ? (
          <label
            className="theme-control pointer-events-auto flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-sm text-cyan-50/80"
            title={t('nav.targetSourceBin')}
          >
            <Library size={15} />
            <select
              aria-label={t('nav.targetSourceBin')}
              className="max-w-44 bg-transparent text-sm text-cyan-50 outline-none"
              onChange={(event) => onActiveFlowSourceBinChange?.(event.target.value || undefined)}
              value={flowTargetBinId}
            >
              {sourceBins.map((bin) => (
                <option className="bg-[#0d1725] text-cyan-50" key={bin.id} value={bin.id}>
                  {bin.name} ({bin.items.length})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="theme-control pointer-events-auto flex max-w-full shrink-0 flex-wrap items-center gap-2 rounded-2xl border px-2 py-1.5 min-[1000px]:rounded-full">
          {showGenericViewportControls ? (
            <>
              <div className="theme-border theme-muted-text hidden min-w-16 items-center justify-center border-r px-2 text-sm min-[2000px]:flex">
                {Math.round(visibleZoom * 100)}%
              </div>

              <IconButton
                disabled={isImageWorkspace && !imageViewportReady}
                icon={<Minus size={16} />}
                label={t('nav.zoom.out')}
                onClick={handleZoomOut}
              />
              <button
                className="rounded-full px-2.5 py-2 text-sm text-cyan-100/75 transition-colors hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:text-cyan-100/30 disabled:hover:bg-transparent"
                disabled={isImageWorkspace && !imageViewportReady}
                onClick={handleZoomFit}
                type="button"
              >
                {t('nav.zoom.fit')}
              </button>
              <IconButton
                disabled={isImageWorkspace && !imageViewportReady}
                icon={<Plus size={16} />}
                label={t('nav.zoom.in')}
                onClick={handleZoomIn}
              />

              <div className="mx-0.5 h-5 w-px bg-cyan-300/15" />
            </>
          ) : null}

          <IconButton
            icon={isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            label={isFullscreen ? t('nav.fullscreen.exit') : t('nav.fullscreen.enter')}
            onClick={() => void toggleFullscreen()}
          />
          <IconButton
            icon={<Command size={16} />}
            label={t('nav.commandPalette')}
            onClick={() => handleMenuCommand('view:command-palette', 'topbar')}
          />

          <div className="mx-0.5 h-5 w-px bg-cyan-300/15" />

          <button
            className="flex items-center gap-2 rounded-full px-2.5 py-2 text-sm text-cyan-100/75 transition-colors hover:bg-cyan-400/10 hover:text-white"
            onClick={() => setProjectLibraryOpen(true)}
            title={t('nav.projects.tooltip')}
            type="button"
          >
            <FolderOpen size={16} />
            <span className="hidden min-[2000px]:inline">{t('nav.projects')}</span>
          </button>

          <button
            className="flex items-center gap-2 rounded-full px-2.5 py-2 text-sm text-cyan-100/75 transition-colors hover:bg-cyan-400/10 hover:text-white"
            onClick={() => setProjectHistoryOpen(true)}
            title={t('nav.history.tooltip')}
            type="button"
          >
            <History size={16} />
            <span className="hidden min-[2000px]:inline">{t('nav.history')}</span>
          </button>

          <WorkspaceLayoutControl workspaceView={workspaceView} />

          {workspaceView === 'flow' ? (
            <FlowWorkspaceSwitcher
              activeWorkspaceId={flowWorkspaceCommands.activeWorkspaceId}
              onCreateWorkspace={() => {
                void flowWorkspaceCommands.handleCreateWorkspace();
              }}
              onSelectWorkspace={flowWorkspaceCommands.handleSelectWorkspace}
              workspaces={flowWorkspaceCommands.workspaces}
            />
          ) : null}

          {workspaceView === 'flow' ? (
            <button
              className="flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2.5 py-2 text-sm font-semibold text-emerald-100 transition-colors hover:border-emerald-100/70 hover:bg-emerald-300/25 hover:text-white"
              onClick={() => setFunctionLibraryOpen(true)}
              title={t('nav.functions.tooltip')}
              type="button"
            >
              <Library size={16} />
              <span className="hidden min-[2000px]:inline">{t('nav.functions')}</span>
            </button>
          ) : null}

          {workspaceView === 'flow' ? (
            <button
              className="flex items-center gap-2 rounded-full px-2.5 py-2 text-sm text-cyan-100/75 transition-colors hover:bg-cyan-400/10 hover:text-white"
              onClick={() => void handleCopyFlow()}
              title={t('nav.export.tooltip')}
              type="button"
            >
              <Download size={16} />
              <span className="hidden min-[2000px]:inline">{copyState === 'copied' ? t('nav.export.copied') : copyState === 'error' ? t('nav.export.failed') : t('nav.export')}</span>
            </button>
          ) : null}

          {workspaceView === 'flow' && flowWorkspaceMetricLabel ? (
            <span
              className="hidden rounded-full border border-cyan-300/15 px-2.5 py-2 text-[11px] text-cyan-100/45 3xl:inline"
              data-testid="flow-workspace-metrics"
            >
              {flowWorkspaceMetricLabel}
            </span>
          ) : null}

          <IconButton icon={<Settings size={16} />} label={t('nav.providerSettings')} onClick={toggleSettings} />
          <UsageBar placement="topbar" workspaceView={workspaceView} />
        </div>
      </div>

      <ProjectLibraryModal
        isOpen={isProjectLibraryOpen}
        onClose={() => setProjectLibraryOpen(false)}
      />
      <ProjectHistoryModal
        isOpen={isProjectHistoryOpen}
        onClose={() => setProjectHistoryOpen(false)}
      />
      <FunctionLibraryDrawer
        builtInFunctions={getFunctionLibraryEntries([]).filter((entry) => entry.source !== 'custom')}
        customFunctions={customFunctionLibraryEntries}
        onClose={() => setFunctionLibraryOpen(false)}
        onInsertBuiltIn={insertFunctionLibraryEntry}
        onInsertCustom={insertFunctionLibraryEntry}
        open={isFunctionLibraryOpen}
      />
    </div>
    {showIntegratedMenu && appMenuStyle === 'menubar' ? (
      <AppClassicMenuBar
        groups={appMenuGroups}
        onCommand={(command) => handleMenuCommand(command)}
        onSwitchToCompact={() => setAppMenuStyle('compact')}
      />
    ) : null}
    </>
  );
};

interface IconButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

type EditorPanelVisibilityKey = 'sourceMonitorVisible' | 'programMonitorVisible' | 'inspectorVisible' | 'sourceBinVisible';

function EditorTitlebarControls({
  activeCompositionId,
  compositionOptions,
  inspectorVisible,
  isCompositionRendering,
  onAddComposition,
  onAddSourceBin,
  onCompositionChange,
  onHelp,
  onRedo,
  onRender,
  onTogglePanel,
  onUndo,
  programMonitorVisible,
  sourceBinCount,
  sourceBinNodeCount,
  sourceBinVisible,
  sourceMonitorVisible,
}: {
  activeCompositionId?: string;
  compositionOptions: Array<{ value: string; label: string }>;
  inspectorVisible: boolean;
  isCompositionRendering: boolean;
  onAddComposition: () => void;
  onAddSourceBin: () => void;
  onCompositionChange: (value: string) => void;
  onHelp: () => void;
  onRedo: () => void;
  onRender: () => void;
  onTogglePanel: (panel: EditorPanelVisibilityKey, visible: boolean) => void;
  onUndo: () => void;
  programMonitorVisible: boolean;
  sourceBinCount: number;
  sourceBinNodeCount: number;
  sourceBinVisible: boolean;
  sourceMonitorVisible: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="pointer-events-auto hidden min-w-0 flex-1 items-center justify-end gap-1.5 overflow-hidden xl:flex">
      <div className="hidden shrink-0 rounded-md border border-cyan-300/15 bg-[#101a29]/85 px-2 py-1 text-[11px] font-medium text-cyan-100/75 min-[1800px]:block">
        {t('video.sourceLibrary')} · {sourceBinCount} {t('video.assetsUnit')} · {sourceBinNodeCount} {t('video.binsUnit')}
      </div>
      <select
        className="hidden h-8 max-w-52 rounded-md border border-cyan-300/15 bg-[#0b121d] px-2 text-[11px] font-semibold text-gray-200 outline-none transition-colors hover:border-cyan-300/35 focus:border-cyan-300/60 min-[1800px]:block"
        onChange={(event) => onCompositionChange(event.target.value)}
        title={t('video.activeComposition')}
        value={activeCompositionId ?? ''}
      >
        <option value="">{t('video.noCompositions')}</option>
        {compositionOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <TitlebarActionButton icon={<Undo2 size={12} />} label={t('common.undo')} onClick={onUndo} title={t('video.undoEdit')} />
      <TitlebarActionButton icon={<Redo2 size={12} />} label={t('common.redo')} onClick={onRedo} title={t('video.redoEdit')} />
      <TitlebarActionButton icon={<Plus size={12} />} label={t('video.sourceBin')} onClick={onAddSourceBin} />
      <TitlebarActionButton icon={<Plus size={12} />} label={t('video.composition')} onClick={onAddComposition} />
      <button
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-white px-2.5 text-[11px] font-semibold text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-500/30 disabled:text-white"
        disabled={!activeCompositionId || isCompositionRendering}
        onClick={onRender}
        type="button"
      >
        <Play size={12} fill="currentColor" />
        <span className="hidden min-[1700px]:inline">{isCompositionRendering ? t('video.rendering') : t('video.render')}</span>
      </button>
      <div className="mx-0.5 h-5 w-px shrink-0 bg-cyan-300/15" />
      <PanelToggleButton
        active={sourceBinVisible}
        label={t('video.panel.bin')}
        onClick={() => onTogglePanel('sourceBinVisible', !sourceBinVisible)}
      />
      <PanelToggleButton
        active={sourceMonitorVisible}
        label={t('video.panel.source')}
        onClick={() => onTogglePanel('sourceMonitorVisible', !sourceMonitorVisible)}
      />
      <PanelToggleButton
        active={programMonitorVisible}
        label={t('video.panel.program')}
        onClick={() => onTogglePanel('programMonitorVisible', !programMonitorVisible)}
      />
      <PanelToggleButton
        active={inspectorVisible}
        label={t('video.panel.inspector')}
        onClick={() => onTogglePanel('inspectorVisible', !inspectorVisible)}
      />
      <button
        className="inline-flex h-7 shrink-0 items-center rounded-full border border-cyan-300/15 bg-[#101a29]/70 px-2 text-[10px] font-semibold text-cyan-100/75 transition-colors hover:border-cyan-300/40 hover:text-white"
        onClick={onHelp}
        type="button"
      >
        {t('common.help')}
      </button>
    </div>
  );
}

function TitlebarActionButton({
  icon,
  label,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 text-[11px] font-semibold text-cyan-100/75 transition-colors hover:border-cyan-300/40 hover:text-white"
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      {icon}
      <span className="hidden min-[1800px]:inline">{label}</span>
    </button>
  );
}

function PanelToggleButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-7 shrink-0 items-center rounded-full border px-2 text-[10px] font-semibold transition-colors ${
        active
          ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100'
          : 'border-cyan-300/10 bg-[#101a29]/50 text-cyan-100/45 hover:border-cyan-300/30 hover:text-cyan-100'
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function MobileEditorPanelControls({
  inspectorVisible,
  isCompositionRendering,
  onAddComposition,
  onAddSourceBin,
  onHelp,
  onRedo,
  onRender,
  onTogglePanel,
  onUndo,
  programMonitorVisible,
  renderDisabled,
  sourceBinVisible,
  sourceMonitorVisible,
}: {
  inspectorVisible: boolean;
  isCompositionRendering: boolean;
  onAddComposition: () => void;
  onAddSourceBin: () => void;
  onHelp: () => void;
  onRedo: () => void;
  onRender: () => void;
  onTogglePanel: (panel: EditorPanelVisibilityKey, visible: boolean) => void;
  onUndo: () => void;
  programMonitorVisible: boolean;
  renderDisabled: boolean;
  sourceBinVisible: boolean;
  sourceMonitorVisible: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-cyan-300/10 bg-[#09101d]/65 p-2" data-mobile-video-controls="true">
      <MobileDrawerActionButton icon={<Undo2 size={16} />} label={t('common.undo')} onClick={onUndo} />
      <MobileDrawerActionButton icon={<Redo2 size={16} />} label={t('common.redo')} onClick={onRedo} />
      <MobileDrawerActionButton icon={<Plus size={16} />} label={t('video.sourceBin')} onClick={onAddSourceBin} />
      <MobileDrawerActionButton icon={<Plus size={16} />} label={t('video.composition')} onClick={onAddComposition} />
      <button
        className="col-span-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-white px-3 text-sm font-semibold text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-500/30 disabled:text-white"
        disabled={renderDisabled}
        onClick={onRender}
        type="button"
      >
        <Play size={14} fill="currentColor" />
        {isCompositionRendering ? t('video.rendering') : t('video.render')}
      </button>
      <PanelToggleButton
        active={sourceBinVisible}
        label={t('video.panel.bin')}
        onClick={() => onTogglePanel('sourceBinVisible', !sourceBinVisible)}
      />
      <PanelToggleButton
        active={sourceMonitorVisible}
        label={t('video.panel.source')}
        onClick={() => onTogglePanel('sourceMonitorVisible', !sourceMonitorVisible)}
      />
      <PanelToggleButton
        active={programMonitorVisible}
        label={t('video.panel.program')}
        onClick={() => onTogglePanel('programMonitorVisible', !programMonitorVisible)}
      />
      <PanelToggleButton
        active={inspectorVisible}
        label={t('video.panel.inspector')}
        onClick={() => onTogglePanel('inspectorVisible', !inspectorVisible)}
      />
      <MobileDrawerActionButton icon={<Command size={16} />} label={t('common.help')} onClick={onHelp} />
    </div>
  );
}

function MobileDrawerActionButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`theme-control inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
        active ? 'border-cyan-300/60 bg-cyan-400/15 text-white' : 'text-cyan-100/80 hover:text-white'
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function IconButton({ disabled = false, icon, label, onClick }: IconButtonProps) {
  return (
    <button
      className="rounded-full p-2 text-cyan-100/60 transition-colors hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:text-cyan-100/25 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
    </button>
  );
}
