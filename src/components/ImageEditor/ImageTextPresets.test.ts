// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shouldRefocusTextEditorOnBlur } from './ImageTextPresets';

describe('shouldRefocusTextEditorOnBlur', () => {
  it('keeps the editor open on a transient blur to nothing while it just opened', () => {
    // The pointer gesture that places a new text layer pulls focus to <body> (relatedTarget
    // null) right after the editor opens. Treat that as transient (refocus) — otherwise the
    // empty freshly-placed layer is committed-then-discarded and the Type tool looks dead.
    expect(shouldRefocusTextEditorOnBlur(true, null)).toBe(true);
  });

  it('commits when focus moves to a real control, even within the open window', () => {
    const input = document.createElement('input');
    expect(shouldRefocusTextEditorOnBlur(true, input)).toBe(false);
    const button = document.createElement('button');
    expect(shouldRefocusTextEditorOnBlur(true, button)).toBe(false);
  });

  it('commits on a blur to nothing once the just-opened window has elapsed (real click-away)', () => {
    expect(shouldRefocusTextEditorOnBlur(false, null)).toBe(false);
    expect(shouldRefocusTextEditorOnBlur(false, document.createElement('input'))).toBe(false);
  });
});
