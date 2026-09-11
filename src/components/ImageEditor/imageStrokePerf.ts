/**
 * Diagnostic on-canvas performance HUD for brush-stroke responsiveness.
 *
 * This exists because synthetic benchmarks kept diverging from the real in-app
 * experience. It shows, live while you sketch: achieved FPS / frame interval, the
 * per-frame composite (draw) time and whether the dirty-rect fast path engaged, and
 * the per-segment paint time + dab count. That tells us exactly which stage is the
 * bottleneck on the real machine instead of guessing.
 *
 * Toggle with Ctrl+Shift+P (persisted to localStorage). Default OFF — developer overlay only.
 */

import { useImageEditorStore } from '../../store/imageEditorStore';

/** Total bytes held by undo/redo paint snapshots across all docs, in MB. A direct
 * readout of the per-stroke history memory that was growing without bound. */
function undoMemoryMB(): number {
  try {
    const state = useImageEditorStore.getState();
    let bytes = 0;
    for (const map of [state.undoStacks, state.redoStacks]) {
      for (const ops of Object.values(map ?? {})) {
        for (const op of ops ?? []) {
          const before = (op as { before?: { width?: number; height?: number } }).before;
          const after = (op as { after?: { width?: number; height?: number } }).after;
          if (before?.width && before?.height) bytes += before.width * before.height * 4;
          if (after?.width && after?.height) bytes += after.width * after.height * 4;
        }
      }
    }
    return bytes / (1024 * 1024);
  } catch {
    return 0;
  }
}

interface DrawSample {
  compositeMs: number;
  blitMs: number;
  overlayMs: number;
  incremental: boolean;
}
interface PaintSample {
  paintMs: number;
  dabs: number;
}

const MAX = 120;
const drawSamples: DrawSample[] = [];
const paintSamples: PaintSample[] = [];
const frameIntervals: number[] = [];
let lastFrameTs = 0;

let enabled = false;
let overlay: HTMLElement | null = null;
let rafId = 0;

function push<T>(arr: T[], value: T): void {
  arr.push(value);
  if (arr.length > MAX) arr.shift();
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function p95(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

export function recordStrokeDraw(
  compositeMs: number,
  blitMs: number,
  overlayMs: number,
  incremental: boolean,
): void {
  if (!enabled) return;
  push(drawSamples, { compositeMs, blitMs, overlayMs, incremental });
}

export function recordStrokePaint(paintMs: number, dabs: number): void {
  if (!enabled) return;
  push(paintSamples, { paintMs, dabs });
}

function tick(ts: number): void {
  if (lastFrameTs) push(frameIntervals, ts - lastFrameTs);
  lastFrameTs = ts;
  if (overlay) {
    const composites = drawSamples.map((s) => s.compositeMs);
    const blits = drawSamples.map((s) => s.blitMs);
    const overlays = drawSamples.map((s) => s.overlayMs);
    const paints = paintSamples.map((s) => s.paintMs);
    const dabs = paintSamples.map((s) => s.dabs);
    const incrementalPct = drawSamples.length
      ? Math.round((100 * drawSamples.filter((s) => s.incremental).length) / drawSamples.length)
      : 0;
    const fi = avg(frameIntervals);
    overlay.textContent =
      `FPS ${fi ? Math.round(1000 / fi) : 0}   frame ${fi.toFixed(1)}ms (p95 ${p95(frameIntervals).toFixed(1)})\n` +
      `composite ${avg(composites).toFixed(1)}ms  [${incrementalPct}% dirty-rect]\n` +
      `blit ${avg(blits).toFixed(1)}ms   overlay ${avg(overlays).toFixed(1)}ms\n` +
      `paint ${avg(paints).toFixed(1)}ms  dabs/seg ${Math.round(avg(dabs))}\n` +
      `undo history ${undoMemoryMB().toFixed(0)} MB`;
  }
  rafId = requestAnimationFrame(tick);
}

export function setStrokePerfEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem('sloom.strokePerf', value ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (typeof document === 'undefined') return;
  if (value && !overlay) {
    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:99999;background:rgba(0,0,0,.82);color:#39ff7a;' +
      'font:11px/1.45 ui-monospace,monospace;padding:6px 9px;border-radius:6px;white-space:pre;' +
      'pointer-events:none;letter-spacing:.2px';
    overlay.textContent = 'stroke perf — sketch to populate';
    document.body.appendChild(overlay);
    lastFrameTs = 0;
    rafId = requestAnimationFrame(tick);
  } else if (!value && overlay) {
    cancelAnimationFrame(rafId);
    overlay.remove();
    overlay = null;
  }
}

export function isStrokePerfEnabled(): boolean {
  return enabled;
}

if (typeof window !== 'undefined') {
  let initial = false;
  try {
    // Default OFF — this is a developer overlay; only show it when explicitly enabled
    // (Ctrl+Shift+P, persisted). Shipping users shouldn't see debug telemetry while painting.
    initial = localStorage.getItem('sloom.strokePerf') === '1';
  } catch {
    /* ignore */
  }
  if (initial) {
    // Defer so document.body exists.
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => setStrokePerfEnabled(true), { once: true });
    } else {
      setStrokePerfEnabled(true);
    }
  }
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && (event.key === 'P' || event.key === 'p')) {
      event.preventDefault();
      setStrokePerfEnabled(!enabled);
    }
  });
}
