import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_TRAIL_LIMIT } from '../lib/activityTrail';
import {
  getActivityTrailBroadcastMessage,
  useActivityTrailStore,
} from './activityTrailStore';

describe('activity trail store', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useActivityTrailStore.setState({
      events: [],
    });
  });

  it('records command activity with generated timestamps and clears the trail', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));

    const event = useActivityTrailStore.getState().recordEvent({
      kind: 'command',
      workspace: 'editor',
      label: 'Cut Tool',
      command: 'timeline:cut',
      source: 'shortcut',
    });

    expect(event.timestamp).toBe(Date.parse('2026-06-04T12:00:00.000Z'));
    expect(useActivityTrailStore.getState().events).toEqual([
      expect.objectContaining({
        id: event.id,
        workspace: 'editor',
        label: 'Cut Tool',
        command: 'timeline:cut',
        source: 'shortcut',
      }),
    ]);

    useActivityTrailStore.getState().clearEvents();
    expect(useActivityTrailStore.getState().events).toEqual([]);
  });

  it('keeps only the newest bounded events', () => {
    for (let index = 0; index < ACTIVITY_TRAIL_LIMIT + 3; index += 1) {
      useActivityTrailStore.getState().recordEvent({
        kind: 'workspace',
        workspace: 'flow',
        label: `Workspace action ${index}`,
        source: 'system',
      });
    }

    const events = useActivityTrailStore.getState().events;
    expect(events).toHaveLength(ACTIVITY_TRAIL_LIMIT);
    expect(events[0]?.label).toBe(`Workspace action ${ACTIVITY_TRAIL_LIMIT + 2}`);
    expect(events.at(-1)?.label).toBe('Workspace action 3');
  });

  it('recognizes broadcast clear messages for multi-window trail resets', () => {
    expect(getActivityTrailBroadcastMessage({ type: 'clear' })).toEqual({ type: 'clear' });
    expect(getActivityTrailBroadcastMessage({ event: { label: 'missing fields' } })).toBeUndefined();
  });
});
