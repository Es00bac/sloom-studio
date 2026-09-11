import { describe, expect, it, vi } from 'vitest';
import { BrushStrokeController } from './strokeController';
import type { BrushBackend, BrushDab, StrokeSession } from './backend';

function fakeBackend() {
  const stamped: BrushDab[] = [];
  const commit = vi.fn(() => ({ x: 0, y: 0, width: 1, height: 1 }));
  const dispose = vi.fn();
  const session: StrokeSession = {
    stampDab: (dab) => { stamped.push(dab); },
    dirtyRect: () => ({ x: 0, y: 0, width: 1, height: 1 }),
    previewInto: vi.fn(() => null),
    commit,
    dispose,
  };
  const backend: BrushBackend = { id: 'cpu', beginStroke: () => session };
  return { backend, commit, dispose, stamped };
}

function makeController(backend: BrushBackend) {
  const seed = { width: 10, height: 1, data: new Uint8ClampedArray(40) } as ImageData;
  return new BrushStrokeController(backend, {
    source: seed,
    sampleSource: { imageData: seed },
    width: 10,
    height: 1,
    op: 'smudge',
    size: 2,
    strength: 1,
  });
}

describe('BrushStrokeController', () => {
  it('interpolates dabs between move points and commits exactly once', () => {
    const { backend, commit, dispose, stamped } = fakeBackend();
    const controller = makeController(backend);
    controller.moveTo({ x: 0, y: 0 });   // first dab
    controller.moveTo({ x: 6, y: 0 });   // distance 6, step=max(1,size/3)=1 -> multiple dabs
    expect(stamped.length).toBeGreaterThan(1);
    expect(stamped[0]).toMatchObject({ op: 'smudge', size: 2, strength: 1 });

    const layer = {} as never;
    expect(controller.commit(layer)).not.toBeNull();
    expect(controller.commit(layer)).toBeNull(); // second commit is a no-op
    expect(commit).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('cancel disposes the session without committing', () => {
    const { backend, commit, dispose } = fakeBackend();
    const controller = makeController(backend);
    controller.moveTo({ x: 1, y: 0 });
    controller.cancel();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});
