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
  buildNativeRealProjectSoakOptions,
  buildNativeRealProjectSoakReport,
  buildNativeRealProjectStartupState,
  buildNativeSmokeStressRenameLabel,
  buildNativeSmokeStressSourceLibraryItem,
  formatNativeRealProjectSoakBudgetFailure,
} from './native-smoke-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const remoteDebuggingPort = Number(process.env.SIGNAL_LOOM_NATIVE_SMOKE_PORT || 9240);
const smokeRoot = process.env.SIGNAL_LOOM_NATIVE_SMOKE_DIR || join(tmpdir(), 'signal-loom-native-real-project-soak');
const projectPath = getProjectPath(process.argv.slice(2), process.env);
const soakOptions = buildNativeRealProjectSoakOptions({
  argv: process.argv.slice(2),
  env: process.env,
});

async function main() {
  if (!projectPath) {
    throw new Error('Provide a real project with --project=/path/to/project.sloom or SIGNAL_LOOM_NATIVE_REAL_PROJECT_PATH.');
  }
  if (!projectPath.toLowerCase().endsWith('.sloom')) {
    throw new Error('Real-project soak requires a restored .sloom file, not a .sloom.bak-* backup path.');
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
    const baseline = await inspectWorkspaceTargets(workspaceTargets);
    const soak = await exerciseRealProjectSoak(workspaceTargets, flowTarget, soakOptions);
    const reportPath = join(paths.rootDir, 'real-project-soak-report.json');
    const report = buildNativeRealProjectSoakReport({
      rootDir: paths.rootDir,
      projectPath,
      options: soakOptions,
      startup,
      baseline,
      soak,
      reportPath,
    });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));

    if (!report.ok) {
      throw new Error(`Native real-project soak performance budget failed: ${formatNativeRealProjectSoakBudgetFailure(report.budgetSummary)}`);
    }
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
      const bridge = window.signalLoomNative;
      if (!bridge) return { error: 'native bridge missing' };
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
  if (result.bodyHasRecovery) throw new Error('Real-project soak opened Flow to a recovery boundary.');
  if (!result.currentProjectPath || !result.projectName) {
    throw new Error(`Real-project soak did not load a native project: ${JSON.stringify(result)}`);
  }
  if (result.paperPages < 1) {
    throw new Error(`Real-project soak did not load a Paper document with pages: ${JSON.stringify(result)}`);
  }
  for (const entry of result.workspaceWindows ?? []) {
    if (!entry?.ok || !NATIVE_SMOKE_WORKSPACES.includes(entry.workspace)) {
      throw new Error(`Real-project soak workspace open failed: ${JSON.stringify(result.workspaceWindows)}`);
    }
  }
  return result;
}

async function exerciseRealProjectSoak(targetsByWorkspace, flowTarget, options) {
  const startedAt = Date.now();
  const cycles = [];

  for (let cycle = 1; cycle <= options.soakCycles; cycle += 1) {
    const cycleStartedAt = Date.now();
    const focus = await focusAllWorkspaces(flowTarget.webSocketDebuggerUrl);
    const sourceLibrary = await churnSyntheticSourceLibraryItem(targetsByWorkspace, cycle);
    const inspections = await inspectWorkspaceTargets(targetsByWorkspace);
    const metrics = await collectWorkspaceMetrics(targetsByWorkspace);
    cycles.push({
      cycle,
      focus,
      sourceLibrary,
      inspections,
      metrics,
      elapsedMs: Date.now() - cycleStartedAt,
    });

    if (options.soakDelayMs > 0) {
      await delay(options.soakDelayMs);
    }
  }

  return {
    cycles: cycles.length,
    delayMs: options.soakDelayMs,
    elapsedMs: Date.now() - startedAt,
    samples: cycles,
  };
}

