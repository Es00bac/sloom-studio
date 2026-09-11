import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('flexible-output node editors', () => {
  it.each([
    'JavaScriptNode.tsx',
    'PythonNode.tsx',
    'JsonQueryNode.tsx',
    'ApiFetchNode.tsx',
  ])('%s requires an explicit output declaration', (fileName) => {
    const source = readFileSync(new URL(fileName, import.meta.url), 'utf8');

    expect(source).toContain('DeclaredOutputTypeSelect');
    expect(source).toContain("patchNodeData(id, { declaredOutputType: value })");
  });
});
