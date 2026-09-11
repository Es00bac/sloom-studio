import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('VideoWorkspace narration usage boundary', () => {
  it('records the resolved provider execution before narration result materialization', () => {
    const source = readFileSync(new URL('./VideoWorkspace.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('const generateNarrationForSelectedTextClip = async () =>');
    const end = source.indexOf('const splitVisualClipAtSeconds', start);
    const caller = source.slice(start, end);

    const executeAndRecord = caller.indexOf('executeAndRecordProjectUsage');
    const validateResult = caller.indexOf("execution.result.startsWith('data:')");
    const persistAsset = caller.indexOf('addAssetItem');
    expect(executeAndRecord).toBeGreaterThan(-1);
    expect(validateResult).toBeGreaterThan(executeAndRecord);
    expect(persistAsset).toBeGreaterThan(validateResult);
    expect(caller).toContain("workspace: 'editor'");
    expect(caller).toContain('recordUsage: useProjectUsageStore.getState().recordUsage');
  });
});
