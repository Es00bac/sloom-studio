import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument } from '../../types/imageEditor';
import { createPaperComicSfxDesign } from '../../lib/paperComicSfx';
import {
  buildComicLayerPlacement,
  buildComicSfxLayerUpdate,
  createComicMangaLayer,
  createComicSfxLayer,
} from './ImageComicTools';

class FakeContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  lineJoin = '';
  lineCap = '';
  font = '';
  textAlign = '';
  textBaseline = '';
  ops: string[] = [];
  beginPath() { this.ops.push('beginPath'); }
  ellipse() { this.ops.push('ellipse'); }
  moveTo() { this.ops.push('moveTo'); }
  lineTo() { this.ops.push('lineTo'); }
  closePath() { this.ops.push('closePath'); }
  fill() { this.ops.push('fill'); }
  stroke() { this.ops.push('stroke'); }
  fillRect() { this.ops.push('fillRect'); }
  strokeRect() { this.ops.push('strokeRect'); }
  fillText() { this.ops.push('fillText'); }
  strokeText() { this.ops.push('strokeText'); }
  save() { this.ops.push('save'); }
  restore() { this.ops.push('restore'); }
  translate() { this.ops.push('translate'); }
  rotate() { this.ops.push('rotate'); }
  transform() { this.ops.push('transform'); }
  scale() { this.ops.push('scale'); }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context = new FakeContext();
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function makeDoc(): ImageDocument {
  return {
    id: 'doc-comic',
    title: 'Comic Page',
    width: 1200,
    height: 1800,
    layers: [],
    activeLayerId: null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

describe('ImageComicTools', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('builds centered comic/manga layer placements for image documents', () => {
    expect(buildComicLayerPlacement(makeDoc(), 'speechBubble')).toMatchObject({
      width: 420,
      height: 240,
      x: 390,
      y: 780,
    });
    expect(buildComicLayerPlacement(makeDoc(), 'panelBorder').width).toBe(640);
  });

  it('creates raster comic layers that are ready to edit and move', () => {
    const layer = createComicMangaLayer(makeDoc(), 'caption', {
      text: 'Meanwhile...',
    });

    expect(layer.name).toBe('Caption Box');
    expect(layer.type).toBe('image');
    expect(layer.visible).toBe(true);
    expect(layer.locked).toBe(false);
    expect(layer.bitmap?.width).toBe(520);
    expect(layer.bitmap?.height).toBe(130);
    expect((layer.bitmap as unknown as FakeOffscreenCanvas).context.ops).toEqual(
      expect.arrayContaining(['fillRect', 'strokeRect', 'fillText']),
    );
  });

  it('creates a raster comic SFX layer from the shared SFX designer state', () => {
    const layer = createComicSfxLayer(makeDoc(), createPaperComicSfxDesign('zap', {
      text: 'bzzt',
      fillColor: '#22d3ee',
      strokeColor: '#082f49',
      speedLinesEnabled: true,
      speedLineCount: 5,
      halftoneEnabled: true,
      halftoneCount: 4,
    }));

    expect(layer.name).toBe('BZZT SFX');
    expect(layer.type).toBe('image');
    expect(layer.metadata?.comicSfxDesign).toMatchObject({
      text: 'BZZT',
      presetId: 'zap',
      fillColor: '#22d3ee',
    });
    expect(layer.visible).toBe(true);
    expect(layer.locked).toBe(false);
    expect(layer.x).toBeGreaterThanOrEqual(0);
    expect(layer.y).toBeGreaterThanOrEqual(0);
    expect(layer.bitmap?.width).toBeGreaterThan(100);
    expect(layer.bitmap?.height).toBeGreaterThan(40);
    expect((layer.bitmap as unknown as FakeOffscreenCanvas).context.ops).toEqual(
      expect.arrayContaining(['ellipse', 'lineTo', 'strokeText', 'fillText']),
    );
  });

  it('rerasterizes an editable comic SFX layer while preserving layer placement', () => {
    const doc = makeDoc();
    const layer = createComicSfxLayer(doc, createPaperComicSfxDesign('bang', {
      text: 'bang',
    }));
    const updated = buildComicSfxLayerUpdate(doc, layer, createPaperComicSfxDesign('kapow', {
      text: 'kapow',
      fillColor: '#facc15',
    }));

    expect(updated.id).toBe(layer.id);
    expect(updated.x).toBe(layer.x);
    expect(updated.y).toBe(layer.y);
    expect(updated.name).toBe('KAPOW SFX');
    expect(updated.bitmapVersion).toBe(layer.bitmapVersion + 1);
    expect(updated.metadata?.comicSfxDesign).toMatchObject({
      presetId: 'kapow',
      text: 'KAPOW',
      fillColor: '#facc15',
    });
    expect(updated.bitmap?.width).toBeGreaterThan(100);
  });
});
