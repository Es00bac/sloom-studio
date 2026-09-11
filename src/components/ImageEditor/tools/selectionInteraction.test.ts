import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SELECTION_TOOL_SETTINGS, type EditorOperation } from '../../../types/imageEditor';
import { createMask, setRect, type SelectionMask } from '../SelectionMask';
import {
  clearAllSelections,
  getFloatingSelection,
  getSelection,
  setFloatingSelection,
  setSelection,
} from '../selectionRegistry';
import { SelectionInteraction } from './selectionInteraction';
import type { Point, ToolEnv } from './types';

function createSelectionEnv(feather: number) {
  const operations: EditorOperation[] = [];
  const requestRender = vi.fn();
  const bumpSelectionVersion = vi.fn();
  const setHasSelection = vi.fn();
  const doc = {
    id: `selection-interaction-${Math.random().toString(36).slice(2)}`,
    width: 8,
    height: 8,
  };
  const env = {
    doc,
    activeLayer: null,
    brushSettings: {},
    cropToolSettings: {},
    selectionToolSettings: {
      ...DEFAULT_SELECTION_TOOL_SETTINGS,
      feather,
    },
    screenToDoc: (point: Point): Point => point,
    docToScreen: (point: Point): Point => point,
    pushOperation: (operation: EditorOperation) => operations.push(operation),
    store: {
      bumpSelectionVersion,
      setHasSelection,
    },
    requestRender,
    resolveSelectionMode: () => 'replace',
  } as unknown as ToolEnv;

  return {
    env,
    operations,
    requestRender,
    bumpSelectionVersion,
    setHasSelection,
  };
}

function alphaAt(mask: SelectionMask, x: number, y: number): number {
  return mask.data[y * mask.width + x];
}

beforeEach(() => {
  clearAllSelections();
});

describe('SelectionInteraction', () => {
  it('feathers only the incoming tool shape before combining with the captured base selection', () => {
    const { env, operations, setHasSelection } = createSelectionEnv(1);
    const base = createMask(env.doc.width, env.doc.height);
    setRect(base, 0, 0, 1, 1, 255, false);
    setSelection(env.doc.id, base);

    const shape = createMask(env.doc.width, env.doc.height);
    setRect(shape, 3, 3, 2, 2, 255, false);

    const interaction = new SelectionInteraction(env, 'add');
    interaction.preview(env, shape);
    interaction.commit(env);

    const selection = getSelection(env.doc.id);
    expect(selection).not.toBeNull();
    if (!selection) throw new Error('Expected a selection mask');

    expect(alphaAt(selection, 0, 0)).toBe(255);
    expect(alphaAt(selection, 1, 0)).toBe(0);
    expect(alphaAt(selection, 2, 3)).toBeGreaterThan(0);
    expect(alphaAt(selection, 2, 3)).toBeLessThan(255);
    expect(alphaAt(selection, 3, 3)).toBeGreaterThan(0);
    expect(alphaAt(selection, 3, 3)).toBeLessThan(255);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ kind: 'selection', docId: env.doc.id });
    expect(setHasSelection).toHaveBeenCalledWith(env.doc.id, true);
  });

  it('clears any floating-selection association when a new selection is committed', () => {
    // A prior Move drag floated the selection onto layer "float-1". Drawing a fresh selection must
    // break that association so the next move lifts from the source instead of grabbing the old
    // float layer (the guard behind the non-destructive move fix).
    const { env } = createSelectionEnv(0);
    setFloatingSelection(env.doc.id, { layerId: 'float-1' });
    expect(getFloatingSelection(env.doc.id)).toEqual({ layerId: 'float-1' });

    const shape = createMask(env.doc.width, env.doc.height);
    setRect(shape, 2, 2, 3, 3, 255, false);
    const interaction = new SelectionInteraction(env, 'replace');
    interaction.preview(env, shape);
    interaction.commit(env);

    expect(getFloatingSelection(env.doc.id)).toBeNull();
  });
});
