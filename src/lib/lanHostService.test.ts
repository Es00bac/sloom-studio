import { afterEach, describe, expect, it } from 'vitest';
import type { SourceLibraryNativeChange } from './sourceLibraryNativeSync';
import {
  getHostSourceLibraryEventsSince,
  getHostSourceLibraryVersion,
  recordHostSourceLibraryChange,
  resetHostSourceLibraryLog,
  waitForHostSourceLibraryEvents,
} from './lanHostService';

const renameChange = (label: string): SourceLibraryNativeChange => ({
  type: 'source-bin-item-renamed',
  itemId: 'item-1',
  label,
});

describe('lanHostService change log', () => {
  afterEach(() => {
    resetHostSourceLibraryLog();
  });

  it('starts at version 0 with no events', () => {
    expect(getHostSourceLibraryVersion()).toBe(0);
    expect(getHostSourceLibraryEventsSince(0)).toEqual([]);
  });

  it('assigns monotonic versions and records the change verbatim', () => {
    const first = recordHostSourceLibraryChange(renameChange('a'));
    const second = recordHostSourceLibraryChange(renameChange('b'));

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(getHostSourceLibraryVersion()).toBe(2);
    expect(first.change).toEqual(renameChange('a'));
  });

  it('returns only events strictly newer than the client cursor', () => {
    recordHostSourceLibraryChange(renameChange('a')); // v1
    recordHostSourceLibraryChange(renameChange('b')); // v2
    recordHostSourceLibraryChange(renameChange('c')); // v3

    const since1 = getHostSourceLibraryEventsSince(1);
    expect(since1.map((event) => event.version)).toEqual([2, 3]);
    expect(getHostSourceLibraryEventsSince(3)).toEqual([]);
  });

  it('bounds the retained tail but keeps advancing the version', () => {
    for (let index = 0; index < 600; index += 1) {
      recordHostSourceLibraryChange(renameChange(`v${index}`));
    }

    expect(getHostSourceLibraryVersion()).toBe(600);
    // Older entries are trimmed (MAX_LOG_ENTRIES = 512); the most recent window survives.
    const all = getHostSourceLibraryEventsSince(0);
    expect(all.length).toBe(512);
    expect(all[all.length - 1].version).toBe(600);
    expect(all[0].version).toBe(89);
  });

  it('reports a retained-tail gap so a lagging Source Library client can re-seed', async () => {
    for (let index = 0; index < 600; index += 1) {
      recordHostSourceLibraryChange(renameChange(`v${index}`));
    }
    const result = await waitForHostSourceLibraryEvents(0, 10_000);
    expect(result.gap).toBe(true);
    expect(result.version).toBe(600);
  });

  it('long-poll resolves immediately when events already exist past the cursor', async () => {
    recordHostSourceLibraryChange(renameChange('a')); // v1
    const result = await waitForHostSourceLibraryEvents(0, 10_000);
    expect(result.version).toBe(1);
    expect(result.events.map((event) => event.version)).toEqual([1]);
  });

  it('long-poll parks until the next change is recorded, then delivers just it', async () => {
    const pending = waitForHostSourceLibraryEvents(getHostSourceLibraryVersion(), 10_000);
    // Record after the waiter has parked.
    const recorded = recordHostSourceLibraryChange(renameChange('late'));
    const result = await pending;
    expect(result.version).toBe(recorded.version);
    expect(result.events).toEqual([recorded]);
  });

  it('long-poll heartbeats with an empty batch on timeout', async () => {
    const result = await waitForHostSourceLibraryEvents(getHostSourceLibraryVersion(), 5);
    expect(result.events).toEqual([]);
    expect(result.version).toBe(getHostSourceLibraryVersion());
  });

  it('reset returns the log to a pristine state', () => {
    recordHostSourceLibraryChange(renameChange('a'));
    resetHostSourceLibraryLog();
    expect(getHostSourceLibraryVersion()).toBe(0);
    expect(getHostSourceLibraryEventsSince(0)).toEqual([]);
  });
});
