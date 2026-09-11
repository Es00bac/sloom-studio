import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';
import { describeImageClippingMaskReadiness } from './ImageClippingMask';

class FakeContext {
  drawImageCalls: Array<{
    image: unknown;
    dx: number;
    dy: number;
    alpha: number;
    composite: string;
  }> = [];
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  private stack: Array<{ alpha: number; composite: string; matrix: number[] }> = [];
  private matrix = [1, 0, 0, 1, 0, 0];
  private width: number;
  private height: number;
  readonly buffer: Uint8ClampedArray;

  constructor(width: number, height: number, buffer: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.buffer = buffer;
  }

  save() {
    this.stack.push({
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
      matrix: [...this.matrix],
    });
  }

  restore() {
    const next = this.stack.pop();
    if (!next) return;
    this.globalAlpha = next.alpha;
    this.globalCompositeOperation = next.composite;
    this.matrix = [...next.matrix];
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.matrix = [a, b, c, d, e, f];
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const [A, B, C, D, E, F] = this.matrix;
    this.matrix = [
      A * a + C * b,
      B * a + D * b,
      A * c + C * d,
      B * c + D * d,
      A * e + C * f + E,
      B * e + D * f + F,
    ];
  }

  translate(x: number, y: number) {
    this.transform(1, 0, 0, 1, x, y);
  }

