#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  NATIVE_SMOKE_WORKSPACES,
  buildNativeSmokeElectronLaunchArgs,
  buildNativeRealProjectSmokeEnvironment,
  buildNativeRealProjectSmokePaths,
  buildNativeRealProjectStartupState,
} from './native-smoke-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const remoteDebuggingPort = Number(process.env.SIGNAL_LOOM_NATIVE_SMOKE_PORT || 9234);
const smokeRoot = process.env.SIGNAL_LOOM_NATIVE_SMOKE_DIR || join(tmpdir(), 'signal-loom-native-real-project-smoke');
const projectPath = getProjectPath(process.argv.slice(2), process.env);

async function main() {
  if (!projectPath) {
    throw new Error('Provide a real project with --project=/path/to/project.sloom or SIGNAL_LOOM_NATIVE_REAL_PROJECT_PATH.');
  }
  if (!projectPath.toLowerCase().endsWith('.sloom')) {
    throw new Error('Real-project smoke requires a restored .sloom file, not a .sloom.bak-* backup path.');
  }
  if (!Number.isInteger(remoteDebuggingPort) || remoteDebuggingPort <= 0) {
    throw new Error('SIGNAL_LOOM_NATIVE_SMOKE_PORT must be a positive integer.');
  }

  await stat(projectPath);
  const paths = buildNativeRealProjectSmokePaths(smokeRoot, projectPath);
  await rm(paths.rootDir, { recursive: true, force: true });
  await mkdir(paths.userDataDir, { recursive: true });
  await writeFile(paths.startupProjectStatePath, buildNativeRealProjectStartupState(projectPath), 'utf8');

  const electron = launchElectron(paths);

  try {
    const flowTarget = await waitForSignalLoomTarget(electron, remoteDebuggingPort);
    const startup = await inspectStartupProjectAndOpenWorkspaces(flowTarget.webSocketDebuggerUrl);
    const workspaceTargets = await waitForWorkspaceTargets(electron, remoteDebuggingPort);
    const workspaces = await inspectWorkspaceTargets(workspaceTargets);
    const paperExport = await exportPaperPdfFromPaperWorkspace(
      workspaceTargets.paper.webSocketDebuggerUrl,
      startup.paperPages,
    );
    const pdf = await waitForFile(paths.pdfPath, 1000, 300000);

    console.log(JSON.stringify({
      ok: true,
      rootDir: paths.rootDir,
      projectPath,
      startup,
      workspaces,
      paperExport,
      pdf,
    }, null, 2));
  } finally {
    await stopElectron(electron);
  }
}

function getProjectPath(argv, env) {
  const argProject = getOptionValue(argv, '--project');
  return argProject || env.SIGNAL_LOOM_NATIVE_REAL_PROJECT_PATH || '';
}

