import { describe, expect, it } from 'vitest';
import {
  ANDROID_LOCALDREAM_SETUP_RELATIVE_DIR,
  buildAndroidLocalDreamSetupEvidence,
  buildAndroidLocalDreamSetupPaths,
  buildAndroidLocalDreamSetupPlan,
  createAndroidLocalDreamSetupReport,
  finalizeAndroidLocalDreamSetupReport,
  markAndroidLocalDreamSetupManualStep,
  formatAndroidLocalDreamSetupPlan,
  markAndroidLocalDreamSetupStepFinished,
  markAndroidLocalDreamSetupStepStarted,
  parseAndroidLocalDreamSetupArgs,
  resolveAndroidLocalDreamSetupExitCode,
} from './android-localdream-setup-lib.mjs';

describe('Android Local Dream guided setup helpers', () => {
  it('parses setup flags and defaults to a live side-by-side setup', () => {
    expect(parseAndroidLocalDreamSetupArgs([
      '--dry-run',
      '--package-mode=replace',
      '--adb-serial=R5C0000',
      '--android-sdk=/opt/android-sdk',
      '--fork-dir=/tmp/fork',
      '--token=pair',
    ])).toMatchObject({
      dryRun: true,
      packageMode: 'replace',
      adbSerial: 'R5C0000',
      androidSdkPath: '/opt/android-sdk',
      forkDir: '/tmp/fork',
      token: 'pair',
      confirmReplaceUninstall: false,
    });

    expect(parseAndroidLocalDreamSetupArgs([], {})).toMatchObject({
      dryRun: false,
      packageMode: 'side-by-side',
      confirmReplaceUninstall: false,
    });
  });

  it('accepts space-separated setup option values for command-line ergonomics', () => {
    expect(parseAndroidLocalDreamSetupArgs([
      '--adb-serial',
      'R5C0000',
      '--android-sdk',
      '/opt/android-sdk',
      '--fork-dir',
      '/tmp/fork',
      '--token',
      'pair',
      '--port',
      '8790',
    ], {})).toMatchObject({
      adbSerial: 'R5C0000',
      androidSdkPath: '/opt/android-sdk',
      forkDir: '/tmp/fork',
      token: 'pair',
      port: 8790,
    });
  });

  it('plans source-only setup as prepare and verify commands without ADB, Gradle, or live gate', () => {
    const options = parseAndroidLocalDreamSetupArgs([
      '--source-only',
      '--package-mode=replace',
      '--fork-dir=/tmp/source-fork',
    ], {});
    const plan = buildAndroidLocalDreamSetupPlan({
      repoRoot: '/repo',
      ...options,
    });

    expect(options).toMatchObject({
      sourceOnly: true,
      packageMode: 'replace',
      forkDir: '/tmp/source-fork',
    });
    expect(plan).toMatchObject({
      status: 'ready',
      packageMode: 'replace',
      sourceOnly: true,
      blocked: false,
    });
    expect(plan.warnings.join('\n')).toContain('does not use ADB, build an APK, install, start, or live-validate');
    expect(plan.steps.map((step) => step.id)).toEqual([
      'prepare-source-only',
      'verify-source-only',
    ]);
    expect(plan.steps[0]).toMatchObject({
      label: 'Prepare the source-only Signal Loom Local Dream fork',
      executable: '/repo/companions/android-local-dream-fork/prepare-signal-loom-localdream.sh',
      args: ['--source-only', '--package-mode', 'replace', '/tmp/source-fork'],
      command: '/repo/companions/android-local-dream-fork/prepare-signal-loom-localdream.sh --source-only --package-mode replace /tmp/source-fork',
    });
    expect(plan.steps[1]).toMatchObject({
      label: 'Verify the source-only Signal Loom Local Dream fork',
      args: ['--verify-prepared', '--source-only', '--package-mode', 'replace', '/tmp/source-fork'],
    });
    const plannedCommands = plan.steps.map((step) => step.command).join('\n');
    expect(plannedCommands).not.toContain('adb');
    expect(plannedCommands).not.toContain('gradlew');
    expect(plannedCommands).not.toContain('android-localdream-gate.mjs');
    expect(formatAndroidLocalDreamSetupPlan(plan)).toContain('Source-only setup');
  });

  it('plans the default guided setup as one prepare-backed live gate command', () => {
    const plan = buildAndroidLocalDreamSetupPlan({
      repoRoot: '/repo',
      packageMode: 'side-by-side',
      adbSerial: 'R5C0000',
      androidSdkPath: '/opt/android-sdk',
      token: 'pair',
    });

    expect(plan.blocked).toBe(false);
    expect(plan.steps).toEqual([
      {
        id: 'prepare-and-gate',
        label: 'Prepare, install, start, and validate the side-by-side Signal Loom Local Dream app',
        command: 'node /repo/scripts/android-localdream-gate.mjs --prepare --package-mode=side-by-side --adb-serial=R5C0000 --android-sdk=/opt/android-sdk --token=<redacted>',
        executable: 'node',
        args: [
          '/repo/scripts/android-localdream-gate.mjs',
          '--prepare',
          '--package-mode=side-by-side',
          '--adb-serial=R5C0000',
          '--android-sdk=/opt/android-sdk',
          '--token=pair',
        ],
      },
    ]);
    expect(formatAndroidLocalDreamSetupPlan(plan)).toContain('Prepare, install, start, and validate');
  });

  it('guards replace-package setup behind explicit destructive confirmation', () => {
    const plan = buildAndroidLocalDreamSetupPlan({
      repoRoot: '/repo',
      packageMode: 'replace',
      confirmReplaceUninstall: false,
    });

    expect(plan.blocked).toBe(true);
    expect(plan.status).toBe('needs-confirmation');
    expect(plan.warnings.join('\n')).toContain('uninstalls the Play Store Local Dream app');
    expect(plan.steps).toEqual([]);
  });

  it('plans replace-package setup with an explicit uninstall step and manual redownload checkpoint only after confirmation', () => {
    const plan = buildAndroidLocalDreamSetupPlan({
      repoRoot: '/repo',
      forkDir: '/tmp/fork',
      packageMode: 'replace',
      confirmReplaceUninstall: true,
      androidSdkPath: '/opt/android-sdk',
    });

    expect(plan.blocked).toBe(false);
    expect(plan.steps.map((step) => step.id)).toEqual([
      'prepare-replace',
      'build-replace',
      'uninstall-play-store-local-dream',
      'install-replace',
      'first-run-redownload-and-smoke',
    ]);
    expect(plan.steps[2].command).toBe('adb uninstall io.github.xororz.localdream');
    expect(plan.steps[3].command).toContain('LocalDream_armv8a_2.5.3_with_filter-signaloom-replace-debug.apk');
    expect(plan.steps[4]).toMatchObject({
      kind: 'manual',
      command: 'manual checkpoint',
      label: 'Open Signal Loom Android, redownload assets, and run in-app operation smoke tests',
    });
    expect(plan.steps[4].manualActions.join('\n')).toContain('Test Generate');
    expect(plan.steps[4].manualActions.join('\n')).toContain('npm run gate:android-localdream -- --package-mode=replace --fork-dir=/tmp/fork --android-sdk=/opt/android-sdk');
    expect(plan.steps.map((step) => step.id)).not.toContain('start-and-smoke-replace');
    expect(plan.warnings.join('\n')).toContain('Run npm run gate:android-localdream after the manual checkpoint passes');
  });

  it('treats blocked replace-package dry-runs as preview success but live runs as blocked', () => {
    const blockedPlan = {
      blocked: true,
    };

    expect(resolveAndroidLocalDreamSetupExitCode(blockedPlan, { dryRun: true })).toBe(0);
    expect(resolveAndroidLocalDreamSetupExitCode(blockedPlan, { dryRun: false })).toBe(2);
    expect(resolveAndroidLocalDreamSetupExitCode({ blocked: false }, { dryRun: false })).toBe(0);
  });

  it('builds stable dashboard evidence paths for guided setup reports', () => {
    expect(ANDROID_LOCALDREAM_SETUP_RELATIVE_DIR).toBe('output/dev-dashboard/android-localdream-setup');
    expect(buildAndroidLocalDreamSetupPaths('/repo')).toEqual({
      directory: '/repo/output/dev-dashboard/android-localdream-setup',
      latest: '/repo/output/dev-dashboard/android-localdream-setup/latest.json',
      linkedGateLatest: '/repo/output/dev-dashboard/android-localdream-gate/latest.json',
    });
  });

  it('creates planned dry-run setup evidence without leaking the token value', () => {
    const plan = buildAndroidLocalDreamSetupPlan({
      repoRoot: '/repo',
      packageMode: 'side-by-side',
      token: 'secret-token',
    });
    const report = finalizeAndroidLocalDreamSetupReport(createAndroidLocalDreamSetupReport({
      options: {
        dryRun: true,
        packageMode: 'side-by-side',
        token: 'secret-token',
        port: 8788,
      },
      plan,
      reportPath: '/repo/output/dev-dashboard/android-localdream-setup/latest.json',
      linkedGateReportPath: '/repo/output/dev-dashboard/android-localdream-gate/latest.json',
      startedAt: new Date('2026-06-04T21:00:00.000Z'),
    }), {
      ok: true,
      endedAt: new Date('2026-06-04T21:00:01.000Z'),
    });
    const evidence = buildAndroidLocalDreamSetupEvidence({ report });

    expect(report.status).toBe('planned');
    expect(evidence).toMatchObject({
      status: 'planned',
      ok: true,
      reportPath: '/repo/output/dev-dashboard/android-localdream-setup/latest.json',
      linkedGateReportPath: '/repo/output/dev-dashboard/android-localdream-gate/latest.json',
      options: {
        dryRun: true,
        packageMode: 'side-by-side',
        tokenConfigured: true,
      },
    });
    expect(evidence.steps).toEqual([
      expect.objectContaining({
        id: 'prepare-and-gate',
        status: 'planned',
        command: 'node /repo/scripts/android-localdream-gate.mjs --prepare --package-mode=side-by-side --token=<redacted>',
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain('secret-token');
    expect(JSON.stringify(evidence)).not.toContain('secret-token');
  });

  it('creates source-only planned setup evidence for dashboard display', () => {
    const plan = buildAndroidLocalDreamSetupPlan({
      repoRoot: '/repo',
      sourceOnly: true,
      packageMode: 'side-by-side',
      forkDir: '/tmp/source-fork',
    });
    const report = createAndroidLocalDreamSetupReport({
      options: {
        dryRun: true,
        sourceOnly: true,
        packageMode: 'side-by-side',
        forkDir: '/tmp/source-fork',
      },
      plan,
      reportPath: '/repo/output/dev-dashboard/android-localdream-setup/latest.json',
      linkedGateReportPath: '/repo/output/dev-dashboard/android-localdream-gate/latest.json',
      startedAt: new Date('2026-06-04T21:02:00.000Z'),
    });
    const evidence = buildAndroidLocalDreamSetupEvidence({ report });

    expect(report.status).toBe('planned');
    expect(report.options).toMatchObject({
      dryRun: true,
      sourceOnly: true,
      packageMode: 'side-by-side',
      forkDir: '/tmp/source-fork',
    });
    expect(evidence.options.sourceOnly).toBe(true);
    expect(evidence.warnings.join('\n')).toContain('does not use ADB');
    expect(evidence.steps).toEqual([
      expect.objectContaining({
        id: 'prepare-source-only',
        status: 'planned',
        command: '/repo/companions/android-local-dream-fork/prepare-signal-loom-localdream.sh --source-only --package-mode side-by-side /tmp/source-fork',
      }),
      expect.objectContaining({
        id: 'verify-source-only',
        status: 'planned',
        command: '/repo/companions/android-local-dream-fork/prepare-signal-loom-localdream.sh --verify-prepared --source-only --package-mode side-by-side /tmp/source-fork',
      }),
    ]);
  });

  it('surfaces blocked replace-package setup as needs-confirmation evidence', () => {
    const plan = buildAndroidLocalDreamSetupPlan({
      repoRoot: '/repo',
      packageMode: 'replace',
      confirmReplaceUninstall: false,
    });
    const evidence = buildAndroidLocalDreamSetupEvidence({
      report: createAndroidLocalDreamSetupReport({
        options: { packageMode: 'replace', confirmReplaceUninstall: false },
        plan,
        startedAt: new Date('2026-06-04T21:05:00.000Z'),
      }),
      reportPath: '/repo/output/dev-dashboard/android-localdream-setup/latest.json',
    });

    expect(evidence.status).toBe('needs-confirmation');
    expect(evidence.ok).toBe(false);
    expect(evidence.options).toMatchObject({
      packageMode: 'replace',
      confirmReplaceUninstall: false,
    });
    expect(evidence.warnings.join('\n')).toContain('uninstalls the Play Store Local Dream app');
    expect(evidence.steps).toEqual([]);
  });

  it('records failed setup steps with redacted detail for dashboard display', () => {
    const plan = buildAndroidLocalDreamSetupPlan({
      repoRoot: '/repo',
      packageMode: 'side-by-side',
    });
    let report = createAndroidLocalDreamSetupReport({
      options: { packageMode: 'side-by-side' },
      plan,
      startedAt: new Date('2026-06-04T21:10:00.000Z'),
    });
    report = markAndroidLocalDreamSetupStepStarted(report, 'prepare-and-gate', new Date('2026-06-04T21:10:01.000Z'));
    report = markAndroidLocalDreamSetupStepFinished(report, 'prepare-and-gate', {
      exitCode: 1,
      stdout: 'running --token=secret-token',
      stderr: 'Authorization: Bearer secret-token failed',
      endedAt: new Date('2026-06-04T21:10:03.000Z'),
    });
    report = finalizeAndroidLocalDreamSetupReport(report, {
      ok: false,
      endedAt: new Date('2026-06-04T21:10:04.000Z'),
    });

    const evidence = buildAndroidLocalDreamSetupEvidence({ report });
    expect(evidence.status).toBe('failed');
    expect(evidence.blockingStep).toMatchObject({
      id: 'prepare-and-gate',
      status: 'failed',
    });
    expect(evidence.blockingStep.detail).toContain('<redacted>');
    expect(evidence.blockingStep.detail).not.toContain('secret-token');
  });

  it('keeps replace-package setup waiting for the user after the manual redownload checkpoint is reached', () => {
    const plan = buildAndroidLocalDreamSetupPlan({
      repoRoot: '/repo',
      packageMode: 'replace',
      confirmReplaceUninstall: true,
    });
    let report = createAndroidLocalDreamSetupReport({
      options: { packageMode: 'replace', confirmReplaceUninstall: true },
      plan,
      startedAt: new Date('2026-06-04T21:15:00.000Z'),
    });

    for (const stepId of ['prepare-replace', 'build-replace', 'uninstall-play-store-local-dream', 'install-replace']) {
      report = markAndroidLocalDreamSetupStepStarted(report, stepId, new Date('2026-06-04T21:15:01.000Z'));
      report = markAndroidLocalDreamSetupStepFinished(report, stepId, {
        exitCode: 0,
        stdout: `${stepId} ok`,
        endedAt: new Date('2026-06-04T21:15:02.000Z'),
      });
    }

    report = markAndroidLocalDreamSetupManualStep(report, 'first-run-redownload-and-smoke', new Date('2026-06-04T21:15:03.000Z'));
    report = finalizeAndroidLocalDreamSetupReport(report, {
      endedAt: new Date('2026-06-04T21:15:04.000Z'),
    });

    const evidence = buildAndroidLocalDreamSetupEvidence({ report });
    expect(report.status).toBe('waiting-for-user');
    expect(report.ok).toBe(false);
    expect(evidence.status).toBe('waiting-for-user');
    expect(evidence.steps.at(-1)).toMatchObject({
      id: 'first-run-redownload-and-smoke',
      kind: 'manual',
      status: 'manual',
    });
    expect(evidence.steps.at(-1).manualActions.join('\n')).toContain('Test Upscale');
  });
});
