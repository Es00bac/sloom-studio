import { describe, expect, it } from 'vitest';
import { probeVideoProfessionalCapabilities } from './videoProfessionalCapabilities';
import {
  bakeVideoTrackingToMaskKeyframes,
  buildVideoMaskCssClipPath,
  buildVideoMaskExecutionPlan,
  buildVideoMaskFfmpegAlphaFilterForMasks,
  buildVideoMaskFfmpegAlphaFilter,
  buildVideoMaskRenderDescriptor,
  buildVideoRotoDescriptor,
  buildVideoStabilizationAnalysisSpec,
  buildVideoStabilizationAnalysisArtifact,
  buildVideoStabilizationRenderSpec,
  rasterizeVideoMaskAlpha,
  resolveVideoMaskTrackingSample,
  resolveVideoStabilizationSample,
  sampleVideoMaskAlpha,
  validateVideoMask,
  type VideoMaskModel,
} from './videoVfxPipeline';

const mask: VideoMaskModel = {
  version: 1,
  id: 'subject',
  name: 'Subject',
  inverted: false,
  shapes: [
    { id: 'body', kind: 'ellipse', operation: 'add', centerX: 0.5, centerY: 0.5, radiusX: 0.4, radiusY: 0.3, opacity: 1, feather: 0 },
    { id: 'cutout', kind: 'rect', operation: 'subtract', x: 0.45, y: 0.45, width: 0.1, height: 0.1, cornerRadius: 0, opacity: 1, feather: 0 },
  ],
};