function launchElectron(paths) {
  const electronCli = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const launchArgs = buildNativeSmokeElectronLaunchArgs({ remoteDebuggingPort, platform: process.platform });
  const args = process.platform === 'win32'
    ? launchArgs
    : [electronCli, ...launchArgs];
  const command = process.platform === 'win32' ? electronCli : process.execPath;
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: buildNativeRealProjectSmokeEnvironment({
      baseEnv: process.env,
      rootDir: paths.rootDir,
      projectPath: paths.projectPath,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  child.logs = logs;
  return child;
}

async function inspectStartupProjectAndOpenWorkspaces(webSocketDebuggerUrl) {
  const result = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let bridge = window.signalLoomNative;
      const bridgeWaitStartedAt = Date.now();
      while (!bridge && Date.now() - bridgeWaitStartedAt < 10000) {
        await sleep(100);
        bridge = window.signalLoomNative;
      }
      if (!bridge) return { error: 'native bridge missing', locationHref: location.href, readyState: document.readyState };
      let state;
      const startedAt = Date.now();
      while (Date.now() - startedAt < 60000) {
        state = await bridge.getNativeState();
        if (state.startupProject?.document) break;
        await sleep(250);
      }
      const document = state?.startupProject?.document;
      const paperDocument = document?.paper?.document;
      const sourceItems = (document?.sourceBin?.bins ?? []).reduce((total, bin) => total + (bin.items?.length ?? 0), 0);
      const workspaceWindows = [];
      for (const workspace of ${JSON.stringify(NATIVE_SMOKE_WORKSPACES)}) {
        const startedAt = performance.now();
        workspaceWindows.push({
          ...(await bridge.openWorkspaceWindow(workspace)),
          switchDurationMs: Math.round(performance.now() - startedAt),
        });
      }
      return {
        currentProjectPath: state?.currentProjectPath,
        scratchDirectoryPath: state?.currentScratchDirectoryPath,
        projectName: document?.name,
        sourceItems,
        paperTitle: paperDocument?.title,
        paperPages: paperDocument?.pages?.length ?? 0,
        workspaceWindows,
        bodyHasRecovery: Boolean(document.body?.innerText.includes('Recovery Boundary')),
      };
    })()
  `, 90000);

  if (result.error) throw new Error(String(result.error));
  if (result.bodyHasRecovery) throw new Error('Real-project smoke opened Flow to a recovery boundary.');
  if (!result.currentProjectPath || !result.projectName) {
    throw new Error(`Real-project startup did not load a native project: ${JSON.stringify(result)}`);
  }
  if (result.paperPages < 1) {
    throw new Error(`Real-project startup did not load a Paper document with pages: ${JSON.stringify(result)}`);
  }
  for (const entry of result.workspaceWindows ?? []) {
    if (!entry?.ok || !NATIVE_SMOKE_WORKSPACES.includes(entry.workspace)) {
      throw new Error(`Real-project workspace open failed: ${JSON.stringify(result.workspaceWindows)}`);
    }
  }
  return result;
}

async function exportPaperPdfFromPaperWorkspace(webSocketDebuggerUrl, expectedPaperPages) {
  const result = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.confirm = () => true;
      const startedAt = Date.now();
      let clicked = false;
      let statusLine = '';
      const expectedPaperPages = ${JSON.stringify(expectedPaperPages)};
      while (Date.now() - startedAt < 120000) {
        const bodyText = document.body?.innerText ?? '';
        if (bodyText.includes('Recovery Boundary')) {
          return { hasRecoveryBoundary: true, clicked, statusLine: 'Recovery Boundary', readyPageCount: 0 };
        }
        const paperWorkspace = document.querySelector('[data-signal-loom-paper-workspace="true"]');
        const readyPageCount = Number(paperWorkspace?.getAttribute('data-paper-page-count') || '0');
        if (readyPageCount >= expectedPaperPages) {
          window.dispatchEvent(new CustomEvent('signal-loom:native-renderer-command', {
            detail: { command: 'paper:export-pdf' },
          }));
          clicked = true;
          break;
        }
        await sleep(250);
      }
      while (Date.now() - startedAt < 300000) {
        const bodyText = document.body?.innerText ?? '';
        statusLine = bodyText.split('\\n').find((line) =>
          line.includes('Saved PDF')
          || line.includes('PDF export failed')
          || line.includes('PDF export canceled')
        ) || '';
        if (statusLine) break;
        if (bodyText.includes('Recovery Boundary')) {
          return { hasRecoveryBoundary: true, clicked, statusLine: 'Recovery Boundary', readyPageCount: 0 };
        }
        await sleep(500);
      }
      const paperWorkspace = document.querySelector('[data-signal-loom-paper-workspace="true"]');
      return {
        clicked,
        statusLine,
        readyPageCount: Number(paperWorkspace?.getAttribute('data-paper-page-count') || '0'),
        elapsedMs: Date.now() - startedAt,
        hasRecoveryBoundary: Boolean((document.body?.innerText ?? '').includes('Recovery Boundary')),
        debug: {
          hasPaperWorkspace: Boolean(document.querySelector('[data-signal-loom-paper-workspace="true"]')),
          hasPaperTopbar: Boolean(document.querySelector('[data-paper-topbar-controls="true"]')),
          paperTopbarPlacement: document.querySelector('[data-paper-topbar-controls="true"]')?.getAttribute('data-paper-topbar-placement') || '',
          hasTopbarSlot: Boolean(document.getElementById('signal-loom-paper-topbar-slot')),
          buttonLabels: Array.from(document.querySelectorAll('button'))
            .map((candidate) => candidate.getAttribute('aria-label') || candidate.textContent?.trim() || '')
            .filter(Boolean)
            .slice(0, 40),
        },
      };
    })()
  `, 320000);

  if (result.hasRecoveryBoundary) throw new Error('Real-project Paper export reached a recovery boundary.');
  if (result.readyPageCount < expectedPaperPages) {
    throw new Error(`Real-project Paper export did not wait for the expected page count: ${JSON.stringify(result)}`);
  }
  if (!result.clicked) {
    throw new Error(`Real-project Paper export could not dispatch the export command: ${JSON.stringify(result)}`);
  }
  if (!result.statusLine || result.statusLine.includes('failed') || result.statusLine.includes('canceled')) {
    throw new Error(`Real-project Paper export did not finish successfully: ${JSON.stringify(result)}`);
  }
  return result;
}

