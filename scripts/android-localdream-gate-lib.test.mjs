import { describe, expect, it } from 'vitest';
import {
  buildAndroidLocalDreamGateEvidence,
  buildAndroidLocalDreamGatePaths,
  buildAndroidLocalDreamGatePlan,
  createAndroidLocalDreamGateReport,
  finalizeAndroidLocalDreamGateReport,
  markAndroidLocalDreamGateStepFinished,
  analyzeAndroidLocalDreamCapabilitiesPayload,
  formatAndroidLocalDreamCapabilitiesReadinessFailure,
  parseAndroidLocalDreamPairingTokenXml,
  parseAndroidLocalDreamGateArgs,
  resolveAndroidLocalDreamGateSdkPath,
  summarizeAndroidLocalDreamGateOutput,
  withAndroidLocalDreamGateAuthToken,
} from './android-localdream-gate-lib.mjs';

describe('Android Local Dream production gate helpers', () => {
  it('builds repo-local dashboard evidence paths', () => {
    expect(buildAndroidLocalDreamGatePaths('/repo')).toEqual({
      directory: '/repo/output/dev-dashboard/android-localdream-gate',
      latest: '/repo/output/dev-dashboard/android-localdream-gate/latest.json',
    });
  });

  it('parses gate flags and environment defaults', () => {
    expect(parseAndroidLocalDreamGateArgs([
      '--dry-run',
      '--continue-on-error',
      '--prepare',
      '--package-mode=replace',
      '--fork-dir=/tmp/fork',
      '--adb-serial=R5C0000',
      '--port=8789',
      '--token=pair',
      '--android-sdk=/opt/android-sdk',
    ], {})).toMatchObject({
      dryRun: true,
      continueOnError: true,
      prepare: true,
      packageMode: 'replace',
      forkDir: '/tmp/fork',
      adbSerial: 'R5C0000',
      port: 8789,
      token: 'pair',
      androidSdkPath: '/opt/android-sdk',
    });

    expect(parseAndroidLocalDreamGateArgs([], {
      SIGNAL_LOOM_LOCALDREAM_PACKAGE_MODE: 'side-by-side',
      SIGNAL_LOOM_LOCALDREAM_FORK_DIR: '/env/fork',
      SIGNAL_LOOM_ANDROID_ACCELERATOR_TOKEN: 'env-token',
      ANDROID_HOME: '/env/android-sdk',
    })).toMatchObject({
      packageMode: 'side-by-side',
      forkDir: '/env/fork',
      token: 'env-token',
      androidSdkPath: '/env/android-sdk',
    });

    expect(parseAndroidLocalDreamGateArgs([], {})).toMatchObject({
      token: '',
    });
  });

  it('discovers a local Android SDK path from environment and common workstation locations', () => {
    expect(resolveAndroidLocalDreamGateSdkPath({
      env: { ANDROID_SDK_ROOT: '/sdk/root' },
      pathExists: (candidate) => candidate === '/sdk/root/platforms',
    })).toBe('/sdk/root');

    expect(resolveAndroidLocalDreamGateSdkPath({
      env: { HOME: '/home/dev' },
      pathExists: (candidate) => candidate === '/opt/android-sdk/platforms',
    })).toBe('/opt/android-sdk');

    expect(resolveAndroidLocalDreamGateSdkPath({
      env: { HOME: '/home/dev' },
      pathExists: (candidate) => candidate === '/home/dev/android-sdk/platforms',
    })).toBe('/home/dev/android-sdk');
  });

  it('prefers a writable user Android SDK over a read-only common SDK during auto-discovery', () => {
    expect(resolveAndroidLocalDreamGateSdkPath({
      env: { HOME: '/home/dev' },
      pathExists: (candidate) => [
        '/opt/android-sdk/platforms',
        '/home/dev/android-sdk/platforms',
      ].includes(candidate),
      pathWritable: (candidate) => candidate === '/home/dev/android-sdk',
    })).toBe('/home/dev/android-sdk');
  });

  it('builds the production proof command plan in execution order', () => {
    const plan = buildAndroidLocalDreamGatePlan({
      repoRoot: '/repo',
      forkDir: '/tmp/fork',
      packageMode: 'side-by-side',
      prepare: true,
      port: 8788,
      token: 'pair',
      adbSerial: 'R5C0000',
      apkPath: '/tmp/fork/app/build/outputs/apk/filter/debug/app.apk',
      androidSdkPath: '/opt/android-sdk',
    });

    expect(plan.map((step) => step.id)).toEqual([
      'doctor',
      'prepare',
      'verify-prepared',
      'gradle-build',
      'adb-install',
      'start-server',
      'adb-forward',
      'capabilities',
      'generate',
      'upscale',
    ]);
    expect(plan[0].command).toBe('/repo/companions/android-local-dream-fork/prepare-signal-loom-localdream.sh --doctor --package-mode side-by-side /tmp/fork');
    expect(plan[3].cwd).toBe('/tmp/fork');
    expect(plan[3].env).toEqual({
      ANDROID_HOME: '/opt/android-sdk',
      ANDROID_SDK_ROOT: '/opt/android-sdk',
    });
    expect(plan[3].command).toBe('ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk ./gradlew :app:assembleFilterDebug --no-daemon');
    expect(plan[4].command).toBe('adb -s R5C0000 install -r /tmp/fork/app/build/outputs/apk/filter/debug/app.apk');
    expect(plan[5].command).toBe('adb -s R5C0000 shell am start -a io.github.xororz.localdream.signalloom.START -n io.github.xororz.localdream.signalloom/io.github.xororz.localdream.MainActivity');
    expect(plan[7].args).toContain('Authorization: Bearer pair');
    expect(plan[7].command).toBe('curl -fsS --retry 10 --retry-delay 1 --retry-all-errors --max-time 15 -H Authorization: Bearer <redacted> http://127.0.0.1:8788/v1/capabilities');
    expect(plan[7].command).not.toContain('pair');
    expect(plan[8].command).toContain('--max-time 240');
    expect(plan[9].command).toContain('--max-time 180');

    const upscalePayload = readStepJsonPayload(plan[9]);
    expect(readPngDimensionsFromDataUrl(upscalePayload.image)).toEqual({ width: 64, height: 64 });
    expect(upscalePayload.targetWidthPx).toBe(256);
    expect(upscalePayload.targetHeightPx).toBe(256);
  });

  it('uses the replace-package APK artifact name when planning replace-mode installs', () => {
    const plan = buildAndroidLocalDreamGatePlan({
      repoRoot: '/repo',
      forkDir: '/tmp/fork',
      packageMode: 'replace',
      token: 'pair',
    });
    const install = plan.find((step) => step.id === 'adb-install');

    expect(install.command).toContain('/tmp/fork/app/build/outputs/apk/filter/debug/LocalDream_armv8a_2.5.3_with_filter-signaloom-replace-debug.apk');
    expect(install.command).not.toContain('with_filter-signaloom-debug.apk');
  });

  it('extracts an Android pairing token and injects it into API smoke steps without leaking reports', () => {
    const token = parseAndroidLocalDreamPairingTokenXml(`<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="pairing_token">gate-token-123</string>
</map>`);
    expect(token).toBe('gate-token-123');

    const plan = buildAndroidLocalDreamGatePlan({
      repoRoot: '/repo',
      token: '',
    });
    const capabilities = plan.find((step) => step.id === 'capabilities');
    const authenticated = withAndroidLocalDreamGateAuthToken(capabilities, token);

    expect(capabilities.args).toContain('Authorization: Bearer ');
    expect(authenticated.args).toContain('Authorization: Bearer gate-token-123');
    expect(authenticated.command).toContain('Authorization: Bearer <redacted>');
    expect(authenticated.command).not.toContain('gate-token-123');
  });

  it('redacts live API tokens from reports and records only token presence', () => {
    const steps = buildAndroidLocalDreamGatePlan({
      repoRoot: '/repo',
      forkDir: '/tmp/fork',
      packageMode: 'side-by-side',
      token: 'super-secret-token',
    });
    const report = createAndroidLocalDreamGateReport({
      options: {
        token: 'super-secret-token',
      },
      steps,
      startedAt: new Date('2026-06-04T20:00:00.000Z'),
    });

    const serialized = JSON.stringify(report);

    expect(report.options).toMatchObject({ tokenConfigured: true });
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).toContain('Authorization: Bearer <redacted>');
  });

  it('tracks step outcomes and summarizes dashboard evidence', () => {
    const steps = buildAndroidLocalDreamGatePlan({
      repoRoot: '/repo',
      forkDir: '/tmp/fork',
      packageMode: 'side-by-side',
      prepare: false,
      port: 8788,
      token: 'pair',
    }).slice(0, 2);
    let report = createAndroidLocalDreamGateReport({
      options: {
        packageMode: 'side-by-side',
        forkDir: '/tmp/fork',
        port: 8788,
      },
      steps,
      startedAt: new Date('2026-06-04T20:00:00.000Z'),
    });

    report = markAndroidLocalDreamGateStepFinished(report, 'doctor', {
      exitCode: 0,
      stdout: 'Doctor result: ready.',
      stderr: '',
      endedAt: new Date('2026-06-04T20:00:01.000Z'),
    });
    report = markAndroidLocalDreamGateStepFinished(report, 'verify-prepared', {
      exitCode: 1,
      stdout: 'Prepared fork verification result: not ready.',
      stderr: 'missing hook',
      endedAt: new Date('2026-06-04T20:00:03.000Z'),
    });
    report = finalizeAndroidLocalDreamGateReport(report, {
      endedAt: new Date('2026-06-04T20:00:03.500Z'),
    });

    expect(report).toMatchObject({
      status: 'failed',
      ok: false,
      durationMs: 3500,
    });
    expect(report.steps[0]).toMatchObject({ status: 'passed', exitCode: 0 });
    expect(report.steps[1]).toMatchObject({ status: 'failed', exitCode: 1 });

    expect(buildAndroidLocalDreamGateEvidence({ report })).toMatchObject({
      status: 'failed',
      readyForLiveValidation: false,
      steps: [
        { id: 'doctor', status: 'passed' },
        { id: 'verify-prepared', status: 'failed' },
      ],
    });
  });

  it('summarizes media API output before writing dashboard evidence', () => {
    const generated = summarizeAndroidLocalDreamGateOutput('generate', JSON.stringify({
      image: 'a'.repeat(12000),
      modelUsed: 'sdxl_base',
      accelerator: 'qnn-htp',
      durationMs: 9490,
    }));
    expect(generated).toContain('<base64 image omitted; 12000 chars>');
    expect(generated).toContain('"modelUsed":"sdxl_base"');
    expect(generated).not.toContain('a'.repeat(500));

    const upscaled = summarizeAndroidLocalDreamGateOutput('upscale', '\xff\xd8\xff\xe0\0\x10JFIF\0\x01');
    expect(upscaled).toBe('[binary media output omitted; 16 bytes captured]');

    const steps = buildAndroidLocalDreamGatePlan({ repoRoot: '/repo', token: 'pair' });
    const report = createAndroidLocalDreamGateReport({
      steps,
      startedAt: new Date('2026-06-04T20:00:00.000Z'),
    });
    const finished = markAndroidLocalDreamGateStepFinished(report, 'generate', {
      exitCode: 0,
      stdout: JSON.stringify({ image: 'b'.repeat(9000), durationMs: 11 }),
      stderr: '',
      endedAt: new Date('2026-06-04T20:00:01.000Z'),
    });

    expect(finished.steps.find((step) => step.id === 'generate').stdout).toContain('<base64 image omitted; 9000 chars>');
  });

  it('summarizes capabilities output with operation-readiness counts for dashboard evidence', () => {
    const capabilitiesSummary = summarizeAndroidLocalDreamGateOutput('capabilities', JSON.stringify({
      ok: true,
      mode: 'local-dream-integrated',
      models: [
        { id: 'sdxl_base', name: 'SDXL Base', downloaded: true },
        { id: 'local-dream-active', name: 'Signal Loom Android default model' },
      ],
      upscalers: [
        { id: 'upscaler_realistic', name: 'Realistic', downloaded: true },
        { id: 'upscaler_anime', name: 'Anime', downloaded: false },
      ],
      jobStatus: { activeJobs: 0, completedJobs: 2, failedJobs: 0 },
      setupProof: {
        apiSelfTestPassed: true,
        generateSmokePassed: true,
        upscaleSmokePassed: true,
      },
      warnings: ['Native backend is not currently running; Signal Loom will try to start it on the next generation or upscale request.'],
    }));

    expect(capabilitiesSummary).toContain('Capabilities operation readiness passed');
    expect(capabilitiesSummary).toContain('2 downloaded model(s), 1 downloaded upscaler(s)');
    expect(capabilitiesSummary).toContain('local-dream-integrated');
    expect(capabilitiesSummary).toContain('Job status: present');
    expect(capabilitiesSummary).toContain('Setup proof: API self-test passed, Generate smoke passed, Upscale smoke passed');
    expect(capabilitiesSummary).toContain('Native backend is not currently running');
    expect(capabilitiesSummary).not.toContain('"models"');
    expect(capabilitiesSummary).not.toContain('"upscalers"');
  });

  it('blocks operation smoke when capabilities show missing downloaded model or upscaler assets', () => {
    expect(analyzeAndroidLocalDreamCapabilitiesPayload(JSON.stringify({
      ok: true,
      mode: 'local-dream-integrated',
      models: [],
      upscalers: [{ id: 'upscaler_realistic', downloaded: false }],
      warnings: [
        'No Local Dream image model is downloaded in this app. Download a model before using Android generation or upscaling.',
        'No Local Dream upscaler is downloaded in this app. Download UltraSharpV2 Lite or Real-ESRGAN Anime before print upscaling.',
      ],
    }))).toMatchObject({
      ready: false,
      downloadedModels: 0,
      downloadedUpscalers: 0,
      message: expect.stringContaining('Download at least one model'),
    });

    expect(analyzeAndroidLocalDreamCapabilitiesPayload(JSON.stringify({
      ok: true,
      mode: 'local-dream-integrated',
      models: [{ id: 'sdxl_base', downloaded: true }, { id: 'local-dream-active' }],
      upscalers: [{ id: 'upscaler_realistic', downloaded: true }],
      warnings: ['Native backend is not currently running; Signal Loom will try to start it on the next generation or upscale request.'],
    }))).toMatchObject({
      ready: true,
      downloadedModels: 2,
      downloadedUpscalers: 1,
    });
  });

  it('requires persisted setup-screen smoke proof only for replace-package capabilities readiness', () => {
    const readyWithoutProof = JSON.stringify({
      ok: true,
      mode: 'local-dream-integrated',
      models: [{ id: 'sdxl_base', downloaded: true }, { id: 'local-dream-active' }],
      upscalers: [{ id: 'upscaler_realistic', downloaded: true }],
      warnings: [],
    });

    expect(analyzeAndroidLocalDreamCapabilitiesPayload(readyWithoutProof, {
      packageMode: 'side-by-side',
    })).toMatchObject({
      ready: true,
      setupProofReady: true,
    });

    expect(analyzeAndroidLocalDreamCapabilitiesPayload(readyWithoutProof, {
      packageMode: 'replace',
    })).toMatchObject({
      ready: false,
      downloadedModels: 2,
      downloadedUpscalers: 1,
      setupProofReady: false,
      message: expect.stringContaining('Run Test API, Test Generate, and Test Upscale inside Signal Loom Android'),
    });

    expect(analyzeAndroidLocalDreamCapabilitiesPayload(JSON.stringify({
      ok: true,
      mode: 'local-dream-integrated',
      models: [{ id: 'sdxl_base', downloaded: true }, { id: 'local-dream-active' }],
      upscalers: [{ id: 'upscaler_realistic', downloaded: true }],
      setupProof: {
        apiSelfTestPassed: true,
        generateSmokePassed: true,
        upscaleSmokePassed: true,
      },
      warnings: [],
    }), {
      packageMode: 'replace',
    })).toMatchObject({
      ready: true,
      setupProofReady: true,
    });
  });

  it('marks old passed gate evidence stale when capabilities lack current one-app contract markers', () => {
    const report = {
      status: 'passed',
      ok: true,
      reportPath: '/repo/output/dev-dashboard/android-localdream-gate/latest.json',
      options: {
        packageMode: 'replace',
        forkDir: '/tmp/fork',
        adbSerial: 'R5C0000',
        androidSdkPath: '/opt/android-sdk',
        port: 8790,
        tokenConfigured: true,
      },
      steps: [
        {
          id: 'capabilities',
          label: 'Smoke /v1/capabilities',
          status: 'passed',
          command: 'curl /v1/capabilities',
          stdout: JSON.stringify({
            ok: true,
            mode: 'local-dream-integrated',
            models: [{ id: 'sdxl_base', downloaded: true }],
            upscalers: [{ id: 'upscaler_realistic', downloaded: true }],
          }),
        },
        { id: 'generate', label: 'Smoke /v1/generate', status: 'passed', command: 'curl /v1/generate', stdout: '{}' },
        { id: 'upscale', label: 'Smoke /v1/upscale', status: 'passed', command: 'curl /v1/upscale', stdout: '{}' },
      ],
    };

    const evidence = buildAndroidLocalDreamGateEvidence({ report });

    expect(evidence).toMatchObject({
      status: 'stale',
      ok: false,
      readyForLiveValidation: false,
      staleAgainstCapabilitiesContract: true,
      capabilitiesContract: {
        current: false,
        missingMarkers: expect.arrayContaining(['jobStatus', 'setupProof']),
      },
    });
    expect(evidence.warnings.join('\n')).toContain('/v1/capabilities report lacks current one-app contract marker(s): jobStatus, setupProof');
    expect(evidence.warnings.join('\n')).toContain('Exact rerun command: npm run gate:android-localdream -- --package-mode=replace --fork-dir=/tmp/fork --adb-serial=R5C0000 --android-sdk=/opt/android-sdk --port=8790 --token=<redacted>');
  });

  it('keeps passed gate evidence live-ready when capabilities include current one-app contract markers', () => {
    const report = {
      status: 'passed',
      ok: true,
      reportPath: '/repo/output/dev-dashboard/android-localdream-gate/latest.json',
      options: { packageMode: 'replace' },
      steps: [
        {
          id: 'capabilities',
          label: 'Smoke /v1/capabilities',
          status: 'passed',
          command: 'curl /v1/capabilities',
          stdout: JSON.stringify({
            ok: true,
            mode: 'local-dream-integrated',
            models: [{ id: 'sdxl_base', downloaded: true }],
            upscalers: [{ id: 'upscaler_realistic', downloaded: true }],
            jobStatus: { activeJobs: 0, completedJobs: 2, failedJobs: 0 },
            setupProof: {
              apiSelfTestPassed: true,
              generateSmokePassed: true,
              upscaleSmokePassed: true,
            },
          }),
        },
        { id: 'generate', label: 'Smoke /v1/generate', status: 'passed', command: 'curl /v1/generate', stdout: '{}' },
        { id: 'upscale', label: 'Smoke /v1/upscale', status: 'passed', command: 'curl /v1/upscale', stdout: '{}' },
      ],
    };

    const evidence = buildAndroidLocalDreamGateEvidence({ report });

    expect(evidence).toMatchObject({
      status: 'passed',
      ok: true,
      readyForLiveValidation: true,
      capabilitiesContract: {
        current: true,
        missingMarkers: [],
      },
    });
    expect(evidence.warnings || []).toEqual([]);
  });

  it('surfaces capabilities operation-readiness failure as the dashboard blocking step', () => {
    const steps = buildAndroidLocalDreamGatePlan({
      repoRoot: '/repo',
      packageMode: 'replace',
      token: 'pair',
    });
    const analysis = analyzeAndroidLocalDreamCapabilitiesPayload(JSON.stringify({
      ok: true,
      mode: 'local-dream-integrated',
      models: [],
      upscalers: [{ id: 'upscaler_realistic', downloaded: false }],
      warnings: ['No Local Dream image model is downloaded in this app.'],
    }));
    let report = createAndroidLocalDreamGateReport({
      options: { packageMode: 'replace' },
      steps,
      startedAt: new Date('2026-06-04T22:50:00.000Z'),
    });

    report = markAndroidLocalDreamGateStepFinished(report, 'capabilities', {
      exitCode: 1,
      stdout: '{"ok":true,"mode":"local-dream-integrated","models":[],"upscalers":[{"downloaded":false}],"warnings":["No Local Dream image model is downloaded in this app."]}',
      stderr: analysis.message,
      endedAt: new Date('2026-06-04T22:50:01.000Z'),
    });
    report = finalizeAndroidLocalDreamGateReport(report, {
      ok: false,
      endedAt: new Date('2026-06-04T22:50:02.000Z'),
    });

    const evidence = buildAndroidLocalDreamGateEvidence({ report });
    expect(evidence.blockingStep).toMatchObject({
      id: 'capabilities',
      status: 'failed',
    });
    expect(evidence.blockingStep.detail).toContain('Download at least one model and at least one upscaler');
    expect(evidence.blockingStep.detail).toContain('Mode: local-dream-integrated');
    expect(evidence.blockingStep.detail).toContain('Downloaded models: 0');
    expect(evidence.blockingStep.detail).toContain('Downloaded upscalers: 0');
    expect(evidence.blockingStep.detail).toContain('No Local Dream image model is downloaded in this app.');
    expect(evidence.blockingStep.detail).not.toContain('"models"');
  });

  it('adds an exact redacted gate rerun command to capabilities readiness failures', () => {
    const analysis = analyzeAndroidLocalDreamCapabilitiesPayload(JSON.stringify({
      ok: true,
      mode: 'local-dream-integrated',
      models: [],
      upscalers: [{ id: 'upscaler_realistic', downloaded: false }],
      warnings: ['No Local Dream image model is downloaded in this app.'],
    }));
    const detail = formatAndroidLocalDreamCapabilitiesReadinessFailure(analysis, {
      packageMode: 'replace',
      forkDir: '/tmp/fork',
      adbSerial: 'R5C0000',
      androidSdkPath: '/opt/android-sdk',
      port: 8790,
      token: 'secret-token',
    });

    expect(detail).toContain('Download at least one model and at least one upscaler');
    expect(detail).toContain('Exact rerun command: npm run gate:android-localdream -- --package-mode=replace --fork-dir=/tmp/fork --adb-serial=R5C0000 --android-sdk=/opt/android-sdk --port=8790 --token=<redacted>');
    expect(detail).not.toContain('secret-token');
  });
});

function readStepJsonPayload(step) {
  const payloadIndex = step.args.indexOf('--data') + 1;
  expect(payloadIndex).toBeGreaterThan(0);
  return JSON.parse(step.args[payloadIndex]);
}

function readPngDimensionsFromDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:image\/png;base64,(.+)$/);
  expect(match).toBeTruthy();

  const png = Buffer.from(match[1], 'base64');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}
