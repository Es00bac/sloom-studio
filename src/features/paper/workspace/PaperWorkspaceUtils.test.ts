import { describe, expect, it } from 'vitest';
import {
  getPaperPanelToggleMode,
  isPaperPanelShown,
  resolvePaperPanelMode,
} from './PaperWorkspaceUtils';

describe('PaperWorkspaceUtils', () => {
  it('treats collapsed preflight panels as hidden from the active workspace surface', () => {
    expect(isPaperPanelShown(resolvePaperPanelMode('collapsed', 'hidden'), { treatCollapsedAsShown: false })).toBe(false);
  });

  it('treats hidden preflight panels as hidden from the active workspace surface', () => {
    expect(isPaperPanelShown(resolvePaperPanelMode(undefined, 'hidden'), { treatCollapsedAsShown: false })).toBe(false);
  });

  it('restores hidden or collapsed preflight panels to docked mode through the toggle control path', () => {
    expect(getPaperPanelToggleMode('hidden', { treatCollapsedAsShown: false })).toBe('docked');
    expect(getPaperPanelToggleMode('collapsed', { treatCollapsedAsShown: false })).toBe('docked');
  });

  it('hides an already shown preflight panel through the same toggle control path', () => {
    expect(getPaperPanelToggleMode('docked', { treatCollapsedAsShown: false })).toBe('hidden');
    expect(getPaperPanelToggleMode('floating', { treatCollapsedAsShown: false })).toBe('hidden');
  });
});
