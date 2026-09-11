import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop external-open wiring guards', () => {
  it('forwards launcher file/URL arguments to the Electron process without breaking --dev', () => {
    const launcher = readFileSync(join(process.cwd(), 'electron/launcher.cjs'), 'utf8');

    expect(launcher).toContain('getLauncherForwardedOpenTargets(argv');
    expect(launcher).toContain('SIGNAL_LOOM_LAUNCH_CWD');
    expect(launcher).toMatch(/getElectronLaunchArgs\(electronEnv, process\.platform, [A-Za-z]+\)/);
    expect(launcher).toMatch(/argv\.includes\('--dev'\)/);
  });

  it('captures the invoking working directory in the terminal wrapper before changing directories', () => {
    const wrapper = readFileSync(join(process.cwd(), 'scripts/signal-loom-electron'), 'utf8');
    const exportIndex = wrapper.indexOf('SIGNAL_LOOM_LAUNCH_CWD');
    const cdIndex = wrapper.indexOf('cd "$project_root"');

    expect(exportIndex).toBeGreaterThan(-1);
    expect(cdIndex).toBeGreaterThan(-1);
    expect(exportIndex).toBeLessThan(cdIndex);
  });

  it('registers .sloom/.slppr file associations and the signal-loom protocol for packaged builds', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      build?: {
        fileAssociations?: Array<{ ext: string }>;
        protocols?: Array<{ schemes?: string[] }>;
      };
    };

    const extensions = (packageJson.build?.fileAssociations ?? []).map((association) => association.ext);
    expect(extensions).toContain('sloom');
    expect(extensions).toContain('slppr');

    const schemes = (packageJson.build?.protocols ?? []).flatMap((protocol) => protocol.schemes ?? []);
    expect(schemes).toContain('signal-loom');
  });

  it('advertises the handled types on the locally installed desktop entry that passes %U', () => {
    const installScript = readFileSync(join(process.cwd(), 'scripts/install-desktop-launcher.sh'), 'utf8');

    expect(installScript).toContain('%U');
    expect(installScript).toMatch(/MimeType=.*x-scheme-handler\/signal-loom/);
  });

  it('wires the renderer external-open consumer through the canonical open transactions', () => {
    const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(appSource).toContain('registerNativeExternalOpenConsumer(');
    // Shared dirty Paper/Image authorization precedes acceptance; renderer path follows commit.
    expect(appSource).toMatch(/authorizeProject: async \(\) => \{[\s\S]{0,700}requestProjectReplacementAuthorization/);
    expect(appSource).toContain('lossPreventionSaveRef.current()');
    expect(appSource).toContain('imageReplacementAuthorizationRef.current(projection)');
    expect(appSource).toMatch(/applyProject[\s\S]{0,900}prepareProjectDocumentTransaction\(result\.document, \{[\s\S]{0,300}imageAuthorization:[\s\S]{0,200}paperAuthorization:[\s\S]{0,200}transactionBookkeeping: 'reset-source-library-native-sync'[\s\S]{0,300}assertCanCommit\(\)[\s\S]{0,150}\.commit\(\)/);
    expect(appSource).toMatch(/onProjectCommitted[\s\S]{0,500}setNativeProjectPath\(result\.filePath\);[\s\S]{0,500}adoptSnapshot\(\{[\s\S]{0,200}authority: transition\.authority/);
    expect(appSource).toContain('beginProjectAuthorityTransition()');
    // Paper entries reuse the canonical .slppr import transaction and land in the Paper workspace.
    expect(appSource).toMatch(/applyPaper[\s\S]{0,500}openStandalonePaperDocument\(bytes, filePath, \{ existingProjectTransition: true \}\)[\s\S]{0,200}setWorkspaceView\('paper'\);/);
    // The consumer must wait for the startup restore to settle so external opens win the race.
    expect(appSource).toMatch(/nativeStartupSettled/);
  });

  it('declares the typed external-open bridge in the renderer native contract', () => {
    const nativeAppSource = readFileSync(join(process.cwd(), 'src/lib/nativeApp.ts'), 'utf8');

    expect(nativeAppSource).toContain('authorizeExternalOpenRenderer?:');
    expect(nativeAppSource).toContain('nextExternalOpenIntent?:');
    expect(nativeAppSource).toContain('acceptExternalOpenIntent?:');
    expect(nativeAppSource).toContain('rejectExternalOpenIntent?:');
    expect(nativeAppSource).toContain('commitExternalOpenIntent?:');
    expect(nativeAppSource).toContain('onExternalOpenPending?:');
    expect(nativeAppSource).toContain('NativeExternalOpenNextResult');
    expect(nativeAppSource).toContain('requestProjectOpen?:');
  });
});