async function focusAllWorkspaces(webSocketDebuggerUrl) {
  const result = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const bridge = window.signalLoomNative;
      if (!bridge) return { error: 'native bridge missing' };
      const results = [];
      for (const workspace of ${JSON.stringify(NATIVE_SMOKE_WORKSPACES)}) {
        const startedAt = performance.now();
        results.push({
          ...(await bridge.openWorkspaceWindow(workspace)),
          switchDurationMs: Math.round(performance.now() - startedAt),
        });
      }
      return results;
    })()
  `, 30000);

  if (result.error) throw new Error(String(result.error));
  for (const entry of result) {
    if (!entry?.ok || !NATIVE_SMOKE_WORKSPACES.includes(entry.workspace)) {
      throw new Error(`Real-project soak workspace focus failed: ${JSON.stringify(result)}`);
    }
  }
  return result;
}

async function churnSyntheticSourceLibraryItem(targetsByWorkspace, cycle) {
  const item = buildNativeSmokeStressSourceLibraryItem({ cycle });
  const renamedLabel = buildNativeSmokeStressRenameLabel(cycle);
  const addWorkspace = workspaceForCycle(cycle, 0);
  const renameWorkspace = workspaceForCycle(cycle, 1);
  const removeWorkspace = workspaceForCycle(cycle, 2);

  const add = await applySourceLibraryChangeFromWorkspace(targetsByWorkspace[addWorkspace], {
    type: 'source-bin-items-added',
    items: [item],
  });
  const added = await waitForSourceLibraryItemStateAcrossWorkspaceTargets(targetsByWorkspace, {
    itemId: item.id,
    label: item.label,
    shouldExist: true,
  });

  const rename = await applySourceLibraryChangeFromWorkspace(targetsByWorkspace[renameWorkspace], {
    type: 'source-bin-item-renamed',
    itemId: item.id,
    label: renamedLabel,
  });
  const renamed = await waitForSourceLibraryItemStateAcrossWorkspaceTargets(targetsByWorkspace, {
    itemId: item.id,
    label: renamedLabel,
    shouldExist: true,
  });

  const remove = await applySourceLibraryChangeFromWorkspace(targetsByWorkspace[removeWorkspace], {
    type: 'source-bin-item-removed',
    itemId: item.id,
    sourceKey: item.sourceKey,
  });
  const removed = await waitForSourceLibraryItemStateAcrossWorkspaceTargets(targetsByWorkspace, {
    itemId: item.id,
    label: renamedLabel,
    shouldExist: false,
  });

  return {
    itemId: item.id,
    origins: {
      add: addWorkspace,
      rename: renameWorkspace,
      remove: removeWorkspace,
    },
    versions: {
      add: add.version,
      rename: rename.version,
      remove: remove.version,
    },
    visibleIn: Object.fromEntries(NATIVE_SMOKE_WORKSPACES.map((workspace) => [
      workspace,
      Boolean(added[workspace]?.visibleInRenderer && renamed[workspace]?.visibleInRenderer && removed[workspace]?.removedFromRenderer),
    ])),
  };
}

async function applySourceLibraryChangeFromWorkspace(target, change) {
  const result = await evaluateCdpExpression(target.webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const bridge = window.signalLoomNative;
      if (!bridge) return { error: 'native bridge missing' };
      const change = ${JSON.stringify(change)};
      const startedAt = Date.now();
      while (!window.signalLoomAutomation?.applySourceLibraryChange && Date.now() - startedAt < 5000) {
        await sleep(100);
      }
      const automation = window.signalLoomAutomation;
      const nativeResult = automation?.applySourceLibraryChange
        ? await automation.applySourceLibraryChange(change)
        : await bridge.applySourceLibraryChange(change);
      if (typeof BroadcastChannel === 'function') {
        const channel = new BroadcastChannel('signal-loom-workspace-window-commands');
        channel.postMessage({
          senderId: 'native-real-project-soak-harness',
          command: change,
        });
        channel.close();
      }
      return nativeResult;
    })()
  `, 15000);

  if (result.error || !result.ok) {
    throw new Error(`Real-project soak Source Library change failed: ${JSON.stringify({ change, result })}`);
  }
  return result;
}

