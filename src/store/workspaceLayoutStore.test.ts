import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  clampWorkspaceLayout,
  createDefaultWorkspaceLayout,
} from './workspaceLayoutStore';

describe('workspaceLayoutStore helpers', () => {
  it('creates independent default layouts for Image and Paper workspaces', () => {
    const layout = createDefaultWorkspaceLayout();

    expect(layout.image).toMatchObject({
      toolbarVisible: true,
      rightPanelVisible: true,
      assetBarVisible: true,
      rightPanelWidth: DEFAULT_WORKSPACE_LAYOUT.image.rightPanelWidth,
    });
    expect(layout.paper).toMatchObject({
      toolbarVisible: true,
      inspectorVisible: true,
      inspectorWidth: DEFAULT_WORKSPACE_LAYOUT.paper.inspectorWidth,
    });
  });

  it('clamps resizable sidebars and preserves show-hide preferences', () => {
    const layout = clampWorkspaceLayout({
      image: {
        toolbarVisible: false,
        rightPanelVisible: false,
        assetBarVisible: false,
        rightPanelWidth: 900,
      },
      paper: {
        toolbarVisible: false,
        inspectorVisible: false,
        inspectorWidth: 100,
      },
    });

    expect(layout.image).toMatchObject({
      toolbarVisible: false,
      rightPanelVisible: false,
      assetBarVisible: false,
      rightPanelWidth: 560,
    });
    expect(layout.paper).toMatchObject({
      toolbarVisible: false,
      inspectorVisible: false,
      inspectorWidth: 260,
    });
  });

  it('sanitizes malformed persisted workspace layout values', () => {
    const layout = clampWorkspaceLayout({
      image: null,
      paper: {
        toolbarVisible: 'yes',
        inspectorVisible: false,
        inspectorWidth: Number.POSITIVE_INFINITY,
      },
    } as never);

    expect(layout.image).toEqual(DEFAULT_WORKSPACE_LAYOUT.image);
    expect(layout.paper).toMatchObject({
      toolbarVisible: true,
      inspectorVisible: false,
      inspectorWidth: DEFAULT_WORKSPACE_LAYOUT.paper.inspectorWidth,
    });
  });
});