describe('professional video VFX pipeline', () => {
  it('executes one persisted rectangle or ellipse mask and refuses unsafe expansion', () => {
    const ready = buildVideoMaskExecutionPlan([{
      id: 'subject-mask',
      kind: 'ellipse',
      points: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.9 }],
      featherPercent: 10,
      opacityPercent: 80,
      inverted: false,
    }]);

    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('expected executable mask');
    expect(buildVideoMaskCssClipPath(ready)).toContain('ellipse(30.000% 40.000% at 50.000% 50.000%)');
    expect(buildVideoMaskFfmpegAlphaFilter(ready)).toContain("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(");
    expect(buildVideoMaskFfmpegAlphaFilter(ready)).toContain('*0.800000');
    expect(buildVideoMaskExecutionPlan([
      { id: 'one', kind: 'ellipse', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], featherPercent: 0, opacityPercent: 100, inverted: false },
      { id: 'two', kind: 'ellipse', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], featherPercent: 0, opacityPercent: 100, inverted: false },
    ])).toMatchObject({ status: 'unsupported' });
    expect(buildVideoMaskExecutionPlan([{
      id: 'tracked', kind: 'ellipse', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], featherPercent: 0, opacityPercent: 100, inverted: false,
      tracking: { status: 'ready', keyframes: [{ timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 }] },
    }])).toMatchObject({ status: 'ready' });
    expect(buildVideoMaskExecutionPlan([{
      id: 'outside', kind: 'ellipse', points: [{ x: -0.1, y: 0.2 }, { x: 0.8, y: 0.9 }], featherPercent: 0, opacityPercent: 100, inverted: false,
    }])).toMatchObject({ status: 'unsupported' });
  });

  it('resolves persisted tracker keyframes at clip time with one deterministic interpolation contract', () => {
    const tracked = {
      id: 'tracked', kind: 'ellipse' as const,
      points: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }], featherPercent: 0, opacityPercent: 100, inverted: false,
      tracking: {
        status: 'ready' as const,
        keyframes: [
          { timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 },
          { timeMs: 1_000, offsetX: 0.1, offsetY: -0.05, scale: 1.2 },
        ],
      },
    };

    expect(resolveVideoMaskTrackingSample(tracked, 500)).toEqual({ timeMs: 500, offsetX: 0.05, offsetY: -0.025, scale: 1.1 });
    const browserPlan = buildVideoMaskExecutionPlan([tracked], 500);
    expect(browserPlan.status).toBe('ready');
    if (browserPlan.status === 'ready') {
      expect(browserPlan.model.shapes[0]).toMatchObject({ centerX: 0.45, centerY: 0.375, radiusX: 0.22, radiusY: 0.22 });
    }
    expect(buildVideoMaskFfmpegAlphaFilterForMasks([tracked])).toContain('t');
  });

  it('fails closed when a tracked sample would leave normalized source bounds', () => {
    expect(buildVideoMaskExecutionPlan([{
      id: 'edge', kind: 'rectangle', points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }], featherPercent: 0, opacityPercent: 100, inverted: false,
      tracking: { status: 'ready', keyframes: [{ timeMs: 0, offsetX: -0.2, offsetY: 0, scale: 1 }] },
    }], 0)).toMatchObject({ status: 'unsupported' });
  });

  it('validates and deterministically samples shared alpha masks', () => {
    expect(validateVideoMask(mask)).toEqual([]);
    expect(sampleVideoMaskAlpha(mask, 0.2, 0.5)).toBe(1);
    expect(sampleVideoMaskAlpha(mask, 0.5, 0.5)).toBe(0);
    expect(sampleVideoMaskAlpha(mask, 0, 0)).toBe(0);
    expect(rasterizeVideoMaskAlpha(mask, 8, 8)).toEqual(rasterizeVideoMaskAlpha(mask, 8, 8));
    expect(buildVideoMaskRenderDescriptor(mask)).toMatchObject({ kind: 'shared-alpha-mask', coordinateSpace: 'normalized-source' });
  });

  it('supports closed Bezier geometry and reports malformed paths', () => {
    const bezier: VideoMaskModel = {
      version: 1,
      id: 'triangle',
      name: 'Triangle',
      inverted: false,
      shapes: [{
        id: 'path',
        kind: 'bezier',
        operation: 'add',
        closed: true,
        opacity: 1,
        feather: 0,
        points: [{ x: 0.5, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
      }],
    };
    expect(validateVideoMask(bezier)).toEqual([]);
    expect(sampleVideoMaskAlpha(bezier, 0.5, 0.5)).toBe(1);
    bezier.shapes[0] = { ...bezier.shapes[0], points: [{ x: -1, y: 0 }] } as typeof bezier.shapes[number];
    expect(validateVideoMask(bezier).join(' ')).toMatch(/at least three|normalized/u);
  });

  it('bakes ordered, clamped tracker samples and truthfully models roto', () => {
    const tracking = {
      tracker: 'planar' as const,
      sourceWidth: 1920,
      sourceHeight: 1080,
      samples: [
        { timeSeconds: 1, translateX: 0.1, translateY: 0, scale: 1.1, rotationDegrees: 2, confidence: 2 },
        { timeSeconds: 0, translateX: 0, translateY: 0, scale: 1, rotationDegrees: 0, confidence: 0.9 },
      ],
    };
    const keyframes = bakeVideoTrackingToMaskKeyframes(tracking);
    expect(keyframes.map(({ timeSeconds }) => timeSeconds)).toEqual([0, 1]);
    expect(keyframes[1]?.confidence).toBe(1);
    const roto = buildVideoRotoDescriptor(mask, tracking);
    expect(roto).toMatchObject({ kind: 'tracked-manual-mask', automation: 'manual-or-tracker-assisted' });
    expect(roto.note).toContain('no ML');
  });

  it('capability-gates both stabilization phases', () => {
    const settings = { shakiness: 5, accuracy: 12, smoothingFrames: 30, zoomPercent: 2.5, tripod: false };
    const unavailable = buildVideoStabilizationAnalysisSpec(settings, '/tmp/clip.trf', probeVideoProfessionalCapabilities({}));
    expect(unavailable).toMatchObject({ ok: false, missingCapabilities: [{ id: 'vidstab-detect' }] });
    const probe = probeVideoProfessionalCapabilities({ ffmpegFiltersText: '... vidstabdetect V->V\n... vidstabtransform V->V' });
    const analysis = buildVideoStabilizationAnalysisSpec(settings, '/tmp/clip.trf', probe);
    const render = buildVideoStabilizationRenderSpec(settings, '/tmp/clip.trf', probe);
    expect(analysis.ok).toBe(true);
    expect(render.ok).toBe(true);
    if (!analysis.ok || !render.ok) return;
    expect(analysis.filter).toContain('vidstabdetect');
    expect(render.filter).toContain('vidstabtransform');
    expect(render.filter).toContain('smoothing=30');
  });

  it('normalizes and interpolates a bounded stabilization analysis artifact', () => {
    const artifact = buildVideoStabilizationAnalysisArtifact([
      { timeMs: 1_000, offsetX: 0.1, offsetY: -0.1, scale: 1.2 },
      { timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 },
    ], 'source-v1');
    expect(artifact).toMatchObject({ version: 1, status: 'ready', sourceFingerprint: 'source-v1' });
    expect(artifact.samples.map((sample) => sample.timeMs)).toEqual([0, 1_000]);
    expect(resolveVideoStabilizationSample(artifact, 500)).toEqual({ timeMs: 500, offsetX: 0.05, offsetY: -0.05, scale: 1.1 });
  });
});
