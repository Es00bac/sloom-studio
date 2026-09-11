import { describe, expect, it } from 'vitest';
import {
  applyMaskCoverage,
  cropPixelBuffer,
  createHighBitPaintOperation,
  executeHighBitTool,
  highBitToolPolicy,
  paintPixelBuffer,
  resamplePixelBuffer,
} from './highBitTools';
import {
  createPixelBuffer,
  pixelBufferEquals,
} from './PixelBuffer';
import type { PixelBuffer } from '../../../types/imageEditor';
import { createEmptyImageDocument, useImageEditorStore } from '../../../store/imageEditorStore';
import { redo, undo } from '../undoRedoApply';

function buffer(depth: PixelBuffer['depth'], width = 6, height = 6): PixelBuffer {
  const result = createPixelBuffer({ width, height, depth });
  if (depth === 'u16') {
    const data = result.data as Uint16Array;
    data.fill(1001);
    for (let i = 3; i < data.length; i += 4) data[i] = 65535;
  } else if (depth === 'f32') {
    const data = result.data as Float32Array;
    data.fill(0.125);
    for (let i = 3; i < data.length; i += 4) data[i] = 1;
  } else {
    const data = result.data as Uint8Array;
    data.fill(17);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
  }
  return result;
}

describe('MH-009 A4 depth-aware tool core', () => {
  it('refuses proxy-only tools before executing or mutating', () => {
    let called = false;
    const result = executeHighBitTool('liquify', () => {
      called = true;
      return 'mutated';
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
    if (!result.ok) {
      expect(result.policy.source).toBe('proxy');
      expect(result.policy.precisionLossy).toBe(true);
      expect(result.policy.disclosure).toContain('no pixels were changed');
    }
    expect(highBitToolPolicy('brush')).toMatchObject({ supported: true, source: 'authority', precisionLossy: false });
    expect(highBitToolPolicy('paintBucket')).toMatchObject({ supported: false, source: 'proxy', precisionLossy: true });
  });

  it('paints u16 authority samples without touching unrelated samples', () => {
    const before = buffer('u16');
    const result = paintPixelBuffer(before, {
      points: [{ x: 3.5, y: 3.5 }],
      radius: 0,
      color: [0.12345, 0.45678, 0.78901, 1],
    });
    expect(result.changedPixels).toBe(1);
    expect(result.pixels.depth).toBe('u16');
    expect((result.pixels.data as Uint16Array)[0]).toBe((before.data as Uint16Array)[0]);
    expect((result.pixels.data as Uint16Array)[3]).toBe(65535);
    const paintedIndex = (3 * 6 + 3) * 4;
    expect((result.pixels.data as Uint16Array)[paintedIndex]).not.toBe(1001);
    expect((result.pixels.data as Uint16Array)[paintedIndex]).toBeGreaterThan(255);
    expect(pixelBufferEquals(before, result.pixels)).toBe(false);
  });

  it('paints f32 authority in place at float precision and keeps untouched values exact', () => {
    const before = buffer('f32');
    const result = paintPixelBuffer(before, {
      points: [{ x: 3.5, y: 3.5 }],
      radius: 0,
      color: [0.33333334, 0.6666667, 0.7777778, 0.5],
    });
    expect(result.pixels.depth).toBe('f32');
    expect((result.pixels.data as Float32Array)[0]).toBe((before.data as Float32Array)[0]);
    const paintedIndex = (3 * 6 + 3) * 4;
    expect((result.pixels.data as Float32Array)[paintedIndex]).toBeGreaterThan(0.125);
    expect((result.pixels.data as Float32Array)[paintedIndex]).not.toBe(Math.round(0.33333334 * 255) / 255);
  });

  it('applies u8 mask coverage directly to native alpha', () => {
    const before = buffer('u16');
    const masked = applyMaskCoverage(before, { width: 6, height: 6, data: new Uint8Array(36).fill(128) });
    expect(masked.depth).toBe('u16');
    expect((masked.data as Uint16Array)[3]).toBe(32896);
    expect((masked.data as Uint16Array)[0]).toBe((before.data as Uint16Array)[0]);
    expect(() => applyMaskCoverage(before, { width: 5, height: 6, data: new Uint8Array(30) })).toThrow(/matching/);
  });

  it('crops native authority samples with transparent out-of-bounds fill', () => {
    const source = buffer('u16', 3, 2);
    const cropped = cropPixelBuffer(source, -1, 0, 3, 2);
    expect(cropped.width).toBe(3);
    expect(cropped.height).toBe(2);
    expect(Array.from(cropped.data as Uint16Array).slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(Array.from(cropped.data as Uint16Array).slice(4, 8)).toEqual(
      Array.from((source.data as Uint16Array).slice(0, 4)),
    );
    expect(() => cropPixelBuffer(source, 0, 0, 8193, 1)).toThrow(/bounded/);
  });

  it('resamples directly in u16/f32 authority and refuses oversized resources', () => {
    const source = buffer('f32', 2, 2);
    (source.data as Float32Array).set([
      0, 0, 0, 1, 1, 0, 0, 1,
      0, 1, 0, 1, 1, 1, 0, 1,
    ]);
    const scaled = resamplePixelBuffer(source, 4, 4, 'bilinear');
    expect(scaled.depth).toBe('f32');
    const centerIndex = (2 * 4 + 2) * 4;
    expect((scaled.data as Float32Array)[centerIndex]).toBeGreaterThan(0);
    expect((scaled.data as Float32Array)[centerIndex]).toBeLessThan(1);
    expect(() => resamplePixelBuffer(source, 8193, 1)).toThrow(/bounded/);
  });

  it('retains independent native-depth before/after buffers for ordinary history', () => {
    const before = buffer('u16', 2, 2);
    const after = paintPixelBuffer(before, {
      points: [{ x: 0.5, y: 0.5 }], radius: 0, color: [1, 0, 0, 1],
    }).pixels;
    const operation = createHighBitPaintOperation('doc', 'layer', before, after, 7, 8);
    (after.data as Uint16Array)[0] = 0;
    expect((operation.after.data as Uint16Array)[0]).not.toBe(0);
    expect(operation.beforeVersion).toBe(7);
    expect(operation.afterVersion).toBe(8);
    expect(() => createHighBitPaintOperation('doc', 'layer', before, buffer('f32', 2, 2), 0, 1)).toThrow(/matching/);
  });

  it('commits authority edits as ordinary undo/redo without changing 8-bit documents', () => {
    const authority = buffer('u16', 2, 2);
    const doc = createEmptyImageDocument({ id: 'a4-history', title: 'A4', width: 2, height: 2 });
    const layer = {
      id: 'a4-layer', name: 'A4', type: 'image' as const, visible: true, locked: false,
      opacity: 1, blendMode: 'normal' as const, x: 0, y: 0, bitmap: null, bitmapVersion: 0,
      mask: null, pixels: authority, pixelsVersion: 2,
    };
    useImageEditorStore.getState().openDocument({
      ...doc, metadata: { bitDepth: 16 }, layers: [layer], activeLayerId: layer.id,
    });
    const edited = paintPixelBuffer(authority, { points: [{ x: 0.5, y: 0.5 }], radius: 0, color: [1, 0, 0, 1] }).pixels;
    expect(useImageEditorStore.getState().commitHighBitPixelEdit(doc.id, layer.id, edited)).toEqual({ ok: true });
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(undo(doc.id)).toBe(true);
    expect((useImageEditorStore.getState().documents[0]!.layers[0]!.pixels!.data as Uint16Array)[0]).toBe(1001);
    expect(redo(doc.id)).toBe(true);
    expect((useImageEditorStore.getState().documents[0]!.layers[0]!.pixels!.data as Uint16Array)[0]).toBe(65535);
    const eight = { ...doc, id: 'a4-8bit', layers: [{ ...layer, id: 'a4-8-layer', pixels: null }], metadata: { bitDepth: 8 as const } };
    useImageEditorStore.getState().openDocument(eight);
    expect(useImageEditorStore.getState().commitHighBitPixelEdit(eight.id, 'a4-8-layer', edited).ok).toBe(false);
  });
});
