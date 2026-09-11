import path from 'node:path';
import { accessSync, constants, existsSync } from 'node:fs';

export const ANDROID_LOCALDREAM_GATE_RELATIVE_DIR = 'output/dev-dashboard/android-localdream-gate';
export const ANDROID_LOCALDREAM_GATE_SCHEMA_VERSION = 1;
export const ANDROID_LOCALDREAM_DEFAULT_PORT = 8788;
export const ANDROID_LOCALDREAM_DEFAULT_TOKEN = '';
export const ANDROID_LOCALDREAM_MAIN_ACTIVITY_CLASS = 'io.github.xororz.localdream.MainActivity';
export const ANDROID_LOCALDREAM_UPSCALE_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAmUlEQVR42u3QQRHAIADAMMAQ0lCOhiEjjzUKep373G/82NIBWgN0gNYAHaA1QAdoDdABWgN0gNYAHaA1QAdoDdABWgN0gNYAHaA1QAdoDdABWgN0gNYAHaA1QAdoDdABWgN0gNYAHaA1QAdoDdABWgN0gNYAHaA1QAdoDdABWgN0gNYAHaA1QAdoDdABWgN0gNYAHaA1QAdoD3VtAwpyw5uQAAAAAElFTkSuQmCC';
const ANDROID_LOCALDREAM_CAPABILITIES_CURL_ARGS = ['--retry', '10', '--retry-delay', '1', '--retry-all-errors', '--max-time', '15'];
const ANDROID_LOCALDREAM_GENERATE_CURL_ARGS = ['--retry', '2', '--retry-delay', '2', '--retry-all-errors', '--max-time', '240'];
const ANDROID_LOCALDREAM_UPSCALE_CURL_ARGS = ['--retry', '2', '--retry-delay', '2', '--retry-all-errors', '--max-time', '180'];

export function buildAndroidLocalDreamGatePaths(repoRoot) {
  const directory = path.join(repoRoot, ANDROID_LOCALDREAM_GATE_RELATIVE_DIR);
  return {
    directory,
    latest: path.join(directory, 'latest.json'),
  };
}

export function parseAndroidLocalDreamGateArgs(argv = [], env = process.env) {
  const options = {
    dryRun: false,
    continueOnError: false,
    prepare: false,
    packageMode: normalizePackageMode(env.SIGNAL_LOOM_LOCALDREAM_PACKAGE_MODE || 'side-by-side'),
    forkDir: String(env.SIGNAL_LOOM_LOCALDREAM_FORK_DIR || '').trim(),
    adbSerial: String(env.ADB_SERIAL || env.ANDROID_SERIAL || '').trim(),
    port: positiveInteger(env.SIGNAL_LOOM_ANDROID_ACCELERATOR_PORT, ANDROID_LOCALDREAM_DEFAULT_PORT, 'SIGNAL_LOOM_ANDROID_ACCELERATOR_PORT'),
    token: String(env.SIGNAL_LOOM_ANDROID_ACCELERATOR_TOKEN || ANDROID_LOCALDREAM_DEFAULT_TOKEN).trim(),
    apkPath: String(env.SIGNAL_LOOM_LOCALDREAM_APK_PATH || '').trim(),
    androidSdkPath: String(env.SIGNAL_LOOM_ANDROID_SDK_PATH || env.ANDROID_HOME || env.ANDROID_SDK_ROOT || '').trim(),
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--continue-on-error') {
      options.continueOnError = true;
    } else if (arg === '--prepare') {
      options.prepare = true;
    } else if (arg.startsWith('--package-mode=')) {
      options.packageMode = normalizePackageMode(arg.slice('--package-mode='.length));
    } else if (arg.startsWith('--fork-dir=')) {
      options.forkDir = arg.slice('--fork-dir='.length).trim();
    } else if (arg.startsWith('--adb-serial=')) {
      options.adbSerial = arg.slice('--adb-serial='.length).trim();
    } else if (arg.startsWith('--port=')) {
      options.port = positiveInteger(arg.slice('--port='.length), ANDROID_LOCALDREAM_DEFAULT_PORT, '--port');
    } else if (arg.startsWith('--token=')) {
      options.token = arg.slice('--token='.length).trim();
    } else if (arg.startsWith('--apk=')) {
      options.apkPath = arg.slice('--apk='.length).trim();
    } else if (arg.startsWith('--android-sdk=')) {
      options.androidSdkPath = arg.slice('--android-sdk='.length).trim();
    } else {
      throw new Error(`Unknown Android Local Dream gate option: ${arg}`);
    }
  }

  return options;
}

