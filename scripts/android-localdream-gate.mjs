#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAndroidLocalDreamGatePaths,
  buildAndroidLocalDreamGatePlan,
  createAndroidLocalDreamGateReport,
  finalizeAndroidLocalDreamGateReport,
  analyzeAndroidLocalDreamCapabilitiesPayload,
  formatAndroidLocalDreamCapabilitiesReadinessFailure,
  markAndroidLocalDreamGateStepFinished,
  markAndroidLocalDreamGateStepStarted,
  parseAndroidLocalDreamPairingTokenXml,
  parseAndroidLocalDreamGateArgs,
  resolveAndroidLocalDreamGateSdkPath,
  summarizeAndroidLocalDreamGateOutput,
  withAndroidLocalDreamGateAuthToken,
} from './android-localdream-gate-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const options = parseAndroidLocalDreamGateArgs(process.argv.slice(2), process.env);
const androidSdkPath = options.androidSdkPath || resolveAndroidLocalDreamGateSdkPath({ env: process.env });
const packageId = resolvePackageId(options.packageMode);
const steps = buildAndroidLocalDreamGatePlan({
  repoRoot,
  forkDir: options.forkDir,
  packageMode: options.packageMode,
  prepare: options.prepare,
  port: options.port,
  token: options.token,
  adbSerial: options.adbSerial,
  apkPath: options.apkPath,
  androidSdkPath,
});
let report = createAndroidLocalDreamGateReport({
  options: {
    ...options,
    androidSdkPath,
  },
  steps,
  startedAt: new Date(),
});

await writeReport(report);
console.log(`Signal Loom Android Local Dream gate: ${steps.length} step${steps.length === 1 ? '' : 's'}`);
for (const [index, step] of steps.entries()) {
  console.log(`${index + 1}. ${step.command}${step.cwd ? ` (cwd ${step.cwd})` : ''}`);
}

if (options.dryRun) {
  report = finalizeAndroidLocalDreamGateReport(report, { ok: true });
  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

let failed = false;
let effectiveToken = options.token;
let pairingTokenReadAttempted = false;
for (const step of steps) {
  let stepToRun = step;
  if (isAndroidLocalDreamApiStep(step.id)) {
    if (!effectiveToken && !pairingTokenReadAttempted) {
      pairingTokenReadAttempted = true;
      effectiveToken = await readAndroidLocalDreamPairingToken({ packageId, adbSerial: options.adbSerial });
      if (effectiveToken) {
        report = {
          ...report,
          options: {
            ...report.options,
            tokenDiscoveredViaRunAs: true,
          },
        };
        await writeReport(report);
        console.log('[android-localdream-gate] Pairing token discovered through adb run-as for API smoke.');
      } else {
        console.warn('[android-localdream-gate] Pairing token was not configured and could not be read through adb run-as.');
      }
    }
    if (effectiveToken) {
      stepToRun = withAndroidLocalDreamGateAuthToken(step, effectiveToken);
    }
  }

  console.log(`\n[android-localdream-gate] ${stepToRun.command}`);
  report = markAndroidLocalDreamGateStepStarted(report, step.id);
  await writeReport(report);

  let result = await runStep(stepToRun, {
    echoStdout: !isAndroidLocalDreamApiStep(step.id),
  });
  if (step.id === 'capabilities' && result.exitCode === 0) {
    const readiness = analyzeAndroidLocalDreamCapabilitiesPayload(result.stdout, {
      packageMode: options.packageMode,
    });
    if (readiness.ready) {
      console.log(`[android-localdream-gate] ${readiness.message}`);
    } else {
      result = {
        ...result,
        exitCode: 1,
        stderr: formatAndroidLocalDreamCapabilitiesReadinessFailure(readiness, {
          ...options,
          androidSdkPath,
        }),
      };
    }
  }
  if (isAndroidLocalDreamApiStep(step.id) && result.stdout) {
    console.log(summarizeAndroidLocalDreamGateOutput(step.id, result.stdout));
  }
  report = markAndroidLocalDreamGateStepFinished(report, step.id, result);
  await writeReport(report);

  if (result.exitCode !== 0) {
    failed = true;
    console.error(`[android-localdream-gate] ${step.id} failed with exit code ${result.exitCode}.`);
    if (result.stderr) console.error(result.stderr);

    if (!options.continueOnError) {
      report = finalizeAndroidLocalDreamGateReport(report, { ok: false });
      await writeReport(report);
      console.log(JSON.stringify(report, null, 2));
      process.exit(result.exitCode || 1);
    }
  }
}

report = finalizeAndroidLocalDreamGateReport(report, { ok: !failed });
await writeReport(report);
console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);

async function writeReport(payload) {
  const paths = buildAndroidLocalDreamGatePaths(repoRoot);
  const body = `${JSON.stringify({ ...payload, reportPath: paths.latest }, null, 2)}\n`;
  await mkdir(paths.directory, { recursive: true });
  await writeFile(paths.latest, body, 'utf8');
}

function runStep(step, { echoStdout = true } = {}) {
  return new Promise((resolve) => {
    const child = spawn(step.executable, step.args, {
      cwd: step.cwd || repoRoot,
      env: {
        ...process.env,
        ...(step.env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout.push(text);
      if (echoStdout) {
        process.stdout.write(text);
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr.push(text);
      process.stderr.write(text);
    });
    child.on('error', (error) => {
      stderr.push(error instanceof Error ? error.message : String(error));
      resolve({
        exitCode: 1,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      });
    });
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      });
    });
  });
}

async function readAndroidLocalDreamPairingToken({ packageId, adbSerial }) {
  const adbPrefix = adbSerial ? ['-s', adbSerial] : [];
  const result = await runSilentCommand('adb', [
    ...adbPrefix,
    'shell',
    'run-as',
    packageId,
    'cat',
    'shared_prefs/signal_loom_accelerator.xml',
  ]);
  if (result.exitCode !== 0) {
    return '';
  }
  return parseAndroidLocalDreamPairingTokenXml(result.stdout);
}

function runSilentCommand(executable, args) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk.toString()));
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    child.on('error', (error) => {
      stderr.push(error instanceof Error ? error.message : String(error));
      resolve({
        exitCode: 1,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      });
    });
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      });
    });
  });
}

function isAndroidLocalDreamApiStep(stepId) {
  return stepId === 'capabilities' || stepId === 'generate' || stepId === 'upscale';
}

function resolvePackageId(packageMode) {
  return packageMode === 'replace'
    ? 'io.github.xororz.localdream'
    : 'io.github.xororz.localdream.signalloom';
}