async function waitForSignalLoomTarget(electron, port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before the real-project target appeared.\n${electron.logs.join('')}`);
    }
    try {
      const targets = await fetch(url).then((response) => response.json());
      const signalLoomTarget = targets.find((target) => target.title === 'Sloom Studio' || target.title === 'Signal Loom');
      if (signalLoomTarget?.webSocketDebuggerUrl) return signalLoomTarget;
      const fallbackTarget = targets.find((target) => target.webSocketDebuggerUrl);
      if (fallbackTarget) return fallbackTarget;
    } catch {
      // Electron may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Electron DevTools target on port ${port}.\n${electron.logs.join('')}`);
}

async function waitForWorkspaceTargets(electron, port) {
  const expected = new Set(NATIVE_SMOKE_WORKSPACES);
  const found = new Map();
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before all real-project workspace targets appeared.\n${electron.logs.join('')}`);
    }
    try {
      const targets = await fetch(url).then((response) => response.json());
      for (const target of targets) {
        const workspace = workspaceFromTargetUrl(target.url);
        if (workspace && expected.has(workspace) && target.webSocketDebuggerUrl) {
          found.set(workspace, target);
        }
      }
      if (NATIVE_SMOKE_WORKSPACES.every((workspace) => found.has(workspace))) {
        return Object.fromEntries(NATIVE_SMOKE_WORKSPACES.map((workspace) => [workspace, found.get(workspace)]));
      }
    } catch {
      // Windows may still be loading.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for real-project workspace targets. Found: ${[...found.keys()].join(', ') || 'none'}.`);
}

