#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import projectFileModule from '../electron/project-files.cjs';
import {
  SMOKE_PNG_BASE64,
  NATIVE_SMOKE_WORKSPACES,
  assertNativeAssetProtocolSmokeResult,
  assertNativePaperOsFileDropSmokeResult,
  assertNativePaperOsFileDropWorkspacePropagationResult,
  assertNativeProjectImportWorkspacePropagationResult,
  assertNativeSmokeResult,
  buildNativeSmokePaperOsFileDropExpression,
  buildNativeSmokePaperOsFileDropWorkspacePropagationExpression,
  buildNativeSmokeBridgeExpression,
  buildNativeSmokeEnvironment,
  buildNativeSmokeOptions,
  buildNativeSmokePaths,
  buildNativeSmokeProjectImportWorkspacePropagationExpression,
  buildNativeSmokeSourceLibraryItem,
  buildNativeSmokeStressRenameLabel,
  buildNativeSmokeStressSourceLibraryItem,
} from './native-smoke-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { buildNativeAssetUrl } = projectFileModule;
const smokeRoot = process.env.SIGNAL_LOOM_NATIVE_SMOKE_DIR || join(tmpdir(), 'signal-loom-native-smoke');
const remoteDebuggingPort = Number(process.env.SIGNAL_LOOM_NATIVE_SMOKE_PORT || 9227);
const smokeOptions = buildNativeSmokeOptions({
  argv: process.argv.slice(2),
  env: process.env,
});
const reportStage = (stage) => process.stderr.write(`[native-smoke] ${stage}\n`);

async function main() {
  if (!Number.isInteger(remoteDebuggingPort) || remoteDebuggingPort <= 0) {
    throw new Error('SIGNAL_LOOM_NATIVE_SMOKE_PORT must be a positive integer.');
  }

  const paths = buildNativeSmokePaths(smokeRoot);
  await rm(paths.rootDir, { recursive: true, force: true });
  await mkdir(paths.rootDir, { recursive: true });
  await seedNativeSmokeUserProfile(paths.userDataDir);
  await writeFile(paths.panelPath, Buffer.from(SMOKE_PNG_BASE64, 'base64'));
  await writeFile(paths.sourceLibraryImportPath, Buffer.from(SMOKE_PNG_BASE64, 'base64'));

  const electron = launchElectron(paths.rootDir);

  try {
    reportStage('waiting for Flow renderer');
    const target = await waitForSignalLoomTarget(electron, remoteDebuggingPort);
    reportStage('Flow renderer found');
    const result = await evaluateNativeSmoke(target.webSocketDebuggerUrl);
    assertNativeSmokeResult(result);
    reportStage('project save/open, import, and Paper exports passed');
    await evaluateCdpExpression(target.webSocketDebuggerUrl, `
      (() => {
        setTimeout(() => location.reload(), 0);
        return { ok: true };
      })()
    `, 5000);
    await delay(1000);
    const workspaceTargets = await waitForWorkspaceTargets(electron, remoteDebuggingPort);
    const workspaces = await inspectWorkspaceTargets(workspaceTargets);
    reportStage('workspace windows passed');
    const paperOsFileDrop = await exercisePaperOsFileDrop(workspaceTargets.paper);
    reportStage('Paper OS file drop passed');
    const paperOsFileDropWorkspacePropagation = await exercisePaperOsFileDropWorkspacePropagation(
      workspaceTargets,
      paperOsFileDrop,
    );
    reportStage('Paper Source Library propagation passed');
    const projectImport = await exerciseProjectSourceLibraryImportAcrossWorkspaceTargets(workspaceTargets, paths);
    reportStage('project Source Library import passed');
    const assetProtocol = await exerciseNativeAssetProtocolAuthorization(target.webSocketDebuggerUrl, paths, result);
    reportStage('native asset protocol passed');
    const sourceLibrary = await exerciseSourceLibraryAcrossWorkspaceTargets(workspaceTargets);
    reportStage('Source Library mutation propagation passed');
    const stress = await exerciseSourceLibraryStressAcrossWorkspaceTargets(workspaceTargets, smokeOptions);
    reportStage('Source Library stress passed');
    const files = await verifyNativeSmokeFiles(paths);

    console.log(JSON.stringify({
      ok: true,
      rootDir: paths.rootDir,
      result,
      paperOsFileDrop,
      paperOsFileDropWorkspacePropagation,
      projectImport,
      assetProtocol,
      workspaces,
      sourceLibrary,
      stress,
      files,
    }, null, 2));
  } finally {
    await stopElectron(electron);
  }
}

