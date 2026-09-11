import { describe, expect, it } from 'vitest';
import {
  buildPaperComicSfxFrames,
  buildPaperComicSfxDecalFrame,
  buildPaperComicSfxDecalFrameUpdate,
  createPaperComicSfxDesign,
  getPaperComicSfxPreset,
  listPaperComicSfxPresets,
  normalizePaperComicSfxDesign,
  PAPER_COMIC_SFX_PRESET_IDS,
  paperComicSfxDesignToDataUrl,
} from './paperComicSfx';

describe('paperComicSfx', () => {
  it('exposes production comic sound-effect presets with full rendering metadata', () => {
    expect(PAPER_COMIC_SFX_PRESET_IDS).toEqual([
      'bang',
      'kapow',
      'screech',
      'whirrrrr',
      'boom',
      'crash',
      'zap',
      'slam',
    ]);

    const presets = listPaperComicSfxPresets();
    expect(presets).toHaveLength(8);
    for (const preset of presets) {
      expect(preset.text).toMatch(/\S/);
      expect(preset.fontFamily).toMatch(/\S/);
      expect(preset.fillColor).toMatch(/^#/);
      expect(preset.strokeColor).toMatch(/^#/);
      expect(preset.shadow.color).toMatch(/\S/);
      expect(typeof preset.warp.skewXDeg).toBe('number');
      expect(typeof preset.rotationDeg).toBe('number');
      expect(typeof preset.tracking).toBe('number');
      expect(preset.trailingCopies.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('builds a layered KAPOW effect with burst backing, trail copies, and styled primary text', () => {
    const result = buildPaperComicSfxFrames({
      presetId: 'kapow',
      idPrefix: 'test-kapow',
      origin: { xMm: 20, yMm: 25 },
      zIndexStart: 5,
    });

    expect(result.primaryFrameId).toBe('test-kapow-primary');
    expect(result.selectedFrameIds).toContain('test-kapow-primary');
    expect(result.frames.length).toBeGreaterThanOrEqual(4);

    const burst = result.frames.find((frame) => frame.label.includes('Burst'));
    expect(burst).toMatchObject({
      kind: 'shape',
      shapeKind: 'polygon',
      zIndex: 5,
    });
    expect(burst?.vertices?.length).toBeGreaterThan(6);

    const trails = result.frames.filter((frame) => frame.label.includes('Trail'));
    expect(trails.length).toBeGreaterThanOrEqual(getPaperComicSfxPreset('kapow').trailingCopies.count);
    expect(trails.every((frame) => (frame.opacity ?? 1) < 0.8)).toBe(true);
    expect(trails.every((frame) => frame.zIndex < 5 + result.frames.length - 1)).toBe(true);

    const primary = result.frames.find((frame) => frame.id === result.primaryFrameId);
    if (!primary) throw new Error('Expected WHIRRRR primary frame');
    expect(primary).toMatchObject({
      id: 'test-kapow-primary',
      kind: 'text',
      label: 'KAPOW! SFX',
      text: 'KAPOW!',
      xMm: 20,
      yMm: 25,
      textStrokeColor: '#111111',
      textShadowColor: 'rgba(0,0,0,0.52)',
      textSkewXDeg: -9,
      textScaleX: 1.12,
    });
    expect(primary?.typography?.fontFamily).toContain('Impact');
    expect(primary?.typography?.fontSizePt).toBeGreaterThan(40);
    expect(primary?.textStrokeWidthMm).toBeGreaterThan(0.8);
  });

  it('builds stretched WHIRRRR text with speed lines and trailing motion copies', () => {
    const result = buildPaperComicSfxFrames({
      presetId: 'whirrrrr',
      idPrefix: 'test-whir',
      origin: { xMm: 12, yMm: 18 },
      text: 'WHIRRRRRR',
    });

    const primary = result.frames.find((frame) => frame.id === result.primaryFrameId);
    if (!primary) throw new Error('Expected WHIRRRR primary frame');
    expect(primary).toMatchObject({
      id: 'test-whir-primary',
      text: 'WHIRRRRRR',
      textScaleX: 1.32,
    });

    const speedLines = result.frames.filter((frame) => frame.label.includes('Speed Line'));
    expect(speedLines).toHaveLength(6);
    expect(speedLines.every((frame) => frame.kind === 'shape' && frame.shapeKind === 'line')).toBe(true);

    const trails = result.frames.filter((frame) => frame.label.includes('Trail'));
    expect(trails).toHaveLength(4);
    expect(trails[0].xMm).toBeLessThan(primary.xMm);
    expect(trails[trails.length - 1].opacity ?? 1).toBeLessThan(trails[0].opacity ?? 0);
  });

  it('creates editable designer state from presets and normalizes unsafe custom values', () => {
    const design = createPaperComicSfxDesign('screech', {
      text: '  squeal   away  ',
      fontSizePt: 144,
      strokeWidthMm: -4,
      trailingCopiesCount: 22,
      burstEnabled: true,
      burstPoints: 3,
      speedLinesEnabled: true,
      speedLineCount: 0,
      halftoneEnabled: true,
      halftoneCount: 80,
      rotationDeg: 99,
      tracking: -10,
    });

    expect(design).toMatchObject({
      presetId: 'screech',
      text: 'SQUEAL AWAY',
      strokeWidthMm: 0,
      trailingCopiesCount: 12,
      burstEnabled: true,
      burstPoints: 4,
      speedLinesEnabled: true,
      speedLineCount: 1,
      halftoneEnabled: true,
      halftoneCount: 48,
      rotationDeg: 45,
      tracking: -2,
    });
    expect(design.fontSizePt).toBe(96);

    const normalized = normalizePaperComicSfxDesign({
      ...design,
      text: '',
      scaleX: 0,
      scaleY: 9,
      trailOpacityStep: 2,
      speedLineOpacity: -1,
    });
    expect(normalized.text).toBe('BANG!');
    expect(normalized.scaleX).toBe(0.4);
    expect(normalized.scaleY).toBe(3);
    expect(normalized.trailOpacityStep).toBe(0.5);
    expect(normalized.speedLineOpacity).toBe(0);
  });

  it('builds custom designer effects with preview-equivalent frames before placement', () => {
    const design = createPaperComicSfxDesign('bang', {
      text: 'thoom',
      fillColor: '#7dd3fc',
      strokeColor: '#0f172a',
      strokeWidthMm: 1.8,
      shadowColor: 'rgba(15,23,42,0.7)',
      shadowBlurMm: 1.1,
      skewXDeg: 12,
      skewYDeg: -6,
      scaleX: 1.45,
      scaleY: 0.82,
      rotationDeg: 14,
      tracking: 3.5,
      trailingCopiesCount: 5,
      trailOffsetXMm: -4,
      trailOffsetYMm: 2,
      trailScaleStep: 0.08,
      trailOpacityStep: 0.12,
      burstEnabled: false,
      speedLinesEnabled: true,
      speedLineCount: 7,
      speedLineColor: '#0284c7',
      speedLineAngleDeg: 18,
      halftoneEnabled: true,
      halftoneCount: 9,
      halftoneColor: '#bae6fd',
    });

    const result = buildPaperComicSfxFrames({
      presetId: 'bang',
      design,
      idPrefix: 'designer-thoom',
      origin: { xMm: 18, yMm: 21 },
    });

    expect(result.frames.some((frame) => frame.label.includes('Burst'))).toBe(false);
    expect(result.frames.filter((frame) => frame.label.includes('Speed Line'))).toHaveLength(7);
    expect(result.frames.filter((frame) => frame.label.includes('Halftone Dot'))).toHaveLength(9);
    expect(result.frames.filter((frame) => frame.label.includes('Trail'))).toHaveLength(5);

    const primary = result.frames.find((frame) => frame.id === result.primaryFrameId);
    expect(primary).toMatchObject({
      id: 'designer-thoom-primary',
      text: 'THOOM',
      rotationDeg: 14,
      textStrokeColor: '#0f172a',
      textStrokeWidthMm: 1.8,
      textShadowColor: 'rgba(15,23,42,0.7)',
      textShadowBlurMm: 1.1,
      textSkewXDeg: 12,
      textSkewYDeg: -6,
      textScaleX: 1.45,
      textScaleY: 0.82,
    });
    expect(primary?.typography?.color).toBe('#7dd3fc');
    expect(primary?.typography?.tracking).toBe(3.5);
  });

  it('keeps short custom sound-effect text large enough before manual resizing', () => {
    const result = buildPaperComicSfxFrames({
      presetId: 'bang',
      idPrefix: 'short-sfx',
      origin: { xMm: 12, yMm: 16 },
      text: 'go',
    });

    const primary = result.frames.find((frame) => frame.id === result.primaryFrameId);
    if (!primary) throw new Error('Expected short SFX primary frame');
    expect(primary.text).toBe('GO');
    expect(primary.widthMm).toBeGreaterThanOrEqual(58);
    expect(primary.heightMm).toBeGreaterThanOrEqual(32);
  });

  it('builds a single embedded vector decal frame for Paper placement', () => {
    const design = createPaperComicSfxDesign('zap', {
      text: 'go',
      burstEnabled: true,
      speedLinesEnabled: true,
      speedLineCount: 3,
      trailingCopiesCount: 4,
    });

    const result = buildPaperComicSfxDecalFrame({
      presetId: 'zap',
      design,
      idPrefix: 'sfx-short',
      origin: { xMm: 33, yMm: 44 },
      zIndexStart: 12,
    });

    expect(result.primaryFrameId).toBe('sfx-short');
    expect(result.selectedFrameIds).toEqual(['sfx-short']);
    expect(result.frame).toMatchObject({
      id: 'sfx-short',
      kind: 'image',
      label: 'GO Comic SFX',
      xMm: 33,
      yMm: 44,
      fit: 'stretch',
      zIndex: 12,
      comicSfxDesign: {
        presetId: 'zap',
        text: 'GO',
      },
    });
    expect(result.frame.widthMm).toBeGreaterThanOrEqual(58);
    expect(result.frame.heightMm).toBeGreaterThanOrEqual(32);
    expect(result.frame.asset?.sourceBinItemId).toBeUndefined();
    expect(result.frame.asset).toMatchObject({
      label: 'GO Comic SFX',
      kind: 'image',
      mimeType: 'image/svg+xml',
    });
    expect(result.frame.asset?.pixelWidth).toBeGreaterThan(2000);

    expect(result.frame.asset?.locator).toBeUndefined();
    const svgPayload = decodeURIComponent(paperComicSfxDesignToDataUrl(result.frame.comicSfxDesign!).split(',')[1] ?? '');
    expect(svgPayload).toContain('<svg');
    expect(svgPayload).toContain('GO');
    expect(svgPayload).toContain('<polygon');
    expect(svgPayload).toContain('<line');
    expect(svgPayload).toContain('<text');
  });

  it('updates an existing Paper SFX decal recipe without moving or resizing it', () => {
    const original = buildPaperComicSfxDecalFrame({
      presetId: 'bang',
      idPrefix: 'sfx-editable',
      origin: { xMm: 10, yMm: 12 },
      zIndexStart: 3,
    }).frame;
    const updatedDesign = createPaperComicSfxDesign('boom', {
      text: 'wham',
      fillColor: '#f97316',
      strokeColor: '#111827',
    });

    const patch = buildPaperComicSfxDecalFrameUpdate(original, updatedDesign);

    expect(patch).toMatchObject({
      label: 'WHAM Comic SFX',
      text: 'WHAM',
      fit: 'stretch',
      comicSfxDesign: {
        presetId: 'boom',
        text: 'WHAM',
        fillColor: '#f97316',
        strokeColor: '#111827',
      },
    });
    expect(patch.xMm).toBeUndefined();
    expect(patch.yMm).toBeUndefined();
    expect(patch.widthMm).toBeUndefined();
    expect(patch.heightMm).toBeUndefined();
    expect(patch.asset?.locator).toBeUndefined();
    expect(paperComicSfxDesignToDataUrl(patch.comicSfxDesign!)).not.toBe(paperComicSfxDesignToDataUrl(original.comicSfxDesign!));
  });
});
