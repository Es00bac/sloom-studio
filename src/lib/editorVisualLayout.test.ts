import { describe, expect, it } from 'vitest';
import type { EditorVisualClip } from '../types/flow';
import {
  buildShapeLayoutDescriptor,
  buildVisualClipLayoutDescriptor,
  fitVisualDimensions,
  getTransitionOpacityFactor,
  resolveTextSourceDimensions,
  TEXT_LINE_HEIGHT,
} from './editorVisualLayout';

function makeClip(patch: Partial<EditorVisualClip> = {}): EditorVisualClip {
  return {
    id: 'clip-1',
    sourceNodeId: 'source-1',
    sourceKind: 'image',
    trackIndex: 0,
    startMs: 0,
    sourceInMs: 0,
    trimStartMs: 0,
    trimEndMs: 0,
    playbackRate: 1,
    reversePlayback: false,
    fitMode: 'contain',
    scalePercent: 100,
    scaleMotionEnabled: false,
    endScalePercent: 100,
    opacityPercent: 100,
    rotationDeg: 0,
    rotationMotionEnabled: false,
    endRotationDeg: 0,
    flipHorizontal: false,
    flipVertical: false,
    positionX: 0,
    positionY: 0,
    motionEnabled: false,
    endPositionX: 0,
    endPositionY: 0,
    cropLeftPercent: 0,
    cropRightPercent: 0,
    cropTopPercent: 0,
    cropBottomPercent: 0,
    cropPanXPercent: 0,
    cropPanYPercent: 0,
    cropRotationDeg: 0,
    filterStack: [],
    transitionIn: 'none',
    transitionOut: 'none',
    transitionDurationMs: 0,
    textFontFamily: 'Inter, system-ui, sans-serif',
    textSizePx: 72,
    textColor: '#ffffff',
    textEffect: 'none',
    textBackgroundOpacityPercent: 0,
    ...patch,
  };
}

describe('editor visual layout descriptors', () => {
  it('computes shared fit and positioned image frame descriptors', () => {
    expect(fitVisualDimensions({ width: 1000, height: 500 }, { width: 1920, height: 1080 }, 'contain')).toEqual({
      width: 1920,
      height: 960,
    });

    const descriptor = buildVisualClipLayoutDescriptor({
      clip: makeClip({ positionX: 40, positionY: -20, scalePercent: 50, rotationDeg: 15 }),
      canvas: { width: 1920, height: 1080 },
      source: { width: 1000, height: 500 },
    });

    expect(descriptor.left).toBe(520);
    expect(descriptor.top).toBe(280);
    expect(descriptor.width).toBe(960);
    expect(descriptor.height).toBe(480);
    expect(descriptor.rotationDeg).toBe(15);
  });

  it('keeps crop preview and render crop descriptors aligned', () => {
    const descriptor = buildVisualClipLayoutDescriptor({
      clip: makeClip({ cropLeftPercent: 10, cropRightPercent: 20, cropTopPercent: 5, cropPanXPercent: 50 }),
      canvas: { width: 1920, height: 1080 },
      source: { width: 1920, height: 1080 },
    });

    expect(descriptor.crop.frameLeftPercent).toBe(10);
    expect(descriptor.crop.visibleWidthPercent).toBe(70);
    expect(descriptor.crop.contentTranslateXPercent).toBe(50);
    expect(descriptor.crop.renderCropXPercent).toBeCloseTo(2.5);
  });

  it('describes text line height, outline padding, and bounds', () => {
    const source = resolveTextSourceDimensions({
      text: 'Hello\nWorld',
      fontFamily: 'Inter',
      fontSizePx: 80,
      effect: 'outline',
    });
    const descriptor = buildVisualClipLayoutDescriptor({
      clip: makeClip({ sourceKind: 'text', textContent: 'Hello\nWorld', textSizePx: 80, textEffect: 'outline' }),
      canvas: { width: 1920, height: 1080 },
      source,
      text: 'Hello\nWorld',
    });

    expect(descriptor.text?.lineHeight).toBe(TEXT_LINE_HEIGHT);
    expect(descriptor.text?.outlineWidthPx).toBe(2);
    expect(descriptor.width).toBe(source.width);
    expect(descriptor.height).toBe(source.height);
  });

  it('describes keyframed transforms and transition opacity windows', () => {
    const clip = makeClip({
      transitionIn: 'fade',
      transitionOut: 'fade',
      transitionDurationMs: 1000,
      keyframes: [
        { timePercent: 0, positionX: 0, positionY: 0, scalePercent: 100, rotationDeg: 0, opacityPercent: 100 },
        { timePercent: 100, positionX: 100, positionY: 50, scalePercent: 200, rotationDeg: 30, opacityPercent: 50 },
      ],
    });
    const descriptor = buildVisualClipLayoutDescriptor({
      clip,
      canvas: { width: 1920, height: 1080 },
      source: { width: 1920, height: 1080 },
      progressPercent: 50,
      localTimeSeconds: 2,
      durationSeconds: 4,
    });

    expect(descriptor.positionX).toBe(50);
    expect(descriptor.scalePercent).toBe(150);
    expect(descriptor.rotationDeg).toBe(15);
    expect(getTransitionOpacityFactor(clip, 0.5, 4)).toBe(0.5);
  });

  it('evaluates persisted hold and cubic-Bezier parameter automation in the preview layout', () => {
    const clip = makeClip({
      professional: {
        parameterKeyframes: [
          {
            id: 'opacity',
            parameter: 'opacity',
            durationMs: 4_000,
            keyframes: [
              { id: 'o1', timeMs: 0, value: 20, interpolation: 'hold' },
              { id: 'o2', timeMs: 2_000, value: 80, interpolation: 'linear' },
            ],
          },
          {
            id: 'position-x',
            parameter: 'position-x',
            durationMs: 4_000,
            keyframes: [
              { id: 'x1', timeMs: 0, value: 0, interpolation: 'bezier', bezier: { outX: 0.42, outY: 0, inX: 1, inY: 1 } },
              { id: 'x2', timeMs: 2_000, value: 100, interpolation: 'linear' },
            ],
          },
        ],
      },
    });
    const descriptor = buildVisualClipLayoutDescriptor({
      clip,
      canvas: { width: 1920, height: 1080 },
      source: { width: 1920, height: 1080 },
      localTimeSeconds: 1,
      durationSeconds: 4,
    });

    expect(descriptor.opacityPercent).toBe(20);
    expect(descriptor.positionX).toBeGreaterThan(0);
    expect(descriptor.positionX).toBeLessThan(50);
  });

  it('uses the same shape inset geometry as preview and render', () => {
    const shape = buildShapeLayoutDescriptor({
      width: 1280,
      height: 720,
      fillColor: '#000000',
      borderColor: '#ffffff',
      borderWidth: 4,
      cornerRadius: 40,
    });

    expect(shape.innerLeft).toBe(128);
    expect(shape.innerTop).toBe(72);
    expect(shape.innerWidth).toBe(1024);
    expect(shape.innerHeight).toBe(576);
  });
});
