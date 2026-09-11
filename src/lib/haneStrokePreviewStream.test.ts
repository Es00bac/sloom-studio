import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TiltmarkBrushDab } from '../components/ImageEditor/tiltmark/TiltmarkTypes';

const host = vi.hoisted(() => ({
  capabilities: { version: 2 },
  pairing: 'paired',
  provider: true,
  fetch: vi.fn(),
}));
const sync = vi.hoisted(() => ({
  applyRemote: vi.fn(async () => true),
  initialize: vi.fn(),
}));

vi.mock('./remoteHostClient', () => ({
  getHaneLinkProviderCapabilities: () => host.capabilities,
  getRemoteHostPairingState: () => host.pairing,
  isHaneLinkProviderSession: () => host.provider,
  remoteHostFetch: host.fetch,
}));
vi.mock('./projectSyncService', () => ({
  getProjectSyncChannel: () => ({ applyRemote: sync.applyRemote }),
}));
vi.mock('./imageSyncChannel', () => ({
  initializeImageSyncChannel: sync.initialize,
}));

import {
  __resetHaneStrokePreviewForTests,
  startHaneStrokePreviewStream,
  stopHaneStrokePreviewStream,
  useHaneStrokePreviewStore,
} from './haneStrokePreview';

function dab(index: number): TiltmarkBrushDab {
  return {
    index,
    x: 12 + index,
    y: 18,
    width: 8,
    height: 4,
    rotationRad: 0,
    shape: 'ellipse',
    color: '#315c9c',
    opacity: 0.8,
    flow: 0.5,
    hardness: 0.4,
    grain: 0,
    wetness: 0,
    solvent: 0,
    strandCount: 0,
    particleCount: 0,
    spread: 0,
    interaction: 'paint',
    pickup: 0,
    colorMix: 0,
    bristleBend: 0,
    bristleSplay: 0,
    bristleCohesion: 1,
    paintLoad: 1,
    seed: index + 1,
    eraser: false,
  };
}

function response(value: unknown): Response {
  return {
    ok: true,
    json: async () => value,
  } as Response;
}

function snapshot(rasterEpoch: number) {
  return response({
    version: rasterEpoch,
    rasterEpoch,
    snapshot: {
      type: 'image-document-snapshot',
      document: {
        id: 'paper-session',
        width: 1200,
        height: 800,
        layers: [],
      },
    },
  });
}

function event(change: Record<string, unknown>, version: number) {
  return {
    version,
    channel: 'image-preview',
    change: {
      sessionId: 'paper-session',
      targetId: 'page-2:frame-4',
      strokeId: 'stroke-1',
      ...change,
    },
  };
}

function abortablePending(signal?: AbortSignal): Promise<Response | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    signal?.addEventListener('abort', () => resolve(null), { once: true });
  });
}

beforeEach(() => {
  host.fetch.mockReset();
  host.capabilities = { version: 2 };
  host.pairing = 'paired';
  host.provider = true;
  sync.applyRemote.mockClear();
  sync.initialize.mockClear();
});

afterEach(() => {
  __resetHaneStrokePreviewForTests();
});

