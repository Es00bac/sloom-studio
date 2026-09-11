import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

const ORACLE_SCRIPT = resolve(import.meta.dirname, '../../../scripts/image-adjustment-gpu-preview-chromium-oracle.py');

function hasChromiumOracle(): boolean {
  try {
    execFileSync('python3.11', ['-c', 'import playwright'], { stdio: 'ignore' });
    execFileSync('npx', ['esbuild', '--version'], { stdio: 'ignore' });
    execFileSync('chromium', ['--version'], { stdio: 'ignore' });
    return existsSync(ORACLE_SCRIPT);
  } catch {
    return false;
  }
}

const describeOrSkip = hasChromiumOracle() ? describe : describe.skip;

describeOrSkip('ImageAdjustmentGpuPreview Chromium WebGL2 oracle', () => {
  it(
    'matches CPU Black & White output for a non-symmetric bitmap with half-byte ties',
    () => {
      execFileSync('python3.11', [ORACLE_SCRIPT], {
        stdio: 'inherit',
        timeout: 120_000,
      });
    },
    130_000,
  );
});
