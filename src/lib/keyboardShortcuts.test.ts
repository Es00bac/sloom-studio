import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  describeKeyboardShortcutReadiness,
  resolveKeyboardShortcutCommand,
} from './keyboardShortcuts';
import type { WorkspaceView } from '../types/flow';

type ShortcutEventInit = {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
};

function event(init: ShortcutEventInit): KeyboardEvent {
  return init as KeyboardEvent;
}

function resolve(init: ShortcutEventInit, workspace: WorkspaceView = 'flow') {
  return resolveKeyboardShortcutCommand(event(init), workspace);
}

describe('keyboard shortcut command resolver', () => {
  it('maps common file and view accelerators to app menu commands', () => {
    expect(resolve({ key: 'n', ctrlKey: true })).toBe('file:new');
    expect(resolve({ key: 'o', ctrlKey: true })).toBe('file:open');
    expect(resolve({ key: 's', ctrlKey: true })).toBe('file:save');
    expect(resolve({ key: 's', ctrlKey: true, shiftKey: true })).toBe('file:save-as');
    expect(resolve({ key: '1', ctrlKey: true })).toBe('view:flow');
    expect(resolve({ key: '2', ctrlKey: true })).toBe('view:editor');
    expect(resolve({ key: '3', ctrlKey: true })).toBe('view:image');
    expect(resolve({ key: '4', ctrlKey: true })).toBe('view:paper');
    expect(resolve({ key: 'k', ctrlKey: true })).toBe('view:command-palette');
    expect(resolve({ key: 'k', metaKey: true })).toBe('view:command-palette');
  });

  it('maps plain Tab to the interface toggle while preserving form focus traversal', () => {
    const input = { tagName: 'input' } as unknown as EventTarget;

    expect(resolve({ key: 'Tab' }, 'flow')).toBe('view:toggle-interface');
    expect(resolve({ key: 'Tab' }, 'image')).toBe('view:toggle-interface');
    expect(resolve({ key: 'Tab', target: input }, 'paper')).toBeUndefined();
    expect(resolve({ key: 'Tab', shiftKey: true }, 'paper')).toBeUndefined();
    expect(resolve({ key: 'Tab', ctrlKey: true }, 'editor')).toBeUndefined();
  });

  it('does not hide the interface on Tab inside a marked keyboard-focus scope (MH-094 Start menu/gallery)', () => {
    const withinScope = {
      tagName: 'button',
      closest: (selector: string) => (selector.includes('data-keyboard-focus-scope') ? {} : null),
    } as unknown as EventTarget;
    const outsideScope = {
      tagName: 'button',
      closest: () => null,
    } as unknown as EventTarget;

    // Tab from a card/search/summary inside the Start menu or gallery panel moves focus
    // normally instead of firing the global hide-interface shortcut.
    expect(resolve({ key: 'Tab', target: withinScope }, 'flow')).toBeUndefined();
    // Shift+Tab (backward traversal) is exempt the same way.
    expect(resolve({ key: 'Tab', shiftKey: true, target: withinScope }, 'flow')).toBeUndefined();
    // Any other focusable element outside the scope keeps the original behavior.
    expect(resolve({ key: 'Tab', target: outsideScope }, 'flow')).toBe('view:toggle-interface');
    // Other shortcuts still resolve normally from inside the scope (only the toggle is exempt).
    expect(resolve({ key: 'z', ctrlKey: true, target: withinScope }, 'flow')).toBe('edit:undo');
  });

  it('maps edit accelerators for Flow and editor workspaces with edit command handlers', () => {
    expect(resolve({ key: 'z', ctrlKey: true }, 'paper')).toBe('edit:undo');
    expect(resolve({ key: 'z', ctrlKey: true, shiftKey: true }, 'image')).toBe('edit:redo');
    expect(resolve({ key: 'y', ctrlKey: true }, 'editor')).toBe('edit:redo');
    expect(resolve({ key: 'c', ctrlKey: true }, 'paper')).toBe('edit:copy');
    expect(resolve({ key: 'x', ctrlKey: true }, 'image')).toBe('edit:cut');
    expect(resolve({ key: 'v', ctrlKey: true }, 'paper')).toBe('edit:paste');
    expect(resolve({ key: 'Delete' }, 'image')).toBe('edit:delete');
    expect(resolve({ key: 'Backspace' }, 'paper')).toBe('edit:delete');
    expect(resolve({ key: 'c', ctrlKey: true }, 'flow')).toBe('edit:copy');
    expect(resolve({ key: 'v', ctrlKey: true }, 'flow')).toBe('edit:paste');
  });

  it('maps workspace-specific tool keys only for the active workspace', () => {
    expect(resolve({ key: 'c' }, 'editor')).toBe('timeline:cut');
    expect(resolve({ key: '[' }, 'editor')).toBe('timeline:previous-keyframe');
    expect(resolve({ key: 'b' }, 'image')).toBe('image:tool-brush');
    expect(resolve({ key: 'e', altKey: true }, 'image')).toBe('image:tool-background-eraser');
    expect(resolve({ key: 'e', shiftKey: true }, 'image')).toBe('image:tool-magic-eraser');
    expect(resolve({ key: 'r', shiftKey: true }, 'image')).toBe('image:tool-sharpen-brush');
    expect(resolve({ key: 't' }, 'paper')).toBe('paper:tool-text');
    expect(resolve({ key: 'v' }, 'paper')).toBe('paper:tool-select');
    expect(resolve({ key: 'i', shiftKey: true }, 'paper')).toBe('paper:tool-image');
    expect(resolve({ key: 'i' }, 'paper')).toBe('paper:tool-eyedropper');
    expect(resolve({ key: 'b' }, 'paper')).toBeUndefined();
  });

  it('routes trim-only keys exclusively in an explicit trim context', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Enter', 'Escape']) {
      expect(resolve({ key }, 'editor')).toBeUndefined();
    }
    expect(resolveKeyboardShortcutCommand(event({ key: 'ArrowLeft' }), 'editor', {}, { videoContext: 'trim' })).toBe('timeline:trim-nudge-back');
    expect(resolveKeyboardShortcutCommand(event({ key: 'ArrowRight' }), 'editor', {}, { videoContext: 'trim' })).toBe('timeline:trim-nudge-forward');
    expect(resolveKeyboardShortcutCommand(event({ key: 'Enter' }), 'editor', {}, { videoContext: 'trim' })).toBe('timeline:trim-commit');
    expect(resolveKeyboardShortcutCommand(event({ key: 'Escape' }), 'editor', {}, { videoContext: 'trim' })).toBe('timeline:trim-cancel');
    expect(resolveKeyboardShortcutCommand(event({ key: 'ArrowLeft' }), 'image', {}, { videoContext: 'trim' })).toBeUndefined();
  });

  it('derives professional Video defaults from the aligned command catalog', () => {
    expect(DEFAULT_KEYBOARD_SHORTCUTS['timeline:slip']).toBe('S');
    expect(DEFAULT_KEYBOARD_SHORTCUTS['timeline:add-edit']).toBe('Ctrl+Shift+K');
    expect(DEFAULT_KEYBOARD_SHORTCUTS['edit:deselect']).toBe('Ctrl+D');
    expect(resolve({ key: 'k', ctrlKey: true }, 'editor')).toBe('view:command-palette');
    expect(resolve({ key: 'k', ctrlKey: true, shiftKey: true }, 'editor')).toBe('timeline:add-edit');
  });

  it('matches shifted punctuation by physical key code when the browser reports its glyph', () => {
    expect(resolve({ key: '|', code: 'Backslash', shiftKey: true }, 'editor')).toBe('timeline:zoom-in-out');
    expect(resolveKeyboardShortcutCommand(event({ key: '|', code: 'Backslash', shiftKey: true }), 'editor', {
      'timeline:zoom-in-out': 'Shift+\\',
    })).toBe('timeline:zoom-in-out');
    expect(resolve({ key: '|', shiftKey: true }, 'editor')).toBeUndefined();
  });

  it('keeps marker authoring and navigation distinct from the plain-M snap tool', () => {
    expect(DEFAULT_KEYBOARD_SHORTCUTS['timeline:snap']).toBe('M');
    expect(DEFAULT_KEYBOARD_SHORTCUTS['timeline:add-marker']).toBe('Ctrl+M');
    expect(DEFAULT_KEYBOARD_SHORTCUTS['timeline:previous-marker']).toBe('Shift+M');
    expect(DEFAULT_KEYBOARD_SHORTCUTS['timeline:next-marker']).toBe('Alt+M');
    expect(resolve({ key: 'm' }, 'editor')).toBe('timeline:snap');
    expect(resolve({ key: 'm', ctrlKey: true }, 'editor')).toBe('timeline:add-marker');
    expect(resolve({ key: 'm', metaKey: true }, 'editor')).toBe('timeline:add-marker');
    expect(resolve({ key: 'm', shiftKey: true }, 'editor')).toBe('timeline:previous-marker');
    expect(resolve({ key: 'm', altKey: true }, 'editor')).toBe('timeline:next-marker');
  });

  it('keeps the command palette global while leaving editable targets alone for normal shortcuts', () => {
    const input = { tagName: 'input' } as unknown as EventTarget;
    const textarea = { tagName: 'textarea' } as unknown as EventTarget;
    const editable = { tagName: 'div', isContentEditable: true } as unknown as EventTarget;

    expect(resolve({ key: 'z', ctrlKey: true, target: input }, 'image')).toBeUndefined();
    expect(resolve({ key: 'k', ctrlKey: true, target: input }, 'flow')).toBe('view:command-palette');
    expect(resolve({ key: 'k', metaKey: true, target: textarea }, 'paper')).toBe('view:command-palette');
    expect(resolve({ key: 'c', ctrlKey: true, target: textarea }, 'paper')).toBeUndefined();
    expect(resolve({ key: 't', target: editable }, 'paper')).toBeUndefined();
  });

  it('honors user shortcut overrides', () => {
    expect(resolveKeyboardShortcutCommand(event({ key: 'q', ctrlKey: true }), 'image', {
      'image:tool-brush': 'Ctrl+Q',
    })).toBe('image:tool-brush');
  });

  it('lets explicit user overrides win over default shortcuts in the same workspace', () => {
    expect(resolveKeyboardShortcutCommand(event({ key: 'c', ctrlKey: true }), 'image', {
      'image:tool-brush': 'Ctrl+C',
    })).toBe('image:tool-brush');
    expect(resolveKeyboardShortcutCommand(event({ key: 'Backspace' }), 'paper', {
      'paper:tool-select': 'Backspace',
    })).toBe('paper:tool-select');
  });

  it('describes workspace-aware shortcut routing and image tool collisions', () => {
    const readiness = describeKeyboardShortcutReadiness({
      'image:tool-brush': 'B',
      'image:tool-pen': 'B',
      'image:tool-text': '',
      'timeline:cut': 'B',
    });

    expect(readiness.missingCommandShortcuts).toContain('image:tool-text');
    expect(readiness.collisions).toContainEqual({
      workspace: 'image',
      shortcut: 'B',
      commands: ['image:tool-brush', 'image:tool-pen'],
    });
    expect(readiness.collisions).not.toContainEqual({
      workspace: 'editor',
      shortcut: 'B',
      commands: expect.arrayContaining(['timeline:cut']),
    });
    expect(readiness.workspaceRoutes.find((route) => route.command === 'image:tool-brush')).toMatchObject({
      workspace: 'image',
      route: 'image-workspace-only',
    });
    expect(readiness.unsupported).toContainEqual({
      kind: 'nested-tool-flyouts',
      supported: false,
      caveat: 'Shortcuts target concrete commands; cycling nested tool flyouts is not implemented.',
    });
  });
});