async function waitForSourceLibraryItemStateAcrossWorkspaceTargets(targetsByWorkspace, expectation) {
  const results = {};
  for (const workspace of NATIVE_SMOKE_WORKSPACES) {
    const result = await waitForSourceLibraryItemStateInWorkspace(targetsByWorkspace[workspace], expectation);
    if (result.hasRecoveryBoundary) {
      throw new Error(`Real-project soak ${workspace} workspace showed a recovery boundary during Source Library churn.`);
    }
    if (expectation.shouldExist && !result.hasExpectedItem) {
      throw new Error(`Real-project soak Source Library item did not converge in ${workspace}: ${JSON.stringify(result)}`);
    }
    if (!expectation.shouldExist && !result.removedFromSnapshot) {
      throw new Error(`Real-project soak Source Library item did not disappear from ${workspace}: ${JSON.stringify(result)}`);
    }
    results[workspace] = result;
  }
  return results;
}

async function waitForSourceLibraryItemStateInWorkspace(target, { itemId, label, shouldExist }) {
  return evaluateCdpExpression(target.webSocketDebuggerUrl, `
    (async () => {
      const bridge = window.signalLoomNative;
      if (!bridge) return { error: 'native bridge missing' };
      const itemId = ${JSON.stringify(itemId)};
      const label = ${JSON.stringify(label)};
      const shouldExist = ${JSON.stringify(shouldExist)};
      const startedAt = Date.now();
      let lastState = {};

      while (Date.now() - startedAt < 8000) {
        const snapshot = await bridge.getSourceLibrarySnapshot();
        const items = (snapshot.snapshot?.bins ?? []).flatMap((bin) => bin.items ?? []);
        const item = items.find((candidate) => candidate.id === itemId);
        const bodyText = document.body?.innerText || '';
        const rendererItemIds = (document.querySelector('[data-source-library-renderer-item-ids]')?.getAttribute('data-source-library-renderer-item-ids') || '')
          .split(/\\s+/)
          .filter(Boolean);
        const rendererStateHasItem = rendererItemIds.includes(encodeURIComponent(itemId));
        const hasRecoveryBoundary = bodyText.includes('Recovery Boundary');
        lastState = {
          workspace: new URL(location.href).searchParams.get('workspace') || 'flow',
          version: snapshot.version,
          itemCount: items.length,
          hasExpectedItem: Boolean(item && item.label === label),
          removedFromSnapshot: !item,
          visibleInRenderer: rendererStateHasItem || bodyText.includes(label),
          removedFromRenderer: !rendererStateHasItem && !bodyText.includes(label),
          rendererStateHasItem,
          hasRecoveryBoundary,
        };

        if (!hasRecoveryBoundary && shouldExist && lastState.hasExpectedItem && lastState.visibleInRenderer) return lastState;
        if (!hasRecoveryBoundary && !shouldExist && lastState.removedFromSnapshot && lastState.removedFromRenderer) return lastState;

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return lastState;
    })()
  `, 10000);
}

