import { describe, expect, it } from 'vitest';
import { probeVideoProfessionalCapabilities } from './videoProfessionalCapabilities';
import {
  compileVideoFfmpegFilterGraph,
  compileVideoPreviewDescriptor,
  hashVideoRenderGraph,
  type VideoRenderGraph,
} from './videoRenderGraph';

const fullProbe = probeVideoProfessionalCapabilities({
  ffmpegFiltersText: '... lut3d V->V\n... zscale V->V\n... minterpolate V->V',
});

const graph: VideoRenderGraph = {
  version: 1,
  nodes: [
    { id: 'source', kind: 'source', sourceId: 'clip-a', streamIndex: 0, mediaKind: 'video' },
    { id: 'grade', kind: 'color', input: 'source', correction: 'eq=contrast=1.1', lutPath: '/looks/film.cube' },
    { id: 'speed', kind: 'retime', input: 'grade', rate: 0.5, interpolation: 'optical-flow' },
  ],
  outputNodeIds: ['speed'],
};

describe('video render graph', () => {
  it('creates deterministic structural hashes and invalidates on meaningful changes', () => {
    expect(hashVideoRenderGraph(graph)).toBe(hashVideoRenderGraph(structuredClone(graph)));
    const changed = structuredClone(graph);
    const speed = changed.nodes.find((node) => node.id === 'speed');
    if (speed?.kind === 'retime') speed.rate = 0.75;
    expect(hashVideoRenderGraph(changed)).not.toBe(hashVideoRenderGraph(graph));
  });

  it('orders preview and FFmpeg operations from source to output', () => {
    const preview = compileVideoPreviewDescriptor(graph, fullProbe);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.operations.map(({ nodeId }) => nodeId)).toEqual(['source', 'grade', 'speed']);

    const ffmpeg = compileVideoFfmpegFilterGraph(graph, fullProbe);
    expect(ffmpeg.ok).toBe(true);
    if (!ffmpeg.ok) return;
    expect(ffmpeg.filterComplex).toContain("lut3d=file='/looks/film.cube'");
    expect(ffmpeg.filterComplex).toContain('minterpolate');
    expect(ffmpeg.outputLabels).toEqual(['n_speed']);
  });

  it('returns explicit missing-capability and graph-validation failures', () => {
    const noOptionalFilters = probeVideoProfessionalCapabilities({});
    const unavailable = compileVideoPreviewDescriptor(graph, noOptionalFilters);
    expect(unavailable).toMatchObject({
      ok: false,
      missingCapabilities: [{ id: 'lut3d' }, { id: 'minterpolate' }],
    });

    const broken: VideoRenderGraph = {
      version: 1,
      nodes: [{ id: 'x', kind: 'transform', input: 'missing', x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDegrees: 0, opacity: 1 }],
      outputNodeIds: ['x'],
    };
    const invalid = compileVideoFfmpegFilterGraph(broken, fullProbe);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.reason).toContain("missing input 'missing'");
  });
});
