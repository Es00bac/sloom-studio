import {
  ArrowLeftRight,
  Bandage,
  Blend,
  CircleOff,
  Circle,
  Crop,
  Droplet,
  Eraser,
  Focus,
  Hand,
  ImageOff,
  Lasso,
  MousePointer2,
  Moon,
  Paintbrush,
  PaintBucket,
  Palette,
  PenTool,
  Pipette,
  RotateCcw,
  Sparkles,
  Stamp,
  Square,
  SquareDashed,
  Sun,
  Type,
  Wand2,
  Wind,
  Undo2,
  Redo2,
  Scissors,
  Copy,
  ClipboardPaste,
} from 'lucide-react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { copyActiveImageSelection, cutActiveImageSelection, pasteImageClipboard } from './imageClipboardActions';
import { redo, undo } from './undoRedoApply';
import { recordActivityTrailWorkspaceEvent } from '../../store/activityTrailStore';
import type { EditorTool } from '../../types/imageEditor';
import { AdvancedColorPicker } from '../Common/AdvancedColorPicker';
import {
  IMAGE_EDITOR_TOOL_DEFINITIONS,
  getImageEditorToolbarCustomOrderSignature,
  getImageEditorToolbarFlyoutGroups,
  getImageEditorToolbarFlyoutSignature,
  getImageEditorToolbarGroupingSignature,
} from './imageEditorTools';

const TOOL_DEFINITION_BY_TOOL = new Map(IMAGE_EDITOR_TOOL_DEFINITIONS.map((definition) => [definition.tool, definition]));
const TOOLBAR_DRAG_MIME = 'application/x-signal-loom-image-toolbar-slot';

