// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  exportCmx3600Edl,
  exportOtioJson,
  exportSloomAafHandoff,
  getAafInterchangeAvailability,
  importAaf,
  importCmx3600Edl,
  importOtioJson,
  importProfessionalFcp7Xml,
  importSloomAafHandoff,
  type ProfessionalInterchangeSequence,
} from './videoProfessionalInterchange';

const goldenSequence: ProfessionalInterchangeSequence = {
  name: 'Feature Reel',
  frameRate: 24,
  widthPx: 1920,
  heightPx: 1080,
  tracks: [
    {
      id: 'v-main', name: 'V1', kind: 'video', index: 0,
      items: [
        { type: 'clip', id: 'c1', name: 'A001 Hero', startMs: 0, durationMs: 2_000, sourceInMs: 1_000, mediaReference: 'file:///media/A001.mov', enabled: true, speed: 1 },
        { type: 'gap', id: 'g1', startMs: 2_000, durationMs: 500 },
        { type: 'clip', id: 'c2', name: 'B002 Fast', startMs: 2_500, durationMs: 1_000, sourceInMs: 0, enabled: false, speed: 2 },
      ],
    },
    {
      id: 'a-main', name: 'A1', kind: 'audio', index: 0,
      items: [
        { type: 'clip', id: 'a1', name: 'Production Sound', startMs: 0, durationMs: 3_500, sourceInMs: 250, mediaReference: 'file:///media/A001.wav', enabled: true, speed: 1 },
      ],
    },
  ],
};

describe('FCP7 XML normalized import', () => {
  it('calls the existing parser and reports every supported clip mapping', () => {
    const xml = [
      '<?xml version="1.0"?><xmeml version="4"><sequence><name>XML Cut</name>',
      '<rate><timebase>24</timebase></rate><media><video>',
      '<format><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></format>',
      '<track><clipitem><name>Hero</name><start>24</start><in>12</in><out>60</out><enabled>TRUE</enabled>',
      '<file><pathurl>file:///hero.mov</pathurl></file></clipitem></track></video><audio></audio></media>',
      '</sequence></xmeml>',
    ].join('');
    const result = importProfessionalFcp7Xml(xml);
    expect(result.sequence).toMatchObject({ name: 'XML Cut', frameRate: 24, widthPx: 1920, heightPx: 1080 });
    expect(result.sequence.tracks[0].items[0]).toMatchObject({ startMs: 1_000, sourceInMs: 500, durationMs: 2_000 });
    expect(result.report.mapped).toHaveLength(1);
    expect(result.report.dropped).toHaveLength(0);
  });

  it('rejects malformed XML through the existing parser', () => {
    expect(() => importProfessionalFcp7Xml('<xmeml><broken>')).toThrow(/not valid XML/);
    const nested = `${'<x>'.repeat(65)}${'</x>'.repeat(65)}`;
    expect(() => importProfessionalFcp7Xml(nested)).toThrow(/nesting depth/);
  });
});

describe('truthful CMX 3600 supported subset', () => {
  it('round-trips cut timing, clip names, media references, and channels', () => {
    const exported = exportCmx3600Edl(goldenSequence);
    expect(exported.data).toContain('FCM: NON-DROP FRAME');
    expect(exported.data).toContain('* FROM CLIP NAME: A001 Hero');
    const imported = importCmx3600Edl(exported.data, { frameRate: 24 });
    const videoClips = imported.sequence.tracks.find((track) => track.kind === 'video')?.items;
    const audioClips = imported.sequence.tracks.find((track) => track.kind === 'audio')?.items;
    expect(videoClips).toHaveLength(2);
    expect(videoClips?.[0]).toMatchObject({ type: 'clip', name: 'A001 Hero', startMs: 0, durationMs: 2_000, sourceInMs: 1_000 });
    expect(audioClips?.[0]).toMatchObject({ name: 'Production Sound', durationMs: 3_500, sourceInMs: 250 });
    expect(imported.report.mapped).toHaveLength(3);
    expect(imported.report.approximated).toHaveLength(3);
  });

  it('drops unsupported transitions with a report and rejects drop-frame lists', () => {
    const dissolve = 'TITLE: X\nFCM: NON-DROP FRAME\n001  AX V D 00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00';
    const imported = importCmx3600Edl(dissolve, { frameRate: 24 });
    expect(imported.report.dropped[0].message).toMatch(/cuts-only/);
    expect(imported.report.mapped).toHaveLength(0);
    expect(() => importCmx3600Edl('TITLE: X\nFCM: DROP FRAME', { frameRate: 30 })).toThrow(/Drop-frame/);
  });

  it('rejects malformed timecode and unsupported export rates actionably', () => {
    const bad = 'TITLE: X\n001 AX V C 00:99:00:00 00:00:01:00 00:00:00:00 00:00:01:00';
    expect(importCmx3600Edl(bad, { frameRate: 24 }).report.dropped[0].message).toMatch(/Out-of-range/);
    expect(() => exportCmx3600Edl({ ...goldenSequence, frameRate: 23.976 })).toThrow(/24, 25, or 30fps/);
  });
});

