import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../types/paper';
import {
  buildPaperFrameDragGeometry,
  buildPaperFrameCreateGeometry,
  clientPointToPaperPoint,
  buildPaperImageRenderStyle,
  resolvePaperImageNaturalSizePatch,
  paperTextVerticalAlignToJustifyContent,
  movePaperFrameByDelta,
  panPaperFrameImageCropByDelta,
  paperGuideOrientationFromRuler,
  paperGuidePositionFromClientPoint,
  rotatePaperFrameImageTowardPointer,
  resolvePaperWheelZoom,
  paperRulerMarkerSpacingMm,
  scalePaperFrameImageTowardPointer,
  snapPaperGuidePositionToRulerMarker,
  snapPaperPointToGridAndGuides,
  resolvePaperTextBox,
  resolvePaperPolygonPointClick,
  resizePaperFrameFromHandle,
  rotatePaperFrameTowardPointer,
} from './paperLayoutTools';

function frame(overrides: Partial<PaperFrame> = {}): PaperFrame {
  return {
    id: 'frame-1',
    kind: 'image',
    label: 'Image Frame',
    xMm: 20,
    yMm: 30,
    widthMm: 40,
    heightMm: 30,
    rotationDeg: 0,
    locked: false,
    fit: 'cover',
    columns: 1,
    typography: {
      fontFamily: 'Inter',
      fontSizePt: 10,
      leadingPt: 13,
      tracking: 0,
      align: 'left',
      hyphenate: true,
      color: '#111827',
      fontWeight: '400',
      fontStyle: 'normal',
    },
    fillColor: 'transparent',
    fillOpacity: 1,
    strokeColor: '#111827',
    strokeOpacity: 1,
    strokeWidthMm: 0.2,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity: 1,
    zIndex: 0,
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    textBoxXPercent: 0,
    textBoxYPercent: 0,
    textBoxWidthPercent: 100,
    textBoxHeightPercent: 100,
    textRotationDeg: 0,
    textVerticalAlign: 'top',
    ...overrides,
  };
}