  drawImage(image: unknown, dx = 0, dy = 0) {
    this.drawImageCalls.push({
      image,
      dx,
      dy,
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
    });
    const source = (image as FakeOffscreenCanvas | null)?.context ?? null;
    if (!(source instanceof FakeContext)) return;
    // Post-multiply translate(dx, dy) into the current matrix, then composite the source
    // bytes with real canvas semantics for the two operations the compositor relies on.
    const [A, B, C, D, E, F] = this.matrix;
    const M = [A, B, C, D, A * dx + C * dy + E, B * dx + D * dy + F];
    const sourceWidth = (image as FakeOffscreenCanvas).width;
    const sourceHeight = (image as FakeOffscreenCanvas).height;
    const corners = [
      [M[4], M[5]],
      [M[0] * sourceWidth + M[4], M[1] * sourceWidth + M[5]],
      [M[2] * sourceHeight + M[4], M[3] * sourceHeight + M[5]],
      [M[0] * sourceWidth + M[2] * sourceHeight + M[4], M[1] * sourceWidth + M[3] * sourceHeight + M[5]],
    ];
    const left = Math.floor(Math.min(...corners.map((point) => point[0])));
    const top = Math.floor(Math.min(...corners.map((point) => point[1])));
    const right = Math.ceil(Math.max(...corners.map((point) => point[0])));
    const bottom = Math.ceil(Math.max(...corners.map((point) => point[1])));
    const determinant = M[0] * M[3] - M[1] * M[2];
    if (Math.abs(determinant) < 1e-8) return;
    if (this.globalCompositeOperation === 'destination-in') {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const sx = Math.floor((M[3] * (x - M[4]) - M[2] * (y - M[5])) / determinant);
          const sy = Math.floor((-M[1] * (x - M[4]) + M[0] * (y - M[5])) / determinant);
          const sourceAlpha = sx >= 0 && sy >= 0 && sx < sourceWidth && sy < sourceHeight
            ? (source.buffer[(sy * sourceWidth + sx) * 4 + 3] / 255) * this.globalAlpha
            : 0;
          const destinationOffset = (y * this.width + x) * 4;
          this.buffer[destinationOffset + 3] = Math.round(
            this.buffer[destinationOffset + 3] * sourceAlpha,
          );
        }
      }
      return;
    }
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        const sx = Math.floor((M[3] * (x - M[4]) - M[2] * (y - M[5])) / determinant);
        const sy = Math.floor((-M[1] * (x - M[4]) + M[0] * (y - M[5])) / determinant);
        if (sx < 0 || sy < 0 || sx >= sourceWidth || sy >= sourceHeight) continue;
        const destinationOffset = (y * this.width + x) * 4;
        const sourceOffset = (sy * sourceWidth + sx) * 4;
        const sourceAlpha = (source.buffer[sourceOffset + 3] / 255) * this.globalAlpha;
        const destinationAlpha = this.buffer[destinationOffset + 3] / 255;
        const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
        if (outAlpha <= 0) {
          this.buffer[destinationOffset + 3] = 0;
          continue;
        }
        for (let channel = 0; channel < 3; channel += 1) {
          const sourceChannel = source.buffer[sourceOffset + channel];
          const destinationChannel = this.buffer[destinationOffset + channel];
          this.buffer[destinationOffset + channel] = Math.round(
            (sourceChannel * sourceAlpha + destinationChannel * destinationAlpha * (1 - sourceAlpha))
              / outAlpha,
          );
        }
        this.buffer[destinationOffset + 3] = Math.round(outAlpha * 255);
      }
    }
  }

  getImageData(x = 0, y = 0, width = 1, height = 1) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const sourceX = x + column;
        const sourceY = y + row;
        if (sourceX < 0 || sourceY < 0 || sourceX >= this.width || sourceY >= this.height) continue;
        const sourceOffset = (sourceY * this.width + sourceX) * 4;
        const destinationOffset = (row * width + column) * 4;
        data[destinationOffset] = this.buffer[sourceOffset];
        data[destinationOffset + 1] = this.buffer[sourceOffset + 1];
        data[destinationOffset + 2] = this.buffer[sourceOffset + 2];
        data[destinationOffset + 3] = this.buffer[sourceOffset + 3];
      }
    }
    return { width, height, data } as ImageData;
  }

  putImageData(imageData: ImageData, dx = 0, dy = 0) {
    for (let row = 0; row < imageData.height; row += 1) {
      for (let column = 0; column < imageData.width; column += 1) {
        const targetX = dx + column;
        const targetY = dy + row;
        if (targetX < 0 || targetY < 0 || targetX >= this.width || targetY >= this.height) continue;
        const sourceOffset = (row * imageData.width + column) * 4;
        const destinationOffset = (targetY * this.width + targetX) * 4;
        this.buffer[destinationOffset] = imageData.data[sourceOffset];
        this.buffer[destinationOffset + 1] = imageData.data[sourceOffset + 1];
        this.buffer[destinationOffset + 2] = imageData.data[sourceOffset + 2];
        this.buffer[destinationOffset + 3] = imageData.data[sourceOffset + 3];
      }
    }
  }

  createImageData(width: number, height: number) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }

  clearRect(x: number, y: number, width: number, height: number) {
    for (let row = Math.max(0, y); row < y + height; row += 1) {
      for (let column = Math.max(0, x); column < x + width; column += 1) {
        if (column >= this.width || row >= this.height) continue;
        const offset = (row * this.width + column) * 4;
        this.buffer[offset] = 0;
        this.buffer[offset + 1] = 0;
        this.buffer[offset + 2] = 0;
        this.buffer[offset + 3] = 0;
      }
    }
  }

  fillRect() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  clip() {}
  rotate() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(width, height, new Uint8ClampedArray(width * height * 4));
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function opaqueBitmap(width: number, height: number): LayerBitmap {
  const bitmap = new FakeOffscreenCanvas(width, height);
  bitmap.context.buffer.fill(255);
  return bitmap as unknown as LayerBitmap;
}

function solidBitmap(width: number, height: number, rgba: [number, number, number, number]): LayerBitmap {
  const bitmap = new FakeOffscreenCanvas(width, height);
  for (let offset = 0; offset < bitmap.context.buffer.length; offset += 4) {
    bitmap.context.buffer[offset] = rgba[0];
    bitmap.context.buffer[offset + 1] = rgba[1];
    bitmap.context.buffer[offset + 2] = rgba[2];
    bitmap.context.buffer[offset + 3] = rgba[3];
  }
  return bitmap as unknown as LayerBitmap;
}

