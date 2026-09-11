import { afterEach, describe, expect, it } from 'vitest';
import {
  clearProjectSyncChannels,
  getProjectSyncChannel,
  getProjectSyncEventsSince,
  getHostProjectSyncAsset,
  getProjectSyncVersion,
  projectSyncCursorHasGap,
  getRegisteredProjectSyncChannelIds,
  recordProjectSyncChange,
  recordProjectSyncAsset,
  registerProjectSyncChannel,
  resetProjectSyncLog,
  retainProjectSyncAssets,
  stageProjectSyncAssets,
  waitForProjectSyncEvents,
  type ProjectSyncChannel,
} from './projectSyncService';

describe('projectSyncService — host-authority event log', () => {
  afterEach(() => {
    resetProjectSyncLog();
  });

  it('starts at version 0 with no events', () => {
    expect(getProjectSyncVersion()).toBe(0);
    expect(getProjectSyncEventsSince(0)).toEqual([]);
  });

  it('assigns one monotonic version across all channels and tags each event', () => {
    const a = recordProjectSyncChange('source-library', { type: 'rename', label: 'a' });
    const b = recordProjectSyncChange('flow', { type: 'node-add', id: 'n1' });
    const c = recordProjectSyncChange('source-library', { type: 'rename', label: 'c' });

    expect([a.version, b.version, c.version]).toEqual([1, 2, 3]);
    expect(getProjectSyncVersion()).toBe(3);
    expect(a.channel).toBe('source-library');
    expect(b.channel).toBe('flow');
    expect(a.change).toEqual({ type: 'rename', label: 'a' });
  });

  it('returns only events strictly newer than the global cursor', () => {
    recordProjectSyncChange('flow', 1); // v1
    recordProjectSyncChange('flow', 2); // v2
    recordProjectSyncChange('flow', 3); // v3

    expect(getProjectSyncEventsSince(1).map((event) => event.version)).toEqual([2, 3]);
    expect(getProjectSyncEventsSince(3)).toEqual([]);
  });

  it('filters by channel while keeping the global version cursor', () => {
    recordProjectSyncChange('source-library', 'sl-1'); // v1
    recordProjectSyncChange('flow', 'flow-1'); // v2
    recordProjectSyncChange('source-library', 'sl-2'); // v3
    recordProjectSyncChange('paper', 'paper-1'); // v4

    const sourceLibrary = getProjectSyncEventsSince(0, 'source-library');
    expect(sourceLibrary.map((event) => event.version)).toEqual([1, 3]);
    // A client at the global cursor 2 still gets its next source-library op (v3), never missing it.
    expect(getProjectSyncEventsSince(2, 'source-library').map((event) => event.version)).toEqual([3]);
    expect(getProjectSyncEventsSince(0, 'flow').map((event) => event.version)).toEqual([2]);
  });

  it('bounds the retained tail but keeps advancing the version', () => {
    for (let index = 0; index < 600; index += 1) {
      recordProjectSyncChange('flow', index);
    }

    expect(getProjectSyncVersion()).toBe(600);
    const all = getProjectSyncEventsSince(0);
    expect(all.length).toBe(512);
    expect(all[all.length - 1].version).toBe(600);
    expect(all[0].version).toBe(89);
    expect(projectSyncCursorHasGap(0)).toBe(true);
    expect(projectSyncCursorHasGap(88)).toBe(false);
  });

  it('marks a long-poll response for snapshot repair when its cursor fell behind the retained tail', async () => {
    for (let index = 0; index < 600; index += 1) recordProjectSyncChange('video', index);
    const result = await waitForProjectSyncEvents(0, 10_000, 'video');
    expect(result.gap).toBe(true);
    expect(result.version).toBe(600);
    expect(result.events[0].version).toBe(89);
  });

  it('marks a cursor ahead of the authority after a host restart for snapshot repair', async () => {
    recordProjectSyncChange('video', 'before-restart');
    resetProjectSyncLog();
    expect(projectSyncCursorHasGap(1)).toBe(true);
    const result = await waitForProjectSyncEvents(1, 10_000, 'video');
    expect(result).toMatchObject({ version: 0, events: [], gap: true });
  });

  it('long-poll resolves immediately when matching events already exist past the cursor', async () => {
    recordProjectSyncChange('flow', 'a'); // v1
    const result = await waitForProjectSyncEvents(0, 10_000, 'flow');
    expect(result.version).toBe(1);
    expect(result.events.map((event) => event.version)).toEqual([1]);
    expect(result.gap).toBe(false);
  });

  it('long-poll parks until a matching change is recorded, then delivers it', async () => {
    const pending = waitForProjectSyncEvents(getProjectSyncVersion(), 10_000, 'flow');
    const recorded = recordProjectSyncChange('flow', 'late');
    const result = await pending;
    expect(result.version).toBe(recorded.version);
    expect(result.events).toEqual([recorded]);
  });

  it('long-poll stays parked when a non-matching channel changes, settles on the matching one', async () => {
    const pending = waitForProjectSyncEvents(getProjectSyncVersion(), 10_000, 'flow');
    // An op on another channel must NOT settle this waiter.
    recordProjectSyncChange('source-library', 'noise'); // v1
    recordProjectSyncChange('paper', 'more-noise'); // v2
    const flowEvent = recordProjectSyncChange('flow', 'mine'); // v3
    const result = await pending;
    expect(result.events).toHaveLength(1);
    expect(result.events[0].version).toBe(flowEvent.version);
    expect(result.events[0].channel).toBe('flow');
  });

  it('repairs a cursor that falls behind while its channel-filtered long-poll is parked', async () => {
    const pending = waitForProjectSyncEvents(0, 10_000, 'video');
    for (let index = 0; index < 513; index += 1) {
      recordProjectSyncChange('paper', index);
    }
    const result = await pending;
    expect(result.gap).toBe(true);
    expect(result.version).toBe(513);
    expect(result.events).toEqual([]);
  });

  it('long-poll heartbeats with an empty batch on timeout', async () => {
    const result = await waitForProjectSyncEvents(getProjectSyncVersion(), 5, 'flow');
    expect(result.events).toEqual([]);
    expect(result.version).toBe(getProjectSyncVersion());
  });

  it('reset returns the log to a pristine state', () => {
    recordProjectSyncChange('flow', 'a');
    resetProjectSyncLog();
    expect(getProjectSyncVersion()).toBe(0);
    expect(getProjectSyncEventsSince(0)).toEqual([]);
  });
});

