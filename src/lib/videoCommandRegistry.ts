import type { NativeMenuCommand } from './nativeApp';

/**
 * Provider- and workspace-store-independent command catalog for professional Video editing.
 * Chords are portable authored strings: `Mod` means Ctrl on Windows/Linux and Meta on macOS.
 */

export const VIDEO_COMMAND_REMAP_SCHEMA_VERSION = 1 as const;
export const MAX_VIDEO_COMMAND_IMPORT_BYTES = 64 * 1024;

export type VideoCommandContext =
  | 'global'
  | 'source-monitor'
  | 'program-monitor'
  | 'timeline'
  | 'trim';

export type VideoCommandCategory =
  | 'edit'
  | 'mark'
  | 'navigation'
  | 'selection'
  | 'tools'
  | 'transport';

export interface VideoCommandDefinition {
  id: string;
  label: string;
  description: string;
  category: VideoCommandCategory;
  contexts: readonly VideoCommandContext[];
  defaultChord?: string;
  allowInEditable?: boolean;
}

export const VIDEO_PROFESSIONAL_COMMANDS = [
  command('video.transport.play-pause', 'Play / Pause', 'Toggle forward playback.', 'transport', ['source-monitor', 'program-monitor', 'timeline'], 'Space'),
  command('video.transport.shuttle-reverse', 'Shuttle Reverse', 'Step reverse shuttle speed.', 'transport', ['source-monitor', 'program-monitor', 'timeline'], 'J'),
  command('video.transport.shuttle-stop', 'Shuttle Stop', 'Stop shuttle playback.', 'transport', ['source-monitor', 'program-monitor', 'timeline', 'trim'], 'K'),
  command('video.transport.shuttle-forward', 'Shuttle Forward', 'Step forward shuttle speed.', 'transport', ['source-monitor', 'program-monitor', 'timeline'], 'L'),
  command('video.mark.in', 'Mark In', 'Set the active monitor or record In point.', 'mark', ['source-monitor', 'program-monitor', 'timeline'], 'I'),
  command('video.mark.out', 'Mark Out', 'Set the active monitor or record Out point.', 'mark', ['source-monitor', 'program-monitor', 'timeline'], 'O'),
  command('video.mark.clear-in', 'Clear In', 'Clear the active In point.', 'mark', ['source-monitor', 'program-monitor', 'timeline'], 'Alt+I'),
  command('video.mark.clear-out', 'Clear Out', 'Clear the active Out point.', 'mark', ['source-monitor', 'program-monitor', 'timeline'], 'Alt+O'),
  command('video.edit.insert', 'Insert Edit', 'Insert patched source channels at record targets.', 'edit', ['source-monitor', 'timeline'], 'Comma'),
  command('video.edit.overwrite', 'Overwrite Edit', 'Overwrite record targets with patched source channels.', 'edit', ['source-monitor', 'timeline'], 'Period'),
  command('video.edit.lift', 'Lift', 'Remove the marked range and preserve its gap.', 'edit', ['program-monitor', 'timeline'], 'Semicolon'),
  command('video.edit.extract', 'Extract', 'Remove the marked range and ripple later material.', 'edit', ['program-monitor', 'timeline'], 'Apostrophe'),
  command('video.edit.add-edit', 'Add Edit', 'Add an edit through targeted, unlocked tracks.', 'edit', ['timeline'], 'Mod+Shift+K'),
  command('video.edit.copy', 'Copy Clips', 'Copy selected clips and relative placement metadata.', 'edit', ['timeline'], 'Mod+C'),
  command('video.edit.cut', 'Cut Clips', 'Cut selected clips into the timeline clipboard.', 'edit', ['timeline'], 'Mod+X'),
  command('video.edit.paste', 'Paste Clips', 'Paste timeline clips at the playhead.', 'edit', ['timeline'], 'Mod+V'),
  command('video.navigation.previous-edit', 'Previous Edit', 'Move to the previous targeted edit point.', 'navigation', ['program-monitor', 'timeline'], 'ArrowUp'),
  command('video.navigation.next-edit', 'Next Edit', 'Move to the next targeted edit point.', 'navigation', ['program-monitor', 'timeline'], 'ArrowDown'),
  command('video.navigation.zoom-selection', 'Zoom To Selection', 'Fit the selected range in the timeline viewport.', 'navigation', ['timeline'], 'Backslash'),
  command('video.selection.select-all', 'Select All Clips', 'Select clips in the active timeline scope.', 'selection', ['timeline'], 'Mod+A'),
  command('video.selection.deselect', 'Deselect All', 'Clear the active timeline selection.', 'selection', ['timeline'], 'Mod+D'),
  command('video.selection.track-forward', 'Track Select Forward', 'Select targeted-track clips forward from the pointer.', 'selection', ['timeline'], 'A'),
  command('video.selection.track-back', 'Track Select Backward', 'Select targeted-track clips backward from the pointer.', 'selection', ['timeline'], 'Shift+A'),
  command('video.tools.select', 'Selection Tool', 'Activate direct selection and move.', 'tools', ['timeline'], 'V'),
  command('video.tools.marquee', 'Marquee Tool', 'Activate rectangular timeline selection.', 'tools', ['timeline'], 'G'),
  command('video.tools.ripple', 'Ripple Trim Tool', 'Activate ripple trim.', 'tools', ['timeline', 'trim'], 'B'),
  command('video.tools.roll', 'Rolling Edit Tool', 'Activate rolling trim.', 'tools', ['timeline', 'trim'], 'N'),
  command('video.tools.slip', 'Slip Tool', 'Activate slip trim.', 'tools', ['timeline', 'trim'], 'S'),
  command('video.tools.slide', 'Slide Tool', 'Activate slide trim.', 'tools', ['timeline', 'trim'], 'U'),
  command('video.tools.rate-stretch', 'Rate Stretch Tool', 'Change clip duration by changing playback rate.', 'tools', ['timeline'], 'R'),
  command('video.trim.nudge-back', 'Trim Back One Frame', 'Move the active trim one frame earlier.', 'edit', ['trim'], 'ArrowLeft'),
  command('video.trim.nudge-forward', 'Trim Forward One Frame', 'Move the active trim one frame later.', 'edit', ['trim'], 'ArrowRight'),
  command('video.trim.commit', 'Commit Trim', 'Commit the active trim session.', 'edit', ['trim'], 'Enter'),
  command('video.trim.cancel', 'Cancel Trim', 'Restore the trim session snapshot.', 'edit', ['trim'], 'Escape'),
] as const satisfies readonly VideoCommandDefinition[];