export function resolveAndroidLocalDreamGateSdkPath({
  env = process.env,
  pathExists = existsSync,
  pathWritable = isWritableDirectory,
} = {}) {
  const home = String(env.HOME || '').trim();
  const explicitCandidates = uniqueNonEmpty([
    env.SIGNAL_LOOM_ANDROID_SDK_PATH,
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
  ]);
  const commonCandidates = uniqueNonEmpty([
    '/opt/android-sdk',
    home ? path.join(home, 'android-sdk') : '',
    '/tmp/sl-android-sdk',
  ]);

  for (const candidate of explicitCandidates) {
    if (isAndroidSdkCandidate(candidate, pathExists)) {
      return candidate;
    }
  }

  const validCommonCandidates = commonCandidates.filter((candidate) => isAndroidSdkCandidate(candidate, pathExists));
  return validCommonCandidates.find((candidate) => safelyCheckPath(candidate, pathWritable))
    || validCommonCandidates[0]
    || '';
}

export function buildAndroidLocalDreamGatePlan({
  repoRoot,
  forkDir,
  packageMode,
  prepare = false,
  port = ANDROID_LOCALDREAM_DEFAULT_PORT,
  token = ANDROID_LOCALDREAM_DEFAULT_TOKEN,
  adbSerial = '',
  apkPath = '',
  androidSdkPath = '',
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required for Android Local Dream gate planning.');
  const resolvedForkDir = forkDir || path.join(repoRoot, 'companions/android-local-dream-fork/build/local-dream-signal-loom');
  const scriptPath = path.join(repoRoot, 'companions/android-local-dream-fork/prepare-signal-loom-localdream.sh');
  const mode = normalizePackageMode(packageMode || 'side-by-side');
  const packageId = mode === 'replace' ? 'io.github.xororz.localdream' : 'io.github.xororz.localdream.signalloom';
  const resolvedApkPath = apkPath || buildAndroidLocalDreamGateApkPath(resolvedForkDir, mode);
  const adbPrefix = adbSerial ? ['-s', adbSerial] : [];
  const androidSdkEnv = androidSdkPath
    ? {
        ANDROID_HOME: androidSdkPath,
        ANDROID_SDK_ROOT: androidSdkPath,
      }
    : undefined;
  const baseUrl = `http://127.0.0.1:${port}`;
  const authHeader = `Authorization: Bearer ${token}`;
  const redactedAuthHeader = 'Authorization: Bearer <redacted>';
  const steps = [
    commandStep({
      id: 'doctor',
      label: 'Local Dream fork doctor',
      executable: scriptPath,
      args: ['--doctor', '--package-mode', mode, resolvedForkDir],
    }),
  ];

  if (prepare) {
    steps.push(commandStep({
      id: 'prepare',
      label: 'Prepare Local Dream fork',
      executable: scriptPath,
      args: ['--package-mode', mode, resolvedForkDir],
    }));
  }

  steps.push(
    commandStep({
      id: 'verify-prepared',
      label: 'Verify prepared Local Dream fork',
      executable: scriptPath,
      args: ['--verify-prepared', '--package-mode', mode, resolvedForkDir],
    }),
    commandStep({
      id: 'gradle-build',
      label: 'Build Local Dream Signal Loom APK',
      executable: './gradlew',
      args: [':app:assembleFilterDebug', '--no-daemon'],
      displayPrefix: androidSdkEnv
        ? [`ANDROID_HOME=${androidSdkPath}`, `ANDROID_SDK_ROOT=${androidSdkPath}`]
        : [],
      env: androidSdkEnv,
      cwd: resolvedForkDir,
    }),
    commandStep({
      id: 'adb-install',
      label: 'Install Local Dream Signal Loom APK',
      executable: 'adb',
      args: [...adbPrefix, 'install', '-r', resolvedApkPath],
    }),
    commandStep({
      id: 'start-server',
      label: 'Start Signal Loom gateway through app activity',
      executable: 'adb',
      args: [
        ...adbPrefix,
        'shell',
        'am',
        'start',
        '-a',
        'io.github.xororz.localdream.signalloom.START',
        '-n',
        `${packageId}/${ANDROID_LOCALDREAM_MAIN_ACTIVITY_CLASS}`,
      ],
    }),
    commandStep({
      id: 'adb-forward',
      label: 'Forward Android accelerator port',
      executable: 'adb',
      args: [...adbPrefix, 'forward', `tcp:${port}`, `tcp:${port}`],
    }),
    commandStep({
      id: 'capabilities',
      label: 'Smoke /v1/capabilities',
      executable: 'curl',
      args: ['-fsS', ...ANDROID_LOCALDREAM_CAPABILITIES_CURL_ARGS, '-H', authHeader, `${baseUrl}/v1/capabilities`],
      displayArgs: ['-fsS', ...ANDROID_LOCALDREAM_CAPABILITIES_CURL_ARGS, '-H', redactedAuthHeader, `${baseUrl}/v1/capabilities`],
    }),
    commandStep({
      id: 'generate',
      label: 'Smoke /v1/generate',
      executable: 'curl',
      args: [
        '-fsS',
        ...ANDROID_LOCALDREAM_GENERATE_CURL_ARGS,
        '-H',
        authHeader,
        '-H',
        'Content-Type: application/json',
        '-X',
        'POST',
        '--data',
        JSON.stringify({
          modelId: 'local-dream-active',
          prompt: 'Signal Loom Android gate smoke image',
          width: 256,
          height: 256,
          steps: 4,
          outputFormat: 'png',
        }),
        `${baseUrl}/v1/generate`,
      ],
      displayArgs: [
        '-fsS',
        ...ANDROID_LOCALDREAM_GENERATE_CURL_ARGS,
        '-H',
        redactedAuthHeader,
        '-H',
        'Content-Type: application/json',
        '-X',
        'POST',
        '--data',
        JSON.stringify({
          modelId: 'local-dream-active',
          prompt: 'Signal Loom Android gate smoke image',
          width: 256,
          height: 256,
          steps: 4,
          outputFormat: 'png',
        }),
        `${baseUrl}/v1/generate`,
      ],
    }),
    commandStep({
      id: 'upscale',
      label: 'Smoke /v1/upscale',
      executable: 'curl',
      args: [
        '-fsS',
        ...ANDROID_LOCALDREAM_UPSCALE_CURL_ARGS,
        '-H',
        authHeader,
        '-H',
        'Content-Type: application/json',
        '-X',
        'POST',
        '--data',
        JSON.stringify({
          image: ANDROID_LOCALDREAM_UPSCALE_PNG_DATA_URL,
          targetWidthPx: 256,
          targetHeightPx: 256,
          upscalerId: 'upscaler_realistic',
          outputFormat: 'png',
        }),
        `${baseUrl}/v1/upscale`,
      ],
      displayArgs: [
        '-fsS',
        ...ANDROID_LOCALDREAM_UPSCALE_CURL_ARGS,
        '-H',
        redactedAuthHeader,
        '-H',
        'Content-Type: application/json',
        '-X',
        'POST',
        '--data',
        JSON.stringify({
          image: ANDROID_LOCALDREAM_UPSCALE_PNG_DATA_URL,
          targetWidthPx: 256,
          targetHeightPx: 256,
          upscalerId: 'upscaler_realistic',
          outputFormat: 'png',
        }),
        `${baseUrl}/v1/upscale`,
      ],
    }),
  );

  return steps;
}

export function buildAndroidLocalDreamGateApkPath(forkDir, packageMode = 'side-by-side') {
  const mode = normalizePackageMode(packageMode);
  const suffix = mode === 'replace' ? 'signaloom-replace-debug' : 'signaloom-debug';
  return path.join(forkDir, `app/build/outputs/apk/filter/debug/LocalDream_armv8a_2.5.3_with_filter-${suffix}.apk`);
}

export function parseAndroidLocalDreamPairingTokenXml(xml) {
  const match = String(xml || '').match(/<string\s+name=["']pairing_token["']>([^<]+)<\/string>/);
  return match ? decodeXmlText(match[1]).trim() : '';
}

export function withAndroidLocalDreamGateAuthToken(step, token) {
  const authHeader = `Authorization: Bearer ${String(token || '').trim()}`;
  return {
    ...step,
    args: Array.isArray(step?.args)
      ? step.args.map((arg) => (String(arg).startsWith('Authorization: Bearer ') ? authHeader : arg))
      : step?.args,
  };
}

export function createAndroidLocalDreamGateReport({
  options = {},
  steps = [],
  startedAt = new Date(),
} = {}) {
  const startedAtIso = toIsoString(startedAt);
  return {
    schemaVersion: ANDROID_LOCALDREAM_GATE_SCHEMA_VERSION,
    status: 'running',
    ok: false,
    startedAt: startedAtIso,
    endedAt: null,
    durationMs: null,
    options: normalizeOptions(options),
    steps: steps.map((step, index) => ({
      index: index + 1,
      id: step.id,
      label: step.label,
      command: step.command,
      cwd: step.cwd || null,
      status: options.dryRun ? 'planned' : 'pending',
      exitCode: null,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      stdout: '',
      stderr: '',
    })),
  };
}

export function markAndroidLocalDreamGateStepStarted(report, stepId, startedAt = new Date()) {
  const startedAtIso = toIsoString(startedAt);
  return updateStep(report, stepId, (step) => ({
    ...step,
    status: 'running',
    startedAt: startedAtIso,
    endedAt: null,
    durationMs: null,
    exitCode: null,
  }));
}

export function markAndroidLocalDreamGateStepFinished(report, stepId, {
  exitCode,
  stdout = '',
  stderr = '',
  endedAt = new Date(),
} = {}) {
  const endedAtIso = toIsoString(endedAt);
  return updateStep(report, stepId, (step) => ({
    ...step,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    endedAt: endedAtIso,
    durationMs: step.startedAt
      ? Math.max(0, new Date(endedAtIso).getTime() - new Date(step.startedAt).getTime())
      : null,
    stdout: compactOutput(summarizeAndroidLocalDreamGateOutput(stepId, stdout)),
    stderr: compactOutput(stderr),
  }));
}

export function summarizeAndroidLocalDreamGateOutput(stepId, value) {
  const text = String(value ?? '').trim();
  if (!text) return '';

  if (stepId === 'capabilities') {
    const capabilitiesSummary = summarizeCapabilitiesOutput(text);
    if (capabilitiesSummary) return capabilitiesSummary;
  }

  const jsonSummary = summarizeJsonMediaOutput(text);
  if (jsonSummary) return jsonSummary;

  if (stepId === 'upscale' && hasBinaryControlCharacters(text)) {
    return `[binary media output omitted; ${Buffer.byteLength(text)} bytes captured]`;
  }

  return text;
}

export function analyzeAndroidLocalDreamCapabilitiesPayload(value, {
  packageMode = 'side-by-side',
} = {}) {
  const mode = normalizePackageMode(packageMode || 'side-by-side');
  const requiresSetupProof = mode === 'replace';
  const text = String(value ?? '').trim();
  if (!text) {
    return {
      ready: false,
      downloadedModels: 0,
      downloadedUpscalers: 0,
      setupProofReady: !requiresSetupProof,
      warnings: ['Capabilities response was empty.'],
      message: 'Signal Loom Android capabilities response was empty; cannot verify downloaded model/upscaler readiness.',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ready: false,
      downloadedModels: 0,
      downloadedUpscalers: 0,
      setupProofReady: !requiresSetupProof,
      warnings: [],
      message: `Signal Loom Android capabilities response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const models = Array.isArray(parsed.models) ? parsed.models : [];
  const upscalers = Array.isArray(parsed.upscalers) ? parsed.upscalers : [];
  const downloadedModels = models.filter(isDownloadedCapabilitiesModel).length;
  const downloadedUpscalers = upscalers.filter((upscaler) => upscaler?.downloaded === true).length;
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map((warning) => String(warning)).filter(Boolean)
    : [];
  const setupProof = parsed.setupProof && typeof parsed.setupProof === 'object' && !Array.isArray(parsed.setupProof)
    ? parsed.setupProof
    : {};
  const setupProofReady = !requiresSetupProof || (
    setupProof.apiSelfTestPassed === true
    && setupProof.generateSmokePassed === true
    && setupProof.upscaleSmokePassed === true
  );

  if (downloadedModels > 0 && downloadedUpscalers > 0 && setupProofReady) {
    return {
      ready: true,
      downloadedModels,
      downloadedUpscalers,
      setupProofReady,
      warnings,
      message: `Capabilities operation readiness passed: ${downloadedModels} downloaded model(s), ${downloadedUpscalers} downloaded upscaler(s).`,
    };
  }

  if (downloadedModels > 0 && downloadedUpscalers > 0 && !setupProofReady) {
    return {
      ready: false,
      downloadedModels,
      downloadedUpscalers,
      setupProofReady,
      warnings,
      message: `Android Local Dream replace-package setup proof is incomplete. Run Test API, Test Generate, and Test Upscale inside Signal Loom Android, then rerun npm run gate:android-localdream. ${formatSetupProofStatus(setupProof)}`,
    };
  }

  let action;
  if (downloadedModels <= 0 && downloadedUpscalers <= 0) {
    action = 'Download at least one model and at least one upscaler inside Signal Loom Android.';
  } else if (downloadedModels <= 0) {
    action = 'Download at least one model inside Signal Loom Android.';
  } else {
    action = 'Download at least one upscaler inside Signal Loom Android.';
  }
  const warningSuffix = warnings.length > 0 ? ` Reported warning(s): ${warnings.join(' ')}` : '';

  return {
    ready: false,
    downloadedModels,
    downloadedUpscalers,
    setupProofReady,
    warnings,
    message: `Android Local Dream is not ready for operation smoke tests. ${action} Complete the first-run setup screen, run Test API, Test Generate, and Test Upscale, then rerun npm run gate:android-localdream.${warningSuffix}`,
  };
}

export function finalizeAndroidLocalDreamGateReport(report, {
  endedAt = new Date(),
  ok,
} = {}) {
  const endedAtIso = toIsoString(endedAt);
  const steps = report.steps.map((step) => step.status === 'running'
    ? {
        ...step,
        status: 'failed',
        endedAt: endedAtIso,
        durationMs: step.startedAt ? Math.max(0, new Date(endedAtIso).getTime() - new Date(step.startedAt).getTime()) : null,
      }
    : step);
  const failed = steps.some((step) => step.status === 'failed');
  const allPlanned = steps.every((step) => step.status === 'planned');
  const passed = ok ?? (!failed && steps.every((step) => step.status === 'passed' || step.status === 'planned'));

  return {
    ...report,
    status: allPlanned ? 'planned' : passed ? 'passed' : 'failed',
    ok: passed,
    endedAt: endedAtIso,
    durationMs: report.startedAt
      ? Math.max(0, new Date(endedAtIso).getTime() - new Date(report.startedAt).getTime())
      : null,
    steps,
  };
}

export function formatAndroidLocalDreamCapabilitiesReadinessFailure(analysis, options = {}) {
  const message = String(analysis?.message || 'Android Local Dream is not ready for operation smoke tests.').trim();
  const rerunCommand = buildAndroidLocalDreamGateRerunCommand(options);
  return [
    message,
    rerunCommand ? `Exact rerun command: ${rerunCommand}` : '',
  ].filter(Boolean).join('\n');
}

export function buildAndroidLocalDreamGateEvidence({ report, reportPath = '', error } = {}) {
  if (!report) {
    return {
      status: error ? 'error' : 'not-run',
      error,
      reportPath,
      readyForLiveValidation: false,
      steps: [],
    };
  }

  const steps = Array.isArray(report.steps)
    ? report.steps.map((step) => ({
        id: step.id,
        label: step.label,
        status: step.status,
        detail: step.status === 'failed'
          ? failedStepDetail(step)
          : step.stdout || '',
        command: step.command,
        durationMs: step.durationMs,
      }))
    : [];
  const blockingStep = steps.find((step) => step.status === 'failed');
  const capabilitiesContract = analyzeAndroidLocalDreamGateCapabilitiesContract(report);
  const reportClaimsLiveReady = report.status === 'passed';
  const contractStale = reportClaimsLiveReady && !capabilitiesContract.current;
  const warnings = Array.isArray(report.warnings) ? [...report.warnings] : [];
  if (contractStale) {
    const rerunCommand = buildAndroidLocalDreamGateRerunCommand(report.options || {});
    warnings.push([
      `Android Local Dream gate evidence is stale: /v1/capabilities report lacks current one-app contract marker(s): ${capabilitiesContract.missingMarkers.join(', ')}. Rerun npm run gate:android-localdream with the current Signal Loom Android companion.`,
      rerunCommand ? `Exact rerun command: ${rerunCommand}` : '',
    ].filter(Boolean).join('\n'));
  }
  const readyForLiveValidation = reportClaimsLiveReady && !contractStale;

  return {
    status: contractStale ? 'stale' : report.status || 'unknown',
    ok: contractStale ? false : Boolean(report.ok),
    reportPath: report.reportPath || reportPath,
    options: report.options || {},
    readyForLiveValidation,
    blockingStep,
    warnings: uniqueStrings(warnings),
    staleAgainstCapabilitiesContract: contractStale,
    capabilitiesContract,
    steps,
  };
}

export function analyzeAndroidLocalDreamGateCapabilitiesContract(report = {}) {
  const capabilitiesStep = Array.isArray(report.steps)
    ? report.steps.find((step) => step?.id === 'capabilities')
    : null;
  const markerState = resolveCapabilitiesContractMarkers(capabilitiesStep?.stdout || '');
  const missingMarkers = Object.entries(markerState)
    .filter(([, present]) => !present)
    .map(([marker]) => marker);

  return {
    current: missingMarkers.length === 0,
    missingMarkers,
  };
}

function commandStep({ id, label, executable, args = [], displayArgs = args, displayPrefix = [], env, cwd }) {
  return {
    id,
    label,
    executable,
    args,
    env,
    cwd,
    command: [...displayPrefix, executable, ...displayArgs].join(' '),
  };
}

function failedStepDetail(step) {
  const parts = [step.stderr, step.stdout]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  const distinct = [];
  for (const part of parts) {
    if (!distinct.includes(part)) distinct.push(part);
  }
  return distinct.join('\n') || `Step ${step.id} failed.`;
}

function updateStep(report, stepId, update) {
  let found = false;
  const steps = report.steps.map((step) => {
    if (step.id !== stepId) return step;
    found = true;
    return update(step);
  });

  if (!found) {
    throw new Error(`Android Local Dream gate report does not contain step "${stepId}".`);
  }

  return { ...report, steps };
}

function normalizeOptions(options) {
  return {
    dryRun: Boolean(options.dryRun),
    continueOnError: Boolean(options.continueOnError),
    prepare: Boolean(options.prepare),
    packageMode: normalizePackageMode(options.packageMode || 'side-by-side'),
    forkDir: String(options.forkDir || '').trim(),
    adbSerial: String(options.adbSerial || '').trim(),
    port: positiveInteger(options.port, ANDROID_LOCALDREAM_DEFAULT_PORT, 'port'),
    tokenConfigured: Boolean(String(options.token || '').trim()),
    apkPath: String(options.apkPath || '').trim(),
    androidSdkPath: String(options.androidSdkPath || '').trim(),
  };
}

function buildAndroidLocalDreamGateRerunCommand(options = {}) {
  const args = [
    `--package-mode=${normalizePackageMode(options.packageMode || 'side-by-side')}`,
  ];
  if (options.forkDir) args.push(`--fork-dir=${String(options.forkDir).trim()}`);
  if (options.adbSerial) args.push(`--adb-serial=${String(options.adbSerial).trim()}`);
  if (options.androidSdkPath) args.push(`--android-sdk=${String(options.androidSdkPath).trim()}`);
  if (options.apkPath) args.push(`--apk=${String(options.apkPath).trim()}`);
  if (positiveInteger(options.port, ANDROID_LOCALDREAM_DEFAULT_PORT, 'port') !== ANDROID_LOCALDREAM_DEFAULT_PORT) {
    args.push(`--port=${positiveInteger(options.port, ANDROID_LOCALDREAM_DEFAULT_PORT, 'port')}`);
  }
  if (String(options.token || '').trim() || options.tokenConfigured === true) args.push('--token=<redacted>');

  return ['npm', 'run', 'gate:android-localdream', '--', ...args.map(quoteShellArgIfNeeded)].join(' ');
}

function quoteShellArgIfNeeded(value) {
  const text = String(value);
  if (!/[\s'"`$\\]/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function normalizePackageMode(value) {
  const mode = String(value || '').trim();
  if (mode === 'side-by-side' || mode === 'replace') return mode;
  throw new Error(`Invalid Android Local Dream package mode "${value}". Use side-by-side or replace.`);
}

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function uniqueNonEmpty(candidates) {
  const seen = new Set();
  return candidates
    .map((candidate) => String(candidate || '').trim())
    .filter((candidate) => {
      if (!candidate || seen.has(candidate)) return false;
      seen.add(candidate);
      return true;
    });
}

function isAndroidSdkCandidate(candidate, pathExists) {
  return safelyCheckPath(path.join(candidate, 'platforms'), pathExists) || safelyCheckPath(candidate, pathExists);
}

function safelyCheckPath(candidate, check) {
  try {
    return Boolean(check(candidate));
  } catch {
    return false;
  }
}

function isWritableDirectory(candidate) {
  accessSync(candidate, constants.W_OK);
  return true;
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function summarizeJsonMediaOutput(text) {
  if (!text.startsWith('{')) return '';

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.image !== 'string' || parsed.image.length <= 256) return '';

    return JSON.stringify({
      ...parsed,
      image: `<base64 image omitted; ${parsed.image.length} chars>`,
    });
  } catch {
    return '';
  }
}

function summarizeCapabilitiesOutput(text) {
  if (!text.startsWith('{')) return '';

  try {
    const parsed = JSON.parse(text);
    const analysis = analyzeAndroidLocalDreamCapabilitiesPayload(text);
    const lines = [
      analysis.message,
      `Mode: ${parsed.mode || 'unknown'}`,
      `Downloaded models: ${analysis.downloadedModels}`,
      `Downloaded upscalers: ${analysis.downloadedUpscalers}`,
    ];
    if (parsed.jobStatus && typeof parsed.jobStatus === 'object' && !Array.isArray(parsed.jobStatus)) {
      lines.push('Job status: present');
    }
    if (parsed.setupProof && typeof parsed.setupProof === 'object' && !Array.isArray(parsed.setupProof)) {
      lines.push(`Setup proof: ${formatSetupProofStatus(parsed.setupProof)}`);
    }
    if (analysis.warnings.length > 0) {
      lines.push(`Warnings: ${analysis.warnings.join(' ')}`);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

function formatSetupProofStatus(setupProof) {
  const passed = (label, value) => `${label} ${value === true ? 'passed' : 'missing'}`;
  return [
    passed('API self-test', setupProof?.apiSelfTestPassed),
    passed('Generate smoke', setupProof?.generateSmokePassed),
    passed('Upscale smoke', setupProof?.upscaleSmokePassed),
  ].join(', ');
}

function hasBinaryControlCharacters(text) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
}

function isDownloadedCapabilitiesModel(model) {
  if (!model || typeof model !== 'object') return false;
  if (model.downloaded === true) return true;
  return model.id === 'local-dream-active';
}

function resolveCapabilitiesContractMarkers(value) {
  const text = String(value ?? '').trim();
  const empty = {
    'local-dream-integrated': false,
    models: false,
    upscalers: false,
    jobStatus: false,
    setupProof: false,
  };
  if (!text) return empty;

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return {
        'local-dream-integrated': parsed?.mode === 'local-dream-integrated',
        models: Array.isArray(parsed?.models),
        upscalers: Array.isArray(parsed?.upscalers),
        jobStatus: parsed?.jobStatus && typeof parsed.jobStatus === 'object' && !Array.isArray(parsed.jobStatus),
        setupProof: parsed?.setupProof && typeof parsed.setupProof === 'object' && !Array.isArray(parsed.setupProof),
      };
    } catch {
      return empty;
    }
  }

  return {
    'local-dream-integrated': text.includes('Mode: local-dream-integrated') || text.includes('local-dream-integrated'),
    models: /Downloaded models:\s*\d+/i.test(text),
    upscalers: /Downloaded upscalers:\s*\d+/i.test(text),
    jobStatus: /Job status:\s*present/i.test(text),
    setupProof: /Setup proof:/i.test(text),
  };
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function compactOutput(value, maxLength = 4000) {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
