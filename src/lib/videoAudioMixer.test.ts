import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildVideoAudioMeterPolicy,
  buildVideoAudioMixerFfmpegGraph,
  buildVideoLoudnessNormalizationPlan,
  compileVideoAudioFfmpegPlan,
  compileVideoWebAudioRouting,
  createVideoAudioMixerRoutingModel,
  createDefaultVideoAudioMixer,
  normalizeVideoAudioMixer,
  parseVideoLoudnormAnalysisOutput,
  parseVideoEbur128Output,
  resolveVideoAudioMixerRoutes,
  validateVideoAudioMixer,
  type VideoAudioMixerModel,
} from './videoAudioMixer';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

describe('professional video audio mixer', () => {
  it('provides valid null/default routing', () => {
    expect(normalizeVideoAudioMixer(null, ['dialogue'])).toEqual(createDefaultVideoAudioMixer(['dialogue']));
    const webAudio = compileVideoWebAudioRouting(null, ['dialogue']);
    expect(webAudio).toMatchObject({ ok: true, metering: 'realtime-approximate' });
    const ffmpeg = compileVideoAudioFfmpegPlan(null, ['dialogue']);
    expect(ffmpeg.ok).toBe(true);
    if (!ffmpeg.ok) return;
    expect(ffmpeg.filterComplex).toContain('volume=0dB');
    expect(ffmpeg.filterComplex).toContain('pan=stereo');
  });

  it('compiles track pan, sends, buses, split, and mix from one model', () => {
    const model: VideoAudioMixerModel = {
      version: 1,
      sampleRate: 48_000,
      masterBusId: 'master',
      tracks: [
        { id: 'dialogue-1', inputIndex: 0, busId: 'dialogue', gainDb: -3, pan: -0.25, sends: [{ id: 'verb', targetBusId: 'fx', gainDb: -12 }] },
        { id: 'dialogue-2', inputIndex: 1, busId: 'dialogue', gainDb: 0, pan: 0.25 },
      ],
      buses: [
        { id: 'dialogue', name: 'Dialogue', parentBusId: 'master', gainDb: 1, pan: 0, sends: [{ id: 'parallel-fx', targetBusId: 'fx', gainDb: -18 }] },
        { id: 'fx', name: 'Effects return', parentBusId: 'master', gainDb: -2, pan: 0 },
        { id: 'master', name: 'Master', gainDb: 0, pan: 0 },
      ],
    };
    expect(validateVideoAudioMixer(model)).toEqual([]);
    const result = compileVideoAudioFfmpegPlan(model);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filterComplex).toContain('asplit=2');
    expect(result.filterComplex).toContain('amix=inputs=2');
    expect(result.filterComplex).toContain('parallel_fx');
    expect(result.outputLabel).toBe('bus_master');
  });

  it('rejects unknown routing and bus cycles', () => {
    const model = createDefaultVideoAudioMixer();
    model.buses.push({ id: 'a', name: 'A', parentBusId: 'b', gainDb: 0, pan: 0 });
    model.buses.push({ id: 'b', name: 'B', parentBusId: 'a', gainDb: 0, pan: 0 });
    model.tracks.push({ id: 'bad', inputIndex: 0, busId: 'missing', gainDb: 0, pan: 0 });
    const errors = validateVideoAudioMixer(model);
    expect(errors.some((error) => error.includes('unknown bus'))).toBe(true);
    expect(errors.some((error) => error.includes('cycle'))).toBe(true);
  });

  it('resolves the persisted main-output bus route once for Program and FFmpeg consumers', () => {
    const model = createVideoAudioMixerRoutingModel({
      buses: [
        { id: 'master', name: 'Master', kind: 'master', gainDb: -1, pan: 0.1 },
        { id: 'dialogue', name: 'Dialogue', kind: 'submix', outputBusId: 'master', gainDb: -3, pan: 0.2 },
      ],
      tracks: [{ id: 'clip-a', busId: 'dialogue', pan: -0.4 }],
    });
    const routes = resolveVideoAudioMixerRoutes(model);
    expect(routes).toMatchObject({ ok: true });
    if (!routes.ok) return;
    expect(routes.routes).toEqual([expect.objectContaining({
      id: 'clip-a',
      gainDb: -4,
      audible: true,
      busPath: ['dialogue', 'master'],
    })]);
    expect(routes.routes[0]?.pan).toBeCloseTo(-0.1);

    const graph = buildVideoAudioMixerFfmpegGraph({ model, inputs: [{ id: 'clip-a', label: 'a0' }] });
    expect(graph).toMatchObject({ ok: true, outputLabel: 'mixer_mix', activeTrackIds: ['clip-a'] });
    if (!graph.ok) return;
    expect(graph.filterParts.join(';')).toContain('volume=-4.000dB');
    expect(graph.filterParts.join(';')).toContain('aformat=channel_layouts=stereo');
    expect(graph.filterParts.join(';')).toContain('pan=stereo');
    expect(buildVideoAudioMixerFfmpegGraph({ model, inputs: [] })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no prepared input'),
    });
  });

  it.skipIf(!hasFfmpeg)('upmixes a real mono FFmpeg input before the mixer pan so both output channels retain signal', () => {
    const model = createVideoAudioMixerRoutingModel({
      buses: [{ id: 'master', name: 'Master', kind: 'master', gainDb: 0, pan: 0 }],
      tracks: [{ id: 'mono-dialogue', busId: 'master', pan: 0 }],
    });
    const graph = buildVideoAudioMixerFfmpegGraph({
      model,
      inputs: [{ id: 'mono-dialogue', label: 'a0' }],
    });
    expect(graph).toMatchObject({ ok: true, outputLabel: 'mixer_mix' });
    if (!graph.ok || !graph.outputLabel) return;

    const result = spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:sample_rate=48000:duration=0.05',
      '-filter_complex', graph.filterParts.join(';'),
      '-map', `[${graph.outputLabel}]`,
      '-f', 'f32le',
      'pipe:1',
    ], { encoding: 'buffer', maxBuffer: 1_048_576 });

    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout.byteLength).toBeGreaterThan(0);
    const samples = new DataView(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength);
    let leftEnergy = 0;
    let rightEnergy = 0;
    const frameCount = Math.floor(samples.byteLength / 8);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const left = samples.getFloat32(frame * 8, true);
      const right = samples.getFloat32(frame * 8 + 4, true);
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const leftRms = Math.sqrt(leftEnergy / frameCount);
    const rightRms = Math.sqrt(rightEnergy / frameCount);
    expect(leftRms).toBeGreaterThan(0.01);
    expect(rightRms).toBeGreaterThan(0.01);
    expect(rightRms).toBeCloseTo(leftRms, 4);
  });

  it('refuses cyclic, over-bound, and solo-muted saved main-output routes before publication', () => {
    const cyclic = createVideoAudioMixerRoutingModel({
      buses: [
        { id: 'master', name: 'Master', kind: 'master' },
        { id: 'a', name: 'A', outputBusId: 'b' },
        { id: 'b', name: 'B', outputBusId: 'a' },
      ],
      tracks: [{ id: 'clip-a', busId: 'a' }],
    });
    expect(resolveVideoAudioMixerRoutes(cyclic)).toMatchObject({ ok: false, reason: expect.stringContaining('cycle') });

    const overBound = createVideoAudioMixerRoutingModel({
      buses: [{ id: 'master', name: 'Master', kind: 'master' }],
      tracks: Array.from({ length: 65 }, (_, index) => ({ id: `clip-${index}` })),
    });
    expect(resolveVideoAudioMixerRoutes(overBound)).toMatchObject({ ok: false, reason: expect.stringContaining('64') });

    const solo = createVideoAudioMixerRoutingModel({
      buses: [
        { id: 'master', name: 'Master', kind: 'master' },
        { id: 'dialogue', name: 'Dialogue', outputBusId: 'master', solo: true },
        { id: 'music', name: 'Music', outputBusId: 'master' },
      ],
      tracks: [{ id: 'dialogue-clip', busId: 'dialogue' }, { id: 'music-clip', busId: 'music' }],
    });
    const routes = resolveVideoAudioMixerRoutes(solo);
    expect(routes).toMatchObject({ ok: true });
    if (!routes.ok) return;
    expect(routes.routes.map(({ id, audible }) => ({ id, audible }))).toEqual([
      { id: 'dialogue-clip', audible: true },
      { id: 'music-clip', audible: false },
    ]);
  });

  it('parses offline loudness and creates a two-pass authoritative plan', () => {
    const measured = parseVideoEbur128Output(`Summary:\n  I:         -24.3 LUFS\n  Threshold: -34.1 LUFS\n  LRA:         8.2 LU\n  True peak:  -1.4 dBFS`);
    expect(measured).toEqual({
      integratedLufs: -24.3,
      thresholdLufs: -34.1,
      loudnessRangeLu: 8.2,
      truePeakDbfs: -1.4,
      authority: 'offline-authoritative',
    });
    const twoPass = parseVideoLoudnormAnalysisOutput(`noise\n{\n  "input_i" : "-24.30",\n  "input_tp" : "-1.40",\n  "input_lra" : "8.20",\n  "input_thresh" : "-34.10",\n  "output_i" : "-23.00",\n  "target_offset" : "0.10"\n}\nmore noise`);
    expect(twoPass).toEqual({
      integratedLufs: -24.3,
      truePeakDbfs: -1.4,
      loudnessRangeLu: 8.2,
      thresholdLufs: -34.1,
      offsetGainDb: 0.1,
      authority: 'offline-authoritative',
    });
    const plan = buildVideoLoudnessNormalizationPlan({ integratedLufs: -23 }, twoPass);
    expect(plan.status).toBe('ready-for-authoritative-render');
    expect(plan.renderFilter).toContain('measured_I=-24.3');
    expect(plan.renderFilter).toContain('measured_thresh=-34.1');
    expect(plan.renderFilter).toContain('offset=0.1');
    expect(plan.note).toContain('complete offline loudnorm first pass');
    expect(buildVideoAudioMeterPolicy(48_000, 30)).toMatchObject({ mode: 'realtime-approximate', samplesPerWindow: 1_600 });
  });
});