export type VideoCommandId = (typeof VIDEO_PROFESSIONAL_COMMANDS)[number]['id'];
export type VideoCommandRemaps = Partial<Record<VideoCommandId, string | null>>;
export type VideoCommandBindings = Record<VideoCommandId, string | undefined>;

/**
 * The single typed bridge from professional command IDs to the app/native command surface.
 * Workspace adapters may dispatch these commands, while keyboard defaults can be derived from the
 * same catalog instead of maintaining a second set of chords.
 */
export const VIDEO_COMMAND_NATIVE_ROUTES = {
  'video.transport.play-pause': 'timeline:play-pause',
  'video.transport.shuttle-reverse': 'timeline:shuttle-reverse',
  'video.transport.shuttle-stop': 'timeline:shuttle-stop',
  'video.transport.shuttle-forward': 'timeline:shuttle-forward',
  'video.mark.in': 'timeline:mark-in',
  'video.mark.out': 'timeline:mark-out',
  'video.mark.clear-in': 'timeline:clear-in',
  'video.mark.clear-out': 'timeline:clear-out',
  'video.edit.insert': 'timeline:insert',
  'video.edit.overwrite': 'timeline:overwrite',
  'video.edit.lift': 'timeline:lift',
  'video.edit.extract': 'timeline:extract',
  'video.edit.add-edit': 'timeline:add-edit',
  'video.edit.copy': 'edit:copy',
  'video.edit.cut': 'edit:cut',
  'video.edit.paste': 'edit:paste',
  'video.navigation.previous-edit': 'timeline:previous-edit',
  'video.navigation.next-edit': 'timeline:next-edit',
  'video.navigation.zoom-selection': 'timeline:zoom-selection',
  'video.selection.select-all': 'edit:select-all',
  'video.selection.deselect': 'edit:deselect',
  'video.selection.track-forward': 'timeline:track-select-forward',
  'video.selection.track-back': 'timeline:track-select-backward',
  'video.tools.select': 'timeline:select',
  'video.tools.marquee': 'timeline:marquee',
  'video.tools.ripple': 'timeline:ripple',
  'video.tools.roll': 'timeline:roll',
  'video.tools.slip': 'timeline:slip',
  'video.tools.slide': 'timeline:slide',
  'video.tools.rate-stretch': 'timeline:rate-stretch',
  'video.trim.nudge-back': 'timeline:trim-nudge-back',
  'video.trim.nudge-forward': 'timeline:trim-nudge-forward',
  'video.trim.commit': 'timeline:trim-commit',
  'video.trim.cancel': 'timeline:trim-cancel',
} as const satisfies Record<VideoCommandId, NativeMenuCommand>;

export const VIDEO_TRIM_NATIVE_COMMANDS = [
  'timeline:trim-nudge-back',
  'timeline:trim-nudge-forward',
  'timeline:trim-commit',
  'timeline:trim-cancel',
] as const satisfies readonly NativeMenuCommand[];

