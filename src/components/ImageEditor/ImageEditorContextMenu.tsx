import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { clampContextMenuPosition, shouldOpenContextMenuForPointerType } from '../../lib/sharedContextMenu';
import { getKeyboardShortcutLabel } from '../../lib/keyboardShortcuts';
import { useSettingsStore } from '../../store/settingsStore';
import type { NativeMenuCommand } from '../../lib/nativeApp';
import { getImageEditorContextMenuPortalTarget } from './ImageEditorContextMenuPortal';

interface ContextMenuState {
  x: number;
  y: number;
  visible: boolean;
}

export interface ImageEditorMenuItem {
  label: string;
  action: () => void;
  command?: NativeMenuCommand;
  danger?: boolean;
}

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onCopy?: () => void;
  onPaste?: () => void;
  onCut?: () => void;
  onDelete?: () => void;
  onSelectAll?: () => void;
  onDeselect?: () => void;
  onInvertSelection?: () => void;
  onExportMask?: () => void;
  onSendToFlow?: () => void;
  onDuplicateLayer?: () => void;
  onDeleteLayer?: () => void;
  extraItems?: ImageEditorMenuItem[];
  onHelp?: () => void;
}

export function ImageEditorContextMenu({
  containerRef,
  onCopy,
  onPaste,
  onCut,
  onDelete,
  onSelectAll,
  onDeselect,
  onInvertSelection,
  onExportMask,
  onSendToFlow,
  onDuplicateLayer,
  onDeleteLayer,
  extraItems,
  onHelp,
}: Props) {
  const [menu, setMenu] = useState<ContextMenuState>({ x: 0, y: 0, visible: false });
  const keyboardShortcuts = useSettingsStore((state) => state.keyboardShortcuts);
  const lastPointerTypeRef = useRef<string | null>(null);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    // A pen/stylus long-press must keep drawing, not open the context menu — only a
    // finger long-press or a mouse right-click opens it. (See shouldOpenContextMenuForPointerType.)
    if (!shouldOpenContextMenuForPointerType(lastPointerTypeRef.current)) {
      return;
    }
    setMenu({ x: e.clientX, y: e.clientY, visible: true });
  }, []);

  const handleClose = useCallback(() => setMenu((m) => ({ ...m, visible: false })), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Record the pointer type that precedes a `contextmenu` event so the handler can tell a
    // stylus long-press (suppress) from a finger long-press / mouse right-click (open).
    const recordPointer = (event: PointerEvent) => {
      lastPointerTypeRef.current = event.pointerType || null;
    };
    el.addEventListener('pointerdown', recordPointer, true);
    el.addEventListener('contextmenu', handleContextMenu);
    return () => {
      el.removeEventListener('pointerdown', recordPointer, true);
      el.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [containerRef, handleContextMenu]);

  useEffect(() => {
    if (!menu.visible) return;
    const close = () => handleClose();
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu.visible, handleClose]);

  if (!menu.visible) return null;

  const items: ImageEditorMenuItem[] = [
    ...(onCopy ? [{ label: 'Copy', command: 'edit:copy' as const, action: onCopy }] : []),
    ...(onPaste ? [{ label: 'Paste', command: 'edit:paste' as const, action: onPaste }] : []),
    ...(onCut ? [{ label: 'Cut', command: 'edit:cut' as const, action: onCut }] : []),
    ...(onDelete ? [{ label: 'Delete', command: 'edit:delete' as const, action: onDelete, danger: true }] : []),
    { label: '---', action: () => {} },
    ...(onSelectAll ? [{ label: 'Select All', command: 'edit:select-all' as const, action: onSelectAll }] : []),
    ...(onDeselect ? [{ label: 'Deselect', command: 'edit:deselect' as const, action: onDeselect }] : []),
    ...(onInvertSelection ? [{ label: 'Invert Selection', command: 'edit:invert-selection' as const, action: onInvertSelection }] : []),
    { label: '---', action: () => {} },
    ...(onExportMask ? [{ label: 'Export as Mask...', action: onExportMask }] : []),
    ...(onSendToFlow ? [{ label: 'Send to Flow Node', action: onSendToFlow }] : []),
    { label: '---', action: () => {} },
    ...(onDuplicateLayer ? [{ label: 'Duplicate Layer', action: onDuplicateLayer }] : []),
    ...(onDeleteLayer ? [{ label: 'Delete Layer', action: onDeleteLayer, danger: true }] : []),
    ...(extraItems?.length ? [{ label: '---', action: () => {} }, ...extraItems] : []),
    ...(onHelp ? [{ label: 'Help', action: onHelp }] : []),
  ];
  const visibleItemCount = items.length;
  const position = clampContextMenuPosition(
    { x: menu.x, y: menu.y },
    {
      width: typeof window === 'undefined' ? 1024 : window.innerWidth,
      height: typeof window === 'undefined' ? 768 : window.innerHeight,
    },
    {
      width: 220,
      height: Math.min(
        typeof window === 'undefined' ? 560 : window.innerHeight - 24,
        12 + visibleItemCount * 31,
      ),
    },
  );

  const menuNode = (
    <div
      className="fixed z-[80] max-h-[min(80vh,34rem)] min-w-[220px] overflow-y-auto rounded-lg border border-cyan-300/10 bg-[#1e1f28] py-1 shadow-2xl"
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, i) =>
        item.label === '---' ? (
          <div key={i} className="my-1 h-px bg-cyan-300/10" />
        ) : (
          <button
            key={i}
            className={`flex w-full items-center justify-between gap-5 px-3 py-1.5 text-left text-xs transition-colors ${
              item.danger
                ? 'text-red-400 hover:bg-red-400/10'
                : 'text-cyan-100/80 hover:bg-cyan-400/10'
            }`}
            onClick={() => {
              item.action();
              handleClose();
            }}
            type="button"
          >
            <span>{item.label}</span>
            {item.command ? (
              <span className="text-[11px] text-cyan-100/35">{getKeyboardShortcutLabel(item.command, keyboardShortcuts)}</span>
            ) : null}
          </button>
        ),
      )}
    </div>
  );
  const portalTarget = getImageEditorContextMenuPortalTarget();

  return portalTarget ? createPortal(menuNode, portalTarget) : menuNode;
}
