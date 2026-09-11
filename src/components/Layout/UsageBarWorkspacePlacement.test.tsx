// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUsageBarPositionClassName, UsageBar } from './UsageBar';

describe('UsageBar workspace placement', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'false'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the estimator out of document canvas overlay positions by default', () => {
    expect(getUsageBarPositionClassName('image')).toBe('pointer-events-auto relative min-w-0 shrink-0');
    expect(getUsageBarPositionClassName('paper')).toBe('pointer-events-auto relative min-w-0 shrink-0');
    expect(getUsageBarPositionClassName('editor')).toBe('pointer-events-auto relative min-w-0 shrink-0');
    expect(getUsageBarPositionClassName('flow')).toBe('pointer-events-auto relative min-w-0 shrink-0');
    expect(getUsageBarPositionClassName('flow', 'overlay')).toBe('pointer-events-none absolute left-1/2 top-20 z-[60] -translate-x-1/2');
    expect(getUsageBarPositionClassName('image', 'mobile-drawer')).toBe('relative min-w-0');
  });

  it('renders compact topbar estimator chrome without absolute canvas overlay classes', () => {
    act(() => {
      root.render(<UsageBar workspaceView="image" />);
    });

    const usageBar = container.querySelector<HTMLElement>('[data-signal-loom-usage-bar="true"]');
    expect(usageBar).not.toBeNull();
    expect(usageBar?.dataset.signalLoomUsageBarWorkspace).toBe('image');
    expect(usageBar?.dataset.signalLoomUsageBarPlacement).toBe('topbar');
    expect(usageBar?.className).toContain('relative');
    expect(usageBar?.className).not.toContain('absolute');
    expect(usageBar?.className).not.toContain('top-2');

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Toggle usage estimator"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.className).toContain('max-w-44');
  });

  it('keeps details and minimized controls interactive with accessible state', () => {
    act(() => {
      root.render(<UsageBar workspaceView="image" />);
    });

    const detailsButton = container.querySelector<HTMLButtonElement>('button[aria-label="Toggle usage estimator"]');
    expect(detailsButton).not.toBeNull();
    act(() => {
      detailsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(detailsButton?.getAttribute('aria-expanded')).toBe('true');
    const popover = Array.from(container.querySelectorAll<HTMLElement>('div'))
      .find((element) => element.className.includes('data-usage-spend-popover') || element.dataset.usageSpendPopover === 'true');
    expect(popover?.className).toContain('pointer-events-auto');
  });
});
