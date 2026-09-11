import type { SourceBinLibraryItem } from '../store/sourceBinStore';

export interface SloomScriptLine {
  speaker?: string;
  text: string;
  id?: string;
}

export interface SloomScript {
  title?: string;
  lines?: SloomScriptLine[];
}

export function parseSloomScriptToItems(scriptJson: string, sourceFileName: string): SourceBinLibraryItem[] {
  let script: SloomScript | SloomScriptLine[] | string[];
  try {
    script = JSON.parse(scriptJson);
  } catch {
    throw new Error('Failed to parse .sloom-script file as JSON');
  }

  const envelopeId = globalThis.crypto?.randomUUID?.() ?? `script-${Date.now()}`;
  const envelopeLabel = (!Array.isArray(script) && typeof script !== 'string' && script.title) ? script.title : sourceFileName;

  const lines: Array<SloomScriptLine | string> = Array.isArray(script)
    ? script
    : typeof script === 'string'
      ? [script]
      : (script.lines || []);

  return lines.map((line, index) => {
    const text = typeof line === 'string' ? line : line.text || '';
    const speaker = typeof line === 'string' ? 'Dialogue' : line.speaker || 'Dialogue';
    const label = `${speaker}: ${text.substring(0, 20)}${text.length > 20 ? '...' : ''}`;

    return {
      id: (typeof line === 'string' ? undefined : line.id) || (globalThis.crypto?.randomUUID?.() ?? `script-line-${Date.now()}-${index}`),
      label,
      kind: 'text',
      text: text,
      createdAt: Date.now(),
      envelopeId,
      envelopeLabel,
      envelopeIndex: index,
      envelopeCollapsed: false,
    };
  });
}