async function inspectWorkspaceTargets(targetsByWorkspace) {
  const inspections = {};
  for (const workspace of NATIVE_SMOKE_WORKSPACES) {
    const target = targetsByWorkspace[workspace];
    const inspection = await evaluateCdpExpression(target.webSocketDebuggerUrl, `
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const readPaperTitlebarToolbar = () => {
          const slot = document.getElementById('signal-loom-paper-topbar-slot');
          const controls = document.querySelector('[data-paper-topbar-controls="true"]');
          return {
            hasSlot: Boolean(slot),
            hasControls: Boolean(controls),
            placement: controls?.getAttribute('data-paper-topbar-placement') || '',
            controlsInsideSlot: Boolean(slot && controls && slot.contains(controls)),
            hasWorkspaceLocalToolbar: Boolean(document.querySelector('[data-paper-topbar-placement="workspace"]')),
          };
        };
        const startedAt = Date.now();
        const workspace = new URL(location.href).searchParams.get('workspace') || 'flow';
        let paperTitlebarToolbar;
        if (workspace === 'paper') {
          while (Date.now() - startedAt < 60000) {
            paperTitlebarToolbar = readPaperTitlebarToolbar();
            if (
              paperTitlebarToolbar.hasSlot
              && paperTitlebarToolbar.hasControls
              && paperTitlebarToolbar.placement === 'titlebar'
              && paperTitlebarToolbar.controlsInsideSlot
            ) {
              break;
            }
            if (document.body?.innerText.includes('Recovery Boundary')) break;
            await sleep(100);
          }
        }
        return {
          workspace,
          title: document.title,
          url: location.href,
          hasRecoveryBoundary: Boolean(document.body?.innerText.includes('Recovery Boundary')),
          hasAutomationSourceLibraryChange: typeof window.signalLoomAutomation?.applySourceLibraryChange === 'function',
          paperTitlebarToolbar,
        };
      })()
    `, 70000);
    if (inspection.hasRecoveryBoundary) {
      throw new Error(`Real-project ${workspace} workspace opened to a recovery boundary.`);
    }
    if (workspace === 'paper') {
      const toolbar = inspection.paperTitlebarToolbar;
      if (
        !toolbar?.hasSlot
        || !toolbar.hasControls
        || toolbar.placement !== 'titlebar'
        || !toolbar.controlsInsideSlot
        || toolbar.hasWorkspaceLocalToolbar
      ) {
        throw new Error(`Real-project Paper toolbar was not mounted in the titlebar slot: ${JSON.stringify(toolbar)}`);
      }
    }
    inspections[workspace] = inspection;
  }
  return inspections;
}

function workspaceFromTargetUrl(value) {
  try {
    const workspace = new URL(value).searchParams.get('workspace');
    return NATIVE_SMOKE_WORKSPACES.includes(workspace) ? workspace : undefined;
  } catch {
    return undefined;
  }
}

async function evaluateCdpExpression(webSocketDebuggerUrl, expression, timeoutMs) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const socket = new WebSocket(webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        clearTimeout(entry.timeout);
        pending.delete(message.id);
        entry.resolve(message);
      }
    });
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    try {
      const response = await sendCdp(socket, pending, () => {
        id += 1;
        return id;
      }, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }, timeoutMs);
      const retryableMessage = response.error?.message || response.result?.exceptionDetails?.text || '';
      if (retryableMessage.includes('Execution context was destroyed')) {
        if (attempt === 2) {
          throw new Error(`CDP expression context was destroyed after retries: ${JSON.stringify(response)}`);
        }
        await delay(250);
        continue;
      }
      const result = response.result?.result;
      if (!result || !Object.prototype.hasOwnProperty.call(result, 'value')) {
        throw new Error(`CDP expression returned no bridge value: ${JSON.stringify(response)}`);
      }
      return result.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 2 && message.includes('Timed out waiting for CDP method Runtime.evaluate.')) {
        await delay(250);
        continue;
      }
      throw error;
    } finally {
      socket.close();
    }
  }

  throw new Error('CDP expression failed after retries.');
}

function sendCdp(socket, pending, nextId, method, params, timeoutMs) {
  const id = nextId();
  const payload = JSON.stringify({ id, method, params });
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for CDP method ${method}.`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
  });
  socket.send(payload);
  return promise;
}

async function waitForFile(filePath, minimumBytes, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const stats = await stat(filePath);
      if (stats.size >= minimumBytes) {
        return {
          filePath,
          bytes: stats.size,
        };
      }
    } catch {
      // File may not have been written yet.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${filePath} to reach ${minimumBytes} bytes.`);
}

async function stopElectron(electron) {
  if (electron.exitCode !== null) return;
  electron.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => electron.once('exit', resolve)),
    delay(5000).then(() => {
      if (electron.exitCode === null) electron.kill('SIGKILL');
    }),
  ]);
}

function getOptionValue(argv, name) {
  const prefix = `${name}=`;
  const match = argv.find((entry) => typeof entry === 'string' && entry.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
