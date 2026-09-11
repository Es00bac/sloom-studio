import path from 'node:path';
import {
  ANDROID_LOCALDREAM_DEFAULT_PORT,
  ANDROID_LOCALDREAM_DEFAULT_TOKEN,
  buildAndroidLocalDreamGateApkPath,
  buildAndroidLocalDreamGatePaths,
} from './android-localdream-gate-lib.mjs';

export const ANDROID_LOCALDREAM_PACKAGE_ID = 'io.github.xororz.localdream';
export const ANDROID_LOCALDREAM_SETUP_RELATIVE_DIR = 'output/dev-dashboard/android-localdream-setup';
export const ANDROID_LOCALDREAM_SETUP_SCHEMA_VERSION = 1;

export function buildAndroidLocalDreamSetupPaths(repoRoot) {
  const directory = path.join(repoRoot, ANDROID_LOCALDREAM_SETUP_RELATIVE_DIR);
  return {
    directory,
    latest: path.join(directory, 'latest.json'),
    linkedGateLatest: buildAndroidLocalDreamGatePaths(repoRoot).latest,
  };
}

export function parseAndroidLocalDreamSetupArgs(argv = [], env = process.env) {
  const options = {
    dryRun: false,
    sourceOnly: false,
    packageMode: normalizePackageMode(env.SIGNAL_LOOM_LOCALDREAM_PACKAGE_MODE || 'side-by-side'),
    forkDir: String(env.SIGNAL_LOOM_LOCALDREAM_FORK_DIR || '').trim(),
    adbSerial: String(env.ADB_SERIAL || env.ANDROID_SERIAL || '').trim(),
    androidSdkPath: String(env.SIGNAL_LOOM_ANDROID_SDK_PATH || env.ANDROID_HOME || env.ANDROID_SDK_ROOT || '').trim(),
    token: String(env.SIGNAL_LOOM_ANDROID_ACCELERATOR_TOKEN || ANDROID_LOCALDREAM_DEFAULT_TOKEN).trim(),
    port: positiveInteger(env.SIGNAL_LOOM_ANDROID_ACCELERATOR_PORT, ANDROID_LOCALDREAM_DEFAULT_PORT, 'SIGNAL_LOOM_ANDROID_ACCELERATOR_PORT'),
    confirmReplaceUninstall: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--source-only') {
      options.sourceOnly = true;
    } else if (arg === '--side-by-side') {
      options.packageMode = 'side-by-side';
    } else if (arg === '--replace-package') {
      options.packageMode = 'replace';
    } else if (arg === '--confirm-replace-uninstall') {
      options.confirmReplaceUninstall = true;
    } else if (arg === '--package-mode') {
      options.packageMode = normalizePackageMode(readNextOptionValue(argv, ++index, arg));
    } else if (arg === '--fork-dir') {
      options.forkDir = readNextOptionValue(argv, ++index, arg).trim();
    } else if (arg === '--adb-serial') {
      options.adbSerial = readNextOptionValue(argv, ++index, arg).trim();
    } else if (arg === '--android-sdk') {
      options.androidSdkPath = readNextOptionValue(argv, ++index, arg).trim();
    } else if (arg === '--token') {
      options.token = readNextOptionValue(argv, ++index, arg).trim();
    } else if (arg === '--port') {
      options.port = positiveInteger(readNextOptionValue(argv, ++index, arg), ANDROID_LOCALDREAM_DEFAULT_PORT, '--port');
    } else if (arg.startsWith('--package-mode=')) {
      options.packageMode = normalizePackageMode(arg.slice('--package-mode='.length));
    } else if (arg.startsWith('--fork-dir=')) {
      options.forkDir = arg.slice('--fork-dir='.length).trim();
    } else if (arg.startsWith('--adb-serial=')) {
      options.adbSerial = arg.slice('--adb-serial='.length).trim();
    } else if (arg.startsWith('--android-sdk=')) {
      options.androidSdkPath = arg.slice('--android-sdk='.length).trim();
    } else if (arg.startsWith('--token=')) {
      options.token = arg.slice('--token='.length).trim();
    } else if (arg.startsWith('--port=')) {
      options.port = positiveInteger(arg.slice('--port='.length), ANDROID_LOCALDREAM_DEFAULT_PORT, '--port');
    } else {
      throw new Error(`Unknown Android Local Dream setup option: ${arg}`);
    }
  }

  return options;
}

