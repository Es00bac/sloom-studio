import { buildAppMenuGroups } from './appMenuModel';
import { isNativeMenuCommand, type NativeMenuCommand } from './nativeApp';
import type { KeyboardShortcutMap } from './keyboardShortcuts';
import type { WorkspaceView } from '../types/flow';

export const ACTIVITY_TRAIL_LIMIT = 200;
const ACTIVITY_TRAIL_LABEL_MAX_LENGTH = 96;
const ACTIVITY_TRAIL_DETAIL_MAX_LENGTH = 160;

export type ActivityTrailEventKind = 'command' | 'app-action' | 'workspace' | 'system';
export type ActivityTrailSource =
  | 'menu'
  | 'native-menu'
  | 'palette'
  | 'keyboard'
  | 'shortcut'
  | 'toolbar'
  | 'topbar'
  | 'system';

export interface ActivityTrailEvent {
  id: string;
  timestamp: number;
  kind: ActivityTrailEventKind;
  workspace: WorkspaceView;
  label: string;
  detail?: string;
  command?: NativeMenuCommand;
  source?: ActivityTrailSource;
}

export type ActivityTrailEventInput = Omit<ActivityTrailEvent, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: number;
};

const VALID_KINDS = new Set<ActivityTrailEventKind>(['command', 'app-action', 'workspace', 'system']);
const VALID_WORKSPACES = new Set<WorkspaceView>(['flow', 'editor', 'image', 'paper']);
const VALID_SOURCES = new Set<ActivityTrailSource>([
  'menu',
  'native-menu',
  'palette',
  'keyboard',
  'shortcut',
  'toolbar',
  'topbar',
  'system',
]);

export function createActivityTrailEvent(input: ActivityTrailEventInput): ActivityTrailEvent {
  const detail = sanitizeActivityTrailDetail(input.detail);
  return {
    id: sanitizeId(input.id) ?? createActivityTrailEventId(),
    timestamp: isFiniteTimestamp(input.timestamp) ? input.timestamp : Date.now(),
    kind: VALID_KINDS.has(input.kind) ? input.kind : 'system',
    workspace: VALID_WORKSPACES.has(input.workspace) ? input.workspace : 'flow',
    label: sanitizeActivityTrailLabel(input.label) ?? 'Activity',
    ...(detail ? { detail } : {}),
    ...(input.command && isNativeMenuCommand(input.command) ? { command: input.command } : {}),
    ...(input.source && VALID_SOURCES.has(input.source) ? { source: input.source } : {}),
  };
}

export function appendActivityTrailEvent(
  events: ActivityTrailEvent[],
  event: ActivityTrailEvent,
  limit = ACTIVITY_TRAIL_LIMIT,
): ActivityTrailEvent[] {
  return mergeActivityTrailEvents(events, [event], limit);
}

export function mergeActivityTrailEvents(
  currentEvents: ActivityTrailEvent[],
  incomingEvents: ActivityTrailEvent[],
  limit = ACTIVITY_TRAIL_LIMIT,
): ActivityTrailEvent[] {
  const seen = new Set<string>();
  return [...incomingEvents, ...currentEvents]
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .slice(0, Math.max(1, limit));
}

export function sanitizeActivityTrailSnapshot(value: unknown, limit = ACTIVITY_TRAIL_LIMIT): ActivityTrailEvent[] {
  if (!Array.isArray(value)) return [];

  const sanitizedEvents = value.flatMap((candidate) => {
    const event = sanitizeActivityTrailEvent(candidate);
    return event ? [event] : [];
  });

  return mergeActivityTrailEvents([], sanitizedEvents, limit);
}

export function resolveActivityTrailCommandLabel(
  command: NativeMenuCommand,
  workspace: WorkspaceView,
  shortcuts?: KeyboardShortcutMap,
): string {
  const groups = buildAppMenuGroups(workspace, shortcuts);
  for (const group of groups) {
    if (!group.enabled) continue;
    const item = group.items.find((item) => item.command === command);
    if (item) return item.label;
  }
  return command;
}

function sanitizeActivityTrailEvent(value: unknown): ActivityTrailEvent | undefined {
  if (!isRecord(value)) return undefined;
  if (!isFiniteTimestamp(value.timestamp)) return undefined;
  if (!VALID_KINDS.has(value.kind as ActivityTrailEventKind)) return undefined;
  if (!VALID_WORKSPACES.has(value.workspace as WorkspaceView)) return undefined;

  const id = sanitizeId(value.id);
  const label = sanitizeActivityTrailLabel(value.label);
  if (!id || !label) return undefined;

  const detail = sanitizeActivityTrailDetail(value.detail);
  const command = isNativeMenuCommand(value.command) ? value.command : undefined;
  const source = VALID_SOURCES.has(value.source as ActivityTrailSource)
    ? value.source as ActivityTrailSource
    : undefined;

  return {
    id,
    timestamp: value.timestamp,
    kind: value.kind as ActivityTrailEventKind,
    workspace: value.workspace as WorkspaceView,
    label,
    ...(detail ? { detail } : {}),
    ...(command ? { command } : {}),
    ...(source ? { source } : {}),
  };
}

function sanitizeActivityTrailDetail(value: unknown): string | undefined {
  const text = sanitizeActivityTrailText(value, ACTIVITY_TRAIL_DETAIL_MAX_LENGTH);
  if (!text) return undefined;

  return redactSensitiveActivityText(text, 'detail');
}

function sanitizeActivityTrailLabel(value: unknown): string | undefined {
  const text = sanitizeActivityTrailText(value, ACTIVITY_TRAIL_LABEL_MAX_LENGTH);
  if (!text) return undefined;

  return redactSensitiveActivityText(text, 'label');
}

function redactSensitiveActivityText(text: string, field: 'label' | 'detail'): string {
  const lower = text.toLowerCase();
  if (
    lower.includes('authorization') ||
    /\bbearer\s+\S+/i.test(text) ||
    /api[-_\s]?key/i.test(text) ||
    /\b(secret|access[_-\s]?token|auth[_-\s]?token)\b/i.test(text) ||
    /\bsk-[a-z0-9_-]{8,}/i.test(text)
  ) {
    return field === 'label' ? '[redacted activity]' : '[redacted secret]';
  }
  if (
    lower.includes('data:') ||
    lower.includes('blob:') ||
    lower.includes('signal-loom-asset://')
  ) {
    return field === 'label' ? '[redacted activity]' : '[redacted media reference]';
  }
  if (/https?:\/\//i.test(text)) {
    return field === 'label' ? '[redacted activity]' : '[redacted URL]';
  }
  if (/(^|\s)(\/[^\s]+|~\/[^\s]+|[a-z]:\\[^\s]+)/i.test(text) || text.includes('\\')) {
    return field === 'label' ? '[redacted activity]' : '[redacted path]';
  }
  return text;
}

function sanitizeActivityTrailText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function sanitizeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 96 ? trimmed : undefined;
}

function createActivityTrailEventId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
