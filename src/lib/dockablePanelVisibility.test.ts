import { describe, expect, it } from 'vitest';
import {
  getDockablePanelToggleMode,
  isDockablePanelShown,
  resolveDockablePanelMode,
} from './dockablePanelVisibility';

describe('dockablePanelVisibility', () => {
  it('resolves the effective mode from layout, then default, then hidden', () => {
    expect(resolveDockablePanelMode('floating', 'docked')).toBe('floating');
    expect(resolveDockablePanelMode(undefined, 'docked')).toBe('docked');
    expect(resolveDockablePanelMode(undefined, undefined)).toBe('hidden');
  });

  it('treats docked/floating as shown and hidden as not shown', () => {
    expect(isDockablePanelShown('docked')).toBe(true);
    expect(isDockablePanelShown('floating')).toBe(true);
    expect(isDockablePanelShown('hidden')).toBe(false);
  });

  it('treats collapsed as shown by default but not when overridden', () => {
    expect(isDockablePanelShown('collapsed')).toBe(true);
    expect(isDockablePanelShown('collapsed', { treatCollapsedAsShown: false })).toBe(false);
  });

  it('toggles a shown panel to hidden and a hidden panel to docked (or restoreMode)', () => {
    expect(getDockablePanelToggleMode('docked')).toBe('hidden');
    expect(getDockablePanelToggleMode('floating')).toBe('hidden');
    expect(getDockablePanelToggleMode('hidden')).toBe('docked');
    expect(getDockablePanelToggleMode('hidden', { restoreMode: 'floating' })).toBe('floating');
    expect(getDockablePanelToggleMode('collapsed', { treatCollapsedAsShown: false })).toBe('docked');
  });
});