export function buildAndroidLocalDreamSetupPlan({
  repoRoot,
  packageMode = 'side-by-side',
  forkDir = '',
  adbSerial = '',
  androidSdkPath = '',
  token = '',
  port = ANDROID_LOCALDREAM_DEFAULT_PORT,
  confirmReplaceUninstall = false,
  sourceOnly = false,
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required for Android Local Dream setup planning.');

  const mode = normalizePackageMode(packageMode);
  const resolvedForkDir = forkDir || path.join(repoRoot, 'companions/android-local-dream-fork/build/local-dream-signal-loom');
  const gateScript = path.join(repoRoot, 'scripts/android-localdream-gate.mjs');
  const prepareScript = path.join(repoRoot, 'companions/android-local-dream-fork/prepare-signal-loom-localdream.sh');
  const adbPrefix = adbSerial ? ['-s', adbSerial] : [];
  const gateCommonArgs = [
    gateScript,
    '--package-mode=' + mode,
    ...(forkDir ? [`--fork-dir=${forkDir}`] : []),
    ...(adbSerial ? [`--adb-serial=${adbSerial}`] : []),
    ...(androidSdkPath ? [`--android-sdk=${androidSdkPath}`] : []),
    ...(token ? [`--token=${token}`] : []),
    ...(port !== ANDROID_LOCALDREAM_DEFAULT_PORT ? [`--port=${port}`] : []),
  ];

  if (sourceOnly) {
    return {
      status: 'ready',
      packageMode: mode,
      sourceOnly: true,
      blocked: false,
      warnings: [
        'Source-only setup does not use ADB, build an APK, install, start, or live-validate the Android companion.',
        'Connect an authorized phone and rerun normal setup before claiming build/install/live validation readiness.',
      ],
      steps: [
        commandStep({
          id: 'prepare-source-only',
          label: 'Prepare the source-only Signal Loom Local Dream fork',
          executable: prepareScript,
          args: ['--source-only', '--package-mode', mode, resolvedForkDir],
        }),
        commandStep({
          id: 'verify-source-only',
          label: 'Verify the source-only Signal Loom Local Dream fork',
          executable: prepareScript,
          args: ['--verify-prepared', '--source-only', '--package-mode', mode, resolvedForkDir],
        }),
      ],
    };
  }

  if (mode === 'replace' && !confirmReplaceUninstall) {
    return {
      status: 'needs-confirmation',
      packageMode: mode,
      blocked: true,
      warnings: [
        'Replace-package setup uninstalls the Play Store Local Dream app and deletes its private downloaded model/upscaler data.',
        'Rerun with --confirm-replace-uninstall only after the user has approved the destructive migration and understands models/upscalers must be redownloaded inside Signal Loom Android.',
      ],
      steps: [],
    };
  }

  if (mode === 'side-by-side') {
    return {
      status: 'ready',
      packageMode: mode,
      blocked: false,
      warnings: [],
      steps: [
        commandStep({
          id: 'prepare-and-gate',
          label: 'Prepare, install, start, and validate the side-by-side Signal Loom Local Dream app',
          executable: 'node',
          args: [
            gateScript,
            '--prepare',
            '--package-mode=side-by-side',
            ...(forkDir ? [`--fork-dir=${forkDir}`] : []),
            ...(adbSerial ? [`--adb-serial=${adbSerial}`] : []),
            ...(androidSdkPath ? [`--android-sdk=${androidSdkPath}`] : []),
            ...(token ? [`--token=${token}`] : []),
            ...(port !== ANDROID_LOCALDREAM_DEFAULT_PORT ? [`--port=${port}`] : []),
          ],
          displayArgs: [
            gateScript,
            '--prepare',
            '--package-mode=side-by-side',
            ...(forkDir ? [`--fork-dir=${forkDir}`] : []),
            ...(adbSerial ? [`--adb-serial=${adbSerial}`] : []),
            ...(androidSdkPath ? [`--android-sdk=${androidSdkPath}`] : []),
            ...(token ? ['--token=<redacted>'] : []),
            ...(port !== ANDROID_LOCALDREAM_DEFAULT_PORT ? [`--port=${port}`] : []),
          ],
        }),
      ],
    };
  }

  const replaceApkPath = buildAndroidLocalDreamGateApkPath(resolvedForkDir, 'replace');
  return {
    status: 'ready',
    packageMode: mode,
    blocked: false,
    warnings: [
      'Replace-package setup will uninstall the Play Store Local Dream app before installing the Signal Loom build.',
      'Model and upscaler files must be downloaded again inside the replacement Signal Loom Android app.',
      'Run npm run gate:android-localdream after the manual checkpoint passes.',
    ],
    steps: [
      commandStep({
        id: 'prepare-replace',
        label: 'Prepare the replace-package Signal Loom Local Dream fork while Play Store Local Dream is still installed',
        executable: prepareScript,
        args: ['--replace-package', resolvedForkDir],
      }),
      commandStep({
        id: 'build-replace',
        label: 'Build the replace-package Signal Loom Local Dream APK',
        executable: './gradlew',
        args: [':app:assembleFilterDebug', '--no-daemon'],
        cwd: resolvedForkDir,
        env: androidSdkPath ? {
          ANDROID_HOME: androidSdkPath,
          ANDROID_SDK_ROOT: androidSdkPath,
        } : undefined,
        displayPrefix: androidSdkPath ? [`ANDROID_HOME=${androidSdkPath}`, `ANDROID_SDK_ROOT=${androidSdkPath}`] : [],
      }),
      commandStep({
        id: 'uninstall-play-store-local-dream',
        label: 'Uninstall Play Store Local Dream after explicit user approval',
        executable: 'adb',
        args: [...adbPrefix, 'uninstall', ANDROID_LOCALDREAM_PACKAGE_ID],
      }),
      commandStep({
        id: 'install-replace',
        label: 'Install the replace-package Signal Loom Local Dream APK',
        executable: 'adb',
        args: [...adbPrefix, 'install', '-r', replaceApkPath],
      }),
      manualStep({
        id: 'first-run-redownload-and-smoke',
        label: 'Open Signal Loom Android, redownload assets, and run in-app operation smoke tests',
        detail: 'The replacement app has a clean private data directory after uninstall/install. Complete this checkpoint before claiming replace-package live validation.',
        manualActions: [
          'Open Signal Loom Android after install.',
          'Confirm Runtime Assets shows QNN libraries, safety checker, and native diffusion core ready.',
          'Download at least one model and one upscaler inside the replacement app.',
          'Start the LAN API from the setup screen.',
          'Run Test API, Test Generate, and Test Upscale from the setup screen.',
          `Run ${buildReplaceGateCommand(gateCommonArgs)} after the in-app tests pass.`,
        ],
      }),
    ],
  };
}

export function formatAndroidLocalDreamSetupPlan(plan) {
  const lines = [
    `Signal Loom Android Local Dream setup: ${plan.status}`,
    `Package mode: ${plan.packageMode}`,
  ];
  if (plan.sourceOnly) {
    lines.push('Source-only setup: yes');
  }

  for (const warning of plan.warnings || []) {
    lines.push(`[warn] ${warning}`);
  }

  if (plan.blocked) {
    lines.push('No commands will run until the warning above is explicitly confirmed.');
    return lines.join('\n');
  }

  for (const [index, step] of plan.steps.entries()) {
    lines.push(`${index + 1}. ${step.label}`);
    if (step.kind === 'manual') {
      lines.push(`   Manual checkpoint: ${step.detail}`);
      for (const action of step.manualActions || []) {
        lines.push(`   - ${action}`);
      }
    } else {
      lines.push(`   ${step.command}${step.cwd ? ` (cwd ${step.cwd})` : ''}`);
    }
  }

  return lines.join('\n');
}

export function resolveAndroidLocalDreamSetupExitCode(plan, options = {}) {
  if (options.dryRun) return 0;
  return plan?.blocked ? 2 : 0;
}

export function createAndroidLocalDreamSetupReport({
  options = {},
  plan = {},
  reportPath = '',
  linkedGateReportPath = '',
  startedAt = new Date(),
} = {}) {
  const dryRun = Boolean(options.dryRun);
  const blocked = Boolean(plan.blocked);
  const startedAtIso = toIsoString(startedAt);
  const status = blocked ? 'needs-confirmation' : dryRun ? 'planned' : 'running';

  return {
    schemaVersion: ANDROID_LOCALDREAM_SETUP_SCHEMA_VERSION,
    status,
    ok: dryRun && !blocked,
    reportPath,
    linkedGateReportPath,
    startedAt: startedAtIso,
    endedAt: blocked || dryRun ? startedAtIso : null,
    durationMs: blocked || dryRun ? 0 : null,
    options: normalizeSetupReportOptions(options, plan),
    warnings: Array.isArray(plan.warnings) ? plan.warnings : [],
    steps: Array.isArray(plan.steps)
      ? plan.steps.map((step, index) => ({
          index: index + 1,
          kind: step.kind || 'command',
          id: step.id,
          label: step.label,
          command: redactAndroidLocalDreamSetupText(step.command),
          cwd: step.cwd || null,
          status: dryRun ? 'planned' : 'pending',
          exitCode: null,
          startedAt: null,
          endedAt: null,
          durationMs: null,
          detail: step.detail || '',
          manualActions: Array.isArray(step.manualActions)
            ? step.manualActions.map(redactAndroidLocalDreamSetupText)
            : [],
          stdout: '',
          stderr: '',
        }))
      : [],
  };
}

export function markAndroidLocalDreamSetupStepStarted(report, stepId, startedAt = new Date()) {
  const startedAtIso = toIsoString(startedAt);
  return updateSetupStep(report, stepId, (step) => ({
    ...step,
    status: 'running',
    startedAt: startedAtIso,
    endedAt: null,
    durationMs: null,
    exitCode: null,
  }));
}

export function markAndroidLocalDreamSetupStepFinished(report, stepId, {
  exitCode,
  stdout = '',
  stderr = '',
  endedAt = new Date(),
} = {}) {
  const endedAtIso = toIsoString(endedAt);
  return updateSetupStep(report, stepId, (step) => ({
    ...step,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    endedAt: endedAtIso,
    durationMs: step.startedAt
      ? Math.max(0, new Date(endedAtIso).getTime() - new Date(step.startedAt).getTime())
      : null,
    stdout: compactOutput(redactAndroidLocalDreamSetupText(stdout)),
    stderr: compactOutput(redactAndroidLocalDreamSetupText(stderr)),
  }));
}

export function markAndroidLocalDreamSetupManualStep(report, stepId, endedAt = new Date()) {
  const endedAtIso = toIsoString(endedAt);
  return updateSetupStep(report, stepId, (step) => ({
    ...step,
    kind: 'manual',
    status: 'manual',
    startedAt: step.startedAt || endedAtIso,
    endedAt: endedAtIso,
    durationMs: step.startedAt
      ? Math.max(0, new Date(endedAtIso).getTime() - new Date(step.startedAt).getTime())
      : 0,
    exitCode: null,
    stdout: '',
    stderr: '',
  }));
}

export function finalizeAndroidLocalDreamSetupReport(report, {
  endedAt = new Date(),
  ok,
} = {}) {
  if (report.status === 'needs-confirmation') {
    return {
      ...report,
      ok: false,
      endedAt: report.endedAt || toIsoString(endedAt),
      durationMs: report.durationMs ?? 0,
    };
  }

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
  const waitingForUser = !failed && steps.some((step) => step.status === 'manual');
  const passed = ok ?? (!failed && steps.every((step) => step.status === 'passed' || step.status === 'planned'));

  return {
    ...report,
    status: allPlanned ? 'planned' : waitingForUser ? 'waiting-for-user' : passed ? 'passed' : 'failed',
    ok: waitingForUser ? false : passed,
    endedAt: endedAtIso,
    durationMs: report.startedAt
      ? Math.max(0, new Date(endedAtIso).getTime() - new Date(report.startedAt).getTime())
      : null,
    steps,
  };
}

export function buildAndroidLocalDreamSetupEvidence({ report, reportPath = '', error } = {}) {
  if (!report) {
    return {
      status: error ? 'error' : 'not-run',
      ok: false,
      error,
      reportPath,
      linkedGateReportPath: '',
      options: {},
      warnings: [],
      steps: [],
    };
  }

  const steps = Array.isArray(report.steps)
    ? report.steps.map((step) => ({
        id: step.id,
        kind: step.kind || 'command',
        label: step.label,
        status: step.status,
        detail: step.status === 'failed'
          ? step.stderr || step.stdout || `Step ${step.id} failed.`
          : step.detail || step.stdout || '',
        command: step.command,
        durationMs: step.durationMs,
        manualActions: Array.isArray(step.manualActions) ? step.manualActions : [],
      }))
    : [];
  const blockingStep = steps.find((step) => step.status === 'failed');

  return {
    status: report.status || 'unknown',
    ok: Boolean(report.ok),
    error,
    reportPath: report.reportPath || reportPath,
    linkedGateReportPath: report.linkedGateReportPath || '',
    options: report.options || {},
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
    blockingStep,
    steps,
  };
}

function commandStep({ id, label, executable, args = [], displayArgs = args, displayPrefix = [], cwd, env }) {
  return {
    id,
    label,
    command: [...displayPrefix, executable, ...displayArgs].join(' '),
    executable,
    args,
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
  };
}

function manualStep({ id, label, detail, manualActions = [] }) {
  return {
    kind: 'manual',
    id,
    label,
    detail,
    manualActions,
    command: 'manual checkpoint',
  };
}

function buildReplaceGateCommand(gateCommonArgs) {
  const displayArgs = gateCommonArgs
    .slice(1)
    .map((arg) => arg.startsWith('--token=') ? '--token=<redacted>' : arg);
  return ['npm', 'run', 'gate:android-localdream', '--', ...displayArgs].join(' ');
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

function readNextOptionValue(argv, index, optionName) {
  const value = argv[index];
  if (value === undefined || String(value).startsWith('--')) {
    throw new Error(`${optionName} requires a value.`);
  }
  return String(value);
}

function normalizeSetupReportOptions(options, plan = {}) {
  return {
    dryRun: Boolean(options.dryRun),
    sourceOnly: Boolean(options.sourceOnly || plan.sourceOnly),
    packageMode: normalizePackageMode(options.packageMode || plan.packageMode || 'side-by-side'),
    forkDir: String(options.forkDir || '').trim(),
    adbSerial: String(options.adbSerial || '').trim(),
    androidSdkPath: String(options.androidSdkPath || '').trim(),
    port: positiveInteger(options.port, ANDROID_LOCALDREAM_DEFAULT_PORT, 'port'),
    tokenConfigured: Boolean(String(options.token || '').trim()),
    confirmReplaceUninstall: Boolean(options.confirmReplaceUninstall),
  };
}

function updateSetupStep(report, stepId, update) {
  let found = false;
  const steps = report.steps.map((step) => {
    if (step.id !== stepId) return step;
    found = true;
    return update(step);
  });

  if (!found) {
    throw new Error(`Android Local Dream setup report does not contain step "${stepId}".`);
  }

  return { ...report, steps };
}

function redactAndroidLocalDreamSetupText(value) {
  return String(value ?? '')
    .replace(/Authorization:\s*Bearer\s+[^\s'"`]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/--token=([^\s'"`]+)/g, '--token=<redacted>')
    .replace(/--token\s+([^\s'"`]+)/g, '--token <redacted>');
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function compactOutput(value, maxLength = 4000) {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
