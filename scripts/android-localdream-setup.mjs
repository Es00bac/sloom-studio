#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAndroidLocalDreamSetupPaths,
  buildAndroidLocalDreamSetupPlan,
  createAndroidLocalDreamSetupReport,
  finalizeAndroidLocalDreamSetupReport,
  formatAndroidLocalDreamSetupPlan,
  markAndroidLocalDreamSetupManualStep,
  markAndroidLocalDreamSetupStepFinished,
  markAndroidLocalDreamSetupStepStarted,
  parseAndroidLocalDreamSetupArgs,
  resolveAndroidLocalDreamSetupExitCode,
} from './android-localdream-setup-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const options = parseAndroidLocalDreamSetupArgs(process.argv.slice(2), process.env);
const plan = buildAndroidLocalDreamSetupPlan({
  repoRoot,
  ...options,
});
const paths = buildAndroidLocalDreamSetupPaths(repoRoot);
let report = createAndroidLocalDreamSetupReport({
  options,
  plan,
  reportPath: paths.latest,
  linkedGateReportPath: paths.linkedGateLatest,
  startedAt: new Date(),
});

await writeReport(report);
console.log(formatAndroidLocalDreamSetupPlan(plan));

const earlyExitCode = resolveAndroidLocalDreamSetupExitCode(plan, options);
if (options.dryRun || plan.blocked) {
  report = finalizeAndroidLocalDreamSetupReport(report, { ok: options.dryRun && !plan.blocked });
  await writeReport(report);
  process.exit(earlyExitCode);
}

let failed = false;
for (const step of plan.steps) {
  console.log(`\n[android-localdream-setup] ${step.command}`);
  if (step.kind === 'manual') {
    console.log(`[android-localdream-setup] Manual checkpoint: ${step.detail}`);
    for (const action of step.manualActions || []) {
      console.log(`  - ${action}`);
    }
    report = markAndroidLocalDreamSetupManualStep(report, step.id);
    report = finalizeAndroidLocalDreamSetupReport(report);
    await writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  report = markAndroidLocalDreamSetupStepStarted(report, step.id);
  await writeReport(report);

  const result = await runStep(step);
  report = markAndroidLocalDreamSetupStepFinished(report, step.id, result);
  await writeReport(report);

  if (result.exitCode !== 0) {
    failed = true;
    console.error(`[android-localdream-setup] ${step.id} failed with exit code ${result.exitCode}.`);
    report = finalizeAndroidLocalDreamSetupReport(report, { ok: false });
    await writeReport(report);
    process.exit(result.exitCode || 1);
  }
}

report = finalizeAndroidLocalDreamSetupReport(report, { ok: !failed });
await writeReport(report);
console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);

async function writeReport(payload) {
  const body = `${JSON.stringify({
    ...payload,
    reportPath: paths.latest,
    linkedGateReportPath: paths.linkedGateLatest,
  }, null, 2)}\n`;
  await mkdir(paths.directory, { recursive: true });
  await writeFile(paths.latest, body, 'utf8');
}

function runStep(step) {
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
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr.push(text);
      process.stderr.write(text);
    });

    child.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      stderr.push(message);
      resolve({ exitCode: 1, stdout: stdout.join(''), stderr: stderr.join('') });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout: stdout.join(''), stderr: stderr.join('') });
    });
  });
}
