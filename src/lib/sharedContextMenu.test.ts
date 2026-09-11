import { describe, expect, it, vi } from 'vitest';
import {
  clampContextMenuPosition,
  estimateContextMenuHeight,
  getContextMenuMaxHeight,
  getContextMenuPortalTarget,
  normalizeContextMenuItems,
  resolveContextMenuLayout,
  shouldOpenContextMenuForPointerType,
} from './sharedContextMenu';

describe('shouldOpenContextMenuForPointerType', () => {
  it('suppresses the context menu for a pen/stylus long-press so it keeps drawing', () => {
    expect(shouldOpenContextMenuForPointerType('pen')).toBe(false);
  });

  it('opens for a finger long-press (touch)', () => {
    expect(shouldOpenContextMenuForPointerType('touch')).toBe(true);
  });

  it('opens for a mouse right-click', () => {
    expect(shouldOpenContextMenuForPointerType('mouse')).toBe(true);
  });

  it('opens when the pointer type is unknown (e.g. keyboard menu key)', () => {
    expect(shouldOpenContextMenuForPointerType(undefined)).toBe(true);
    expect(shouldOpenContextMenuForPointerType(null)).toBe(true);
    expect(shouldOpenContextMenuForPointerType('')).toBe(true);
  });
});

describe('shared context menu helpers', () => {
  it('clamps the menu inside the viewport with padding', () => {
    expect(
      clampContextMenuPosition(
        { x: 790, y: 590 },
        { width: 800, height: 600 },
        { width: 240, height: 180 },
      ),
    ).toEqual({ x: 548, y: 408 });
  });

  it('never clamps a tall menu underneath the fixed top chrome (viewport.top inset)', () => {
    // Chrome occupies y<96 and paints above popovers — a menu clamped to y=12 hides
    // its first items behind the bars (the Paper right-click regression).
    expect(
      clampContextMenuPosition(
        { x: 40, y: 300 },
        { width: 800, height: 600, top: 96 },
        { width: 240, height: 560 },
      ),
    ).toEqual({ x: 40, y: 108 });
  });

  it('caps the menu max height below the top chrome inset', () => {
    expect(getContextMenuMaxHeight({ width: 800, height: 600, top: 96 })).toBe(600 - 96 - 24);
    expect(getContextMenuMaxHeight({ width: 800, height: 600 })).toBe(600 - 24);
  });

  it('opens upward from the pointer when there is not enough room below', () => {
    expect(
      clampContextMenuPosition(
        { x: 200, y: 560 },
        { width: 800, height: 600 },
        { width: 240, height: 180 },
      ),
    ).toEqual({ x: 200, y: 380 });
  });

  it('clamps tall menus opened near the bottom edge fully into the viewport', () => {
    const height = estimateContextMenuHeight(
      Array.from({ length: 40 }, (_, index) => ({
        id: `item-${index}`,
        label: `Action ${index + 1}`,
      })),
      {
        headerHeight: 34,
        itemHeight: 36,
        maxHeight: getContextMenuMaxHeight({ width: 1280, height: 720 }),
        paddingY: 16,
      },
    );

    expect(
      clampContextMenuPosition(
        { x: 240, y: 708 },
        { width: 1280, height: 720 },
        { width: 256, height },
      ),
    ).toEqual({ x: 240, y: 12 });
  });

  it('clamps tall menus opened near the right edge fully into the viewport', () => {
    const height = estimateContextMenuHeight(
      Array.from({ length: 18 }, (_, index) => ({
        id: `item-${index}`,
        label: `Action ${index + 1}`,
      })),
      {
        headerHeight: 34,
        itemHeight: 36,
        maxHeight: getContextMenuMaxHeight({ width: 320, height: 720 }),
        paddingY: 16,
      },
    );

    expect(
      clampContextMenuPosition(
        { x: 316, y: 320 },
        { width: 320, height: 720 },
        { width: 256, height },
      ),
    ).toEqual({ x: 52, y: 12 });
  });

  it('reclamps from the measured menu size when the rendered menu is taller than the estimate', () => {
    expect(
      resolveContextMenuLayout({
        point: { x: 316, y: 220 },
        viewport: { width: 320, height: 240 },
        menuWidth: 256,
        estimatedHeight: 120,
        maxHeight: 216,
        headerHeight: 34,
        measuredSize: { width: 256, height: 420 },
      }),
    ).toEqual({
      position: { x: 52, y: 12 },
      menuSize: { width: 256, height: 216 },
      maxHeight: 216,
      contentMaxHeight: 182,
    });
  });

  it('keeps hidden items out and preserves disabled items without actions', () => {
    const action = vi.fn();
    const items = normalizeContextMenuItems([
      { id: 'rename', label: 'Rename', action },
      { id: 'separator', label: 'Separator', hidden: true, action: vi.fn() },
      { id: 'disabled', label: 'Disabled', disabled: true, action: vi.fn() },
    ]);

    expect(items).toEqual([
      expect.objectContaining({ id: 'rename', label: 'Rename', disabled: false }),
      expect.objectContaining({ id: 'disabled', label: 'Disabled', disabled: true, action: undefined }),
    ]);
  });

  it('caps tall context menus to the viewport with padding', () => {
    expect(getContextMenuMaxHeight({ width: 3840, height: 2160 })).toBe(2136);
    expect(getContextMenuMaxHeight({ width: 800, height: 160 })).toBe(136);
  });

  it('does not make tiny viewport menus taller than the available screen space', () => {
    expect(getContextMenuMaxHeight({ width: 320, height: 80 })).toBe(56);
  });

  it('uses document.body when a browser document exists', () => {
    const body = {} as HTMLElement;

    expect(getContextMenuPortalTarget({ body } as Document)).toBe(body);
  });

  it('stays inline when no document exists', () => {
    expect(getContextMenuPortalTarget(undefined)).toBeUndefined();
  });
});
