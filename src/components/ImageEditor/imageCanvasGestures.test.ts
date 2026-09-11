import { describe, expect, it, vi } from 'vitest';
import { CanvasViewportGesture } from './imageCanvasGestures';
import type { DocumentViewport } from '../../types/imageEditor';

function makePort(initial: DocumentViewport = { zoom: 1, panX: 0, panY: 0 }) {
  let viewport: DocumentViewport = { ...initial };
  return {
    getViewport: () => viewport,
    setViewport: vi.fn((next: DocumentViewport) => { viewport = next; }),
    requestRender: vi.fn(),
    getRect: () => ({ left: 0, top: 0 }),
    current: () => viewport,
  };
}

const touch = (pointerId: number, clientX: number, clientY: number) => ({
  pointerType: 'touch',
  pointerId,
  clientX,
  clientY,
});

describe('CanvasViewportGesture', () => {
  it('two fingers pinch-zoom even when single-finger pan is allowed (touch-nav on / Hand tool)', () => {
    const port = makePort();
    const gesture = new CanvasViewportGesture(port);
    // First finger with pan allowed would normally pan…
    expect(gesture.pointerDown({ ...touch(1, 100, 100), panAllowed: true })).toBe('pan');
    // …but a second finger must flip the gesture to a pinch (this was the bug).
    expect(gesture.pointerDown({ ...touch(2, 200, 100), panAllowed: true })).toBe('pinch');
    gesture.pointerMove(touch(2, 300, 100)); // spread fingers apart -> zoom in
    expect(port.setViewport).toHaveBeenCalled();
    expect(port.current().zoom).toBeGreaterThan(1);
  });

  it('two fingers pinch even when panning is NOT allowed (touch-nav off / drawing tool)', () => {
    const port = makePort();
    const gesture = new CanvasViewportGesture(port);
    expect(gesture.pointerDown({ ...touch(1, 100, 100), panAllowed: false })).toBe('none'); // would draw
    expect(gesture.pointerDown({ ...touch(2, 200, 100), panAllowed: false })).toBe('pinch');
    gesture.pointerMove(touch(1, 0, 100)); // finger 1 moves left -> fingers spread -> zoom in
    expect(port.current().zoom).toBeGreaterThan(1);
  });

  it('pinches together to zoom out', () => {
    const port = makePort({ zoom: 2, panX: 0, panY: 0 });
    const gesture = new CanvasViewportGesture(port);
    gesture.pointerDown({ ...touch(1, 0, 100), panAllowed: false });
    gesture.pointerDown({ ...touch(2, 400, 100), panAllowed: false });
    gesture.pointerMove(touch(2, 200, 100)); // bring fingers together
    expect(port.current().zoom).toBeLessThan(2);
  });

  it('single finger pans when allowed, and passes through (draws) when not', () => {
    const panPort = makePort();
    const panGesture = new CanvasViewportGesture(panPort);
    expect(panGesture.pointerDown({ ...touch(1, 10, 10), panAllowed: true })).toBe('pan');
    panGesture.pointerMove(touch(1, 30, 25));
    expect(panPort.current().panX).toBe(20);
    expect(panPort.current().panY).toBe(15);

    const drawPort = makePort();
    const drawGesture = new CanvasViewportGesture(drawPort);
    expect(drawGesture.pointerDown({ ...touch(1, 10, 10), panAllowed: false })).toBe('none');
    expect(drawPort.setViewport).not.toHaveBeenCalled();
  });

  it('ends the gesture once both fingers lift', () => {
    const port = makePort();
    const gesture = new CanvasViewportGesture(port);
    gesture.pointerDown({ ...touch(1, 100, 100), panAllowed: false });
    gesture.pointerDown({ ...touch(2, 200, 100), panAllowed: false });
    expect(gesture.isActive()).toBe(true);
    expect(gesture.pointerUp({ pointerType: 'touch', pointerId: 1 })).toBe('pinch');
    expect(gesture.pointerUp({ pointerType: 'touch', pointerId: 2 })).toBe('pinch');
    expect(gesture.isActive()).toBe(false);
    // A fresh single finger with no pan allowed now passes through to drawing again.
    expect(gesture.pointerDown({ ...touch(3, 10, 10), panAllowed: false })).toBe('none');
  });
});

describe('CanvasViewportGesture view rotation', () => {
  function makeRotatablePort(initial: DocumentViewport = { zoom: 1, panX: 0, panY: 0 }) {
    let viewport: DocumentViewport = { ...initial };
    return {
      getViewport: () => viewport,
      setViewport: vi.fn((next: DocumentViewport) => { viewport = next; }),
      requestRender: vi.fn(),
      getRect: () => ({ left: 0, top: 0 }),
      getViewSize: () => ({ width: 400, height: 300 }),
      current: () => viewport,
    };
  }

  it('twists two fingers to rotate the view around the container center', () => {
    const port = makeRotatablePort();
    const gesture = new CanvasViewportGesture(port);
    gesture.pointerDown({ ...touch(1, 100, 150), panAllowed: false });
    gesture.pointerDown({ ...touch(2, 300, 150), panAllowed: false });
    // Twist the pair 90° counterclockwise around the midpoint (200,150) while keeping the
    // finger distance constant, so only rotation — not pinch zoom — is applied.
    gesture.pointerMove(touch(1, 200, 50));
    gesture.pointerMove(touch(2, 200, 250));

    const rotation = port.current().rotationDeg ?? 0;
    expect(rotation).toBeGreaterThan(5);
    expect(port.current().zoom).toBeCloseTo(1, 1);
  });

  it('ignores twist jitter below the minimum delta', () => {
    const port = makeRotatablePort();
    const gesture = new CanvasViewportGesture(port);
    gesture.pointerDown({ ...touch(1, 100, 150), panAllowed: false });
    gesture.pointerDown({ ...touch(2, 300, 150), panAllowed: false });
    gesture.pointerMove(touch(1, 101, 150));
    gesture.pointerMove(touch(2, 299, 150));

    expect(port.current().rotationDeg).toBeUndefined();
  });

  it('pans in screen space while the view is rotated', () => {
    const port = makeRotatablePort({ zoom: 1, panX: 0, panY: 0, rotationDeg: 90 });
    const gesture = new CanvasViewportGesture(port);
    gesture.pointerDown({ ...touch(1, 10, 10), panAllowed: true });
    gesture.pointerMove(touch(1, 50, 10));

    const viewport = port.current();
    expect(viewport.rotationDeg).toBe(90);
    // Screen-right pan in a 90°-rotated view is a view-space (0,-40) translation.
    expect(viewport.panX).toBeCloseTo(0, 6);
    expect(viewport.panY).toBeCloseTo(-40, 6);
  });
});
