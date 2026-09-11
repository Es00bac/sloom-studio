import { describe, expect, it } from 'vitest';
import { packContainer } from '../shared/files/SignalLoomContainer';
import { classifyOpenedFile } from './signalLoomFileRouting';

const container = (format: string, kind: string) =>
  packContainer({ format, formatVersion: 1, kind, document: {}, assets: [] }, new Map());

describe('classifyOpenedFile', () => {
  it('routes a plain-JSON .sloom project to the project opener', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ id: 'p1', nodes: [] }));
    expect(classifyOpenedFile(bytes, 'My Project.sloom')).toBe('project');
  });

  it('routes a .slimg ZIP container to the image opener (the "PK is not valid JSON" bug)', () => {
    const bytes = container('signal-loom-image', 'image');
    // first bytes are the ZIP magic "PK" that the project opener used to choke on
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(classifyOpenedFile(bytes, 'portrait.slimg')).toBe('image');
  });

  it('routes a .slppr ZIP container to the paper opener', () => {
    expect(classifyOpenedFile(container('signal-loom-paper', 'paper'), 'zine.slppr')).toBe('paper');
  });

  it('reports an unrecognized ZIP container as unknown', () => {
    expect(classifyOpenedFile(container('something-else', 'other'), 'mystery.zip')).toBe('unknown');
  });

  it('falls back to the file extension when the container manifest cannot be read', () => {
    const corruptZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]); // PK header, junk body
    expect(classifyOpenedFile(corruptZip, 'broken.slimg')).toBe('image');
    expect(classifyOpenedFile(corruptZip, 'broken.slppr')).toBe('paper');
  });
});
