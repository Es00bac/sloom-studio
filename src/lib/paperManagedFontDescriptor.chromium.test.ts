import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ORACLE_SCRIPT = resolve(import.meta.dirname, '../../scripts/paperManagedFontDescriptor_chromium_oracle.py');

function hasChromiumOracle(): boolean {
  try {
    const executablePath = execSync(
      'python3.11 -c "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); print(p.chromium.executable_path); p.stop()"',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return executablePath.length > 0 && existsSync(executablePath);
  } catch {
    return false;
  }
}

interface OracleResult {
  descriptors: Array<{ value: string; accepted: boolean; error?: string }>;
  oldPercentageAccepted: boolean;
}

const describeOrSkip = hasChromiumOracle() ? describe : describe.skip;

describeOrSkip('Paper managed-font descriptor Chromium oracle', () => {
  it('accepts every exact stretch keyword and rejects the old percentage shorthand', () => {
    const stdout = execSync(`python3.11 "${ORACLE_SCRIPT}"`, {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? '{}') as OracleResult;
    expect(result.descriptors).toHaveLength(9);
    expect(result.descriptors.filter((entry) => !entry.accepted)).toEqual([]);
    expect(result.oldPercentageAccepted).toBe(false);
  }, 30_000);
});
