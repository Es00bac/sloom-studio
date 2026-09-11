import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  OSS_NATIVE_COMPONENTS,
  OSS_NPM_PACKAGES,
} from '../generated/ossLicenses';

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
) as { dependencies?: Record<string, string> };

describe('generated OSS license inventory', () => {
  it('covers every direct production dependency', () => {
    const inventoryNames = new Set(OSS_NPM_PACKAGES.map((entry) => entry.name));
    const missing = Object.keys(packageJson.dependencies ?? {}).filter(
      (name) => !inventoryNames.has(name),
    );
    expect(missing).toEqual([]);
  });

  it('lists the bundled/downloaded native components', () => {
    const names = OSS_NATIVE_COMPONENTS.map((entry) => entry.name).join('\n');
    expect(names).toContain('Electron');
    expect(names).toContain('realesrgan-ncnn-vulkan');
    expect(names).toContain('Local Dream');
    expect(names).toContain('Qualcomm QNN');
    expect(names).toContain('FFmpeg');
  });

  it('flags the components whose redistribution terms are under review', () => {
    const flagged = OSS_NATIVE_COMPONENTS.filter((entry) => entry.flagged);
    expect(flagged.map((entry) => entry.license).join(' ')).toContain('CC-BY-NC-4.0');
    expect(flagged.length).toBeGreaterThanOrEqual(2);
  });

  it('has a name and license on every entry', () => {
    for (const entry of [...OSS_NATIVE_COMPONENTS, ...OSS_NPM_PACKAGES]) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.license.length).toBeGreaterThan(0);
    }
  });

  it('keeps npm entries deduplicated by name@version', () => {
    const keys = OSS_NPM_PACKAGES.map((entry) => `${entry.name}@${entry.version ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
