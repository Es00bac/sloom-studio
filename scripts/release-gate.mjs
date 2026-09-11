#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReleaseGateLedgerPaths,
  buildReleaseGatePlan,
  createReleaseGateLedger,
  finalizeReleaseGateLedger,
  formatReleaseGatePlan,
  markReleaseGateStepFinished,
  markReleaseGateStepStarted,
  parseReleaseGateArgs,
} from './release-gate-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const options = parseReleaseGateArgs(process.argv.slice(2));
const steps = buildReleaseGatePlan(options.profile);
let ledger = createReleaseGateLedger({
  profile: options.profile,
  steps,
  options,
  environment: process.env,
});

console.log(formatReleaseGatePlan(options.profile, steps));
await writeLedger(ledger);

if (options.dryRun) {
  ledger = finalizeReleaseGateLedger(ledger, { ok: true });
  await writeLedger(ledger);
  process.exit(0);
}

let failed = false;

for (const step of steps) {
  console.log(`\n[release-gate] npm run ${step.script}`);
  ledger = markReleaseGateStepStarted(ledger, step.script);
  await writeLedger(ledger);
  const result = await runNpmScript(step.script);
  ledger = markReleaseGateStepFinished(ledger, step.script, result);
  await writeLedger(ledger);

  if (result.exitCode !== 0) {
    failed = true;
    console.error(`[release-gate] npm run ${step.script} failed with exit code ${result.exitCode}.`);

    if (!options.continueOnError) {
      ledger = finalizeReleaseGateLedger(ledger, { ok: false });
      await writeLedger(ledger);
      process.exit(result.exitCode);
    }
  }
}

ledger = finalizeReleaseGateLedger(ledger, { ok: !failed });
await writeLedger(ledger);
process.exit(failed ? 1 : 0);

async function writeLedger(payload) {
  const paths = buildReleaseGateLedgerPaths(repoRoot, payload.profile);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  await mkdir(paths.directory, { recursive: true });
  await Promise.all([
    writeFile(paths.latest, body, 'utf8'),
    writeFile(paths.profileLatest, body, 'utf8'),
  ]);
}

function runNpmScript(script) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  return new Promise((resolve) => {
    const child = spawn(npmCommand, ['run', script], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout?.on('data', (chunk) => {
      stdoutChunks.push(chunk);
      process.stdout.write(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    child.on('error', (error) => {
      stderrChunks.push(Buffer.from(`${error.message}\n`));
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });

    child.on('close', (code) => resolve({
      exitCode: code ?? 1,
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    }));
  });
}