describe('projectSyncService — retained workspace assets', () => {
  afterEach(() => {
    resetProjectSyncLog();
  });

  it('keeps a declared Paper inventory larger than the generic 256-entry transient tail', () => {
    const assetIds = Array.from({ length: 300 }, (_, index) => `sha256:${index.toString(16).padStart(64, '0')}`);
    retainProjectSyncAssets('paper', assetIds);
    for (const [index, assetId] of assetIds.entries()) {
      recordProjectSyncAsset('paper', assetId, `data:application/octet-stream;base64,${index}`);
    }
    expect(getHostProjectSyncAsset('paper', assetIds[0])).toBe('data:application/octet-stream;base64,0');
    expect(getHostProjectSyncAsset('paper', assetIds[299])).toBe('data:application/octet-stream;base64,299');

    retainProjectSyncAssets('paper', assetIds.slice(250));
    expect(getHostProjectSyncAsset('paper', assetIds[0])).toBeNull();
    expect(getHostProjectSyncAsset('paper', assetIds[250])).toBe('data:application/octet-stream;base64,250');
  });

  it('does not prune the last accepted inventory while a replacement inventory is only staged', () => {
    retainProjectSyncAssets('paper', ['old']);
    recordProjectSyncAsset('paper', 'old', 'data:application/octet-stream;base64,T0xE');
    stageProjectSyncAssets('paper', ['new']);
    recordProjectSyncAsset('paper', 'new', 'data:application/octet-stream;base64,TkVX');

    expect(getHostProjectSyncAsset('paper', 'old')).toBe('data:application/octet-stream;base64,T0xE');
    expect(getHostProjectSyncAsset('paper', 'new')).toBe('data:application/octet-stream;base64,TkVX');

    retainProjectSyncAssets('paper', ['new']);
    expect(getHostProjectSyncAsset('paper', 'old')).toBeNull();
    expect(getHostProjectSyncAsset('paper', 'new')).toBe('data:application/octet-stream;base64,TkVX');
  });
});

describe('projectSyncService — channel registry', () => {
  afterEach(() => {
    clearProjectSyncChannels();
  });

  const makeChannel = (id: string): ProjectSyncChannel => ({
    id,
    applyRemote: () => true,
    snapshot: () => ({ id }),
  });

  it('registers and resolves channels by id', () => {
    const flow = makeChannel('flow');
    const paper = makeChannel('paper');
    registerProjectSyncChannel(flow);
    registerProjectSyncChannel(paper);

    expect(getProjectSyncChannel('flow')).toBe(flow);
    expect(getProjectSyncChannel('paper')).toBe(paper);
    expect(getProjectSyncChannel('missing')).toBeUndefined();
    expect(getRegisteredProjectSyncChannelIds().sort()).toEqual(['flow', 'paper']);
  });

  it('replaces a channel registered under the same id (last wins)', () => {
    const first = makeChannel('image');
    const second = makeChannel('image');
    registerProjectSyncChannel(first);
    registerProjectSyncChannel(second);

    expect(getProjectSyncChannel('image')).toBe(second);
    expect(getRegisteredProjectSyncChannelIds()).toEqual(['image']);
  });

  it('clear drops all registered channels', () => {
    registerProjectSyncChannel(makeChannel('flow'));
    clearProjectSyncChannels();
    expect(getRegisteredProjectSyncChannelIds()).toEqual([]);
  });
});
