import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

function loadVersionDisplay(): {
  formatInternalBuildVersion: (version: unknown) => string;
} {
  return require('../../electron/version-display.cjs') as {
    formatInternalBuildVersion: (version: unknown) => string;
  };
}

describe('Electron internal build version display', () => {
  it('presents the SemVer-safe single-letter suffix in the compact release notation', () => {
    const { formatInternalBuildVersion } = loadVersionDisplay();

    expect(formatInternalBuildVersion('0.9.12-d')).toBe('0.9.12d');
  });

  it('does not rewrite public or named prerelease versions', () => {
    const { formatInternalBuildVersion } = loadVersionDisplay();

    expect(formatInternalBuildVersion('0.9.12')).toBe('0.9.12');
    expect(formatInternalBuildVersion('0.9.12-beta')).toBe('0.9.12-beta');
    expect(formatInternalBuildVersion(undefined)).toBe('');
  });
});
