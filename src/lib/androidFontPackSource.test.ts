import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());

describe('Android publishing font-pack source', () => {
  it('declares an on-demand asset pack outside the base APK', () => {
    const settings = readFileSync(join(root, 'android/settings.gradle'), 'utf8');
    const appGradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf8');
    const packGradle = readFileSync(join(root, 'android/sloom_fonts/build.gradle'), 'utf8');

    expect(settings).toContain("include ':sloom_fonts'");
    expect(appGradle).toContain('assetPacks = [":sloom_fonts"]');
    expect(appGradle).toContain('com.google.android.play:asset-delivery:2.3.0');
    expect(packGradle).toContain("id 'com.android.asset-pack'");
    expect(packGradle).toContain('deliveryType = "on-demand"');
  });

  it('registers a bounded, verified native byte bridge', () => {
    const main = readFileSync(join(root, 'android/app/src/main/java/studio/sloom/slstapp/MainActivity.java'), 'utf8');
    const plugin = readFileSync(join(root, 'android/app/src/main/java/studio/sloom/slstapp/SloomFontPackPlugin.java'), 'utf8');

    expect(main).toContain('registerPlugin(SloomFontPackPlugin.class)');
    expect(plugin).toContain('@CapacitorPlugin(name = "SloomFontPack")');
    expect(plugin).toContain('EXPECTED_CHECKSUM_COUNT = 546');
    expect(plugin).toContain('MAX_CHUNK_BYTES = 1024 * 1024');
    expect(plugin).toContain('actualSignature.equals(expectedSignature)');
    expect(plugin).toContain('actualHash.equals(expectedHash)');
    expect(plugin).toContain('requireSafePath');
  });

  it('keeps native verification constants aligned with the staged audited inventory', () => {
    const plugin = readFileSync(join(root, 'android/app/src/main/java/studio/sloom/slstapp/SloomFontPackPlugin.java'), 'utf8');
    const inventory = JSON.parse(readFileSync(join(root, 'build/font-library/inventory/font-inventory.json'), 'utf8')) as {
      faceCount: number;
      families: unknown[];
    };
    const checksumCount = readFileSync(join(root, 'build/font-library/inventory/SHA256SUMS'), 'utf8')
      .trim().split(/\r?\n/).length;

    expect(plugin).toContain(`EXPECTED_FAMILY_COUNT = ${inventory.families.length}`);
    expect(plugin).toContain(`EXPECTED_FACE_COUNT = ${inventory.faceCount}`);
    expect(plugin).toContain(`EXPECTED_CHECKSUM_COUNT = ${checksumCount}`);
  });
});