export interface VideoCommandCollision {
  chord: string;
  contexts: VideoCommandContext[];
  commandIds: VideoCommandId[];
}

export type VideoCommandRemapIssue =
  | { kind: 'invalid-chord'; commandId: VideoCommandId; value: unknown }
  | { kind: 'unknown-command'; commandId: string }
  | { kind: 'collision'; collision: VideoCommandCollision };

export interface VideoCommandRemapValidation {
  valid: boolean;
  remaps: VideoCommandRemaps;
  bindings: VideoCommandBindings;
  collisions: VideoCommandCollision[];
  issues: VideoCommandRemapIssue[];
}

export type VideoCommandImportResult =
  | { ok: true; validation: VideoCommandRemapValidation }
  | { ok: false; reason: 'invalid-json' | 'invalid-schema' | 'payload-too-large' };

export interface VideoCommandMatchOptions {
  context: VideoCommandContext;
  chord: string;
  editable?: boolean;
  remaps?: VideoCommandRemaps;
}

const COMMAND_BY_ID = new Map<VideoCommandId, (typeof VIDEO_PROFESSIONAL_COMMANDS)[number]>(
  VIDEO_PROFESSIONAL_COMMANDS.map((entry) => [entry.id, entry]),
);

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;
const KEY_ALIASES: Record<string, string> = {
  "'": 'Apostrophe',
  ',': 'Comma',
  '.': 'Period',
  '\\': 'Backslash',
  cmd: 'Meta',
  command: 'Meta',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  del: 'Delete',
  down: 'ArrowDown',
  esc: 'Escape',
  left: 'ArrowLeft',
  meta: 'Meta',
  mod: 'Mod',
  option: 'Alt',
  return: 'Enter',
  right: 'ArrowRight',
  spacebar: 'Space',
  up: 'ArrowUp',
};

export function getVideoCommandDefinition(commandId: VideoCommandId): VideoCommandDefinition {
  return COMMAND_BY_ID.get(commandId)!;
}

export function isVideoCommandAvailable(
  commandId: VideoCommandId,
  context: VideoCommandContext,
  editable = false,
): boolean {
  const entry = getVideoCommandDefinition(commandId);
  return (!editable || entry.allowInEditable === true)
    && (entry.contexts.includes('global') || entry.contexts.includes(context));
}

export function normalizeVideoCommandChord(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const source = value.trim();
  if (!source || source.length > 64) return undefined;
  const parts = source.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 6) return undefined;
  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  let key: string | undefined;
  for (const part of parts) {
    const alias = KEY_ALIASES[part.toLowerCase()];
    const normalized = alias ?? normalizeKey(part);
    if (MODIFIER_ORDER.includes(normalized as (typeof MODIFIER_ORDER)[number])) {
      modifiers.add(normalized as (typeof MODIFIER_ORDER)[number]);
    } else if (key === undefined) {
      key = normalized;
    } else {
      return undefined;
    }
  }
  if (!key || MODIFIER_ORDER.includes(key as (typeof MODIFIER_ORDER)[number])) return undefined;
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

export function resolveVideoCommandBindings(remaps: VideoCommandRemaps = {}): VideoCommandBindings {
  return Object.fromEntries(VIDEO_PROFESSIONAL_COMMANDS.map((entry) => {
    const override = remaps[entry.id];
    const chord = override === null
      ? undefined
      : override === undefined
        ? normalizeVideoCommandChord(entry.defaultChord)
        : normalizeVideoCommandChord(override);
    return [entry.id, chord];
  })) as VideoCommandBindings;
}

/** Convert the portable professional catalog to the app's native shortcut notation. */
export function getDefaultVideoNativeCommandShortcuts(): Partial<Record<NativeMenuCommand, string>> {
  const bindings = resolveVideoCommandBindings();
  return Object.fromEntries(VIDEO_PROFESSIONAL_COMMANDS.flatMap((entry) => {
    const chord = bindings[entry.id];
    return chord ? [[VIDEO_COMMAND_NATIVE_ROUTES[entry.id], toNativeShortcutChord(chord)]] : [];
  }));
}

export function detectVideoCommandCollisions(bindings: VideoCommandBindings): VideoCommandCollision[] {
  const byChord = new Map<string, VideoCommandId[]>();
  for (const entry of VIDEO_PROFESSIONAL_COMMANDS) {
    const chord = bindings[entry.id];
    if (!chord) continue;
    byChord.set(chord, [...byChord.get(chord) ?? [], entry.id]);
  }
  const collisions: VideoCommandCollision[] = [];
  for (const [chord, commandIds] of byChord) {
    if (commandIds.length < 2) continue;
    const contexts = (['global', 'source-monitor', 'program-monitor', 'timeline', 'trim'] as const)
      .filter((context) => commandIds.filter((id) => isVideoCommandAvailable(id, context)).length > 1);
    if (contexts.length) collisions.push({ chord, contexts: [...contexts], commandIds: [...commandIds].sort() });
  }
  return collisions.sort((left, right) => left.chord.localeCompare(right.chord));
}

