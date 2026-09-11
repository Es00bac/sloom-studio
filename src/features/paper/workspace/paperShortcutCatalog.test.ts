import { describe, expect, it } from 'vitest';
import {
  buildPaperShortcutCatalog,
  countPaperShortcuts,
  filterPaperShortcutCatalog,
} from './paperShortcutCatalog';

describe('Paper shortcut catalog', () => {
  it('uses the live command resolver while retaining direct Paper gestures', () => {
    const groups = buildPaperShortcutCatalog({
      'edit:undo': 'Alt+U',
      'paper:tool-image': 'Shift+I',
      'paper:toggle-rulers': 'Alt+R',
    });
    const items = groups.flatMap((group) => group.items);

    expect(items.find((item) => item.command === 'edit:undo')?.shortcut).toBe('Alt+U');
    expect(items.find((item) => item.command === 'paper:tool-image')?.shortcut).toBe('Shift+I');
    expect(items.find((item) => item.command === 'paper:toggle-rulers')).toMatchObject({
      label: 'Toggle Rulers',
      shortcut: 'Alt+R',
      source: 'command',
    });
    expect(items.find((item) => item.id === 'canvas:nudge-precise')).toMatchObject({
      shortcut: 'Alt+Arrow keys',
      description: 'Move by 0.25 mm.',
      source: 'canvas',
    });
    expect(items.find((item) => item.id === 'text:bold')?.shortcut).toBe('Ctrl/Cmd+B');
  });

  it('does not advertise menu accelerator fallbacks that the keyboard dispatcher cannot route', () => {
    const items = buildPaperShortcutCatalog().flatMap((group) => group.items);

    expect(items.find((item) => item.command === 'paper:tool-eyedropper')?.shortcut).toBe('I');
    expect(items.find((item) => item.command === 'paper:export-pdf')?.shortcut).toBe('Ctrl+P');
  });

  it('searches labels, groups, descriptions, command ids, and Command aliases', () => {
    const groups = buildPaperShortcutCatalog({ 'paper:toggle-rulers': 'Alt+R' });

    expect(filterPaperShortcutCatalog(groups, 'rulers')).toEqual([
      expect.objectContaining({
        label: 'View',
        items: [expect.objectContaining({ command: 'paper:toggle-rulers' })],
      }),
    ]);
    expect(filterPaperShortcutCatalog(groups, '0.25').flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ id: 'canvas:nudge-precise' }),
    ]);
    expect(filterPaperShortcutCatalog(groups, 'cmd+b').flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ id: 'text:bold' }),
    ]);
    expect(countPaperShortcuts(filterPaperShortcutCatalog(groups, 'not-a-shortcut'))).toBe(0);
  });
});