function alphaAt(bitmap: FakeOffscreenCanvas, x: number, y: number): number {
  return bitmap.context.buffer[(y * bitmap.width + x) * 4 + 3];
}

function makeDoc(layers: ImageLayer[], width = 12, height = 8): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Clipping Mask',
    width,
    height,
    layers,
    activeLayerId: layers[layers.length - 1]?.id ?? null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function makeLayer(overrides: Partial<ImageLayer>): ImageLayer {
  return {
    id: overrides.id ?? 'layer-1',
    name: overrides.name ?? 'Layer 1',
    type: overrides.type ?? 'image',
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? false,
    opacity: overrides.opacity ?? 1,
    blendMode: overrides.blendMode ?? 'normal',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    bitmap: overrides.bitmap ?? new OffscreenCanvas(4, 4) as LayerBitmap,
    bitmapVersion: overrides.bitmapVersion ?? 0,
    mask: overrides.mask ?? null,
    ...overrides,
  };
}

function countOpaque(bitmap: FakeOffscreenCanvas): number {
  let count = 0;
  for (let offset = 3; offset < bitmap.context.buffer.length; offset += 4) {
    if (bitmap.context.buffer[offset] > 0) count += 1;
  }
  return count;
}

describe('Image clipping masks', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('clips a pixel layer to the transparency of the nearest base layer below before compositing', () => {
    const base = makeLayer({ id: 'base', name: 'Base shape', x: 2, y: 1, bitmap: opaqueBitmap(4, 4) });
    const clipped = makeLayer({
      id: 'shading',
      name: 'Shading',
      x: 0,
      y: 0,
      bitmap: opaqueBitmap(4, 4),
      ...({ clippingMask: true } as Partial<ImageLayer>),
    });

    const bitmap = renderImageDocumentLayersToBitmap(makeDoc([base, clipped])) as unknown as FakeOffscreenCanvas;
    const calls = bitmap.context.drawImageCalls;

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ image: base.bitmap, dx: 2, dy: 1 });
    expect(calls[1].image).not.toBe(clipped.bitmap);
    expect(calls[1]).toMatchObject({ dx: 0, dy: 0, composite: 'source-over' });

    const clippedComposite = calls[1].image as FakeOffscreenCanvas;
    expect(clippedComposite.width).toBe(12);
    expect(clippedComposite.height).toBe(8);
    expect(clippedComposite.context.drawImageCalls[0]).toMatchObject({
      image: clipped.bitmap,
      dx: 0,
      dy: 0,
      composite: 'source-over',
    });
    expect(clippedComposite.context.drawImageCalls.at(-1)).toMatchObject({
      composite: 'destination-in',
    });

    // Pixel truth with real byte compositing: the texture survives only where it overlaps
    // the base footprint. Overlap x∈[2,4) y∈[1,4) stays; texture at (0,0) and base-only
    // pixels at (5,2) are clipped away.
    expect(alphaAt(clippedComposite, 2, 2)).toBe(255);
    expect(alphaAt(clippedComposite, 0, 0)).toBe(0);
    expect(alphaAt(clippedComposite, 5, 2)).toBe(0);
    expect(alphaAt(bitmap, 2, 2)).toBe(255);
    expect(alphaAt(bitmap, 0, 0)).toBe(0);
  });

  it('clips a pixel layer above a group row to the combined transparency of the group descendants', () => {
    const groupChildA = makeLayer({
      id: 'group-child-a',
      name: 'Group child A',
      groupId: 'group-base',
      x: 1,
      y: 1,
      bitmap: opaqueBitmap(4, 4),
    });
    const groupChildB = makeLayer({
      id: 'group-child-b',
      name: 'Group child B',
      groupId: 'group-base',
      x: 6,
      y: 2,
      bitmap: opaqueBitmap(4, 4),
    });
    const group = makeLayer({
      id: 'group-base',
      name: 'Group base',
      type: 'group',
      bitmap: null,
    });
    const clipped = makeLayer({
      id: 'texture',
      name: 'Texture clipped to group',
      bitmap: opaqueBitmap(4, 4),
      ...({ clippingMask: true } as Partial<ImageLayer>),
    });

    const bitmap = renderImageDocumentLayersToBitmap(
      makeDoc([groupChildA, groupChildB, group, clipped]),
    ) as unknown as FakeOffscreenCanvas;
    const calls = bitmap.context.drawImageCalls;

    // Isolated-folder contract: the group composites into one doc-sized surface drawn to the
    // root once — the children never draw to the root directly.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ dx: 1, dy: 1, alpha: 1, composite: 'source-over' });
    const isolated = calls[0].image as FakeOffscreenCanvas;
    expect(isolated).not.toBe(groupChildA.bitmap);
    expect(isolated).not.toBe(groupChildB.bitmap);
    expect(isolated.width).toBe(9);
    expect(isolated.height).toBe(5);
    expect(isolated.context.drawImageCalls.map((call) => ({ image: call.image, dx: call.dx, dy: call.dy })))
      .toEqual([
        { image: groupChildA.bitmap, dx: 1, dy: 1 },
        { image: groupChildB.bitmap, dx: 6, dy: 2 },
      ]);

    // The clipped texture composites through its own doc-sized intermediate, ending with the
    // group alpha footprint applied via destination-in.
    expect(calls[1].image).not.toBe(clipped.bitmap);
    expect(calls[1]).toMatchObject({ dx: 0, dy: 0, composite: 'source-over' });
    const clippedComposite = calls[1].image as FakeOffscreenCanvas;
    expect(clippedComposite.context.drawImageCalls[0]).toMatchObject({
      image: clipped.bitmap,
      composite: 'source-over',
    });
    expect(clippedComposite.context.drawImageCalls.at(-1)).toMatchObject({
      composite: 'destination-in',
    });
    const clippingMask = clippedComposite.context.drawImageCalls.at(-1)?.image as FakeOffscreenCanvas;
    expect(clippingMask.context.drawImageCalls.map((call) => call.image)).toEqual([
      groupChildA.bitmap,
      groupChildB.bitmap,
    ]);

    // Pixel truth: the clipped-texture intermediate carries the texture only where it
    // overlaps the COMBINED descendant footprint — not either child alone. Overlap with
    // child A at (2,2) stays; the child-B footprint beyond the 4×4 texture at (7,3) stays
    // empty; texture pixels outside the footprint, like (0,0), are clipped away.
    expect(alphaAt(clippedComposite, 2, 2)).toBe(255);
    expect(alphaAt(clippedComposite, 7, 3)).toBe(0);
    expect(alphaAt(clippedComposite, 0, 0)).toBe(0);
    // The final document adds the clipped texture over the isolated group render: the
    // overlap shows the texture, the child-B-only area shows child B through the group,
    // and the clipped-away corner stays empty.
    expect(alphaAt(bitmap, 2, 2)).toBe(255);
    expect(alphaAt(bitmap, 7, 3)).toBe(255);
    expect(alphaAt(bitmap, 0, 0)).toBe(0);
  });

  it('allocates nested isolated group surfaces from descendant bounds', () => {
    const leaf = makeLayer({
      id: 'bounded-leaf',
      name: 'Bounded leaf',
      groupId: 'inner-group',
      x: 4,
      y: 3,
      bitmap: opaqueBitmap(2, 2),
    });
    const inner = makeLayer({
      id: 'inner-group',
      name: 'Inner group',
      type: 'group',
      groupId: 'outer-group',
      bitmap: null,
    });
    const outer = makeLayer({
      id: 'outer-group',
      name: 'Outer group',
      type: 'group',
      bitmap: null,
    });

    const bitmap = renderImageDocumentLayersToBitmap(makeDoc([leaf, inner, outer])) as unknown as FakeOffscreenCanvas;
    const outerSurface = bitmap.context.drawImageCalls[0]?.image as FakeOffscreenCanvas;
    const innerSurface = outerSurface?.context.drawImageCalls[0]?.image as FakeOffscreenCanvas;

    expect(outerSurface).toMatchObject({ width: 2, height: 2 });
    expect(innerSurface).toMatchObject({ width: 2, height: 2 });
    expect(bitmap.context.drawImageCalls[0]).toMatchObject({ dx: 4, dy: 3 });
  });

  it('sizes isolated groups from transformed layer footprints', () => {
    const leaf = makeLayer({
      id: 'rotated-leaf',
      name: 'Rotated leaf',
      groupId: 'rotated-group',
      x: 4,
      y: 0,
      rotationDeg: 45,
      bitmap: opaqueBitmap(8, 8),
    });
    const group = makeLayer({
      id: 'rotated-group',
      name: 'Rotated group',
      type: 'group',
      bitmap: null,
    });

    const flat = renderImageDocumentLayersToBitmap(makeDoc([{ ...leaf, groupId: undefined },], 32, 32)) as unknown as FakeOffscreenCanvas;
    const bitmap = renderImageDocumentLayersToBitmap(makeDoc([leaf, group], 32, 32)) as unknown as FakeOffscreenCanvas;
    const isolated = bitmap.context.drawImageCalls[0]?.image as FakeOffscreenCanvas;

    expect(isolated.width).toBeGreaterThan(8);
    expect(isolated.height).toBeGreaterThan(8);
    expect(countOpaque(bitmap)).toBe(countOpaque(flat));
    expect(alphaAt(bitmap, 3, 8)).toBe(alphaAt(flat, 3, 8));
    expect(countOpaque(bitmap)).toBeGreaterThan(0);
  });

  it('includes effect padding when sizing isolated groups', () => {
    const leaf = makeLayer({
      id: 'styled-leaf',
      name: 'Styled leaf',
      groupId: 'styled-group',
      x: 4,
      y: 2,
      bitmap: opaqueBitmap(4, 4),
      effects: [{
        id: 'outside-stroke',
        kind: 'stroke',
        enabled: true,
        color: '#ff0000',
        opacity: 1,
        size: 3,
        position: 'outside',
      }],
    });
    const group = makeLayer({
      id: 'styled-group',
      name: 'Styled group',
      type: 'group',
      bitmap: null,
    });

    const flat = renderImageDocumentLayersToBitmap(makeDoc([{ ...leaf, groupId: undefined },], 32, 32)) as unknown as FakeOffscreenCanvas;
    const bitmap = renderImageDocumentLayersToBitmap(makeDoc([leaf, group], 32, 32)) as unknown as FakeOffscreenCanvas;
    const isolated = bitmap.context.drawImageCalls[0]?.image as FakeOffscreenCanvas;

    expect(isolated.width).toBeGreaterThan(4);
    expect(isolated.height).toBeGreaterThan(4);
    expect(countOpaque(bitmap)).toBe(countOpaque(flat));
    expect(alphaAt(bitmap, 8, 11)).toBe(alphaAt(flat, 8, 11));
    expect(countOpaque(bitmap)).toBeGreaterThan(0);
  });

  it('clips to the complete alpha footprint of a pass-through folder, not only its last leaf', () => {
    const first = makeLayer({
      id: 'pass-first',
      name: 'First pass-through child',
      groupId: 'pass-through',
      bitmap: solidBitmap(1, 1, [255, 0, 0, 255]),
    });
    const last = makeLayer({
      id: 'pass-last',
      name: 'Last pass-through child',
      groupId: 'pass-through',
      x: 1,
      bitmap: solidBitmap(1, 1, [0, 0, 255, 255]),
    });
    const group = makeLayer({
      id: 'pass-through',
      name: 'Pass-through folder',
      type: 'group',
      bitmap: null,
      groupPassThrough: true,
    });
    const clipped = makeLayer({
      id: 'pass-texture',
      name: 'Texture clipped to pass-through folder',
      bitmap: solidBitmap(4, 1, [0, 255, 0, 255]),
      ...({ clippingMask: true } as Partial<ImageLayer>),
    });

    const bitmap = renderImageDocumentLayersToBitmap(makeDoc([first, last, group, clipped])) as unknown as FakeOffscreenCanvas;
    expect(Array.from(bitmap.context.buffer.slice(0, 4))).toEqual([0, 255, 0, 255]);
    expect(Array.from(bitmap.context.buffer.slice(4, 8))).toEqual([0, 255, 0, 255]);
    expect(alphaAt(bitmap, 2, 0)).toBe(0);
  });

  it('describes clipping bases through visible group descendants with stable signatures', () => {
    const sourceLayers = [
      makeLayer({ id: 'orphan', name: 'Orphan clipped layer', clippingMask: true }),
      makeLayer({ id: 'visible-child', name: 'Visible group child', groupId: 'group-base', x: 2, y: 3, bitmap: new OffscreenCanvas(8, 4) as LayerBitmap }),
      makeLayer({ id: 'hidden-child', name: 'Hidden group child', groupId: 'group-base', visible: false, x: 20, y: 1, bitmap: new OffscreenCanvas(5, 5) as LayerBitmap }),
      makeLayer({ id: 'group-base', name: 'Visible group base', type: 'group', bitmap: null }),
      makeLayer({ id: 'texture', name: 'Texture clipped to visible group', clippingMask: true }),
      makeLayer({ id: 'hidden-base-child', name: 'Hidden base child', groupId: 'hidden-group', x: 4, y: 4, bitmap: new OffscreenCanvas(6, 6) as LayerBitmap }),
      makeLayer({ id: 'hidden-group', name: 'Hidden group base', type: 'group', bitmap: null, visible: false }),
      makeLayer({ id: 'shade', name: 'Shade clipped to hidden group', clippingMask: true }),
    ];

    expect(describeImageClippingMaskReadiness(sourceLayers)).toEqual({
      descriptorId: 'image-clipping-mask-readiness:v1',
      ready: false,
      clippedLayerIds: ['orphan', 'texture', 'shade'],
      baseLayerIds: ['group-base', 'hidden-group'],
      invalidLayerIds: ['orphan', 'shade'],
      hiddenBaseLayerIds: ['hidden-group'],
      groupBaseLayerIds: ['group-base', 'hidden-group'],
      chains: [
        {
          baseLayerId: null,
          baseKind: 'missing',
          clippedLayerIds: ['orphan'],
          valid: false,
          baseVisible: false,
          visibleBaseDescendantLayerIds: [],
          hiddenBaseDescendantLayerIds: [],
          baseBounds: null,
          blockers: ['missing-base'],
          caveats: [],
        },
        {
          baseLayerId: 'group-base',
          baseKind: 'group',
          clippedLayerIds: ['texture'],
          valid: true,
          baseVisible: true,
          visibleBaseDescendantLayerIds: ['visible-child'],
          hiddenBaseDescendantLayerIds: ['hidden-child'],
          baseBounds: { x: 2, y: 3, width: 8, height: 4 },
          blockers: [],
          caveats: ['group-base-descendant-alpha'],
        },
        {
          baseLayerId: 'hidden-group',
          baseKind: 'group',
          clippedLayerIds: ['shade'],
          valid: false,
          baseVisible: false,
          visibleBaseDescendantLayerIds: [],
          hiddenBaseDescendantLayerIds: ['hidden-base-child'],
          baseBounds: null,
          blockers: ['hidden-base'],
          caveats: ['group-base-descendant-alpha', 'group-base-hidden'],
        },
      ],
      chainValidation: {
        maxClippedLayerCount: 1,
        groupedChainBaseLayerIds: [],
        groupBaseChainLayerIds: ['texture', 'shade'],
        unsupportedStateCodes: [
          'group-base-descendant-alpha-preview',
          'native-psd-clipping-group-roundtrip',
        ],
      },
      sourceSafety: {
        sourceLinkedLayerIds: [],
        sourceLinkedClippedLayerIds: [],
        sourceLinkedBaseLayerIds: [],
        destructiveBatchSafe: true,
        blockers: [],
      },
      previewSignature: 'image-clipping-mask-readiness:v1|chains=orphan->none:missing:hidden:bounds=none:visible=none:hidden=none:blockers=missing-base;texture->group-base:group:visible:bounds=2,3,8,4:visible=visible-child:hidden=hidden-child:blockers=none;shade->hidden-group:group:hidden:bounds=none:visible=none:hidden=hidden-base-child:blockers=hidden-base|invalid=orphan,shade|hiddenBases=hidden-group|groups=group-base,hidden-group|validation=max=1,grouped=none,group-base=texture,shade,unsupported=group-base-descendant-alpha-preview,native-psd-clipping-group-roundtrip|source=linked=none,clipped=none,bases=none,blockers=none',
    });
  });

  it('validates grouped clipping chains and source-linked destructive safety with stable signatures', () => {
    const sourceLayers = [
      makeLayer({
        id: 'source-base',
        name: 'Source base',
        metadata: {
          sourceLink: {
            id: 'src-base',
            status: 'linked',
            relinkHistory: [],
          },
        },
      }),
      makeLayer({ id: 'tone', name: 'Tone', clippingMask: true }),
      makeLayer({
        id: 'source-texture',
        name: 'Source texture',
        clippingMask: true,
        metadata: { smartLinkedSourceId: 'src-texture' },
      }),
      makeLayer({ id: 'group-child', name: 'Group child', groupId: 'group-base', x: 4, y: 5 }),
      makeLayer({ id: 'group-base', name: 'Group base', type: 'group', bitmap: null }),
      makeLayer({ id: 'group-clip', name: 'Group clip', clippingMask: true }),
    ];

    const readiness = describeImageClippingMaskReadiness(sourceLayers);

    expect(readiness.chainValidation).toEqual({
      maxClippedLayerCount: 2,
      groupedChainBaseLayerIds: ['source-base'],
      groupBaseChainLayerIds: ['group-clip'],
      unsupportedStateCodes: [
        'nested-clipping-mask-chain-editing',
        'group-base-descendant-alpha-preview',
        'source-linked-destructive-clipping-edit',
        'native-psd-clipping-group-roundtrip',
      ],
    });
    expect(readiness.sourceSafety).toEqual({
      sourceLinkedLayerIds: ['source-base', 'source-texture'],
      sourceLinkedClippedLayerIds: ['source-texture'],
      sourceLinkedBaseLayerIds: ['source-base'],
      destructiveBatchSafe: false,
      blockers: [
        'source-linked-base-layer',
        'source-linked-clipped-layer',
      ],
    });
    expect(readiness.previewSignature).toBe(
      'image-clipping-mask-readiness:v1|chains=tone+source-texture->source-base:layer:visible:bounds=0,0,4,4:visible=none:hidden=none:blockers=none;group-clip->group-base:group:visible:bounds=4,5,4,4:visible=group-child:hidden=none:blockers=none|invalid=none|hiddenBases=none|groups=group-base|validation=max=2,grouped=source-base,group-base=group-clip,unsupported=nested-clipping-mask-chain-editing,group-base-descendant-alpha-preview,source-linked-destructive-clipping-edit,native-psd-clipping-group-roundtrip|source=linked=source-base,source-texture,clipped=source-texture,bases=source-base,blockers=source-linked-base-layer,source-linked-clipped-layer',
    );
  });
});
