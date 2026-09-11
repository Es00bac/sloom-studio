import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { buildNativeSmokeProjectDocument } from './native-smoke-lib.mjs';
const electronPath = resolve('node_modules/electron/dist/electron');
const probeRoot = await mkdtemp(join(tmpdir(), 'sloom-single-instance-probe-'));
const userDataPath = join(probeRoot, 'user-data');
const targetPath = join(probeRoot, 'Comic 週刊.sloom');
const rememberedPath = join(userDataPath, 'startup-project.json');
const mainSource = await readFile(resolve('electron/main.mjs'), 'utf8');

if (!mainSource.includes('requestSingleInstanceLock(externalOpenLaunchPayload)') || !mainSource.includes('externalOpenLaunchDeliveryId')) {
  throw new Error('The application no longer relays the bounded external-open delivery identity covered by this probe.');
}

function launch(extraArgs = []) {
  const child = spawn(electronPath, [
    '--no-sandbox',
    '--ozone-platform=x11',
    '.',
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      GDK_BACKEND: 'x11',
      XDG_SESSION_TYPE: 'x11',
      SIGNAL_LOOM_ELECTRON_DISABLE_GPU: '1',
      SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: userDataPath,
      SIGNAL_LOOM_EXTERNAL_OPEN_PROBE: '1',
      WAYLAND_DISPLAY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  return { child, logs: () => logs };
}

async function waitForFile(filePath, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(filePath, constants.F_OK);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}.`);
}

async function waitForRememberedTarget(timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = JSON.parse(await readFile(rememberedPath, 'utf8'));
      if (state.currentProjectPath === targetPath) return;
    } catch {
      // The winner has not committed the accepted renderer transaction yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('The winning app did not commit the relayed Unicode/spaces project path.');
}

function waitForExit(child, timeoutMs = 20_000, getLogs = () => '') {
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      rejectExit(new Error(`Electron process ${child.pid} did not exit.\n${getLogs()}`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
  });
}

async function removeProbeRootStrictly() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await rm(probeRoot, { recursive: true, force: true });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    try {
      await access(probeRoot, constants.F_OK);
    } catch {
      return;
    }
  }
  throw new Error(`Electron processes kept recreating probe state after cleanup: ${probeRoot}`);
}

let winner;
let loser;
try {
  await access(electronPath, constants.X_OK);
  await writeFile(targetPath, `${JSON.stringify(buildNativeSmokeProjectDocument(), null, 2)}\n`, 'utf8');

  winner = launch();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
  if (winner.child.exitCode !== null) {
    throw new Error(`Winning application exited before the relay probe.\n${winner.logs()}`);
  }

  loser = launch([targetPath]);
  const loserExit = await waitForExit(loser.child, 20_000, loser.logs);
  if (loserExit.code !== 0) {
    throw new Error(`Losing application exited ${loserExit.code ?? loserExit.signal}.\n${loser.logs()}`);
  }
  await waitForFile(rememberedPath);
  await waitForRememberedTarget();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  const commitLines = winner.logs().split('\n').filter((line) => line.includes('[external-open-probe] committed project'));
  if (commitLines.length !== 1) {
    throw new Error(`Expected exactly one external project commit, received ${commitLines.length}.\n${winner.logs()}`);
  }
  if (winner.child.exitCode !== null) {
    throw new Error(`The lock winner died while processing the second-instance relay.\n${winner.logs()}`);
  }

  console.log(`Stable single-instance identity relay passed (winner ${winner.child.pid}, Unicode/spaces argv, loser exit 0, one committed path).`);
} finally {
  if (loser?.child.exitCode === null) loser.child.kill('SIGTERM');
  if (winner?.child.exitCode === null) {
    winner.child.kill('SIGTERM');
    await waitForExit(winner.child, 5_000, winner.logs).catch(() => undefined);
  }
  await removeProbeRootStrictly();
}
