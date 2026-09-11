import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageFrameAnimation } from '../../types/imageEditor';
import {
  advanceAnimationPlaybackCursor,
  appendAnimationFrame,
  applyAnimationFrameAt,
  deriveNextFrameIdentity,
  getImageFrameAnimation,
  normalizeImageFrameAnimationDocument,
  planAnimationFrameDisplay,
  resolveAnimationDisplayFrameId,
} from './ImageFrameAnimation';

function documentFixture(): ImageDocument {
  return {
    id: 'repair-doc',
    title: 'Repair',
    width: 32,
    height: 32,
    activeLayerId: 'ink',
    layers: [
      { id: 'paper', name: 'Paper', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null },
      { id: 'ink', name: 'Ink', type: 'image', visible: false, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null },
    ],
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function withAnimation(animation: ImageFrameAnimation): ImageDocument {
  return { ...documentFixture(), metadata: { animation } };
}

/** Exact removal semantics the mounted panel uses (position filter + first-remaining selection),
 * mirrored here so the production handler's guarantees are tested verbatim. */
function panelRemoveAt(animation: ReturnType<typeof getImageFrameAnimation>, index: number) {
  if (animation.frames.length <= 1) return animation;
  const frames = animation.frames.filter((_, position) => position !== index);
  if (frames.length === animation.frames.length) return animation;
  return { ...animation, frames, currentFrameId: frames[0]!.id };
}

describe('MH-064 repair — collision-free frame identity (P1)', () => {
  it('derives ids from the highest existing ordinal, so remove-middle-then-add cannot collide', () => {
    let doc = documentFixture();
    let animation = getImageFrameAnimation(doc);
    for (let added = 0; added < 2; added += 1) {
      animation = appendAnimationFrame(doc);
      doc = { ...doc, metadata: { animation } };
    }
    expect(animation.frames.map((frame) => frame.id)).toEqual(['frame-1', 'frame-2', 'frame-3']);

    // Reproduce the original defect flow: remove the middle entry, then add again.
    animation = panelRemoveAt(animation, 1);
    doc = { ...doc, metadata: { animation } };
    expect(animation.frames.map((frame) => frame.id)).toEqual(['frame-1', 'frame-3']);
    animation = appendAnimationFrame(doc);
    expect(animation.frames.map((frame) => frame.id)).toEqual(['frame-1', 'frame-3', 'frame-4']);
    expect(new Set(animation.frames.map((frame) => frame.id)).size).toBe(3);
  });

  it('keeps identity unique across repeated add/remove churn and against hostile reopened duplicates', () => {
    // A hand-edited or corrupted `.slimg` payload that reopens with duplicate ids must never
    // make an appended frame join the collision.
    const hostile = withAnimation({
      version: 1,
      frameRate: 12,
      currentFrameId: 'frame-3',
      onionSkin: { enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 },
      frames: [
        { id: 'frame-1', name: 'Frame 1', durationMs: 1000 / 12, layerVisibility: { paper: true, ink: false } },
        { id: 'frame-3', name: 'Frame 3', durationMs: 1000 / 12, layerVisibility: { paper: false, ink: false } },
        { id: 'frame-3', name: 'Frame 3', durationMs: 1000 / 12, layerVisibility: { paper: false, ink: true } },
      ],
    });
    const derived = deriveNextFrameIdentity(hostile.metadata!.animation!);
    const existingIds = new Set(hostile.metadata!.animation!.frames.map((frame) => frame.id));
    expect(existingIds.has(derived.id)).toBe(false);
    expect(hostile.metadata!.animation!.frames).toHaveLength(3);

    // The same document survives more churn without ever deriving a taken id.
    let animation = hostile.metadata!.animation!;
    for (let round = 0; round < 5; round += 1) {
      const before = animation.frames.map((frame) => frame.id);
      animation = appendAnimationFrame({ ...hostile, metadata: { animation } });
      const ids = animation.frames.map((frame) => frame.id);
      expect(ids).toHaveLength(before.length + 1);
      // Every fresh suffix derives free of everything on the page at append time; the only
      // duplicates that can ever exist are the hostile twins imported with the file.
      expect(before).not.toContain(ids[ids.length - 1]);
    }
  });

  it('removes exactly one entry per trash click even when duplicate hostile ids exist', () => {
    const animation = withAnimation({
      version: 1,
      frameRate: 12,
      currentFrameId: 'frame-3',
      onionSkin: { enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 },
      frames: [
        { id: 'frame-1', name: 'Frame 1', durationMs: 1000 / 12, layerVisibility: { paper: true, ink: false } },
        { id: 'frame-3', name: 'Frame 3', durationMs: 1000 / 12, layerVisibility: { paper: false, ink: false } },
        { id: 'frame-3', name: 'Frame 3', durationMs: 1000 / 12, layerVisibility: { paper: false, ink: true } },
      ],
    }).metadata!.animation!;
    const afterRemove = panelRemoveAt(animation, 2);
    // An id-equality filter would have deleted both "frame-3" twins; position-based removal
    // deletes exactly the clicked entry.
    expect(afterRemove.frames).toHaveLength(2);
    expect(afterRemove.frames[0]!.layerVisibility.ink).toBe(false);
    expect(afterRemove.currentFrameId).toBe('frame-1');
    // The clicked twin's distinct cel left with it; the surviving first twin keeps its own.
    expect(afterRemove.frames[1]!.layerVisibility.ink).toBe(false);
    expect(afterRemove.frames.filter((frame) => frame.layerVisibility.ink)).toHaveLength(0);
  });

  it('applies the exact positional twin and clamps dangling selections safely on reopen', () => {
    const doc = withAnimation({
      version: 1,
      frameRate: 12,
      currentFrameId: 'frame-1',
      onionSkin: { enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 },
      frames: [
        { id: 'twin', name: 'Twin A', durationMs: 1000 / 12, layerVisibility: { paper: true, ink: true } },
        { id: 'twin', name: 'Twin B', durationMs: 1000 / 12, layerVisibility: { paper: false, ink: false } },
      ],
    });
    const applied = applyAnimationFrameAt(doc, doc.metadata!.animation!, 1);
    expect(applied.layers.map((layer) => layer.visible)).toEqual([false, false]);
    const dangling = { ...doc.metadata!.animation!, currentFrameId: 'missing-after-rename' };
    expect(resolveAnimationDisplayFrameId(dangling, doc.id, null)).toBe('twin');
    expect(applyAnimationFrameAt(doc, dangling, -1)).toBe(doc);
  });

  it('bounds an oversized numeric frame id without deriving Infinity or looping', () => {
    const hostile = withAnimation({
      version: 1,
      frameRate: 12,
      currentFrameId: 'frame-1',
      onionSkin: { enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 },
      frames: [{
        id: `frame-${'9'.repeat(320)}`,
        name: 'Hostile',
        durationMs: 1000 / 12,
        layerVisibility: { paper: true, ink: false },
      }],
    });
    const identity = deriveNextFrameIdentity(hostile.metadata!.animation!);
    expect(identity.id).toBe('frame-2');
    expect(Number.isFinite(Number.parseInt(identity.id.slice('frame-'.length), 10))).toBe(true);
  });

  it('normalizes malformed persisted metadata to a safe single frame with a warning', () => {
    const malformed = {
      ...documentFixture(),
      metadata: {
        animation: {
          version: 1,
          frameRate: 12,
          currentFrameId: 'missing',
          onionSkin: { enabled: true },
          frames: [{ id: 'frame-1' }],
        },
      },
    } as unknown as ImageDocument;
    const reopened = normalizeImageFrameAnimationDocument(malformed);
    const animation = getImageFrameAnimation(reopened);
    expect(animation.frames).toHaveLength(1);
    expect(animation.currentFrameId).toBe('frame-1');
    expect(animation.onionSkin).toEqual({ enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 });
    expect(reopened.metadata?.warnings).toContain('Malformed Image frame animation metadata was reset to a safe single frame.');
  });
});

describe('MH-064 repair — ephemeral playback cursor (P2)', () => {
  function authoredThreeFrames(): ReturnType<typeof getImageFrameAnimation> {
    let doc = documentFixture();
    let animation = getImageFrameAnimation(doc);
    for (let added = 0; added < 2; added += 1) {
      animation = appendAnimationFrame(doc);
      doc = { ...doc, metadata: { animation } };
    }
    return animation;
  }

  it('walks a finite wrap-around cycle visiting every frame exactly once', () => {
    const animation = authoredThreeFrames();
    const seen: string[] = [];
    let cursor: { docId: string; frameId: string } | null = { docId: 'repair-doc', frameId: animation.currentFrameId };
    for (let step = 0; step < 3; step += 1) {
      cursor = advanceAnimationPlaybackCursor(animation, 'repair-doc', cursor);
      expect(cursor).not.toBeNull();
      seen.push(cursor!.frameId);
    }
    expect(seen.sort()).toEqual(['frame-1', 'frame-2', 'frame-3']);
    expect(new Set(seen).size).toBe(3);
    expect(cursor!.frameId).toBe(animation.currentFrameId); // wrapped back to start
  });

  it('refuses to play single-frame animations and ignores cursors owned by another document', () => {
    const solo = getImageFrameAnimation(documentFixture());
    expect(solo.frames).toHaveLength(1);
    expect(advanceAnimationPlaybackCursor(solo, 'repair-doc', { docId: 'repair-doc', frameId: 'frame-1' })).toBeNull();
    const animation = authoredThreeFrames();
    expect(
      advanceAnimationPlaybackCursor(animation, 'repair-doc', { docId: 'other-doc', frameId: 'frame-9' })!.frameId,
    ).not.toBe('frame-9');
    // Dangling cursor ids fall back to the authored selection instead of throwing
    // (authored selection is the last frame, so the step advances to the first).
    expect(
      advanceAnimationPlaybackCursor(animation, 'repair-doc', { docId: 'repair-doc', frameId: 'ghost-id' })!.frameId,
    ).toBe('frame-1');
  });
});

describe('MH-064 repair — display plan routing (P1 onion parity seam input)', () => {
  function authored(framesIds: string[]): NonNullable<NonNullable<ImageDocument['metadata']>['animation']> {
    return {
      version: 1,
      frameRate: 12,
      currentFrameId: framesIds[0]!,
      onionSkin: { enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 },
      frames: framesIds.map((id) => ({
        id,
        name: id,
        durationMs: 1000 / 12,
        layerVisibility: { paper: id === 'middle', ink: false },
      })),
    };
  }

  it('keeps ordinary views free of ghost imagery until authored frames and the toggle demand it', () => {
    const unauthored = documentFixture();
    // Auto-synthesized single-frame animation: no ghosts, no playback cel — byte-passthrough.
    expect(planAnimationFrameDisplay(unauthored, null)).toBeNull();

    const toggledOff = { ...documentFixture(), metadata: { animation: { ...authored(['a', 'b', 'middle']), onionSkin: { enabled: false, previousOpacity: 0.28, nextOpacity: 0.16 } } } };
    expect(planAnimationFrameDisplay(toggledOff, null)).toBeNull();
  });

  it('routes prev/next ghosts around the shown frame exactly as configured', () => {
    const doc = { ...documentFixture(), metadata: { animation: authored(['first', 'middle', 'last']) } };
    doc.metadata!.animation!.currentFrameId = 'middle';
    const plan = planAnimationFrameDisplay(doc, null)!;
    expect(plan.celFrameId).toBeNull(); // not playing → live document is already correct
    expect(plan.ghosts).toEqual([
      { frameId: 'first', opacity: 0.28 },
      { frameId: 'last', opacity: 0.16 },
    ]);

    doc.metadata!.animation!.currentFrameId = 'last';
    expect(planAnimationFrameDisplay(doc, null)!.ghosts).toEqual([
      { frameId: 'middle', opacity: 0.28 },
    ]);
  });

  it('lets the playback cursor own the displayed cel while ghosts follow the played position', () => {
    const doc = { ...documentFixture(), metadata: { animation: authored(['first', 'middle', 'last']) } };
    const plan = planAnimationFrameDisplay(doc, { docId: doc.id, frameId: 'last' })!;
    expect(plan.celFrameId).toBe('last');
    expect(plan.ghosts).toEqual([{ frameId: 'middle', opacity: 0.28 }]);
    // A cursor aimed at a different document is treated as absent.
    const foreign = planAnimationFrameDisplay(doc, { docId: 'elsewhere', frameId: 'last' })!;
    expect(foreign.celFrameId).toBeNull();
  });

  it('suppresses zero-opacity ghosts but still rebases onto the played cel during playback', () => {
    const animation = { ...authored(['first', 'middle']), onionSkin: { enabled: true, previousOpacity: 0, nextOpacity: 0 } };
    const doc = { ...documentFixture(), metadata: { animation } };
    const plan = planAnimationFrameDisplay(doc, { docId: doc.id, frameId: 'middle' })!;
    expect(plan.ghosts).toEqual([]);
    expect(plan.celFrameId).toBe('middle');
  });
});

describe('MH-064 repair — structural lifecycle guards (P1/P2 wiring)', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/ImageEditor/ImageFrameAnimationPanel.tsx'), 'utf8');

  it('runs every hook before any conditional return in the panel', () => {
    const firstHook = panelSource.indexOf('useState(false)');
    const lastHook = panelSource.lastIndexOf('}, [documentId, frameCount, frameRate, playing]);');
    const earlyReturn = panelSource.indexOf('if (!document || !animation) return null;');
    expect(firstHook).toBeGreaterThan(-1);
    expect(lastHook).toBeGreaterThan(firstHook);
    expect(earlyReturn).toBeGreaterThan(lastHook);
    // No early return may precede the first hook either.
    expect(panelSource.slice(0, firstHook)).not.toContain('return null');
  });

  it('stops playback through interval cleanup tied to document ownership', () => {
    expect(panelSource).toContain('window.clearInterval(timer)');
    expect(panelSource).toContain('state.animationPlayback?.docId === documentId');
    // A session without frames can exist: the control stays disabled rather than flipping labels.
    expect(panelSource).toContain('disabled={animation.frames.length < 2}');
    // Removal is positional; the panel must not filter frames by raw id equality.
    expect(panelSource).toContain('position !== index');
    expect(panelSource).not.toContain('.filter((item) => item.id !== frame.id)');
  });

  it('wraps both worker and synchronous composites in one shared animation display seam', () => {
    const rendererSource = readFileSync(join(process.cwd(), 'src/components/ImageEditor/CompositeRenderer.ts'), 'utf8');
    expect(rendererSource).toContain('this.applyAnimationFrameDisplay(composite, doc, animationCursor)');
    // The worker result cache slot holds pure compositor bytes only.
    expect(rendererSource).toContain('workerResultBitmap = renderImageDocumentLayersToBitmap(doc)');
    expect(rendererSource).not.toContain('workerResultBitmap = renderAnimationOnionPreview');
    // Playback ticks must not churn the off-thread worker behind the timer's back.
    expect(rendererSource).toContain('if (!animationCursor) this.runHighResWorker(doc)');
  });

  it('routes slider and live-stroke fast paths through bounded cached animation parts', () => {
    const rendererSource = readFileSync(join(process.cwd(), 'src/components/ImageEditor/CompositeRenderer.ts'), 'utf8');
    const sliderStart = rendererSource.indexOf('if (store.isDraggingSlider)');
    const strokeStart = rendererSource.indexOf('} else if (store.isPaintingStroke)', sliderStart);
    const idleStart = rendererSource.indexOf('} else {', strokeStart);
    expect(rendererSource.slice(sliderStart, strokeStart)).toContain('this.applyAnimationFrameFastPath');
    expect(rendererSource.slice(strokeStart, idleStart)).toContain('this.applyAnimationFrameFastPath');
    expect(rendererSource).toContain('this.animationDisplayPartsKey !== key');
    expect(rendererSource).toContain('renderAnimationFrameDisplayParts(doc, cursor)');
    expect(rendererSource).toContain('this.animationDisplayPartsKey = null');
  });

  it('keeps animation and onion concepts out of the worker module and export flatteners', () => {
    const workerSource = readFileSync(join(process.cwd(), 'src/components/ImageEditor/highResComposite.worker.ts'), 'utf8').toLowerCase();
    expect(workerSource).not.toContain('onion');
    expect(workerSource).not.toContain('animation');
    expect(workerSource).not.toContain('imageframeanimation');
    for (const exporter of ['src/components/ImageEditor/ImageDocumentExport.ts']) {
      const source = readFileSync(join(process.cwd(), exporter), 'utf8');
      expect(source).not.toContain('ImageFrameAnimation');
      expect(source.toLowerCase()).not.toContain('onion');
      expect(source).not.toContain('applyAnimationFrameDisplay');
    }
  });
});