describe('bounded OTIO JSON subset', () => {
  it('golden-round-trips tracks, clips, gaps, references, placement, and linear time warps', () => {
    const exported = exportOtioJson(goldenSequence);
    const imported = importOtioJson(exported.data);
    expect(imported.sequence.name).toBe('Feature Reel');
    expect(imported.sequence.frameRate).toBe(24);
    expect(imported.sequence.tracks.map((track) => track.id)).toEqual(['v-main', 'a-main']);
    const items = imported.sequence.tracks[0].items;
    expect(items[0]).toMatchObject({ type: 'clip', id: 'c1', startMs: 0, durationMs: 2_000, sourceInMs: 1_000, speed: 1 });
    expect(items[1]).toEqual({ type: 'gap', id: 'g1', startMs: 2_000, durationMs: 500 });
    expect(items[2]).toMatchObject({ type: 'clip', id: 'c2', startMs: 2_500, durationMs: 1_000, speed: 2, enabled: false });
    expect(imported.report.mapped).toHaveLength(4);
  });

  it('reports unsupported items/effects rather than silently claiming fidelity', () => {
    const payload = JSON.parse(exportOtioJson(goldenSequence).data) as Record<string, any>;
    payload.tracks.children[0].children.push({ OTIO_SCHEMA: 'Transition.1', name: 'Dissolve' });
    payload.tracks.children[0].children[0].effects.push({ OTIO_SCHEMA: 'Effect.1', name: 'Blur' });
    const result = importOtioJson(JSON.stringify(payload));
    expect(result.report.dropped.map((entry) => entry.message).join(' ')).toMatch(/Only LinearTimeWarp|Only Clip.2 and Gap.1/);
  });

  it('rejects malformed shapes, excessive depth, and empty input', () => {
    expect(() => importOtioJson('{nope')).toThrow(/not valid JSON/);
    expect(() => importOtioJson('{}')).toThrow(/Timeline.1/);
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let index = 0; index < 40; index += 1) {
      deep.child = {};
      deep = deep.child as Record<string, unknown>;
    }
    expect(() => importOtioJson(JSON.stringify(root))).toThrow(/nesting depth/);
    expect(() => importOtioJson('')).toThrow(/empty/);
  });
});

describe('AAF availability', () => {
  it('round-trips the explicit Sloom handoff wrapper without pretending it is an AAF binary', () => {
    const exported = exportSloomAafHandoff(goldenSequence);
    const restored = importSloomAafHandoff(exported.data);

    expect(exported.fileExtension).toBe('.sloom-aaf.json');
    expect(exported.mediaType).toBe('application/vnd.sloom.aaf-handoff+json');
    expect(exported.warnings.join(' ')).toMatch(/not an AAF binary/i);
    expect(restored.report.format).toBe('sloom-aaf-handoff');
    expect(restored.sequence.tracks[0].items[0]).toMatchObject({ id: 'c1', startMs: 0, sourceInMs: 1_000 });
    expect(restored.report.approximated[0].message).toMatch(/not an AAF binary/i);
  });

  it('rejects malformed or impostor handoff JSON before a caller can replace timeline state', () => {
    expect(() => importSloomAafHandoff('{oops')).toThrow(/not valid JSON/);
    expect(() => importSloomAafHandoff(JSON.stringify({ schema: 'aaf', kind: 'sloom-aaf-handoff', timeline: {} }))).toThrow(/exact supported wrapper schema/);
    expect(() => importSloomAafHandoff(JSON.stringify({ schema: 'sloom-aaf-handoff/v1', kind: 'sloom-aaf-handoff', timeline: {} }))).toThrow(/Timeline\.1/);
  });

  it('is explicitly unavailable and never pretends to parse bytes', () => {
    expect(getAafInterchangeAvailability()).toMatchObject({ available: false });
    expect(() => importAaf()).toThrow(/not implemented/);
  });
});
