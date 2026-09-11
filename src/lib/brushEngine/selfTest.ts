import type { LayerBitmap } from '../../types/imageEditor';
import type { BrushBackend, BrushDab } from './backend';

/**
 * Correctness self-test for brush backends. A GPU driver can compile the shaders yet compute wrong
 * output (precision quirks, mis-sampled textures, blocklist fallbacks). Since GPU acceleration is on
 * by default for every user — including GPUs we never tested — we validate a candidate backend
 * against the trusted CPU reference on a tiny fixture before trusting it, and fall back to CPU on a
 * gross mismatch. The check runs once per session (cached by the caller) and costs a few milliseconds.
 */

const FIXTURE_W = 16;
const FIXTURE_H = 16;

/** A deterministic gradient with varying alpha so smudge/blur/sharpen all have something to chew on. */
function buildFixture(): ImageData {
  const data = new Uint8ClampedArray(FIXTURE_W * FIXTURE_H * 4);
  for (let y = 0; y < FIXTURE_H; y += 1) {
    for (let x = 0; x < FIXTURE_W; x += 1) {
      const i = (y * FIXTURE_W + x) * 4;
      data[i] = (x * 16) & 0xff;
      data[i + 1] = (y * 16) & 0xff;
      data[i + 2] = ((x + y) * 8) & 0xff;
      data[i + 3] = 255;
    }
  }
  return makeImageData(data, FIXTURE_W, FIXTURE_H);
}

function makeImageData(data: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): ImageData {
  if (typeof ImageData !== 'undefined') return new ImageData(data, width, height);
  return { width, height, data } as ImageData;
}

function cloneImageData(source: ImageData): ImageData {
  return makeImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

/** One dab per op so the self-test exercises every shader/kernel branch. */
const SELF_TEST_DABS: BrushDab[] = [
  { op: 'smudge', from: { x: 4, y: 8 }, to: { x: 9, y: 8 }, size: 7, strength: 0.8 },
  { op: 'blur', from: { x: 8, y: 4 }, to: { x: 8, y: 4 }, size: 6, strength: 0.7 },
  { op: 'sharpen', from: { x: 11, y: 11 }, to: { x: 11, y: 11 }, size: 6, strength: 0.6 },
];

function runFixtureStroke(backend: BrushBackend, fixture: ImageData): ImageData {
  const target = new OffscreenCanvas(FIXTURE_W, FIXTURE_H) as unknown as LayerBitmap;
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('no 2d context for brush self-test');
  ctx.putImageData(cloneImageData(fixture), 0, 0);
  const session = backend.beginStroke({
    source: cloneImageData(fixture),
    sampleSource: { imageData: cloneImageData(fixture) },
    width: FIXTURE_W,
    height: FIXTURE_H,
  });
  for (const dab of SELF_TEST_DABS) session.stampDab(dab);
  session.commit(target);
  session.dispose();
  return ctx.getImageData(0, 0, FIXTURE_W, FIXTURE_H);
}

/** Maximum per-channel difference between a candidate backend and the reference over the fixture stroke. */
export function maxBackendChannelDiff(candidate: BrushBackend, reference: BrushBackend): number {
  const fixture = buildFixture();
  const a = runFixtureStroke(candidate, fixture).data;
  const b = runFixtureStroke(reference, fixture).data;
  let max = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
  }
  return max;
}

/**
 * True when the candidate's output matches the reference within tolerance. The default tolerance (16)
 * comfortably absorbs legitimate cross-GPU float rounding (parity was byte-exact on AMD) while still
 * catching gross corruption (Y-flips, garbage sampling) that runs into the tens or hundreds.
 */
export function backendProducesCorrectOutput(
  candidate: BrushBackend,
  reference: BrushBackend,
  tolerance = 16,
): boolean {
  try {
    return maxBackendChannelDiff(candidate, reference) <= tolerance;
  } catch {
    return false;
  }
}
