import { describe, expect, it } from 'vitest';
import type { TiltmarkBrushDab } from '../components/ImageEditor/tiltmark/TiltmarkTypes';
import {
  HANE_STROKE_PREVIEW_MAX_DABS_PER_PACKET,
  HANE_STROKE_PREVIEW_MAX_DABS_PER_STROKE,
  HANE_STROKE_PREVIEW_MAX_EVENTS,
  HaneStrokePreviewConsumer,
  parseHaneStrokePreviewPoll,
  type HaneStrokePreviewEvent,
  type HaneStrokePreviewAppend,
  type HaneStrokePreviewBegin,
  type HaneStrokePreviewCancel,
  type HaneStrokePreviewCommit,
  type HaneStrokePreviewOperation,
  type HaneStrokePreviewPoll,
} from './haneStrokePreview';

type OperationInput =
  | Omit<HaneStrokePreviewBegin, 'sessionId' | 'targetId' | 'strokeId'>
  | Omit<HaneStrokePreviewAppend, 'sessionId' | 'targetId' | 'strokeId'>
  | Omit<HaneStrokePreviewCommit, 'sessionId' | 'targetId' | 'strokeId'>
  | Omit<HaneStrokePreviewCancel, 'sessionId' | 'targetId' | 'strokeId'>;

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

function operation(
  input: OperationInput,
): HaneStrokePreviewOperation {
  return {
    sessionId: 'paper-session',
    targetId: 'page-2:frame-4',
    strokeId: 'stroke-1',
    ...input,
  } as HaneStrokePreviewOperation;
}

function event(
  version: number,
  change: OperationInput,
): HaneStrokePreviewEvent {
  return {
    version,
    channel: 'image-preview',
    change: operation(change),
  };
}

function poll(
  version: number,
  events: HaneStrokePreviewEvent[],
  overrides: Partial<HaneStrokePreviewPoll> = {},
): HaneStrokePreviewPoll {
  return {
    version,
    events,
    gap: false,
    action: 'apply-events',
    ...overrides,
  };
}

describe('Hane v2 stroke-preview consumer', () => {
  it('retains a committed overlay until its accepted durable raster epoch is installed', () => {
    const consumer = new HaneStrokePreviewConsumer('paper-session', 'page-2:frame-4');
    consumer.installRasterEpoch(10);
    const result = consumer.applyPoll(poll(3, [
      event(1, {
        type: 'stroke-preview-begin',
        sequence: 0,
        baseRasterEpoch: 10,
        dabs: [dab(0)],
      }),
      event(2, {
        type: 'stroke-preview-append',
        sequence: 1,
        dabs: [dab(1)],
      }),
      event(3, {
        type: 'stroke-preview-commit',
        sequence: 2,
        acceptedRasterEpoch: 11,
      }),
    ]));

    expect(result.requiredRasterEpoch).toBe(11);
    expect(consumer.snapshot().overlays).toMatchObject([{
      strokeId: 'stroke-1',
      pendingAcceptedRasterEpoch: 11,
      dabs: [{ index: 0 }, { index: 1 }],
    }]);
    consumer.installRasterEpoch(10);
    expect(consumer.snapshot().overlays).toHaveLength(1);
    consumer.installRasterEpoch(11);
    expect(consumer.snapshot().overlays).toEqual([]);
  });

  it('sorts out-of-order transport events, accepts dropped append sequences, and ignores stale packets', () => {
    const consumer = new HaneStrokePreviewConsumer('paper-session', 'page-2:frame-4');
    consumer.installRasterEpoch(5);
    consumer.applyPoll(poll(9, [
      event(9, { type: 'stroke-preview-append', sequence: 3, dabs: [dab(3)] }),
      event(7, {
        type: 'stroke-preview-begin',
        sequence: 0,
        baseRasterEpoch: 5,
        dabs: [dab(0)],
      }),
      event(8, { type: 'stroke-preview-append', sequence: 2, dabs: [dab(2)] }),
    ]));
    consumer.applyPoll(poll(11, [
      event(10, { type: 'stroke-preview-append', sequence: 2, dabs: [dab(20)] }),
      event(11, { type: 'stroke-preview-append', sequence: 4, dabs: [dab(4)] }),
    ]));

    expect(consumer.snapshot()).toMatchObject({
      version: 11,
      overlays: [{
        dabs: [{ index: 0 }, { index: 2 }, { index: 3 }, { index: 4 }],
      }],
    });
  });

  it('discards every transient overlay and requests a snapshot on an authority gap', () => {
    const consumer = new HaneStrokePreviewConsumer('paper-session', 'page-2:frame-4');
    consumer.applyPoll(poll(1, [event(1, {
      type: 'stroke-preview-begin',
      sequence: 0,
      baseRasterEpoch: 0,
      dabs: [dab(0)],
    })]));

    const result = consumer.applyPoll(poll(80, [], {
      gap: true,
      action: 'discard-overlays-request-snapshot',
    }));

    expect(result.recoveryRequired).toBe(true);
    expect(consumer.snapshot()).toMatchObject({ version: 80, overlays: [] });
  });

  it('bounds event packets and retained stroke commands under sustained append traffic', () => {
    const oversizedEvents = Array.from(
      { length: HANE_STROKE_PREVIEW_MAX_EVENTS + 1 },
      (_, index) => event(index + 1, {
        type: 'stroke-preview-cancel',
        sequence: index,
        reason: 'input-cancelled',
      }),
    );
    expect(parseHaneStrokePreviewPoll(poll(oversizedEvents.length, oversizedEvents))).toBeNull();
    expect(parseHaneStrokePreviewPoll(poll(1, [event(1, {
      type: 'stroke-preview-begin',
      sequence: 0,
      baseRasterEpoch: 0,
      dabs: Array.from(
        { length: HANE_STROKE_PREVIEW_MAX_DABS_PER_PACKET + 1 },
        (_, index) => dab(index),
      ),
    })]))).toBeNull();

    const consumer = new HaneStrokePreviewConsumer('paper-session', 'page-2:frame-4');
    consumer.applyPoll(poll(1, [event(1, {
      type: 'stroke-preview-begin',
      sequence: 0,
      baseRasterEpoch: 0,
      dabs: [dab(0)],
    })]));
    let version = 1;
    for (let packet = 1; packet <= 18; packet += 1) {
      version += 1;
      consumer.applyPoll(poll(version, [event(version, {
        type: 'stroke-preview-append',
        sequence: packet,
        dabs: Array.from(
          { length: HANE_STROKE_PREVIEW_MAX_DABS_PER_PACKET },
          (_, index) => dab(packet * 1000 + index),
        ),
      })]));
    }
    const retained = consumer.snapshot().overlays[0]?.dabs ?? [];
    expect(retained).toHaveLength(HANE_STROKE_PREVIEW_MAX_DABS_PER_STROKE);
    expect(retained[0]?.index).toBeGreaterThan(0);
  });
});