export function validateVideoCommandRemaps(value: unknown): VideoCommandRemapValidation {
  const issues: VideoCommandRemapIssue[] = [];
  const remaps: VideoCommandRemaps = {};
  if (isRecord(value)) {
    for (const [id, chord] of Object.entries(value)) {
      if (!COMMAND_BY_ID.has(id as VideoCommandId)) {
        issues.push({ kind: 'unknown-command', commandId: id });
        continue;
      }
      const commandId = id as VideoCommandId;
      if (chord === null) {
        remaps[commandId] = null;
        continue;
      }
      const normalized = normalizeVideoCommandChord(chord);
      if (!normalized) {
        issues.push({ kind: 'invalid-chord', commandId, value: chord });
        continue;
      }
      remaps[commandId] = normalized;
    }
  }
  const bindings = resolveVideoCommandBindings(remaps);
  const collisions = detectVideoCommandCollisions(bindings);
  issues.push(...collisions.map((collision) => ({ kind: 'collision' as const, collision })));
  return { valid: issues.length === 0, remaps, bindings, collisions, issues };
}

export function matchVideoCommand(options: VideoCommandMatchOptions): VideoCommandId | undefined {
  const chord = normalizeVideoCommandChord(options.chord);
  if (!chord) return undefined;
  const bindings = resolveVideoCommandBindings(options.remaps);
  return VIDEO_PROFESSIONAL_COMMANDS.find((entry) => (
    bindings[entry.id] === chord
    && isVideoCommandAvailable(entry.id, options.context, options.editable)
  ))?.id;
}

export function exportVideoCommandRemaps(remaps: VideoCommandRemaps): string {
  const validation = validateVideoCommandRemaps(remaps);
  const sorted = Object.fromEntries(Object.entries(validation.remaps).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({ version: VIDEO_COMMAND_REMAP_SCHEMA_VERSION, remaps: sorted }, null, 2);
}

export function importVideoCommandRemaps(serialized: string): VideoCommandImportResult {
  if (new TextEncoder().encode(serialized).byteLength > MAX_VIDEO_COMMAND_IMPORT_BYTES) {
    return { ok: false, reason: 'payload-too-large' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (!isRecord(parsed) || parsed.version !== VIDEO_COMMAND_REMAP_SCHEMA_VERSION || !isRecord(parsed.remaps)) {
    return { ok: false, reason: 'invalid-schema' };
  }
  return { ok: true, validation: validateVideoCommandRemaps(parsed.remaps) };
}

export function searchVideoCommands(
  query: string,
  context: VideoCommandContext,
  remaps: VideoCommandRemaps = {},
  limit = 100,
): Array<VideoCommandDefinition & { chord?: string }> {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const bindings = resolveVideoCommandBindings(remaps);
  return VIDEO_PROFESSIONAL_COMMANDS
    .filter((entry) => isVideoCommandAvailable(entry.id, context))
    .filter((entry) => {
      const haystack = `${entry.label} ${entry.description} ${entry.category} ${entry.id}`.toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .slice(0, Math.max(1, Math.min(200, Math.floor(limit))))
    .map((entry) => ({ ...entry, chord: bindings[entry.id] }));
}

function command<
  const TId extends string,
  const TContexts extends readonly VideoCommandContext[],
>(
  id: TId,
  label: string,
  description: string,
  category: VideoCommandCategory,
  contexts: TContexts,
  defaultChord?: string,
): VideoCommandDefinition & { id: TId; contexts: TContexts } {
  return { id, label, description, category, contexts, defaultChord };
}

function normalizeKey(value: string): string {
  const trimmed = value.trim();
  if (/^f(?:[1-9]|1\d|2[0-4])$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed.slice(0, 1).toUpperCase() + trimmed.slice(1);
}

function toNativeShortcutChord(chord: string): string {
  const parts = chord.split('+');
  const key = parts.at(-1) ?? '';
  const nativeKey = key === 'Comma' ? ','
    : key === 'Period' ? '.'
      : key === 'Apostrophe' ? "'"
        : key === 'Backslash' ? '\\'
          : key === 'Escape' ? 'Esc'
            : key;
  return [...parts.slice(0, -1).map((part) => part === 'Mod' ? 'Ctrl' : part), nativeKey].join('+');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
