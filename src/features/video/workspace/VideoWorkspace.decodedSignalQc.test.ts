import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('VideoWorkspace decoded-signal QC completion', () => {
  const source = readFileSync(new URL('./VideoWorkspace.tsx', import.meta.url), 'utf8');

  it('merges a completed report with the current composition workflow snapshot, never the click-time render snapshot', () => {
    const completion = source.slice(source.indexOf("if (command.kind === 'run-decoded-signal')"), source.indexOf("if (command.kind === 'run-structural')"));
    expect(completion).toContain('const latestComposition = useFlowStore.getState().nodes.find');
    expect(completion).toContain('latestComposition.data.editorProfessionalWorkflowState');
    expect(completion).toContain('mergeVideoDecodedSignalQcReport(');
    expect(completion).not.toContain('...professionalWorkflowState,\n            decodedSignalQcReport: result.report');
  });
});
