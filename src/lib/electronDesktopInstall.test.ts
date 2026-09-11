import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDesktopLauncherInstallPlan } from './electronDesktopInstall';

describe('electronDesktopInstall', () => {
  it('builds a user-local install plan with an absolute desktop Exec path', () => {
    const plan = buildDesktopLauncherInstallPlan({
      homeDir: '/home/user',
      projectRoot: '/home/user/work/flow',
    });

    expect(plan.binTarget).toBe('/home/user/.local/bin/signal-loom-electron');
    expect(plan.desktopTarget).toBe('/home/user/.local/share/applications/signal-loom.desktop');
    expect(plan.launcherSource).toBe('/home/user/work/flow/scripts/signal-loom-electron');
    expect(plan.desktopEntry).toContain('Name=Sloom Studio');
    expect(plan.desktopEntry).toContain('Exec=/home/user/.local/bin/signal-loom-electron');
    expect(plan.desktopEntry).toContain('StartupWMClass=Sloom Studio');
  });

  it('uses one top-level application-menu category in every launcher template', () => {
    const plan = buildDesktopLauncherInstallPlan({
      homeDir: '/home/user',
      projectRoot: '/home/user/work/flow',
    });
    const installScript = readFileSync(
      new URL('../../scripts/install-desktop-launcher.sh', import.meta.url),
      'utf8',
    );

    expect(plan.desktopEntry).toContain('Categories=AudioVideo;AudioVideoEditing;');
    expect(plan.desktopEntry).not.toMatch(/^Categories=.*Graphics/m);
    expect(installScript).toContain('Categories=AudioVideo;AudioVideoEditing;');
    expect(installScript).not.toMatch(/^Categories=.*Graphics/m);
  });

  it('does not opt the installed launcher into the Electron 41-incompatible native panel-menu transport', () => {
    const installScript = readFileSync(
      new URL('../../scripts/install-desktop-launcher.sh', import.meta.url),
      'utf8',
    );

    expect(installScript).toContain('Exec=${install_dir}/signal-loom %U');
    expect(installScript).not.toContain('SIGNAL_LOOM_ELECTRON_PANEL_MENU=1');
  });

  it('refuses to replace the packaged tree beneath a running Sloom process', () => {
    const installScript = readFileSync(
      new URL('../../scripts/install-desktop-launcher.sh', import.meta.url),
      'utf8',
    );
    const firstRunningCheck = installScript.indexOf('require_installed_app_stopped');
    const installSync = installScript.indexOf('rsync -a --delete');

    expect(firstRunningCheck).toBeGreaterThan(-1);
    expect(installSync).toBeGreaterThan(firstRunningCheck);
    expect(installScript).toContain('Close Sloom Studio completely before installing');
    expect(installScript.match(/require_installed_app_stopped/g)).toHaveLength(3);
  });
});
