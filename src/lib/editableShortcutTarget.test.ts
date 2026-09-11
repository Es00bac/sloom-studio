// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { isTypingIntoEditableTarget } from './keyboardShortcuts';

describe('isTypingIntoEditableTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

  it('treats input/textarea/select/contenteditable event targets as text entry', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(isTypingIntoEditableTarget({ target: document.createElement(tag) })).toBe(true);
    }
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    document.body.appendChild(ce);
    expect(isTypingIntoEditableTarget({ target: ce })).toBe(true);
  });

  it('ignores non-editable targets and null', () => {
    expect(isTypingIntoEditableTarget({ target: document.createElement('button') })).toBe(false);
    expect(isTypingIntoEditableTarget({ target: null })).toBe(false);
    expect(isTypingIntoEditableTarget(undefined)).toBe(false);
  });

  it('catches the focused field even when the event target is something else', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    // The keydown's target is a non-editable element, but focus is in the input → still text entry.
    expect(isTypingIntoEditableTarget({ target: document.createElement('div') })).toBe(true);
  });
});
