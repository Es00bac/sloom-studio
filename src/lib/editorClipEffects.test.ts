import { describe, expect, it } from 'vitest';
import {
  buildClipEffectPresetPatch,
  buildCssClipFilter,
  buildFFmpegClipEffectFilters,
  buildCssClipBlendMode,
  mapClipBlendModeToFFmpeg,
  buildClipEffectDescriptor,
  getClipBlendModes,
  normalizeClipCrop,
  normalizeClipBlendMode,
} from './editorClipEffects';

describe('normalizeClipCrop', () => {
  it('clamps crop sides so the visible source area stays non-empty', () => {
    expect(normalizeClipCrop({
      cropLeftPercent: 60,
      cropRightPercent: 60,
      cropTopPercent: -5,
      cropBottomPercent: 20,
      cropPanXPercent: 150,
      cropPanYPercent: -150,
      cropRotationDeg: 720,
    })).toEqual({
      cropLeftPercent: 47,
      cropRightPercent: 48,
      cropTopPercent: 0,
      cropBottomPercent: 20,
      cropPanXPercent: 100,
      cropPanYPercent: -100,
      cropRotationDeg: 720,
    });
  });
});

describe('buildFFmpegClipEffectFilters', () => {
  it('serializes crop and enabled filters for a clip render chain', () => {
    const filters = buildFFmpegClipEffectFilters({
      cropLeftPercent: 10,
      cropRightPercent: 5,
      cropTopPercent: 0,
      cropBottomPercent: 20,
      cropPanXPercent: 0,
      cropPanYPercent: 0,
      cropRotationDeg: 0,
      filterStack: [
        { id: 'b', kind: 'brightness', amount: 12, enabled: true },
        { id: 'off', kind: 'blur', amount: 8, enabled: false },
        { id: 's', kind: 'saturation', amount: -20, enabled: true },
      ],
    });

    expect(filters).toContain("crop=w='iw*0.8500':h='ih*0.8000':x='iw*0.1000':y='ih*0.0000'");
    expect(filters).toContain('eq=brightness=0.1200');
    expect(filters).toContain('eq=saturation=0.8000');
    expect(filters).not.toContain('boxblur');
  });

  it('serializes chroma key, stroke, and expanded filters for final render parity', () => {
    const filters = buildFFmpegClipEffectFilters({
      cropLeftPercent: 0,
      cropRightPercent: 0,
      cropTopPercent: 0,
      cropBottomPercent: 0,
      cropPanXPercent: 0,
      cropPanYPercent: 0,
      cropRotationDeg: 0,
      filterStack: [
        { id: 'sepia', kind: 'sepia', amount: 80, enabled: true },
        { id: 'invert', kind: 'invert', amount: 50, enabled: true },
        { id: 'hue', kind: 'hue-rotate', amount: 45, enabled: true },
      ],
      chromaKey: {
        enabled: true,
        color: '#00ff00',
        similarityPercent: 24,
        blendPercent: 8,
      },
      stroke: {
        enabled: true,
        color: '#ff00cc',
        widthPx: 6,
        opacityPercent: 75,
      },
    });

    expect(filters).toEqual(expect.arrayContaining([
      expect.stringContaining("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(lte("),
    ]));
    expect(filters).toContain('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
    expect(filters).toContain('negate=negate_alpha=0');
    expect(filters).toContain("hue=h='45.0000'");
    expect(filters).toContain('drawbox=x=0:y=0:w=iw:h=ih:color=0xff00cc@0.7500:t=6');
  });
});

describe('buildCssClipFilter', () => {
  it('creates a CSS filter string from the same enabled filter stack', () => {
    expect(buildCssClipFilter([
      { id: 'b', kind: 'brightness', amount: 20, enabled: true },
      { id: 'g', kind: 'grayscale', amount: 100, enabled: true },
      { id: 'off', kind: 'blur', amount: 6, enabled: false },
    ])).toBe('brightness(1.2) grayscale(1)');
  });

  it('creates browser preview filters for expanded clip filters', () => {
    expect(buildCssClipFilter([
      { id: 'sepia', kind: 'sepia', amount: 70, enabled: true },
      { id: 'invert', kind: 'invert', amount: 25, enabled: true },
      { id: 'hue', kind: 'hue-rotate', amount: 90, enabled: true },
    ])).toBe('sepia(0.7) invert(0.25) hue-rotate(90deg)');
  });
});

describe('clip blend modes', () => {
  it('normalizes supported blend modes and falls back to normal', () => {
    expect(normalizeClipBlendMode('screen')).toBe('screen');
    expect(normalizeClipBlendMode('color-burn')).toBe('color-burn');
    expect(normalizeClipBlendMode('unknown')).toBe('normal');
  });

  it('maps clip blend modes to CSS and FFmpeg names', () => {
    expect(buildCssClipBlendMode('color-dodge')).toBe('color-dodge');
    expect(buildCssClipBlendMode('normal')).toBe('normal');
    expect(mapClipBlendModeToFFmpeg('color-dodge')).toBe('dodge');
    expect(mapClipBlendModeToFFmpeg('normal')).toBeUndefined();
  });

  it('normalizes all 16 Image-parity blend modes and maps CSS 1:1', () => {
    const modes = getClipBlendModes();
    expect(modes).toHaveLength(16);
    expect(modes).toEqual(expect.arrayContaining([
      'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
      'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
      'exclusion', 'hue', 'saturation', 'color', 'luminosity',
    ]));

    for (const mode of modes) {
      expect(normalizeClipBlendMode(mode)).toBe(mode);
      expect(buildCssClipBlendMode(mode)).toBe(mode);
    }
  });

  it('maps FFmpeg blend= names for the modes that differ from the CSS spelling', () => {
    expect(mapClipBlendModeToFFmpeg('color-burn')).toBe('burn');
    expect(mapClipBlendModeToFFmpeg('hard-light')).toBe('hardlight');
    expect(mapClipBlendModeToFFmpeg('soft-light')).toBe('softlight');
    expect(mapClipBlendModeToFFmpeg('difference')).toBe('difference');
    expect(mapClipBlendModeToFFmpeg('exclusion')).toBe('exclusion');
  });

  it('has no FFmpeg blend= equivalent for the non-separable HSL modes (falls back to normal)', () => {
    expect(mapClipBlendModeToFFmpeg('hue')).toBeUndefined();
    expect(mapClipBlendModeToFFmpeg('saturation')).toBeUndefined();
    expect(mapClipBlendModeToFFmpeg('color')).toBeUndefined();
    expect(mapClipBlendModeToFFmpeg('luminosity')).toBeUndefined();
  });
});

describe('professional effect presets', () => {
  it('builds conservative correction stacks and explicit keying presets', () => {
    expect(buildClipEffectPresetPatch('balanced')).toMatchObject({
      blendMode: 'normal',
      chromaKey: { enabled: false },
      filterStack: [
        expect.objectContaining({ kind: 'contrast', amount: 10 }),
        expect.objectContaining({ kind: 'saturation', amount: 8 }),
        expect.objectContaining({ kind: 'brightness', amount: 3 }),
      ],
    });
    expect(buildClipEffectPresetPatch('green-screen')).toMatchObject({
      filterStack: [],
      chromaKey: { enabled: true, color: '#00ff00', similarityPercent: 24, blendPercent: 8 },
    });
    expect(buildClipEffectPresetPatch('neutral')).toMatchObject({
      filterStack: [],
      blendMode: 'normal',
      chromaKey: { enabled: false },
    });
  });
});

describe('buildClipEffectDescriptor', () => {
  it('builds one normalized descriptor for preview CSS and render filters', () => {
    const descriptor = buildClipEffectDescriptor({
      cropLeftPercent: 10,
      cropRightPercent: 5,
      cropTopPercent: 2,
      cropBottomPercent: 3,
      cropPanXPercent: 25,
      cropPanYPercent: -25,
      cropRotationDeg: 15,
      blendMode: 'overlay',
      filterStack: [
        { id: 'contrast', kind: 'contrast', amount: 20, enabled: true },
      ],
    });

    expect(descriptor.crop.cropLeftPercent).toBe(10);
    expect(descriptor.cssFilter).toBe('contrast(1.2)');
    expect(descriptor.cssBlendMode).toBe('overlay');
    expect(descriptor.cssOutline).toBeUndefined();
    expect(descriptor.ffmpegBlendMode).toBe('overlay');
    expect(descriptor.ffmpegFilters).toEqual(expect.arrayContaining([
      expect.stringContaining('crop='),
      expect.stringContaining('rotate='),
      'eq=contrast=1.2000',
    ]));
  });

  it('builds one descriptor for chroma key and clip stroke controls', () => {
    const descriptor = buildClipEffectDescriptor({
      cropLeftPercent: 0,
      cropRightPercent: 0,
      cropTopPercent: 0,
      cropBottomPercent: 0,
      cropPanXPercent: 0,
      cropPanYPercent: 0,
      cropRotationDeg: 0,
      blendMode: 'normal',
      filterStack: [],
      chromaKey: {
        enabled: true,
        color: '#00ff00',
        similarityPercent: 18,
        blendPercent: 6,
      },
      stroke: {
        enabled: true,
        color: '#22d3ee',
        widthPx: 4,
        opacityPercent: 60,
      },
    });

    expect(descriptor.chromaKey).toEqual({
      enabled: true,
      color: '#00ff00',
      similarityPercent: 18,
      blendPercent: 6,
    });
    expect(descriptor.cssOutline).toEqual({
      color: '#22d3ee',
      widthPx: 4,
      opacityPercent: 60,
    });
    expect(descriptor.ffmpegFilters).toEqual(expect.arrayContaining([
      expect.stringContaining("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(lte("),
      'drawbox=x=0:y=0:w=iw:h=ih:color=0x22d3ee@0.6000:t=4',
    ]));
  });

  it('projects one persisted mask into both preview and native execution, refusing unsafe stacks', () => {
    const mask = {
      id: 'subject-mask',
      kind: 'ellipse' as const,
      points: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.9 }],
      featherPercent: 10,
      opacityPercent: 80,
      inverted: false,
    };
    const ready = buildClipEffectDescriptor({
      cropLeftPercent: 0, cropRightPercent: 0, cropTopPercent: 0, cropBottomPercent: 0,
      cropPanXPercent: 0, cropPanYPercent: 0, cropRotationDeg: 0,
      filterStack: [], masks: [mask],
    });
    expect(ready.maskExecution.status).toBe('ready');
    if (ready.maskExecution.status === 'ready') {
      expect(ready.maskExecution.model.shapes[0]).toMatchObject({ kind: 'ellipse', opacity: 0.8 });
    }

    const refused = buildClipEffectDescriptor({
      cropLeftPercent: 0, cropRightPercent: 0, cropTopPercent: 0, cropBottomPercent: 0,
      cropPanXPercent: 0, cropPanYPercent: 0, cropRotationDeg: 0,
      filterStack: [], masks: [mask, { ...mask, id: 'second-mask' }],
    });
    expect(refused.maskExecution.status).toBe('unsupported');
  });

  it('resolves a persisted tracked mask for the requested clip time in both delivery descriptors', () => {
    const tracked = {
      id: 'tracked-mask', kind: 'rectangle' as const,
      points: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }], featherPercent: 0, opacityPercent: 100, inverted: false,
      tracking: { status: 'ready' as const, keyframes: [
        { timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 },
        { timeMs: 1_000, offsetX: 0.1, offsetY: 0, scale: 1 },
      ] },
    };
    const descriptor = buildClipEffectDescriptor({
      cropLeftPercent: 0, cropRightPercent: 0, cropTopPercent: 0, cropBottomPercent: 0,
      cropPanXPercent: 0, cropPanYPercent: 0, cropRotationDeg: 0,
      filterStack: [], masks: [tracked],
    }, 500);

    expect(descriptor.maskExecution.status).toBe('ready');
    if (descriptor.maskExecution.status === 'ready') {
      const shape = descriptor.maskExecution.model.shapes[0];
      expect(shape?.kind).toBe('rect');
      if (shape?.kind === 'rect') {
        expect(shape.x).toBeCloseTo(0.25, 8);
        expect(shape.y).toBeCloseTo(0.2, 8);
        expect(shape).toMatchObject({ width: 0.3, height: 0.3 });
      }
    }
    expect(descriptor.ffmpegFilters.some((filter) => filter.includes('between(X'))).toBe(true);
  });

  it('refuses tracked geometry that leaves bounds later without throwing from descriptor construction', () => {
    const tracked = {
      id: 'late-out-of-bounds', kind: 'rectangle' as const,
      points: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }], featherPercent: 0, opacityPercent: 100, inverted: false,
      tracking: { status: 'ready' as const, keyframes: [
        { timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 },
        { timeMs: 1_000, offsetX: 1, offsetY: 0, scale: 1 },
      ] },
    };

    expect(() => buildClipEffectDescriptor({
      cropLeftPercent: 0, cropRightPercent: 0, cropTopPercent: 0, cropBottomPercent: 0,
      cropPanXPercent: 0, cropPanYPercent: 0, cropRotationDeg: 0,
      filterStack: [], masks: [tracked],
    }, 0)).not.toThrow();
    expect(buildClipEffectDescriptor({
      cropLeftPercent: 0, cropRightPercent: 0, cropTopPercent: 0, cropBottomPercent: 0,
      cropPanXPercent: 0, cropPanYPercent: 0, cropRotationDeg: 0,
      filterStack: [], masks: [tracked],
    }, 0).maskExecution).toMatchObject({ status: 'unsupported' });
  });

  it('refuses masks on text clips so preview and export cannot diverge', () => {
    const descriptor = buildClipEffectDescriptor({
      sourceKind: 'text',
      cropLeftPercent: 0, cropRightPercent: 0, cropTopPercent: 0, cropBottomPercent: 0,
      cropPanXPercent: 0, cropPanYPercent: 0, cropRotationDeg: 0,
      filterStack: [],
      masks: [{
        id: 'text-mask',
        kind: 'ellipse',
        points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }],
        featherPercent: 0,
        opacityPercent: 100,
        inverted: false,
      }],
    });
    expect(descriptor.maskExecution).toEqual({
      status: 'unsupported',
      reason: 'Masks are not executable on text clips; remove the mask or use an image/video clip.',
    });
  });

  it('refuses persisted stabilization before preview or export can silently ignore it', () => {
    const descriptor = buildClipEffectDescriptor({
      cropLeftPercent: 0,
      cropRightPercent: 0,
      cropTopPercent: 0,
      cropBottomPercent: 0,
      cropPanXPercent: 0,
      cropPanYPercent: 0,
      cropRotationDeg: 0,
      filterStack: [],
      stabilization: { enabled: true, strengthPercent: 50, cropMode: 'auto-scale' },
    });

    expect(descriptor.maskExecution).toEqual({
      status: 'unsupported',
      reason: 'Stabilization is saved setup only; this renderer has no bounded stabilization analysis artifact.',
    });
  });

  it('consumes a bounded stabilization artifact in browser and native descriptors', () => {
    const descriptor = buildClipEffectDescriptor({
      cropLeftPercent: 0, cropRightPercent: 0, cropTopPercent: 0, cropBottomPercent: 0,
      cropPanXPercent: 0, cropPanYPercent: 0, cropRotationDeg: 0, filterStack: [],
      stabilization: {
        enabled: true, strengthPercent: 50, cropMode: 'auto-scale',
        analysis: { version: 1, status: 'ready', samples: [
          { timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 },
          { timeMs: 1_000, offsetX: 0.1, offsetY: -0.1, scale: 1.2 },
        ] },
      },
    }, 500);

    expect(descriptor.stabilizationExecution).toMatchObject({ status: 'ready', offsetX: 0.05, offsetY: -0.05, scale: 1.1, cropMode: 'auto-scale' });
    expect(descriptor.ffmpegFilters.some((filter) => filter.startsWith("scale=w='iw*("))).toBe(true);
    expect(descriptor.maskExecution).toEqual({ status: 'none' });
  });
});