describe('Hane v2 preview stream', () => {
  it('installs the accepted durable snapshot before retiring a committed overlay', async () => {
    const snapshots = [snapshot(10), snapshot(11)];
    const previews = [
      response({
        version: 1,
        gap: false,
        action: 'apply-events',
        events: [event({
          type: 'stroke-preview-begin',
          sequence: 0,
          baseRasterEpoch: 10,
          dabs: [dab(0)],
        }, 1)],
      }),
      response({
        version: 2,
        gap: false,
        action: 'apply-events',
        events: [event({
          type: 'stroke-preview-commit',
          sequence: 1,
          acceptedRasterEpoch: 11,
        }, 2)],
      }),
    ];
    host.fetch.mockImplementation((path: string, init?: { signal?: AbortSignal }) => {
      if (path === '/project/image/snapshot') return Promise.resolve(snapshots.shift() ?? snapshot(11));
      if (path.startsWith('/project/image/preview-events')) {
        const next = previews.shift();
        return next ? Promise.resolve(next) : abortablePending(init?.signal);
      }
      return Promise.resolve(null);
    });
    const installed = vi.fn(async (_epoch: number) => undefined);

    startHaneStrokePreviewStream({
      sessionId: 'paper-session',
      targetId: 'page-2:frame-4',
      documentId: 'paper-session',
      onDurableSnapshotInstalled: installed,
    });

    await vi.waitFor(() => {
      expect(useHaneStrokePreviewStore.getState()).toMatchObject({
        installedRasterEpoch: 11,
        overlays: [],
        status: 'streaming',
      });
    });
    expect(sync.applyRemote).toHaveBeenCalledTimes(2);
    expect(installed.mock.calls.map(([epoch]) => epoch)).toEqual([10, 11]);
    expect(host.fetch.mock.calls.some(
      ([path]) => path === '/project/image/preview-events?since=1',
    )).toBe(true);
    stopHaneStrokePreviewStream();
  });

  it('discards an active overlay on gap and repairs from the latest snapshot', async () => {
    const snapshots = [snapshot(10), snapshot(12)];
    let resolveGap: (value: Response) => void = () => {
      throw new Error('Gap poll was not requested.');
    };
    let previewCalls = 0;
    host.fetch.mockImplementation((path: string, init?: { signal?: AbortSignal }) => {
      if (path === '/project/image/snapshot') return Promise.resolve(snapshots.shift() ?? snapshot(12));
      if (path.startsWith('/project/image/preview-events')) {
        previewCalls += 1;
        if (previewCalls === 1) {
          return Promise.resolve(response({
            version: 1,
            gap: false,
            action: 'apply-events',
            events: [event({
              type: 'stroke-preview-begin',
              sequence: 0,
              baseRasterEpoch: 10,
              dabs: [dab(0)],
            }, 1)],
          }));
        }
        if (previewCalls === 2) {
          return new Promise<Response>((resolve) => {
            resolveGap = resolve;
          });
        }
        return abortablePending(init?.signal);
      }
      return Promise.resolve(null);
    });

    startHaneStrokePreviewStream({
      sessionId: 'paper-session',
      targetId: 'page-2:frame-4',
      documentId: 'paper-session',
      onDurableSnapshotInstalled: async () => undefined,
    });
    await vi.waitFor(() => {
      expect(useHaneStrokePreviewStore.getState().overlays).toHaveLength(1);
    });
    resolveGap(response({
      version: 80,
      events: [],
      gap: true,
      action: 'discard-overlays-request-snapshot',
    }));
    await vi.waitFor(() => {
      expect(useHaneStrokePreviewStore.getState()).toMatchObject({
        version: 80,
        installedRasterEpoch: 12,
        overlays: [],
        status: 'streaming',
      });
    });
    expect(sync.applyRemote).toHaveBeenCalledTimes(2);
  });

  it('discards transient state and installs a fresh durable snapshot after reconnect', async () => {
    const snapshots = [snapshot(10), snapshot(12)];
    let rejectConnection: (reason?: unknown) => void = () => {
      throw new Error('Reconnect poll was not requested.');
    };
    let previewCalls = 0;
    host.fetch.mockImplementation((path: string, init?: { signal?: AbortSignal }) => {
      if (path === '/project/image/snapshot') return Promise.resolve(snapshots.shift() ?? snapshot(12));
      if (path.startsWith('/project/image/preview-events')) {
        previewCalls += 1;
        if (previewCalls === 1) {
          return Promise.resolve(response({
            version: 1,
            gap: false,
            action: 'apply-events',
            events: [event({
              type: 'stroke-preview-begin',
              sequence: 0,
              baseRasterEpoch: 10,
              dabs: [dab(0)],
            }, 1)],
          }));
        }
        if (previewCalls === 2) {
          return new Promise<Response>((_resolve, reject) => {
            rejectConnection = reject;
          });
        }
        return abortablePending(init?.signal);
      }
      return Promise.resolve(null);
    });

    startHaneStrokePreviewStream({
      sessionId: 'paper-session',
      targetId: 'page-2:frame-4',
      documentId: 'paper-session',
      onDurableSnapshotInstalled: async () => undefined,
    });
    await vi.waitFor(() => {
      expect(useHaneStrokePreviewStore.getState().overlays).toHaveLength(1);
    });
    rejectConnection(new Error('simulated Wi-Fi drop'));
    await vi.waitFor(() => {
      expect(useHaneStrokePreviewStore.getState()).toMatchObject({
        installedRasterEpoch: 12,
        overlays: [],
        status: 'streaming',
        version: 0,
      });
    }, { timeout: 2500 });
    expect(sync.applyRemote).toHaveBeenCalledTimes(2);
  });
});
