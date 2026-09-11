import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyChromeOsWebAssets } from './verify-chromeos-web-assets.mjs';

function fixture(css) {
  const root = mkdtempSync(join(tmpdir(), 'sloom-chromeos-assets-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(
    join(root, 'index.html'),
    '<link rel="stylesheet" href="./assets/index-fixture.css"><script type="module" src="./assets/index-fixture.js"></script>',
  );
  writeFileSync(join(root, 'assets/index-fixture.css'), css);
  writeFileSync(join(root, 'assets/index-fixture.js'), 'document.documentElement.dataset.appReady = "true";');
  return root;
}

const compatibleCss = [
  '--color-cyan-500:#00b8db;',
  '.flex:not(#\\#){display:flex}',
  '@supports (color:color-mix(in lab,red,red)){.accent:not(#\\#){color:color-mix(in srgb,#fff 50%,#000)}}',
  'x'.repeat(100_000),
].join('');

describe('ChromeOS packaged web asset verifier', () => {
  it('accepts a complete downleveled application bundle', () => {
    expect(verifyChromeOsWebAssets(fixture(compatibleCss))).toMatchObject({
      referencedAssetCount: 2,
      stylesheetCount: 1,
      applicationStylesheet: 'assets/index-fixture.css',
    });
  });

  it('rejects a Tailwind cascade layer that old ChromeOS WebViews discard', () => {
    expect(() => verifyChromeOsWebAssets(fixture(`${compatibleCss}@layer utilities{.grid{display:grid}}`)))
      .toThrow(/still contains @layer/u);
  });

  it('rejects a referenced asset omitted from the package', () => {
    const root = fixture(compatibleCss);
    writeFileSync(
      join(root, 'index.html'),
      '<link rel="stylesheet" href="./assets/index-fixture.css"><script src="./assets/missing.js"></script>',
    );
    expect(() => verifyChromeOsWebAssets(root)).toThrow(/Missing packaged web assets/u);
  });
});

