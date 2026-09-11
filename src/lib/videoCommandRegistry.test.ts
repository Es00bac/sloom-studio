import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_COMMAND_IMPORT_BYTES,
  VIDEO_PROFESSIONAL_COMMANDS,
  detectVideoCommandCollisions,
  exportVideoCommandRemaps,
  getDefaultVideoNativeCommandShortcuts,
  importVideoCommandRemaps,
  isVideoCommandAvailable,
  matchVideoCommand,
  normalizeVideoCommandChord,
  resolveVideoCommandBindings,
  searchVideoCommands,
  validateVideoCommandRemaps,
} from './videoCommandRegistry';

describe('professional Video command registry', () => {
  it('publishes collision-free defaults across contextual command scopes', () => {
    const bindings = resolveVideoCommandBindings();
    expect(VIDEO_PROFESSIONAL_COMMANDS.length).toBeGreaterThanOrEqual(30);
    expect(detectVideoCommandCollisions(bindings)).toEqual([]);
    expect(bindings['video.transport.shuttle-reverse']).toBe('J');
    expect(bindings['video.edit.insert']).toBe('Comma');
    expect(bindings['video.tools.slip']).toBe('S');
    expect(bindings['video.edit.add-edit']).toBe('Mod+Shift+K');
    expect(getDefaultVideoNativeCommandShortcuts()).toMatchObject({
      'timeline:slip': 'S',
      'timeline:add-edit': 'Ctrl+Shift+K',
      'timeline:insert': ',',
      'timeline:overwrite': '.',
      'timeline:trim-cancel': 'Esc',
    });
  });

  it('normalizes portable chords and gates commands by focus context', () => {
    expect(normalizeVideoCommandChord('shift + cmd + a')).toBe('Meta+Shift+A');
    expect(normalizeVideoCommandChord('option+,')).toBe('Alt+Comma');
    expect(normalizeVideoCommandChord('Ctrl+K+L')).toBeUndefined();
    expect(isVideoCommandAvailable('video.edit.insert', 'source-monitor')).toBe(true);
    expect(isVideoCommandAvailable('video.edit.insert', 'program-monitor')).toBe(false);
    expect(matchVideoCommand({ context: 'timeline', chord: 'mod+shift+k' })).toBe('video.edit.add-edit');
    expect(matchVideoCommand({ context: 'timeline', chord: 'mod+k' })).toBeUndefined();
    expect(matchVideoCommand({ context: 'timeline', chord: 'J', editable: true })).toBeUndefined();
  });

  it('reports invalid, unknown, and context-overlapping remaps without mutating defaults', () => {
    const validation = validateVideoCommandRemaps({
      'video.tools.select': 'J',
      'video.tools.marquee': '++',
      'future.command': 'F12',
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'invalid-chord', commandId: 'video.tools.marquee' }),
      expect.objectContaining({ kind: 'unknown-command', commandId: 'future.command' }),
      expect.objectContaining({ kind: 'collision' }),
    ]));
    expect(resolveVideoCommandBindings()['video.tools.select']).toBe('V');
  });

  it('round-trips bounded remap documents and preserves explicit disabled commands', () => {
    const serialized = exportVideoCommandRemaps({
      'video.tools.select': 'F2',
      'video.tools.marquee': null,
    });
    const imported = importVideoCommandRemaps(serialized);
    expect(imported).toMatchObject({ ok: true, validation: { valid: true } });
    if (!imported.ok) throw new Error(imported.reason);
    expect(imported.validation.bindings['video.tools.select']).toBe('F2');
    expect(imported.validation.bindings['video.tools.marquee']).toBeUndefined();
    expect(importVideoCommandRemaps('{')).toEqual({ ok: false, reason: 'invalid-json' });
    expect(importVideoCommandRemaps(JSON.stringify({ version: 99, remaps: {} }))).toEqual({ ok: false, reason: 'invalid-schema' });
    expect(importVideoCommandRemaps(' '.repeat(MAX_VIDEO_COMMAND_IMPORT_BYTES + 1))).toEqual({ ok: false, reason: 'payload-too-large' });
  });

  it('searches only commands available in the active context', () => {
    expect(searchVideoCommands('insert patched', 'source-monitor').map((entry) => entry.id)).toEqual(['video.edit.insert']);
    expect(searchVideoCommands('rate stretch', 'source-monitor')).toEqual([]);
    expect(searchVideoCommands('rate stretch', 'timeline')[0]).toMatchObject({ id: 'video.tools.rate-stretch', chord: 'R' });
  });
});
