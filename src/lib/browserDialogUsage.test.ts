import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = new URL('../', import.meta.url).pathname;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

function collectSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return collectSourceFiles(path);
    }
    if (!SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.')))) {
      return [];
    }
    if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) {
      return [];
    }
    return [path];
  });
}

describe('browser dialog usage', () => {
  it('does not use blocking browser alerts in production source', () => {
    const offenders = collectSourceFiles(SOURCE_ROOT).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes('window.alert(') ? [relative(SOURCE_ROOT, file)] : [];
    });

    expect(offenders).toEqual([]);
  });
});
