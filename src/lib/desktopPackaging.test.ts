import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

async function loadDesktopPackagingModule() {
  return await import('./desktopPackaging');
}

describe('desktop and Android packaging configuration', () => {
  it('publishes deterministic desktop workspace launch readiness descriptors', async () => {
    const {
      DESKTOP_WORKSPACE_LAUNCH_READINESS,
      getDesktopWorkspaceLaunchReadiness,
    } = await loadDesktopPackagingModule();

    expect(DESKTOP_WORKSPACE_LAUNCH_READINESS).toEqual([
      {
        workspace: 'flow',
        appName: 'Flow',
        menuLabel: 'Flow',
        launchLabel: 'Open/Focus Flow Window',
        launchCommand: 'view:flow',
        accelerator: 'CommandOrControl+1',
        packageSurface: 'electron-native-menu',
        readiness: 'ready',
        caveats: ['Launches the Flow workspace through the shared Sloom Studio desktop binary.'],
      },
      {
        workspace: 'editor',
        appName: 'Video',
        menuLabel: 'Video',
        launchLabel: 'Open/Focus Video Window',
        launchCommand: 'view:editor',
        accelerator: 'CommandOrControl+2',
        packageSurface: 'electron-native-menu',
        readiness: 'ready',
        caveats: ['Launches the Video workspace through the shared Sloom Studio desktop binary.'],
      },
      {
        workspace: 'image',
        appName: 'Image',
        menuLabel: 'Image',
        launchLabel: 'Open/Focus Image Window',
        launchCommand: 'view:image',
        accelerator: 'CommandOrControl+3',
        packageSurface: 'electron-native-menu',
        readiness: 'ready',
        caveats: ['Launches the Image workspace through the shared Sloom Studio desktop binary.'],
      },
      {
        workspace: 'paper',
        appName: 'Paper',
        menuLabel: 'Paper',
        launchLabel: 'Open/Focus Paper Window',
        launchCommand: 'view:paper',
        accelerator: 'CommandOrControl+4',
        packageSurface: 'electron-native-menu',
        readiness: 'ready',
        caveats: ['Launches the Paper workspace through the shared Sloom Studio desktop binary.'],
      },
    ]);
    expect(getDesktopWorkspaceLaunchReadiness('image')).toBe(DESKTOP_WORKSPACE_LAUNCH_READINESS[2]);
  });

  it('summarizes platform targets, dependencies, and installer limitations from package metadata', async () => {
    const { buildDesktopPackagingReadinessSummary } = await loadDesktopPackagingModule();
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'sloom-missing-fonts-'));

    try {
      expect(buildDesktopPackagingReadinessSummary(packageJson, {
        stagedFontLibraryRoot: join(fixtureRoot, 'absent'),
      })).toEqual({
      productName: 'Sloom Studio',
      appId: 'studio.sloom.signalloom',
      workspaceLaunchSurface: 'electron-native-menu',
      platforms: [
        {
          platform: 'windows',
          scriptName: 'dist:win',
          script: 'npm run build && npm run prepare:font-library && electron-builder --win nsis',
          configuredTargets: ['nsis:x64'],
          processDocumentPath: 'docs/packaging/windows-installer.md',
          hostRequirement: 'linux-cross-build-supported',
          readiness: 'configured-with-caveats',
          caveats: [
            'NSIS packaging is configured for x64 only.',
            'Windows installer packaging can be prepared on Linux, but signing credentials and final validation still need a Windows-oriented release step.',
          ],
          artifactExpectations: [
            'Expected configured artifact type: NSIS installer for x64.',
            'Do not claim a signed installer artifact exists until an actual release build produces it.',
          ],
          signingCaveats: [
            'Windows code signing credentials are not represented in package metadata.',
          ],
        },
        {
          platform: 'macos',
          scriptName: 'dist:mac',
          script: 'npm run build && npm run prepare:font-library && electron-builder --mac dmg zip',
          configuredTargets: ['dmg', 'zip'],
          processDocumentPath: 'docs/packaging/macos-build.md',
          hostRequirement: 'macos-required-for-final-package',
          readiness: 'configured-with-caveats',
          caveats: [
            'Final DMG packaging requires a macOS build host.',
            'Linux can only smoke-check the unsigned ZIP path and cannot replace the Mac packaging/signing/notarization process.',
            'Gatekeeper assessment is disabled for local packaging.',
          ],
          artifactExpectations: [
            'Expected configured artifact types: DMG and ZIP app packages.',
            'Do not claim a notarized app package exists until a macOS release build completes successfully.',
          ],
          signingCaveats: [
            'Notarization requires Apple credentials outside package metadata.',
            'A Developer ID Application certificate is required for signed distribution builds.',
          ],
        },
        {
          platform: 'linux',
          scriptName: 'dist:linux',
          script: 'npm run build && npm run prepare:font-library && electron-builder --linux AppImage deb',
          configuredTargets: ['AppImage', 'deb', 'snap'],
          processDocumentPath: 'docs/packaging/linux-build.md',
          hostRequirement: 'native-linux-build-host',
          readiness: 'configured-with-caveats',
          caveats: [
            'AppImage, deb, and Snap targets are configured; Flatpak and RPM targets are not represented.',
            'The user-local desktop entry installer is separate from electron-builder packages.',
          ],
          artifactExpectations: [
            'Expected configured artifact types: AppImage, deb, and Snap packages.',
          ],
          signingCaveats: [],
        },
      ],
      dependencies: [
        {
          packageName: 'electron',
          versionRange: '^41.3.0',
          role: 'desktop-runtime',
          limitation: 'Native launch depends on installed npm dependencies; no Electron binary is vendored in the repository.',
          bundledBy: 'electron-builder files packaging',
        },
        {
          packageName: 'electron-builder',
          versionRange: '^26.15.2',
          role: 'installer-builder',
          limitation: 'Installer creation depends on host toolchains and signing/notarization credentials outside package metadata.',
          bundledBy: 'build-time host dependency only',
        },
      ],
      dependencyChecklist: [
        {
          id: 'desktop-app-files',
          label: 'Desktop build includes renderer, Electron entrypoints, shared code, and package metadata.',
          readiness: 'ready',
          evidence: ['dist/**/*', 'electron/**/*', 'shared/**/*', 'package.json'],
        },
        {
          id: 'native-render-resource',
          label: 'Desktop build includes the native render helper as an extra resource.',
          readiness: 'ready',
          evidence: ['ops/native-render -> ops/native-render'],
        },
        {
          id: 'bundled-font-library-resource',
          label: 'Desktop build includes the audited managed font library as a read-only extra resource.',
          readiness: 'blocked',
          evidence: ['build/font-library -> font-library'],
          blockers: [
            'Staged font manifest is missing.',
            'Staged font checksum manifest is missing.',
          ],
        },
        {
          id: 'windows-installer-dependencies',
          label: 'Windows installer readiness depends on installed Electron and Electron Builder packages before packaging.',
          readiness: 'ready',
          evidence: ['electron@^41.3.0', 'electron-builder@^26.15.2'],
        },
      ],
      installerLimitations: [
        'Flow, Video, Image, and Paper are focusable workspaces inside one Sloom Studio desktop app, not separate packaged executables.',
        'Provider credentials, model downloads, and Android accelerator setup remain runtime/user configuration and are not bundled in desktop installers.',
      ],
      });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('blocks desktop packaging readiness when the configured staged font library is absent', async () => {
    const { buildDesktopPackagingReadinessSummary } = await loadDesktopPackagingModule();
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'sloom-missing-fonts-'));

    try {
      const fontLibrary = buildDesktopPackagingReadinessSummary(packageJson, {
        stagedFontLibraryRoot: join(fixtureRoot, 'absent'),
      })
        .dependencyChecklist
        .find((item) => item.id === 'bundled-font-library-resource');

      expect(fontLibrary?.readiness).toBe('blocked');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('blocks a staged font library when its checksum manifest does not match the staged bytes', async () => {
    const { verifyStagedFontLibrary } = await loadDesktopPackagingModule();
    const root = mkdtempSync(join(tmpdir(), 'sloom-staged-fonts-'));
    const relativeFontPath = 'collection/base/example.ttf';
    const expectedHash = createHash('sha256').update('expected font bytes').digest('hex');

    try {
      mkdirSync(join(root, 'inventory'), { recursive: true });
      mkdirSync(join(root, 'collection', 'base'), { recursive: true });
      writeFileSync(join(root, 'inventory', 'font-inventory.json'), JSON.stringify({
        catalogFamilyCount: 116,
        faceCount: 430,
        fontFileCount: 430,
        criticalErrorCount: 0,
        families: [{ faces: [{ file: relativeFontPath, sha256: expectedHash }] }],
      }));
      writeFileSync(join(root, 'inventory', 'SHA256SUMS'), `${expectedHash}  ${relativeFontPath}\n`);
      writeFileSync(join(root, relativeFontPath), 'different staged bytes');

      expect(verifyStagedFontLibrary(root)).toMatchObject({
        readiness: 'blocked',
        blockers: expect.arrayContaining([
          `Staged font bytes fail checksum verification for ${relativeFontPath}.`,
        ]),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps repeatable Android sync and debug build scripts available', () => {
    expect(packageJson.scripts['sync:android']).toBe('npm run build && cap sync android');
    expect(packageJson.scripts['android:prepare-localdream-runtime']).toBe('node scripts/prepare-android-localdream-runtime.mjs');
    expect(packageJson.scripts['build:android']).toBe('npm run android:prepare-localdream-runtime && npm run sync:android && cd android && ./gradlew assembleDebug');
    expect(existsSync(join(process.cwd(), 'scripts/prepare-android-localdream-runtime.mjs'))).toBe(true);
  });

  it('defines standard Windows and macOS Electron installer targets', () => {
    expect(packageJson.scripts['prepare:font-library']).toBe('node scripts/prepare-bundled-font-library.mjs');
    expect(packageJson.scripts['dist:win']).toBe('npm run build && npm run prepare:font-library && electron-builder --win nsis');
    expect(packageJson.scripts['dist:win:msix']).toBeUndefined();
    expect(packageJson.scripts['dist:mac']).toBe('npm run build && npm run prepare:font-library && electron-builder --mac dmg zip');
    expect(packageJson.scripts['dist:mac:zip']).toBe('npm run build && npm run prepare:font-library && electron-builder --mac zip');
    expect(packageJson.scripts['icons:mac']).toBe('bash scripts/create-mac-icon.sh');
    expect(packageJson.build).toMatchObject({
      appId: 'studio.sloom.signalloom',
      productName: 'Sloom Studio',
      win: {
        icon: 'build/icons/icon.ico',
        target: [{ target: 'nsis', arch: ['x64'] }],
      },
      mac: {
        hardenedRuntime: true,
        gatekeeperAssess: false,
        entitlements: 'build/mac/entitlements.mac.plist',
        entitlementsInherit: 'build/mac/entitlements.mac.plist',
        target: ['dmg', 'zip'],
      },
      linux: {
        icon: 'build/icons/icon.png',
      },
    });
    expect(packageJson.build.files).toEqual(expect.arrayContaining([
      'dist/**/*',
      'electron/**/*',
      'package.json',
    ]));
    expect(packageJson.build.extraResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'build/font-library', to: 'font-library' }),
    ]));
    expect(existsSync(join(process.cwd(), 'scripts/prepare-bundled-font-library.mjs'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'scripts/create-mac-icon.sh'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'build/mac/entitlements.mac.plist'))).toBe(true);
    const macBuildDoc = readFileSync(join(process.cwd(), 'docs/packaging/macos-build.md'), 'utf8');
    expect(macBuildDoc).toContain('npm run icons:mac');
    expect(macBuildDoc).toContain('npm run dist:mac');
    expect(macBuildDoc).toContain('APPLE_ID');
    expect(macBuildDoc).toContain('notar');
  });

  it('documents Windows installer dependency bundling readiness and artifact expectations without claiming a built artifact', async () => {
    const { buildDesktopPackagingReadinessSummary } = await loadDesktopPackagingModule();

    const summary = buildDesktopPackagingReadinessSummary(packageJson);
    const windows = summary.platforms.find((platform) => platform.platform === 'windows');
    const checklistItem = summary.dependencyChecklist.find((item) => item.id === 'windows-installer-dependencies');
    const windowsDoc = readFileSync(join(process.cwd(), 'docs/packaging/windows-installer.md'), 'utf8');

    expect(windows).toMatchObject({
      hostRequirement: 'linux-cross-build-supported',
      processDocumentPath: 'docs/packaging/windows-installer.md',
      artifactExpectations: [
        'Expected configured artifact type: NSIS installer for x64.',
        'Do not claim a signed installer artifact exists until an actual release build produces it.',
      ],
      signingCaveats: ['Windows code signing credentials are not represented in package metadata.'],
    });
    expect(checklistItem).toEqual({
      id: 'windows-installer-dependencies',
      label: 'Windows installer readiness depends on installed Electron and Electron Builder packages before packaging.',
      readiness: 'ready',
      evidence: ['electron@^41.3.0', 'electron-builder@^26.15.2'],
    });
    expect(windowsDoc).toContain('electron-builder --win nsis');
    expect(windowsDoc).toContain('NSIS');
    expect(windowsDoc).not.toContain('MSIX');
    expect(windowsDoc).toContain('Do not claim a signed installer artifact exists');
    const releaseWorkflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    expect(releaseWorkflow).not.toContain('.msix');
  });

  it('documents the macOS package process, Linux host limitation, and signing/notarization caveats as descriptors only', async () => {
    const { buildDesktopPackagingReadinessSummary } = await loadDesktopPackagingModule();

    const summary = buildDesktopPackagingReadinessSummary(packageJson);
    const mac = summary.platforms.find((platform) => platform.platform === 'macos');
    const macBuildDoc = readFileSync(join(process.cwd(), 'docs/packaging/macos-build.md'), 'utf8');
    const linuxDoc = readFileSync(join(process.cwd(), 'docs/packaging/linux-build.md'), 'utf8');

    expect(mac).toMatchObject({
      hostRequirement: 'macos-required-for-final-package',
      processDocumentPath: 'docs/packaging/macos-build.md',
      caveats: expect.arrayContaining([
        'Final DMG packaging requires a macOS build host.',
        'Linux can only smoke-check the unsigned ZIP path and cannot replace the Mac packaging/signing/notarization process.',
      ]),
      signingCaveats: [
        'Notarization requires Apple credentials outside package metadata.',
        'A Developer ID Application certificate is required for signed distribution builds.',
      ],
      artifactExpectations: [
        'Expected configured artifact types: DMG and ZIP app packages.',
        'Do not claim a notarized app package exists until a macOS release build completes successfully.',
      ],
    });
    expect(macBuildDoc).toContain('Linux can produce an unsigned zip');
    expect(macBuildDoc).toContain('does not replace a signed and notarized macOS build');
    expect(macBuildDoc).toContain('Developer ID Application certificate');
    expect(linuxDoc).toContain('Linux host limitation');
    expect(linuxDoc).toContain('cannot produce the final signed/notarized macOS app package');
  });
});