async function seedNativeSmokeUserProfile(userDataDir) {
  const sourceRoot = process.env.SIGNAL_LOOM_NATIVE_SMOKE_PROFILE_SOURCE;
  if (!sourceRoot) return;
  await mkdir(userDataDir, { recursive: true });
  for (const relativePath of ['Local State', 'Preferences', 'Local Storage']) {
    const sourcePath = join(sourceRoot, relativePath);
    const destinationPath = join(userDataDir, relativePath);
    await cp(sourcePath, destinationPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

function launchElectron(rootDir) {
  const electronCli = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const args = process.platform === 'win32'
    ? [`--remote-debugging-port=${remoteDebuggingPort}`, '.']
    : [electronCli, `--remote-debugging-port=${remoteDebuggingPort}`, '.'];
  const command = process.platform === 'win32' ? electronCli : process.execPath;
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: buildNativeSmokeEnvironment({ baseEnv: process.env, rootDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  child.logs = logs;
  return child;
}

async function waitForSignalLoomTarget(electron, port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before the native smoke target appeared.\n${electron.logs.join('')}`);
    }
    try {
      const targets = await fetch(url).then((response) => response.json());
      const flowTarget = targets.find((target) => workspaceFromTargetUrl(target.url) === 'flow' && target.webSocketDebuggerUrl);
      if (flowTarget) {
        return flowTarget;
      }
      const signalLoomTarget = targets.find((target) => target.title === 'Sloom Studio' || target.title === 'Signal Loom');
      if (signalLoomTarget?.webSocketDebuggerUrl) {
        return signalLoomTarget;
      }
      const fallbackTarget = targets.find((target) => target.webSocketDebuggerUrl);
      if (fallbackTarget) {
        return fallbackTarget;
      }
    } catch {
      // Electron may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Electron DevTools target on port ${port}.\n${electron.logs.join('')}`);
}

async function evaluateNativeSmoke(webSocketDebuggerUrl) {
  return evaluateCdpExpression(webSocketDebuggerUrl, buildNativeSmokeBridgeExpression(), 90000);
}

async function exerciseNativeAssetProtocolAuthorization(webSocketDebuggerUrl, paths, result) {
  const scratchDirectoryPath = result.save?.scratchDirectoryPath;

  if (!scratchDirectoryPath) {
    throw new Error(`Native asset protocol smoke missing scratch directory: ${JSON.stringify(result.save)}`);
  }

  const unregisteredScratchPath = join(scratchDirectoryPath, 'unregistered-protocol-probe.png');
  const outsidePath = join(paths.rootDir, 'outside-protocol-secret.png');
  const symlinkPath = join(scratchDirectoryPath, 'symlink-protocol-escape.png');

  await Promise.all([
    writeFile(unregisteredScratchPath, Buffer.from(SMOKE_PNG_BASE64, 'base64')),
    writeFile(outsidePath, Buffer.from(SMOKE_PNG_BASE64, 'base64')),
  ]);

  let symlinkProbe = { skipped: true, reason: 'symlink unavailable on this platform' };
  if (process.platform !== 'win32') {
    await symlink(outsidePath, symlinkPath);
    symlinkProbe = undefined;
  }

  const protocolResult = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const unregisteredScratchUrl = ${JSON.stringify(buildNativeAssetUrl(unregisteredScratchPath))};
      const symlinkEscapeUrl = ${JSON.stringify(symlinkProbe ? undefined : buildNativeAssetUrl(symlinkPath))};
      const bridge = window.signalLoomNative;
      const symlinkItemId = 'native-smoke-symlink-escape';

      if (!bridge) return { error: 'native bridge missing' };
      const snapshot = await bridge.getSourceLibrarySnapshot();
      const registeredItem = (snapshot.snapshot?.bins ?? [])
        .flatMap((bin) => bin.items ?? [])
        .find((item) => item.id === 'smoke-image' && typeof item.assetUrl === 'string' && item.assetUrl.startsWith('signal-loom-asset://'));

      if (!registeredItem) {
        return { error: 'opened project source library did not expose smoke-image as a native registered asset url' };
      }

      let symlinkItem = { skipped: true };
      if (symlinkEscapeUrl) {
        const apply = await bridge.applySourceLibraryChange({
          type: 'source-bin-items-added',
          items: [{
            id: symlinkItemId,
            label: 'Native smoke symlink escape',
            kind: 'image',
            mimeType: 'image/png',
            assetUrl: symlinkEscapeUrl,
            nativeFilePath: ${JSON.stringify(symlinkPath)},
            sourceKey: 'native-smoke-symlink-escape',
            createdAt: Date.now(),
          }],
        });
        const afterSymlinkSnapshot = await bridge.getSourceLibrarySnapshot();
        const hasItem = (afterSymlinkSnapshot.snapshot?.bins ?? [])
          .flatMap((bin) => bin.items ?? [])
          .some((item) => item.id === symlinkItemId && item.assetUrl === symlinkEscapeUrl);
        symlinkItem = {
          apply,
          version: afterSymlinkSnapshot.version,
          hasItem,
        };
      }

      const probe = async (url) => {
        try {
          const response = await fetch(url);
          const bytes = response.ok ? (await response.arrayBuffer()).byteLength : 0;
          const text = response.ok ? '' : await response.text().catch(() => '');
          return {
            ok: response.ok,
            status: response.status,
            bytes,
            text: text.slice(0, 160),
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            bytes: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      };

      return {
        registeredItem: {
          id: registeredItem.id,
          label: registeredItem.label,
          assetUrl: registeredItem.assetUrl,
        },
        symlinkItem,
        registered: await probe(registeredItem.assetUrl),
        unregisteredScratch: await probe(unregisteredScratchUrl),
        symlinkEscape: symlinkEscapeUrl ? await probe(symlinkEscapeUrl) : ${JSON.stringify(symlinkProbe)},
      };
    })()
  `, 30000);

  if (protocolResult.error) {
    throw new Error(`Native asset protocol smoke failed: ${protocolResult.error}`);
  }

  return assertNativeAssetProtocolSmokeResult(protocolResult);
}

async function exercisePaperOsFileDrop(paperTarget) {
  const pageNumber = 2;
  const result = await evaluateCdpExpression(
    paperTarget.webSocketDebuggerUrl,
    buildNativeSmokePaperOsFileDropExpression({
      fileName: 'native-smoke-paper-page-2-os-drop.png',
      pageNumber,
      ensurePageCount: pageNumber,
    }),
    30000,
  );

  return assertNativePaperOsFileDropSmokeResult(result, {
    pageNumber,
  });
}

async function exercisePaperOsFileDropWorkspacePropagation(targetsByWorkspace, paperOsFileDrop) {
  const fileName = 'native-smoke-paper-page-2-os-drop.png';
  const expectedEnvelope = paperOsFileDrop.envelopeLabel || `Page ${paperOsFileDrop.pageNumber} imports`;
  const expression = buildNativeSmokePaperOsFileDropWorkspacePropagationExpression({
    envelopeLabel: expectedEnvelope,
    fileName,
    itemId: paperOsFileDrop.snapshotItemId,
    mimeType: 'image/png',
  });

  const workspaces = [];
  for (const workspace of NATIVE_SMOKE_WORKSPACES) {
    workspaces.push(await evaluateCdpExpression(
      targetsByWorkspace[workspace].webSocketDebuggerUrl,
      expression,
      25000,
    ));
  }

  return assertNativePaperOsFileDropWorkspacePropagationResult({
    expectedEnvelope,
    fileName,
    itemId: paperOsFileDrop.snapshotItemId,
    workspaces,
  });
}

async function exerciseProjectSourceLibraryImportAcrossWorkspaceTargets(targetsByWorkspace, paths) {
  const fileName = 'native-smoke-source-library-import.png';
  const expectedEnvelope = 'Project imports';

  await setFileInputFilesInTarget(
    targetsByWorkspace.flow.webSocketDebuggerUrl,
    '[data-source-library-import-input="true"]',
    [paths.sourceLibraryImportPath],
    15000,
  );

  const flowImport = await evaluateCdpExpression(
    targetsByWorkspace.flow.webSocketDebuggerUrl,
    buildNativeSmokeProjectImportWorkspacePropagationExpression({
      fileName,
    }),
    30000,
  );
  const itemId = flowImport.snapshotItemId || flowImport.itemId;
  const expression = buildNativeSmokeProjectImportWorkspacePropagationExpression({
    fileName,
    itemId,
  });

  const workspaces = [];
  for (const workspace of NATIVE_SMOKE_WORKSPACES) {
    workspaces.push(await evaluateCdpExpression(
      targetsByWorkspace[workspace].webSocketDebuggerUrl,
      expression,
      25000,
    ));
  }

  return assertNativeProjectImportWorkspacePropagationResult({
    expectedEnvelope,
    fileName,
    itemId,
    flowImport,
    workspaces,
  });
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
          throw new Error(`Native smoke context was destroyed after retries: ${JSON.stringify(response)}`);
        }
        await delay(250);
        continue;
      }

      const result = response.result?.result;
      if (!result || !Object.prototype.hasOwnProperty.call(result, 'value')) {
        throw new Error(`Native smoke returned no bridge value: ${JSON.stringify(response)}`);
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

  throw new Error('Native smoke CDP evaluation failed after retries.');
}

async function setFileInputFilesInTarget(webSocketDebuggerUrl, selector, files, timeoutMs) {
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

  const nextId = () => {
    id += 1;
    return id;
  };
  const startedAt = Date.now();
  let lastResult;

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const documentResult = await sendCdp(socket, pending, nextId, 'DOM.getDocument', {}, 5000);
      const rootNodeId = documentResult.result?.root?.nodeId;
      if (!rootNodeId) {
        lastResult = documentResult;
        await delay(100);
        continue;
      }

      const queryResult = await sendCdp(socket, pending, nextId, 'DOM.querySelector', {
        nodeId: rootNodeId,
        selector,
      }, 5000);
      const nodeId = queryResult.result?.nodeId;
      if (!nodeId) {
        lastResult = queryResult;
        await delay(100);
        continue;
      }

      const setResult = await sendCdp(socket, pending, nextId, 'DOM.setFileInputFiles', {
        nodeId,
        files,
      }, 10000);
      if (setResult.error) {
        throw new Error(`DOM.setFileInputFiles failed: ${JSON.stringify(setResult.error)}`);
      }

      return { selector, files };
    }
  } finally {
    socket.close();
  }

  throw new Error(`Timed out waiting for file input ${selector}: ${JSON.stringify(lastResult)}`);
}

async function waitForWorkspaceTargets(electron, port) {
  const expected = new Set(NATIVE_SMOKE_WORKSPACES);
  const found = new Map();
  const url = `http://127.0.0.1:${port}/json/list`;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before all workspace targets appeared.\n${electron.logs.join('')}`);
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

  throw new Error(`Timed out waiting for workspace targets. Found: ${[...found.keys()].join(', ') || 'none'}.`);
}

function workspaceFromTargetUrl(value) {
  try {
    const workspace = new URL(value).searchParams.get('workspace');
    return NATIVE_SMOKE_WORKSPACES.includes(workspace) ? workspace : undefined;
  } catch {
    return undefined;
  }
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
        while (!document.body && Date.now() - startedAt < 10000) {
          await sleep(50);
        }
        const workspace = new URL(location.href).searchParams.get('workspace') || 'flow';
        let paperTitlebarToolbar;
        if (workspace === 'paper') {
          while (Date.now() - startedAt < 30000) {
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
          paperTitlebarToolbar,
        };
      })()
    `, 15000);
    if (inspection.hasRecoveryBoundary) {
      throw new Error(`Native ${workspace} workspace opened to a recovery boundary.`);
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
        throw new Error(`Native Paper toolbar was not mounted in the titlebar slot: ${JSON.stringify(toolbar)}`);
      }
    }
    inspections[workspace] = inspection;
  }
  return inspections;
}

async function exerciseSourceLibraryAcrossWorkspaceTargets(targetsByWorkspace) {
  const item = buildNativeSmokeSourceLibraryItem();
  const addResult = await evaluateCdpExpression(targetsByWorkspace.flow.webSocketDebuggerUrl, `
    (async () => {
      const bridge = window.signalLoomNative;
      if (!bridge) return { error: 'native bridge missing' };
      const item = ${JSON.stringify(item)};
      const apply = await bridge.applySourceLibraryChange({
        type: 'source-bin-items-added',
        items: [item],
      });
      const snapshot = await bridge.getSourceLibrarySnapshot();
      const items = (snapshot.snapshot?.bins ?? []).flatMap((bin) => bin.items ?? []);
      return {
        apply,
        version: snapshot.version,
        hasItem: items.some((candidate) => candidate.id === item.id && candidate.label === item.label),
        itemCount: items.length,
      };
    })()
  `, 15000);

  if (addResult.error || !addResult.apply?.ok || !addResult.hasItem) {
    throw new Error(`Native Source Library add/snapshot smoke failed: ${JSON.stringify(addResult)}`);
  }

  const snapshots = await waitForSourceLibraryItemStateAcrossWorkspaceTargets(targetsByWorkspace, {
    itemId: item.id,
    label: item.label,
    shouldExist: true,
  });

  return {
    itemId: item.id,
    label: item.label,
    addResult,
    snapshots,
  };
}

async function exerciseSourceLibraryStressAcrossWorkspaceTargets(targetsByWorkspace, options) {
  if (!options.stressCycles) {
    return {
      skipped: true,
      cycles: 0,
      delayMs: options.stressDelayMs,
    };
  }

  const startedAt = Date.now();
  const cycles = [];

  for (let cycle = 1; cycle <= options.stressCycles; cycle += 1) {
    const item = buildNativeSmokeStressSourceLibraryItem({ cycle });
    const renamedLabel = buildNativeSmokeStressRenameLabel(cycle);
    const addWorkspace = workspaceForStressCycle(cycle, 0);
    const renameWorkspace = workspaceForStressCycle(cycle, 1);
    const removeWorkspace = workspaceForStressCycle(cycle, 2);
    const cycleStartedAt = Date.now();

    const addResult = await applySourceLibraryChangeFromWorkspace(targetsByWorkspace[addWorkspace], {
      type: 'source-bin-items-added',
      items: [item],
    });
    const addedState = await waitForSourceLibraryItemStateAcrossWorkspaceTargets(targetsByWorkspace, {
      itemId: item.id,
      label: item.label,
      shouldExist: true,
    });

    const renameResult = await applySourceLibraryChangeFromWorkspace(targetsByWorkspace[renameWorkspace], {
      type: 'source-bin-item-renamed',
      itemId: item.id,
      label: renamedLabel,
    });
    const renamedState = await waitForSourceLibraryItemStateAcrossWorkspaceTargets(targetsByWorkspace, {
      itemId: item.id,
      label: renamedLabel,
      shouldExist: true,
    });

    const removeResult = await applySourceLibraryChangeFromWorkspace(targetsByWorkspace[removeWorkspace], {
      type: 'source-bin-item-removed',
      itemId: item.id,
      sourceKey: item.sourceKey,
    });
    const removedState = await waitForSourceLibraryItemStateAcrossWorkspaceTargets(targetsByWorkspace, {
      itemId: item.id,
      label: renamedLabel,
      shouldExist: false,
    });
    await inspectWorkspaceTargets(targetsByWorkspace);

    cycles.push({
      cycle,
      itemId: item.id,
      origins: {
        add: addWorkspace,
        rename: renameWorkspace,
        remove: removeWorkspace,
      },
      versions: {
        add: addResult.version,
        rename: renameResult.version,
        remove: removeResult.version,
      },
      elapsedMs: Date.now() - cycleStartedAt,
      visibleIn: Object.fromEntries(NATIVE_SMOKE_WORKSPACES.map((workspace) => [
        workspace,
        Boolean(addedState[workspace]?.visibleInRenderer && renamedState[workspace]?.visibleInRenderer && removedState[workspace]?.removedFromRenderer),
      ])),
    });

    if (options.stressDelayMs > 0) {
      await delay(options.stressDelayMs);
    }
  }

  return {
    skipped: false,
    cycles: cycles.length,
    delayMs: options.stressDelayMs,
    elapsedMs: Date.now() - startedAt,
    samples: cycles,
  };
}

async function applySourceLibraryChangeFromWorkspace(target, change) {
  const result = await evaluateCdpExpression(target.webSocketDebuggerUrl, `
    (async () => {
      const bridge = window.signalLoomNative;
      if (!bridge) return { error: 'native bridge missing' };
      return bridge.applySourceLibraryChange(${JSON.stringify(change)});
    })()
  `, 15000);

  if (result.error || !result.ok) {
    throw new Error(`Native Source Library stress change failed: ${JSON.stringify({ change, result })}`);
  }

  return result;
}

async function waitForSourceLibraryItemStateAcrossWorkspaceTargets(targetsByWorkspace, expectation) {
  const results = {};

  for (const workspace of NATIVE_SMOKE_WORKSPACES) {
    const result = await waitForSourceLibraryItemStateInWorkspace(targetsByWorkspace[workspace], expectation);
    if (result.hasRecoveryBoundary) {
      throw new Error(`Native ${workspace} workspace showed a recovery boundary during Source Library stress.`);
    }
    if (expectation.shouldExist && (!result.hasExpectedItem || !result.visibleInRenderer)) {
      throw new Error(`Native Source Library stress item did not converge in ${workspace}: ${JSON.stringify(result)}`);
    }
    if (!expectation.shouldExist && (!result.removedFromSnapshot || !result.removedFromRenderer)) {
      throw new Error(`Native Source Library stress item did not disappear from ${workspace}: ${JSON.stringify(result)}`);
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
          hasItem: Boolean(item && item.label === label),
          hasExpectedItem: Boolean(item && item.label === label),
          removedFromSnapshot: !item,
          visibleInRenderer: rendererStateHasItem || bodyText.includes(label),
          removedFromRenderer: !rendererStateHasItem && !bodyText.includes(label),
          rendererStateHasItem,
          hasRecoveryBoundary,
        };

        if (!hasRecoveryBoundary && shouldExist && lastState.hasExpectedItem && lastState.visibleInRenderer) {
          return lastState;
        }
        if (!hasRecoveryBoundary && !shouldExist && lastState.removedFromSnapshot && lastState.removedFromRenderer) {
          return lastState;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return lastState;
    })()
  `, 10000);
}

function workspaceForStressCycle(cycle, offset) {
  return NATIVE_SMOKE_WORKSPACES[(cycle - 1 + offset) % NATIVE_SMOKE_WORKSPACES.length];
}

function sendCdp(socket, pending, nextId, method, params, timeoutMs) {
  const callId = nextId();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(callId);
      reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    pending.set(callId, { resolve, timeout });
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
}

async function verifyNativeSmokeFiles(paths) {
  const [project, pdf, image] = await Promise.all([
    verifyFile(paths.projectPath, { minBytes: 100, magic: Buffer.from('{') }),
    verifyFile(paths.pdfPath, { minBytes: 100, magic: Buffer.from('%PDF') }),
    verifyFile(paths.expectedPaperImagePath, { minBytes: 1, magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }),
  ]);

  return { project, pdf, image };
}

async function verifyFile(filePath, { minBytes, magic }) {
  const info = await stat(filePath);
  if (info.size < minBytes) {
    throw new Error(`${filePath} is too small for native smoke output: ${info.size} bytes.`);
  }
  const firstBytes = await readFile(filePath, { encoding: null });
  if (!firstBytes.subarray(0, magic.length).equals(magic)) {
    throw new Error(`${filePath} did not match expected file signature.`);
  }
  return { filePath, bytes: info.size };
}

async function stopElectron(electron) {
  if (electron.exitCode !== null) return;
  electron.kill('SIGINT');
  const exited = await Promise.race([
    once(electron, 'exit').then(() => true),
    delay(5000).then(() => false),
  ]);
  if (!exited && electron.exitCode === null) {
    electron.kill('SIGKILL');
    await once(electron, 'exit').catch(() => undefined);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
