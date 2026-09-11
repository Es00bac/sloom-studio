import { describe, expect, it } from 'vitest';
import { PAPER_TOOL_DEFINITIONS } from './paperToolRegistry';

describe('paperToolRegistry', () => {
  it('registers a hand tool separately from document editing tools', () => {
    const ids = PAPER_TOOL_DEFINITIONS.map((definition) => definition.tool);
    expect(ids).toContain('hand');
    expect(new Set(ids).size).toBe(ids.length);
    expect(PAPER_TOOL_DEFINITIONS.find((definition) => definition.tool === 'hand')).toMatchObject({
      label: 'Hand',
      shortcut: 'H',
      frameKind: null,
    });
  });

  it('registers an eyedropper tool for sampling Paper colors', () => {
    expect(PAPER_TOOL_DEFINITIONS.filter((definition) => definition.tool === 'eyedropper')).toHaveLength(1);
    expect(PAPER_TOOL_DEFINITIONS.find((definition) => definition.tool === 'eyedropper')).toMatchObject({
      label: 'Eyedropper',
      shortcut: 'I',
      frameKind: null,
      add: false,
    });
  });
});
