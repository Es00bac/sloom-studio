import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
} from '../../../types/imageEditor';
import { createEmptyImageDocument, useImageEditorStore } from '../../../store/imageEditorStore';
import { clearAllSelections, getSelection } from '../selectionRegistry';
import type { ToolEnv } from './types';
import { brushTool, eraserTool } from './brushTool';

const mods = { shift: false, alt: false, ctrl: false, meta: false };

function pointerEvent(): PointerEvent {
  return {
    pointerType: 'mouse',
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
  } as PointerEvent;
}

function createEnv(docId: string): ToolEnv {
  const store = useImageEditorStore.getState();
  const doc = store.documents.find((entry) => entry.id === docId)!;
  return {
    doc,
    activeLayer: null,
    brushSettings: { ...DEFAULT_BRUSH_SETTINGS },
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS },
    screenToDoc: (point) => point,
    docToScreen: (point) => point,
    pushOperation: store.pushOperation,
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store,
  };
}

describe('brushTool QuickMask integration', () => {
  beforeEach(() => {
    clearAllSelections();
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
      quickMaskSettings: {
        enabled: true,
        viewMode: 'maskedAreas',
        overlayOpacity: 0.5,
      },
    });
  });

  it('uses the brush to paint the selection mask and records an undoable selection operation', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-quick-mask',
      title: 'Quick Mask',
      width: 12,
      height: 12,
    });
    useImageEditorStore.getState().openDocument(doc);
    const env = createEnv(doc.id);

    brushTool.onPointerDown?.(env, { x: 6, y: 6 }, mods, pointerEvent());
    brushTool.onPointerUp?.(env, { x: 6, y: 6 }, mods, pointerEvent());

    const selection = getSelection(doc.id);
    expect(selection?.data[6 * 12 + 6]).toBeGreaterThan(0);
    expect(useImageEditorStore.getState().getActiveDocument()?.hasSelection).toBe(true);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: doc.id,
    });
  });

  it('lets the eraser reveal selection coverage while in QuickMask mode', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-quick-mask-eraser',
      title: 'Quick Mask',
      width: 12,
      height: 12,
    });
    useImageEditorStore.getState().openDocument(doc);
    const env = createEnv(doc.id);

    env.brushSettings = { ...DEFAULT_BRUSH_SETTINGS, color: '#000000' };
    eraserTool.onPointerDown?.(env, { x: 6, y: 6 }, mods, pointerEvent());
    eraserTool.onPointerUp?.(env, { x: 6, y: 6 }, mods, pointerEvent());

    const selection = getSelection(doc.id);
    expect(selection?.data[6 * 12 + 6]).toBeGreaterThan(0);
  });

  it('mirrors QuickMask painting across the document center when horizontal symmetry is enabled', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-quick-mask-symmetry',
      title: 'Quick Mask Symmetry',
      width: 12,
      height: 12,
    });
    useImageEditorStore.getState().openDocument(doc);
    const env = createEnv(doc.id);
    env.brushSettings = { ...DEFAULT_BRUSH_SETTINGS, symmetryMode: 'horizontal' };

    brushTool.onPointerDown?.(env, { x: 6, y: 2 }, mods, pointerEvent());
    brushTool.onPointerUp?.(env, { x: 6, y: 2 }, mods, pointerEvent());

    const selection = getSelection(doc.id);
    expect(selection?.data[2 * 12 + 6]).toBeGreaterThan(0);
    expect(selection?.data[10 * 12 + 6]).toBeGreaterThan(0);
  });
});
