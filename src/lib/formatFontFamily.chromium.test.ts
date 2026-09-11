import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ORACLE_SCRIPT = resolve(import.meta.dirname, '../../scripts/formatFontFamily_chromium_oracle.py');

function hasChromiumOracle(): boolean {
  try {
    execSync('python3.11 -c "import playwright"', { stdio: 'ignore' });
    execSync('command -v npx', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface OracleResult {
  input: string;
  serialized: string;
  chromiumRoundtrip: string;
  match: boolean;
}

function runOracle(): OracleResult[] {
  const stdout = execSync(`python3.11 "${ORACLE_SCRIPT}"`, {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const jsonStart = stdout.indexOf('[');
  if (jsonStart === -1) {
    throw new Error(`Oracle did not return JSON output:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(jsonStart)) as OracleResult[];
}

const describeOrSkip = hasChromiumOracle() ? describe : describe.skip;

describeOrSkip('formatFontFamily Chromium round-trip oracle', () => {
  it(
    'round-trips every serializer output through Chromium CSSOM',
    () => {
      const results = runOracle();
      const failures = results.filter((result) => !result.match);

      expect(failures).toEqual([]);
      expect(results.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
