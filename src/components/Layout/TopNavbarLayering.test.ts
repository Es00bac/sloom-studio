import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The top bar's exact Tailwind layout has been refactored several times (absolute-centered
// scrolling Flow toolbar → a single flex-wrap row that stays one line at 1080p+). Pinning the
// precise class strings made this test break on every cosmetic layout tweak without catching any
// real regression, so it now guards only the STABLE structural contracts: the named control
// regions, the body-portaled app menu (so it escapes the bar's horizontal clip and stacks above
// the canvas), the workspace predicates, and usage-estimator ownership. Visual single-row/wrap
// behavior is verified by rendered-width checks, not by grepping for class names here.
describe('TopNavbar structure', () => {
  const topbarSource = readFileSync(new URL('./TopNavbar.tsx', import.meta.url), 'utf8');

  it('exposes the stable, named top-bar control regions', () => {
    expect(topbarSource).toContain('data-flow-node-toolbar-layer="true"');
    expect(topbarSource).toContain('data-topbar-left-controls="true"');
    expect(topbarSource).toContain('data-topbar-primary-controls="true"');
    expect(topbarSource).toContain('data-testid="workspace-switcher"');
  });

  it('lays the bar out as a single wrapping flex row (one row when it fits, wrap only on overflow)', () => {
    expect(topbarSource).toContain('flex shrink-0 flex-wrap items-center');
    expect(topbarSource).toContain('max-[999px]:w-full max-[999px]:justify-start');
    expect(topbarSource).toContain('flex max-w-full shrink-0 flex-wrap items-center');
  });

  it('portals the app-menu dropdown to <body> so it escapes the bar clip and stacks above the canvas', () => {
    expect(topbarSource).toContain('fixed z-[200]');
    expect(topbarSource).toContain('document.body');
  });

  it('declares compact workspace predicates without importing the removed titlemark chrome', () => {
    expect(topbarSource).toContain("const isImageWorkspace = workspaceView === 'image';");
    expect(topbarSource).toContain("const isPaperWorkspace = workspaceView === 'paper';");
    expect(topbarSource).not.toContain('TITLEBAR_LOGO_SRC');
    expect(topbarSource).not.toContain('TITLEBAR_LOGO_ALT');
  });

  it('keeps the usage estimator owned by topbar chrome instead of the canvas overlay', () => {
    const usageBarSource = readFileSync(new URL('./UsageBar.tsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

    expect(topbarSource).toContain('<UsageBar placement="topbar"');
    expect(topbarSource).toContain('<UsageBar placement="mobile-drawer"');
    expect(usageBarSource).not.toContain('top-2 z-[90]');
    expect(appSource).not.toContain('<UsageBar workspaceView={activeWorkspaceView} />');
  });
});
