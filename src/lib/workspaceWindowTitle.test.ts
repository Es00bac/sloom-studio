import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorkspaceWindowTitle, paperDocumentWindowLabel } from './workspaceWindowTitle';

describe('workspace window titles', () => {
  it('moves the active Paper document identity into the native window title without repeating the product name', () => {
    expect(paperDocumentWindowLabel('Sloom Studio — The Studio That Grew Sideways'))
      .toBe('The Studio That Grew Sideways');
    expect(buildWorkspaceWindowTitle('paper', 'Sloom Studio — The Studio That Grew Sideways', true))
      .toBe('Sloom Studio Paper — The Studio That Grew Sideways');
  });

  it('identifies every non-Paper window by the workspace actually displayed there', () => {
    expect(buildWorkspaceWindowTitle('flow', 'Ignored', true)).toBe('Sloom Studio Flow');
    expect(buildWorkspaceWindowTitle('image', 'Ignored', true)).toBe('Sloom Studio Image');
    expect(buildWorkspaceWindowTitle('editor', 'Ignored', true)).toBe('Sloom Studio Video');
    expect(buildWorkspaceWindowTitle('image', 'Ignored', false)).toBe('Sloom Studio Image');
  });

  it('drives the native title from the workspace pinned to this window', () => {
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('buildWorkspaceWindowTitle(activeWorkspaceView');
    expect(appSource).not.toContain('buildWorkspaceWindowTitle(workspaceView');
  });
});