async function inspectWorkspaceTargets(targetsByWorkspace) {
  const inspections = {};
  for (const workspace of NATIVE_SMOKE_WORKSPACES) {
    const target = targetsByWorkspace[workspace];
    const inspection = await evaluateCdpExpression(target.webSocketDebuggerUrl, `
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const bridge = window.signalLoomNative;
        if (!bridge) return { error: 'native bridge missing' };
        const startedAt = Date.now();
        while (!document.body && Date.now() - startedAt < 10000) {
          await sleep(50);
        }
        const workspace = new URL(location.href).searchParams.get('workspace') || 'flow';
        const snapshot = await bridge.getSourceLibrarySnapshot();
        const sourceItems = (snapshot.snapshot?.bins ?? []).flatMap((bin) => bin.items ?? []);
        const rendererItemIds = (document.querySelector('[data-source-library-renderer-item-ids]')?.getAttribute('data-source-library-renderer-item-ids') || '')
          .split(/\\s+/)
          .filter(Boolean);
        const paperWorkspace = document.querySelector('[data-signal-loom-paper-workspace="true"]');
        return {
          workspace,
          title: document.title,
          url: location.href,
          hasRecoveryBoundary: Boolean(document.body?.innerText.includes('Recovery Boundary')),
          hasAutomationSourceLibraryChange: typeof window.signalLoomAutomation?.applySourceLibraryChange === 'function',
          sourceItemCount: sourceItems.length,
          rendererSourceItemCount: rendererItemIds.length,
          paperPageCount: Number(paperWorkspace?.getAttribute('data-paper-page-count') || '0'),
          bodyTextLength: (document.body?.innerText || '').length,
        };
      })()
    `, 20000);

    if (inspection.error) throw new Error(String(inspection.error));
    if (inspection.hasRecoveryBoundary) {
      throw new Error(`Real-project soak ${workspace} workspace opened to a recovery boundary.`);
    }
    if (workspace === 'paper' && inspection.paperPageCount < 1) {
      throw new Error(`Real-project soak Paper workspace did not expose loaded pages: ${JSON.stringify(inspection)}`);
    }
    inspections[workspace] = inspection;
  }
  return inspections;
}

async function collectWorkspaceMetrics(targetsByWorkspace) {
  const metrics = {};
  for (const workspace of NATIVE_SMOKE_WORKSPACES) {
    metrics[workspace] = summarizePerformanceMetrics(
      await getPerformanceMetrics(targetsByWorkspace[workspace].webSocketDebuggerUrl),
    );
  }
  return metrics;
}

function summarizePerformanceMetrics(metrics) {
  return {
    jsHeapUsedBytes: Math.round(metrics.JSHeapUsedSize ?? 0),
    jsHeapTotalBytes: Math.round(metrics.JSHeapTotalSize ?? 0),
    documents: Math.round(metrics.Documents ?? 0),
    nodes: Math.round(metrics.Nodes ?? 0),
    jsEventListeners: Math.round(metrics.JSEventListeners ?? 0),
    layoutCount: Math.round(metrics.LayoutCount ?? 0),
    recalcStyleCount: Math.round(metrics.RecalcStyleCount ?? 0),
    taskDurationMs: Math.round((metrics.TaskDuration ?? 0) * 1000),
  };
}

async function getPerformanceMetrics(webSocketDebuggerUrl) {
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
    await sendCdp(socket, pending, () => {
      id += 1;
      return id;
    }, 'HeapProfiler.collectGarbage', {}, 10000).catch(() => undefined);
    await sendCdp(socket, pending, () => {
      id += 1;
      return id;
    }, 'Performance.enable', {}, 10000);
    const response = await sendCdp(socket, pending, () => {
      id += 1;
      return id;
    }, 'Performance.getMetrics', {}, 10000);
    return Object.fromEntries((response.result?.metrics ?? []).map((metric) => [metric.name, metric.value]));
  } finally {
    socket.close();
  }
}

async function waitForSignalLoomTarget(electron, port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before the real-project soak target appeared.\n${electron.logs.join('')}`);
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
      throw new Error(`Electron exited before all real-project soak workspace targets appeared.\n${electron.logs.join('')}`);
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
  throw new Error(`Timed out waiting for real-project soak workspace targets. Found: ${[...found.keys()].join(', ') || 'none'}.`);
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

function workspaceForCycle(cycle, offset) {
  return NATIVE_SMOKE_WORKSPACES[(cycle - 1 + offset) % NATIVE_SMOKE_WORKSPACES.length];
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