export function ImageEditorToolbar() {
  const tool = useImageEditorStore((s) => s.tool);
  const setTool = useImageEditorStore((s) => s.setTool);
  const foregroundColor = useImageEditorStore((s) => s.brushSettings.color);
  const backgroundColor = useImageEditorStore((s) => s.backgroundColor);
  const setBrushSettings = useImageEditorStore((s) => s.setBrushSettings);
  const setBackgroundColor = useImageEditorStore((s) => s.setBackgroundColor);
  const swapForegroundBackgroundColors = useImageEditorStore((s) => s.swapForegroundBackgroundColors);
  const resetForegroundBackgroundColors = useImageEditorStore((s) => s.resetForegroundBackgroundColors);
  const toolbarFlyoutOrder = useImageEditorStore((s) => s.toolbarFlyoutOrder);
  const setToolbarFlyoutOrder = useImageEditorStore((s) => s.setToolbarFlyoutOrder);
  const activeDocId = useImageEditorStore((s) => s.activeDocId);
  const canUndo = useImageEditorStore((s) => (s.activeDocId ? (s.undoStacks[s.activeDocId]?.length ?? 0) > 0 : false));
  const canRedo = useImageEditorStore((s) => (s.activeDocId ? (s.redoStacks[s.activeDocId]?.length ?? 0) > 0 : false));
  const toolsCollapsed = useImageEditorStore((s) => s.toolsCollapsed);
  const toolbarFlyoutGroups = getImageEditorToolbarFlyoutGroups(toolbarFlyoutOrder);
  const editActions: Array<{ id: string; label: string; icon: React.ReactNode; onActivate: () => void; disabled?: boolean }> = [
    { id: 'undo', label: 'Undo', icon: <Undo2 size={16} />, onActivate: () => { if (activeDocId) undo(activeDocId); }, disabled: !canUndo },
    { id: 'redo', label: 'Redo', icon: <Redo2 size={16} />, onActivate: () => { if (activeDocId) redo(activeDocId); }, disabled: !canRedo },
    { id: 'cut', label: 'Cut', icon: <Scissors size={16} />, onActivate: () => { cutActiveImageSelection(); }, disabled: !activeDocId },
    { id: 'copy', label: 'Copy', icon: <Copy size={16} />, onActivate: () => { copyActiveImageSelection(); }, disabled: !activeDocId },
    { id: 'paste', label: 'Paste', icon: <ClipboardPaste size={16} />, onActivate: () => { pasteImageClipboard(); }, disabled: !activeDocId },
  ];
  const toolbarOrderSignature = getImageEditorToolbarCustomOrderSignature(toolbarFlyoutOrder);
  const icons: Record<EditorTool, React.ReactNode> = {
    move: <MousePointer2 size={16} />,
    hand: <Hand size={16} />,
    marquee: <SquareDashed size={16} />,
    lasso: <Lasso size={16} />,
    magicWand: <Wand2 size={16} />,
    brush: <Paintbrush size={16} />,
    eraser: <Eraser size={16} />,
    backgroundEraser: <ImageOff size={16} />,
    magicEraser: <Sparkles size={16} />,
    cloneStamp: <Stamp size={16} />,
    spotHeal: <Bandage size={16} />,
    blurBrush: <Droplet size={16} />,
    sharpenBrush: <Focus size={16} />,
    smudgeBrush: <Wind size={16} />,
    dodgeBrush: <Sun size={16} />,
    burnBrush: <Moon size={16} />,
    spongeSaturateBrush: <Palette size={16} />,
    spongeDesaturateBrush: <CircleOff size={16} />,
    paintBucket: <PaintBucket size={16} />,
    gradientTool: <Blend size={16} />,
    pen: <PenTool size={16} />,
    rectShape: <Square size={16} />,
    ellipseShape: <Circle size={16} />,
    crop: <Crop size={16} />,
    text: <Type size={16} />,
    eyedropper: <Pipette size={16} />,
  };
  const selectTool = (nextTool: EditorTool) => {
    const definition = TOOL_DEFINITION_BY_TOOL.get(nextTool);
    if (!definition) return;

    setTool(nextTool);
    recordActivityTrailWorkspaceEvent('image', 'Select Image tool', definition.label, 'toolbar');
  };
  const reorderToolbarSlot = (draggedId: string, targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const currentOrder = toolbarFlyoutGroups.map((group) => group.id);
    const from = currentOrder.indexOf(draggedId as never);
    const to = currentOrder.indexOf(targetId as never);
    if (from < 0 || to < 0) return;
    const nextOrder = [...currentOrder];
    const [dragged] = nextOrder.splice(from, 1);
    nextOrder.splice(to, 0, dragged);
    setToolbarFlyoutOrder(nextOrder);
  };

  return (
    <div
      aria-label="Image tools"
      className="w-[64px] bg-[#151720]"
      data-image-editor-toolbar-customization="user-reorderable-flyout-groups"
      data-image-editor-toolbar-custom-order-signature={toolbarOrderSignature}
      data-image-editor-toolbar-flyout-footprint="absolute-overlay"
      data-image-editor-toolbar-flyout-signature={getImageEditorToolbarFlyoutSignature(toolbarFlyoutOrder)}
      data-image-editor-toolbar-grouping-signature={getImageEditorToolbarGroupingSignature()}
      data-image-editor-tools-panel="true"
      role="toolbar"
    >
      {!toolsCollapsed && (
        <div className="grid grid-cols-2 gap-0 border-b border-[#252936]" data-image-editor-edit-actions="true">
        {editActions.map((action) => (
          <button
            aria-label={action.label}
            className="flex h-8 w-8 items-center justify-center rounded-none border border-[#252936] bg-[#151720] text-cyan-100/55 transition-colors hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            disabled={action.disabled}
            key={action.id}
            onClick={action.onActivate}
            title={action.label}
            type="button"
          >
            {action.icon}
          </button>
        ))}
      </div>
      )}
      {!toolsCollapsed && (
        <div className="grid grid-cols-2 gap-0" data-image-editor-tools-grid="true">
        {toolbarFlyoutGroups.map((group) => {
          const activeTool = group.tools.includes(tool) ? tool : group.primaryTool;
          const activeDefinition = TOOL_DEFINITION_BY_TOOL.get(activeTool);
          if (!activeDefinition) return null;

          const flyoutId = `image-tool-flyout-${group.id}`;
          const hasFlyout = group.hasFlyout;
          const slotActive = group.tools.includes(tool);

          return (
            <div
              className="group relative h-8 w-8"
              data-image-editor-tool-slot={group.id}
              data-image-editor-tool-slot-primary={group.primaryTool}
              data-image-editor-tool-slot-reorderable="true"
              draggable
              key={group.id}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData(TOOLBAR_DRAG_MIME, group.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                reorderToolbarSlot(event.dataTransfer.getData(TOOLBAR_DRAG_MIME), group.id);
              }}
            >
              <button
                aria-controls={hasFlyout ? flyoutId : undefined}
                aria-expanded={hasFlyout ? false : undefined}
                aria-haspopup={hasFlyout ? 'menu' : undefined}
                aria-label={hasFlyout ? `${group.label} tools: ${activeDefinition.label}` : `${activeDefinition.label} tool`}
                className={`relative flex h-8 w-8 items-center justify-center rounded-none border border-[#252936] transition-colors ${
                  slotActive
                    ? 'bg-cyan-400 text-slate-950'
                    : 'bg-[#151720] text-cyan-100/55 hover:bg-cyan-400/10 hover:text-white'
                }`}
                data-image-editor-tool-active-member={activeTool}
                data-image-editor-tool-flyout-trigger={hasFlyout ? 'true' : undefined}
                data-image-editor-tool-slot-button="true"
                onClick={() => selectTool(activeTool)}
                title={
                  hasFlyout
                    ? `${group.label}: ${activeDefinition.label} (${activeDefinition.shortcut})`
                    : `${activeDefinition.label} (${activeDefinition.shortcut})`
                }
                type="button"
              >
                {icons[activeTool]}
                {hasFlyout ? (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 border-b border-r border-current opacity-70"
                    data-image-editor-tool-flyout-corner="true"
                  />
                ) : null}
              </button>

              {hasFlyout ? (
                <div
                  aria-label={`${group.label} tools flyout`}
                  className="absolute left-full top-0 z-[80] hidden min-w-36 grid-cols-1 border border-cyan-300/20 bg-[#111722] shadow-xl shadow-black/35 group-focus-within:grid group-hover:grid"
                  data-image-editor-tool-flyout-footprint={group.footprint}
                  data-image-editor-tool-flyout-group={group.id}
                  data-image-editor-tool-flyout-tools={group.tools.join(',')}
                  id={flyoutId}
                  role="menu"
                >
                  {group.tools.map((flyoutTool) => {
                    const definition = TOOL_DEFINITION_BY_TOOL.get(flyoutTool);
                    if (!definition) return null;

                    return (
                      <button
                        aria-label={`${definition.label} tool`}
                        className={`flex h-7 min-w-36 items-center gap-2 border-b border-cyan-300/10 px-2 text-left text-[11px] last:border-b-0 ${
                          tool === flyoutTool
                            ? 'bg-cyan-400 text-slate-950'
                            : 'bg-[#111722] text-cyan-100/75 hover:bg-cyan-400/10 hover:text-white'
                        }`}
                        key={flyoutTool}
                        onClick={() => selectTool(flyoutTool)}
                        role="menuitem"
                        title={`${definition.label} (${definition.shortcut})`}
                        type="button"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icons[flyoutTool]}</span>
                        <span className="min-w-0 flex-1 truncate">{definition.label}</span>
                        <span className="shrink-0 text-[10px] opacity-65">{definition.shortcut}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        </div>
      )}
      <div
        className="relative h-[60px] w-16 border-x border-b border-[#252936] bg-[#151720]"
        data-image-editor-color-well="true"
      >
        <AdvancedColorPicker
          className="absolute bottom-2 right-2 h-7 w-7 cursor-pointer rounded-none border border-black bg-transparent p-0"
          buttonClassName="rounded-none border border-black"
          label="Background color"
          onChange={setBackgroundColor}
          title="Background color"
          value={backgroundColor}
        />
        <AdvancedColorPicker
          className="absolute left-2 top-2 z-10 h-8 w-8 cursor-pointer rounded-none border border-white/85 bg-transparent p-0 shadow-[0_0_0_1px_rgba(0,0,0,0.85)]"
          buttonClassName="rounded-none border border-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.85)]"
          label="Foreground color"
          onChange={(color) => setBrushSettings({ color, presetId: undefined })}
          onEyeDropper={() => setTool('eyedropper')}
          title="Foreground color"
          value={foregroundColor}
        />
        <button
          aria-label="Swap foreground and background colors"
          className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center border border-cyan-300/10 bg-[#0b0d12] text-cyan-100/60 hover:text-white"
          onClick={swapForegroundBackgroundColors}
          title="Swap foreground and background colors"
          type="button"
        >
          <ArrowLeftRight size={10} />
        </button>
        <button
          aria-label="Reset foreground and background colors"
          className="absolute bottom-0.5 left-0.5 flex h-4 w-4 items-center justify-center border border-cyan-300/10 bg-[#0b0d12] text-cyan-100/60 hover:text-white"
          onClick={resetForegroundBackgroundColors}
          title="Reset foreground and background colors"
          type="button"
        >
          <RotateCcw size={10} />
        </button>
      </div>
    </div>
  );
}
