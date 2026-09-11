import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_TRAIL_LIMIT,
  appendActivityTrailEvent,
  createActivityTrailEvent,
  resolveActivityTrailCommandLabel,
  sanitizeActivityTrailSnapshot,
} from './activityTrail';

describe('activity trail model', () => {
  it('prepends new events and keeps the list bounded', () => {
    const existing = Array.from({ length: ACTIVITY_TRAIL_LIMIT }, (_, index) =>
      createActivityTrailEvent({
        id: `event-${index}`,
        timestamp: 1_700_000_000_000 + index,
        kind: 'command',
        workspace: 'flow',
        label: `Event ${index}`,
        command: 'view:flow',
        source: 'menu',
      }),
    );
    const next = createActivityTrailEvent({
      id: 'new-event',
      timestamp: 1_800_000_000_000,
      kind: 'app-action',
      workspace: 'image',
      label: 'Provider Settings',
      source: 'palette',
    });

    const events = appendActivityTrailEvent(existing, next);

    expect(events).toHaveLength(ACTIVITY_TRAIL_LIMIT);
    expect(events[0]?.id).toBe('new-event');
    expect(events.at(-1)?.id).toBe('event-198');
  });

  it('sanitizes persisted snapshots without trusting malformed local storage', () => {
    const events = sanitizeActivityTrailSnapshot([
      {
        id: 'valid',
        timestamp: 1_700_000_000_000,
        kind: 'command',
        workspace: 'paper',
        label: 'Export Print PDF...',
        command: 'paper:export-pdf',
        detail: 'paper:export-pdf',
        source: 'menu',
      },
      {
        id: 'bad-kind',
        timestamp: 1_700_000_000_001,
        kind: 'launch',
        workspace: 'flow',
        label: 'Launch',
      },
      {
        id: 'bad-workspace',
        timestamp: 1_700_000_000_002,
        kind: 'command',
        workspace: 'paint',
        label: 'Paint',
      },
      {
        id: 'bad-time',
        timestamp: Number.NaN,
        kind: 'command',
        workspace: 'flow',
        label: 'Flow',
      },
    ]);

    expect(events).toEqual([
      expect.objectContaining({
        id: 'valid',
        kind: 'command',
        workspace: 'paper',
        label: 'Export Print PDF...',
        command: 'paper:export-pdf',
        source: 'menu',
      }),
    ]);
  });

  it('redacts sensitive labels and details before persistence', () => {
    const event = createActivityTrailEvent({
      id: 'sensitive',
      timestamp: 1_700_000_000_000,
      kind: 'workspace',
      workspace: 'image',
      label: 'Opened /home/user/private/project.png',
      detail: 'Image URL https://example.com/private.png with OPENAI_API_KEY=sk-test',
      source: 'system',
    });
    const persisted = sanitizeActivityTrailSnapshot([
      {
        ...event,
        label: 'Prompt: render the private character bible with bearer abc123',
        detail: 'Dropped blob:http://localhost/private and data:image/png;base64,abc',
      },
    ]);

    expect(event.label).toBe('[redacted activity]');
    expect(event.detail).toBe('[redacted secret]');
    expect(persisted[0]?.label).toBe('[redacted activity]');
    expect(persisted[0]?.detail).toBe('[redacted media reference]');
  });

  it('resolves user-facing command labels from the active workspace menu model', () => {
    expect(resolveActivityTrailCommandLabel('image:tool-brush', 'image')).toBe('Brush Tool');
    expect(resolveActivityTrailCommandLabel('view:activity-trail', 'flow')).toBe('Activity Trail...');
    expect(resolveActivityTrailCommandLabel('image:tool-brush', 'flow')).toBe('image:tool-brush');
  });
});
