import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Android Chromebook support contract', () => {
  const root = process.cwd();
  const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  const postCssConfig = readFileSync(join(root, 'postcss.config.js'), 'utf8');

  it('declares native freeform resizing and handles every ChromeOS size configuration in place', () => {
    expect(manifest).toMatch(/<application[\s\S]*?android:resizeableActivity="true"/u);
    expect(manifest).toMatch(/<activity[\s\S]*?android:resizeableActivity="true"/u);
    expect(manifest).toContain('android.supports_size_changes');
    expect(manifest).not.toContain('android:screenOrientation=');

    for (const configuration of [
      'orientation',
      'keyboard',
      'screenSize',
      'smallestScreenSize',
      'screenLayout',
      'uiMode',
      'navigation',
      'density',
    ]) {
      expect(manifest).toMatch(new RegExp(`android:configChanges="[^"]*\\b${configuration}\\b`, 'u'));
    }
  });

  it('supports Chromebooks without touch and preserves native desktop pointer events', () => {
    expect(manifest).toContain(
      '<uses-feature android:name="android.hardware.touchscreen" android:required="false" />',
    );
    expect(manifest).toContain(
      '<uses-feature android:name="android.hardware.type.pc" android:required="false" />',
    );
  });

  it('downlevels both JavaScript and Tailwind CSS below the modern WebView-only baseline', () => {
    expect(viteConfig).toContain("target: 'chrome89'");
    expect(viteConfig).toContain("cssTarget: 'chrome80'");
    expect(viteConfig).toContain('include: Features.Colors');

    const tailwindIndex = postCssConfig.indexOf("'@tailwindcss/postcss'");
    const cascadeCompatibilityIndex = postCssConfig.indexOf("'@csstools/postcss-cascade-layers'");
    expect(tailwindIndex).toBeGreaterThanOrEqual(0);
    expect(cascadeCompatibilityIndex).toBeGreaterThan(tailwindIndex);
  });
});

