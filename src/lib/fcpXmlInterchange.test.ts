// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  exportSequenceToFcpXml,
  importFcpXmlSequence,
  type FcpXmlSequence,
} from './fcpXmlInterchange';

const sampleSequence: FcpXmlSequence = {
  name: 'Root & Relay <cut #1>',
  timebase: 30,
  widthPx: 1920,
  heightPx: 1080,
  videoClips: [
    {
      name: 'A-cam "hero"',
      trackIndex: 0,
      startMs: 0,
      sourceInMs: 500,
      sourceOutMs: 3500,
      pathUrl: '/home/user/footage/a-cam hero.mp4',
      enabled: true,
    },
    {
      name: 'Title overlay',
      trackIndex: 1,
      startMs: 1000,
      sourceInMs: 0,
      sourceOutMs: 2000,
      pathUrl: undefined,
      enabled: false,
    },
  ],
  audioClips: [
    {
      name: 'VO',
      trackIndex: 0,
      startMs: 0,
      sourceInMs: 0,
      sourceOutMs: 4000,
      pathUrl: '/home/user/audio/vo.wav',
      enabled: true,
    },
  ],
};

describe('exportSequenceToFcpXml', () => {
  it('produces xmeml with frame-quantized timings and escaped names', () => {
    const { xml, warnings } = exportSequenceToFcpXml(sampleSequence);
    expect(xml).toContain('<xmeml version="4">');
    expect(xml).toContain('<name>Root &amp; Relay &lt;cut #1&gt;</name>');
    // 500ms @ 30fps = 15 frames; 3500ms = 105 frames
    expect(xml).toContain('<in>15</in>');
    expect(xml).toContain('<out>105</out>');
    expect(xml).toContain('<width>1920</width>');
    // path with a space is URL-encoded and file://localhost-prefixed
    expect(xml).toContain('file://localhost/home/user/footage/a-cam%20hero.mp4');
    // clip without a media path warns instead of failing
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Title overlay');
  });

  it('keeps disabled clips flagged and separates video tracks', () => {
    const { xml } = exportSequenceToFcpXml(sampleSequence);
    expect(xml).toContain('<enabled>FALSE</enabled>');
    expect(xml.match(/<track>/g)?.length).toBe(3); // 2 video + 1 audio
  });
});

describe('importFcpXmlSequence', () => {
  it('round-trips the exported sequence', () => {
    const { xml } = exportSequenceToFcpXml(sampleSequence);
    const { sequence, warnings } = importFcpXmlSequence(xml);
    expect(warnings).toHaveLength(0);
    expect(sequence.name).toBe('Root & Relay <cut #1>');
    expect(sequence.timebase).toBe(30);
    expect(sequence.widthPx).toBe(1920);
    expect(sequence.heightPx).toBe(1080);
    expect(sequence.videoClips).toHaveLength(2);
    expect(sequence.audioClips).toHaveLength(1);

    const hero = sequence.videoClips[0];
    expect(hero.name).toBe('A-cam "hero"');
    expect(hero.trackIndex).toBe(0);
    expect(hero.startMs).toBe(0);
    expect(hero.sourceInMs).toBe(500);
    expect(hero.sourceOutMs).toBe(3500);
    expect(hero.pathUrl).toContain('a-cam%20hero.mp4');
    expect(hero.enabled).toBe(true);

    const overlay = sequence.videoClips[1];
    expect(overlay.trackIndex).toBe(1);
    expect(overlay.startMs).toBe(1000);
    expect(overlay.enabled).toBe(false);
    expect(overlay.pathUrl).toBeUndefined();
  });

  it('rejects non-XML and XML without a sequence', () => {
    expect(() => importFcpXmlSequence('not xml at all <<<')).toThrow(/not valid XML/);
    expect(() => importFcpXmlSequence('<?xml version="1.0"?><xmeml version="4"></xmeml>'))
      .toThrow(/No <sequence>/);
  });

  it('skips clips with broken timing and reports a warning', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<xmeml version="4"><sequence id="s"><name>S</name>',
      '<rate><timebase>24</timebase></rate>',
      '<media><video><track>',
      '<clipitem id="bad"><name>Bad</name><start>oops</start><in>0</in><out>10</out></clipitem>',
      '<clipitem id="ok"><name>Ok</name><start>24</start><in>0</in><out>48</out></clipitem>',
      '</track></video><audio></audio></media>',
      '</sequence></xmeml>',
    ].join('');
    const { sequence, warnings } = importFcpXmlSequence(xml);
    expect(sequence.videoClips).toHaveLength(1);
    expect(sequence.videoClips[0].startMs).toBe(1000); // 24 frames @ 24fps
    expect(sequence.videoClips[0].sourceOutMs).toBe(2000);
    expect(warnings).toHaveLength(1);
  });
});