describe('paperLayoutTools', () => {
  it('normalizes drag-created frame geometry and enforces a usable minimum size', () => {
    expect(buildPaperFrameDragGeometry({ xMm: 70, yMm: 80 }, { xMm: 20, yMm: 35 })).toEqual({
      xMm: 20,
      yMm: 35,
      widthMm: 50,
      heightMm: 45,
    });

    expect(buildPaperFrameDragGeometry({ xMm: 10, yMm: 10 }, { xMm: 11, yMm: 11 })).toEqual({
      xMm: 10,
      yMm: 10,
      widthMm: 12,
      heightMm: 8,
    });
  });

  it('keeps click-created frame geometry size-free so Paper can use kind-specific defaults', () => {
    expect(buildPaperFrameCreateGeometry({ xMm: 10, yMm: 10 }, { xMm: 10.5, yMm: 10.5 })).toEqual({
      xMm: 10,
      yMm: 10,
    });

    expect(buildPaperFrameCreateGeometry({ xMm: 10, yMm: 10 }, { xMm: 28, yMm: 24 })).toEqual({
      xMm: 10,
      yMm: 10,
      widthMm: 18,
      heightMm: 14,
    });
  });

  it('moves frames by millimeter deltas without clamping them to the page', () => {
    expect(movePaperFrameByDelta(frame(), { deltaXMm: 60, deltaYMm: 90 })).toMatchObject({
      xMm: 80,
      yMm: 120,
    });

    expect(movePaperFrameByDelta(frame(), { deltaXMm: -35, deltaYMm: -45 })).toMatchObject({
      xMm: -15,
      yMm: -15,
    });
  });

  it('translates client coordinates outside the page without clamping', () => {
    expect(clientPointToPaperPoint(
      { clientX: 62, clientY: 176 },
      { left: 100, top: 120 },
      0.5,
    )).toEqual({
      xMm: -20.106,
      yMm: 29.63,
    });
  });

  it('maps ruler drags to the perpendicular guide orientation and page coordinate', () => {
    expect(paperGuideOrientationFromRuler('horizontal')).toBe('vertical');
    expect(paperGuideOrientationFromRuler('vertical')).toBe('horizontal');

    expect(paperGuidePositionFromClientPoint(
      { clientX: 176, clientY: 999 },
      'vertical',
      { left: 100, top: 120, width: 378, height: 756 },
      { widthMm: 100, heightMm: 200 },
      0.5,
    )).toBe(40.212);

    expect(paperGuidePositionFromClientPoint(
      { clientX: 999, clientY: 176 },
      'horizontal',
      { left: 100, top: 120, width: 378, height: 756 },
      { widthMm: 100, heightMm: 200 },
      0.5,
    )).toBe(29.63);
  });

  it('resizes frames from handles while preserving the opposite edge', () => {
    expect(resizePaperFrameFromHandle(frame(), 'nw', { deltaXMm: -10, deltaYMm: -5 })).toMatchObject({
      xMm: 10,
      yMm: 25,
      widthMm: 50,
      heightMm: 35,
    });

    expect(resizePaperFrameFromHandle(frame(), 'se', { deltaXMm: -100, deltaYMm: -100 })).toMatchObject({
      widthMm: 12,
      heightMm: 8,
    });
  });

  it('resizes frames beyond the page edges while enforcing minimum dimensions', () => {
    expect(resizePaperFrameFromHandle(frame(), 'nw', { deltaXMm: -35, deltaYMm: -45 })).toMatchObject({
      xMm: -15,
      yMm: -15,
      widthMm: 75,
      heightMm: 75,
    });

    expect(resizePaperFrameFromHandle(frame(), 'se', { deltaXMm: 85, deltaYMm: 120 })).toMatchObject({
      xMm: 20,
      yMm: 30,
      widthMm: 125,
      heightMm: 150,
    });
  });

  it('locks frame aspect ratio while resizing from corners and edge handles', () => {
    expect(resizePaperFrameFromHandle(frame(), 'se', { deltaXMm: 20, deltaYMm: 0 }, undefined, undefined, {
      lockAspectRatio: true,
    })).toEqual({
      xMm: 20,
      yMm: 30,
      widthMm: 60,
      heightMm: 45,
    });

    expect(resizePaperFrameFromHandle(frame(), 'e', { deltaXMm: 20, deltaYMm: 0 }, undefined, undefined, {
      lockAspectRatio: true,
    })).toEqual({
      xMm: 20,
      yMm: 22.5,
      widthMm: 60,
      heightMm: 45,
    });

    expect(resizePaperFrameFromHandle(frame(), 'n', { deltaXMm: 0, deltaYMm: -15 }, undefined, undefined, {
      lockAspectRatio: true,
    })).toEqual({
      xMm: 10,
      yMm: 15,
      widthMm: 60,
      heightMm: 45,
    });
  });

  it('rotates frames toward a pointer around their center', () => {
    expect(rotatePaperFrameTowardPointer(frame(), { xMm: 40, yMm: 15 })).toBe(0);
    expect(rotatePaperFrameTowardPointer(frame(), { xMm: 70, yMm: 45 })).toBe(90);
    expect(rotatePaperFrameTowardPointer(frame(), { xMm: 40, yMm: 80 })).toBe(180);
  });

  it('builds image render style for fit, crop, offset, and in-frame rotation', () => {
    expect(buildPaperImageRenderStyle(frame({
      fit: 'stretch',
      imageScale: 1.35,
      imageOffsetXPercent: -20,
      imageOffsetYPercent: 15,
      imageRotationDeg: 12,
    }))).toEqual({
      objectFit: 'fill',
      objectPosition: '50% 50%',
      position: 'absolute',
      width: '135%',
      height: '135%',
      maxWidth: 'none',
      maxHeight: 'none',
      left: '30%',
      top: '65%',
      transform: 'translate(-50%, -50%) rotate(12deg)',
      transformOrigin: 'center',
    });
  });

  it('preserves unrestricted image crop offsets and flip transforms', () => {
    expect(buildPaperImageRenderStyle(frame({
      fit: 'cover',
      imageScale: 0.2,
      imageOffsetXPercent: 260,
      imageOffsetYPercent: -180,
      imageRotationDeg: -33,
      imageFlipX: true,
      imageFlipY: true,
    } as Partial<PaperFrame>))).toEqual({
      objectFit: 'cover',
      objectPosition: '50% 50%',
      position: 'absolute',
      width: '20%',
      height: '20%',
      maxWidth: 'none',
      maxHeight: 'none',
      left: '310%',
      top: '-130%',
      transform: 'translate(-50%, -50%) rotate(-33deg) scaleX(-1) scaleY(-1)',
      transformOrigin: 'center',
    });
  });

  it('uses explicit two-axis transform offsets so crop panning is visible even when object-fit has only one overflow axis', () => {
    expect(buildPaperImageRenderStyle(frame({
      fit: 'cover',
      imageScale: 1,
      imageOffsetXPercent: 25,
      imageOffsetYPercent: -12,
      imageRotationDeg: 0,
      asset: {
        sourceBinItemId: 'asset-1',
        label: 'square-panel.png',
        kind: 'image',
        pixelWidth: 1000,
        pixelHeight: 1000,
      },
    }))).toEqual({
      objectFit: 'cover',
      objectPosition: '50% 50%',
      position: 'absolute',
      width: '100%',
      height: '133.333%',
      maxWidth: 'none',
      maxHeight: 'none',
      left: '75%',
      top: '38%',
      transform: 'translate(-50%, -50%) rotate(0deg)',
      transformOrigin: 'center',
    });
  });

  it('sizes the image canvas from the asset aspect before panning so cover crop does not clip image sides', () => {
    const style = buildPaperImageRenderStyle(frame({
      widthMm: 50,
      heightMm: 50,
      fit: 'cover',
      imageScale: 1,
      imageOffsetXPercent: 30,
      imageOffsetYPercent: -10,
      imageRotationDeg: 0,
      asset: {
        sourceBinItemId: 'asset-1',
        label: 'wide-panel.png',
        kind: 'image',
        pixelWidth: 2000,
        pixelHeight: 1000,
      },
    }));

    expect(style).toMatchObject({
      objectFit: 'cover',
      objectPosition: '50% 50%',
      position: 'absolute',
      width: '200%',
      height: '100%',
      left: '80%',
      top: '40%',
      transform: 'translate(-50%, -50%) rotate(0deg)',
      transformOrigin: 'center',
    });
  });

  it('prevents global image CSS from clamping the crop canvas back to the frame size', () => {
    expect(buildPaperImageRenderStyle(frame({
      widthMm: 50,
      heightMm: 50,
      fit: 'cover',
      imageScale: 1.4,
      asset: {
        sourceBinItemId: 'asset-1',
        label: 'wide-panel.png',
        kind: 'image',
        pixelWidth: 2000,
        pixelHeight: 1000,
      },
    }))).toMatchObject({
      width: '280%',
      height: '140%',
      maxWidth: 'none',
      maxHeight: 'none',
    });
  });

  it('uses browser intrinsic image fitting instead of stretching when image pixel metadata is not resolved yet', () => {
    expect(buildPaperImageRenderStyle(frame({
      fit: 'cover',
      asset: {
        sourceBinItemId: 'asset-1',
        label: 'missing-metadata.png',
        kind: 'image',
      },
    }))).toMatchObject({
      objectFit: 'cover',
      width: '100%',
      height: '100%',
    });

    expect(buildPaperImageRenderStyle(frame({
      fit: 'contain',
      asset: {
        sourceBinItemId: 'asset-1',
        label: 'missing-metadata.png',
        kind: 'image',
      },
    }))).toMatchObject({
      objectFit: 'contain',
      width: '100%',
      height: '100%',
    });
  });

  it('creates an image natural-size patch so existing frames stop falling back to stretch-like metadata', () => {
    expect(resolvePaperImageNaturalSizePatch(frame({
      fit: 'cover',
      asset: {
        sourceBinItemId: 'asset-1',
        label: 'wide-panel.png',
        kind: 'image',
      },
    }), 2000, 1000)).toEqual({
      asset: {
        sourceBinItemId: 'asset-1',
        label: 'wide-panel.png',
        kind: 'image',
        pixelWidth: 2000,
        pixelHeight: 1000,
      },
    });

    expect(resolvePaperImageNaturalSizePatch(frame({
      asset: {
        sourceBinItemId: 'asset-1',
        label: 'wide-panel.png',
        kind: 'image',
        pixelWidth: 2000,
        pixelHeight: 1000,
      },
    }), 2000, 1000)).toBeUndefined();
  });

  it('pans an image crop from direct shift-drag deltas without constraining the image to the frame', () => {
    expect(panPaperFrameImageCropByDelta(frame({
      imageOffsetXPercent: 10,
      imageOffsetYPercent: -5,
    }), { deltaXMm: 8, deltaYMm: -6 })).toEqual({
      imageOffsetXPercent: 30,
      imageOffsetYPercent: -25,
    });

    expect(panPaperFrameImageCropByDelta(frame({
      imageOffsetXPercent: 45,
      imageOffsetYPercent: -45,
    }), { deltaXMm: 10, deltaYMm: -10 })).toEqual({
      imageOffsetXPercent: 70,
      imageOffsetYPercent: -78.333,
    });
  });

  it('scales and rotates image content around the frame center from direct handles', () => {
    expect(scalePaperFrameImageTowardPointer(frame(), { xMm: 40, yMm: 20 })).toEqual({
      imageScale: 1,
    });

    expect(scalePaperFrameImageTowardPointer(frame(), { xMm: 90, yMm: 45 })).toEqual({
      imageScale: 2,
    });

    expect(scalePaperFrameImageTowardPointer(frame(), { xMm: 40, yMm: 45 })).toEqual({
      imageScale: 0.05,
    });

    expect(rotatePaperFrameImageTowardPointer(frame(), { xMm: 40, yMm: 20 })).toEqual({
      imageRotationDeg: 0,
    });

    expect(rotatePaperFrameImageTowardPointer(frame(), { xMm: 65, yMm: 45 })).toEqual({
      imageRotationDeg: 90,
    });
  });

  it('resolves modifier-wheel zoom while leaving ordinary wheel scrolling alone', () => {
    expect(resolvePaperWheelZoom({
      currentZoom: 0.8,
      deltaY: -120,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })).toBeNull();

    expect(resolvePaperWheelZoom({
      currentZoom: 0.8,
      deltaY: -120,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    })).toBe(0.88);

    expect(resolvePaperWheelZoom({
      currentZoom: 0.8,
      deltaY: -120,
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
    })).toBe(1);

    expect(resolvePaperWheelZoom({
      currentZoom: 0.8,
      deltaY: 120,
      ctrlKey: false,
      metaKey: true,
      shiftKey: true,
    })).toBe(0.6);

    expect(resolvePaperWheelZoom({
      currentZoom: 2.95,
      deltaY: -120,
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
    })).toBe(3);
  });

  it('snaps guide positions to ruler marker increments only while Shift is held', () => {
    const grid = { enabled: true, sizeMm: 10, subdivisions: 5 };

    expect(paperRulerMarkerSpacingMm(grid)).toBe(2);
    expect(snapPaperGuidePositionToRulerMarker(13.1, 100, grid, false)).toBe(13.1);
    expect(snapPaperGuidePositionToRulerMarker(13.1, 100, grid, true)).toBe(14);
    expect(snapPaperGuidePositionToRulerMarker(99.6, 100, grid, true)).toBe(100);
    expect(snapPaperGuidePositionToRulerMarker(-2.2, 100, grid, true)).toBe(0);
  });

  it('snaps frame points to enabled grid markers and nearby guide lines', () => {
    expect(snapPaperPointToGridAndGuides(
      { xMm: 13.1, yMm: 28.9 },
      {
        grid: { enabled: true, sizeMm: 10, subdivisions: 5 },
        snapToGrid: true,
      },
    )).toEqual({ xMm: 14, yMm: 28 });

    expect(snapPaperPointToGridAndGuides(
      { xMm: 41.4, yMm: 77.2 },
      {
        guides: [
          { orientation: 'vertical', positionMm: 42 },
          { orientation: 'horizontal', positionMm: 78 },
        ],
        snapToGuides: true,
      },
    )).toEqual({ xMm: 42, yMm: 78 });
  });

  it('resolves speech-bubble inner text boxes with sane defaults and clamps invalid geometry', () => {
    expect(resolvePaperTextBox(frame({
      kind: 'speechBubble',
      textBoxXPercent: -10,
      textBoxYPercent: 84,
      textBoxWidthPercent: 140,
      textBoxHeightPercent: 40,
      textRotationDeg: 15,
      textVerticalAlign: 'middle',
    }))).toEqual({
      xPercent: 0,
      yPercent: 84,
      widthPercent: 100,
      heightPercent: 16,
      rotationDeg: 15,
      verticalAlign: 'middle',
    });

    expect(resolvePaperTextBox({ kind: 'speechBubble' })).toMatchObject({
      xPercent: 12,
      yPercent: 18,
      widthPercent: 76,
      heightPercent: 48,
      verticalAlign: 'middle',
    });
    expect(paperTextVerticalAlignToJustifyContent('bottom')).toBe('flex-end');
  });

  it('closes a free polygon when a click lands back on an existing vertex after enough points', () => {
    const points = [
      { xMm: 10, yMm: 10 },
      { xMm: 42, yMm: 12 },
      { xMm: 50, yMm: 40 },
      { xMm: 18, yMm: 46 },
    ];

    expect(resolvePaperPolygonPointClick(points, { xMm: 10.6, yMm: 10.4 })).toEqual({
      kind: 'close',
      points,
      closedPointIndex: 0,
    });
  });

  it('keeps adding free-polygon points before three vertices or when the click misses existing vertices', () => {
    expect(resolvePaperPolygonPointClick([
      { xMm: 10, yMm: 10 },
      { xMm: 42, yMm: 12 },
    ], { xMm: 10.5, yMm: 10.3 })).toEqual({
      kind: 'add',
      points: [
        { xMm: 10, yMm: 10 },
        { xMm: 42, yMm: 12 },
        { xMm: 10.5, yMm: 10.3 },
      ],
    });

    expect(resolvePaperPolygonPointClick([
      { xMm: 10, yMm: 10 },
      { xMm: 42, yMm: 12 },
      { xMm: 50, yMm: 40 },
    ], { xMm: 32, yMm: 30 })).toEqual({
      kind: 'add',
      points: [
        { xMm: 10, yMm: 10 },
        { xMm: 42, yMm: 12 },
        { xMm: 50, yMm: 40 },
        { xMm: 32, yMm: 30 },
      ],
    });
  });
});
