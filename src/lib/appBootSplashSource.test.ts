import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('app boot splash source guards', () => {
  it('renders the Sloom Studio splash before React mounts and hides it after the app is ready', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(existsSync(join(process.cwd(), 'public/signal-loom-splash.png'))).toBe(true);
    expect(html).toContain('id="app-boot-splash"');
    expect(html).toContain('src="/signal-loom-splash.png"');
    expect(html).toContain('html[data-app-ready="true"] #app-boot-splash');
    expect(appSource).toContain('function AppBootSplashDismissor()');
    expect(appSource).toContain('<img');
    // The React StartupSplash resolves the asset via document.baseURI so it loads under the packaged
    // file:// origin too (a bare root-absolute /… 404s there). index.html's pre-React splash is a build
    // asset Vite rewrites to a relative URL, so it stays a plain src (checked above).
    expect(appSource).toContain("resolveBundledAssetUrl('/signal-loom-splash.png')");
    expect(appSource).toContain('alt="Sloom Studio is starting"');
    expect(appSource).toContain("document.documentElement.dataset.appReady = 'true'");
    expect(appSource).toMatch(/window\.setTimeout\([\s\S]*450/);
  });
});
