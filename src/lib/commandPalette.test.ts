import { describe, expect, it } from 'vitest';
import {
  buildCommandPaletteEntries,
  filterCommandPaletteEntries,
} from './commandPalette';

describe('command palette model', () => {
  it('builds Flow-aware commands while keeping inactive workspace tools hidden', () => {
    const entries = buildCommandPaletteEntries({
      activeWorkspace: 'flow',
      flowDiagnosticsCount: 2,
      flowNodeCount: 3,
      canCleanFlow: true,
    });

    expect(entries.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      'app:open-provider-settings',
      'app:clean-flow',
      'app:open-flow-diagnostics',
      'menu:file:save',
      'menu:view:toggle-interface',
      'menu:view:activity-trail',
      'menu:view:image',
      'menu:help:feature-help',
    ]));
    expect(entries.some((entry) => entry.id === 'menu:image:tool-brush')).toBe(false);
    expect(entries.some((entry) => entry.id === 'menu:view:command-palette')).toBe(false);
  });

  it('marks Clean Flow unavailable when the Flow graph cannot be organized', () => {
    const cleanFlow = buildCommandPaletteEntries({
      activeWorkspace: 'flow',
      flowNodeCount: 0,
      canCleanFlow: false,
    }).find((entry) => entry.id === 'app:clean-flow');

    expect(cleanFlow?.disabled).toBe(true);
    expect(cleanFlow?.description).toMatch(/available after nodes/i);
  });

  it('includes workspace tool commands only for the active workspace', () => {
    const imageEntries = buildCommandPaletteEntries({
      activeWorkspace: 'image',
      shortcuts: {
        'image:tool-brush': 'Ctrl+Alt+B',
      },
    });
    const paperEntries = buildCommandPaletteEntries({ activeWorkspace: 'paper' });

    expect(imageEntries.find((entry) => entry.id === 'menu:image:tool-brush')?.shortcut).toBe('Ctrl+Alt+B');
    expect(imageEntries.some((entry) => entry.id === 'menu:paper:tool-text')).toBe(false);
    expect(paperEntries.some((entry) => entry.id === 'menu:paper:tool-text')).toBe(true);
    expect(paperEntries.some((entry) => entry.id === 'menu:timeline:cut')).toBe(false);
  });

  it('keeps Flow diagnostics searchable from non-Flow workspaces', () => {
    const imageEntries = buildCommandPaletteEntries({
      activeWorkspace: 'image',
      flowDiagnosticsCount: 4,
    });

    expect(imageEntries.find((entry) => entry.id === 'app:open-flow-diagnostics')?.label).toBe('Flow Diagnostics (4)');
    expect(filterCommandPaletteEntries(imageEntries, 'diagnostics')[0]?.id).toBe('app:open-flow-diagnostics');
  });

  it('includes Paper production exports that are also available from native menus', () => {
    const paperEntries = buildCommandPaletteEntries({ activeWorkspace: 'paper' });

    expect(paperEntries.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      'menu:paper:export-reader-spreads-pdf',
      'menu:paper:export-booklet-proof-pdf',
      'menu:paper:export-webcomic-images',
      'menu:paper:package-print',
      'menu:paper:export-idml',
      'menu:paper:export-stories-docx',
      'menu:paper:export-cbz',
    ]));
    expect(filterCommandPaletteEntries(paperEntries, 'webcomic')[0]?.id).toBe('menu:paper:export-webcomic-images');
  });

  it('searches labels, descriptions, groups, shortcuts, and command ids', () => {
    const entries = buildCommandPaletteEntries({
      activeWorkspace: 'image',
      shortcuts: {
        'image:tool-brush': 'Ctrl+Alt+B',
      },
    });

    expect(filterCommandPaletteEntries(entries, 'provider')[0]?.id).toBe('app:open-provider-settings');
    expect(filterCommandPaletteEntries(entries, 'activity trail')[0]?.id).toBe('menu:view:activity-trail');
    expect(filterCommandPaletteEntries(entries, 'brush')[0]?.id).toBe('menu:image:tool-brush');
    expect(filterCommandPaletteEntries(entries, 'Ctrl Alt B')[0]?.id).toBe('menu:image:tool-brush');
    expect(filterCommandPaletteEntries(entries, 'export assets').map((entry) => entry.id)).toContain('menu:file:export-assets');
  });

  it('keeps menu command ids unique after combining global and workspace groups', () => {
    const entries = buildCommandPaletteEntries({ activeWorkspace: 'flow' });
    const duplicateIds = entries
      .map((entry) => entry.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);

    expect(duplicateIds).toEqual([]);
    expect(entries.filter((entry) => entry.id === 'menu:settings:keyboard-shortcuts')).toHaveLength(1);
  });
});
