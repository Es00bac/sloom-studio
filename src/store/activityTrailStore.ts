import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
  appendActivityTrailEvent,
  createActivityTrailEvent,
  mergeActivityTrailEvents,
  sanitizeActivityTrailSnapshot,
  type ActivityTrailEvent,
  type ActivityTrailEventInput,
  type ActivityTrailSource,
} from '../lib/activityTrail';

export const ACTIVITY_TRAIL_STORAGE_KEY = 'signal-loom-activity-trail';
export const ACTIVITY_TRAIL_BROADCAST_CHANNEL = 'signal-loom-activity-trail-events';

export type ActivityTrailBroadcastMessage =
  | { type: 'event'; event: ActivityTrailEvent }
  | { type: 'clear' };

interface ActivityTrailState {
  events: ActivityTrailEvent[];
  recordEvent: (event: ActivityTrailEventInput) => ActivityTrailEvent;
  mergeEvents: (events: ActivityTrailEvent[]) => void;
  clearEvents: (options?: { broadcast?: boolean }) => void;
}

export const useActivityTrailStore = create<ActivityTrailState>()(
  persist(
    (set) => ({
      events: [],
      recordEvent: (input) => {
        const event = createActivityTrailEvent(input);
        set((state) => ({ events: appendActivityTrailEvent(state.events, event) }));
        postActivityTrailEvent(event);
        return event;
      },
      mergeEvents: (events) => {
        const sanitizedEvents = sanitizeActivityTrailSnapshot(events);
        if (sanitizedEvents.length === 0) return;
        set((state) => ({ events: mergeActivityTrailEvents(state.events, sanitizedEvents) }));
      },
      clearEvents: (options = {}) => {
        set({ events: [] });
        if (options.broadcast !== false) {
          postActivityTrailClear();
        }
      },
    }),
    {
      name: ACTIVITY_TRAIL_STORAGE_KEY,
      storage: createJSONStorage(getActivityTrailStorage),
      partialize: (state) => ({ events: state.events }),
      merge: (persisted, current) => ({
        ...current,
        events: sanitizeActivityTrailSnapshot((persisted as Partial<ActivityTrailState> | undefined)?.events),
      }),
    },
  ),
);

export function postActivityTrailEvent(event: ActivityTrailEvent): boolean {
  return postActivityTrailMessage({ type: 'event', event });
}

export function postActivityTrailClear(): boolean {
  return postActivityTrailMessage({ type: 'clear' });
}

export function recordActivityTrailWorkspaceEvent(
  workspace: ActivityTrailEvent['workspace'],
  label: string,
  detail?: string,
  source: ActivityTrailSource = 'system',
): ActivityTrailEvent {
  return useActivityTrailStore.getState().recordEvent({
    kind: 'workspace',
    workspace,
    label,
    ...(detail ? { detail } : {}),
    source,
  });
}

export function getActivityTrailBroadcastMessage(value: unknown): ActivityTrailBroadcastMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'clear') return { type: 'clear' };
  if (value.type === 'event') {
    const event = getActivityTrailEventFromBroadcastMessage(value);
    return event ? { type: 'event', event } : undefined;
  }
  const event = getActivityTrailEventFromBroadcastMessage(value);
  return event ? { type: 'event', event } : undefined;
}

export function getActivityTrailEventFromBroadcastMessage(value: unknown): ActivityTrailEvent | undefined {
  const eventValue = isRecord(value) && value.type === 'event' ? value.event : isRecord(value) ? value.event : undefined;
  const events = sanitizeActivityTrailSnapshot(eventValue ? [eventValue] : []);
  return events[0];
}

function postActivityTrailMessage(message: ActivityTrailBroadcastMessage): boolean {
  if (typeof BroadcastChannel === 'undefined') return false;

  const channel = new BroadcastChannel(ACTIVITY_TRAIL_BROADCAST_CHANNEL);
  channel.postMessage(message);
  channel.close();
  return true;
}

const memoryStorage = new Map<string, string>();

function getActivityTrailStorage(): StateStorage {
  let browserStorage: Storage | undefined;
  try {
    browserStorage = typeof globalThis === 'undefined' ? undefined : globalThis.localStorage;
  } catch {
    browserStorage = undefined;
  }

  if (
    browserStorage &&
    typeof browserStorage.getItem === 'function' &&
    typeof browserStorage.setItem === 'function' &&
    typeof browserStorage.removeItem === 'function'
  ) {
    return {
      getItem: (name) => {
        try {
          return browserStorage.getItem(name);
        } catch {
          return null;
        }
      },
      setItem: (name, value) => {
        try {
          browserStorage.setItem(name, value);
        } catch {
          // Ignore unavailable/quota-limited storage during startup.
        }
      },
      removeItem: (name) => {
        try {
          browserStorage.removeItem(name);
        } catch {
          // Ignore unavailable storage during startup.
        }
      },
    };
  }

  return {
    getItem: (name) => memoryStorage.get(name) ?? null,
    setItem: (name, value) => {
      memoryStorage.set(name, value);
    },
    removeItem: (name) => {
      memoryStorage.delete(name);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
