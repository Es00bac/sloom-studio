import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceWindowUrl,
  getWorkspaceWindowLabel,
  getWorkspaceWindowTitle,
  parseWorkspaceWindowSearch,
} from './workspaceWindows';

describe('workspace window helpers', () => {
  it('parses only supported workspace query values', () => {
    expect(parseWorkspaceWindowSearch('?workspace=flow')).toBe('flow');
    expect(parseWorkspaceWindowSearch('?workspace=editor')).toBe('editor');
    expect(parseWorkspaceWindowSearch('?workspace=image')).toBe('image');
    expect(parseWorkspaceWindowSearch('?workspace=paper')).toBe('paper');
    expect(parseWorkspaceWindowSearch('?workspace=bad')).toBeUndefined();
    expect(parseWorkspaceWindowSearch('')).toBeUndefined();
  });

  it('labels editor as Video while preserving the internal workspace key', () => {
    expect(getWorkspaceWindowLabel('flow')).toBe('Flow');
    expect(getWorkspaceWindowLabel('editor')).toBe('Video');
    expect(getWorkspaceWindowLabel('image')).toBe('Image');
    expect(getWorkspaceWindowLabel('paper')).toBe('Paper');
    expect(getWorkspaceWindowTitle('editor')).toBe('Sloom Studio - Video');
  });

  it('builds renderer urls that preserve existing search params and set the workspace', () => {
    expect(buildWorkspaceWindowUrl('http://localhost:5173/', 'image')).toBe('http://localhost:5173/?workspace=image');
    expect(buildWorkspaceWindowUrl('http://localhost:5173/?foo=1', 'paper')).toBe('http://localhost:5173/?foo=1&workspace=paper');
    expect(buildWorkspaceWindowUrl('file:///tmp/dist/index.html', 'editor')).toBe('file:///tmp/dist/index.html?workspace=editor');
  });
});
