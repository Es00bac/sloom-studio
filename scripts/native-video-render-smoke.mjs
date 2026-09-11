#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  NATIVE_VIDEO_RENDER_SMOKE_DEBUG_PORT,
  NATIVE_VIDEO_RENDER_SMOKE_RENDER_PORT,
  assertNativeVideoRenderSmokeResult,
  buildNativeRealProjectStartupState,
  buildNativeVideoRenderSmokeEnvironment,
  buildNativeVideoRenderSmokePaths,
  buildNativeVideoRenderSmokeProjectDocument,
  buildNativeVideoRenderSmokeRendererEnvironment,
  buildNativeVideoRenderSmokeSettingsStorage,
} from './native-smoke-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const smokeRoot = process.env.SIGNAL_LOOM_NATIVE_VIDEO_RENDER_SMOKE_DIR || join(tmpdir(), 'signal-loom-native-video-render-smoke');
const remoteDebuggingPort = Number(process.env.SIGNAL_LOOM_NATIVE_VIDEO_RENDER_SMOKE_PORT || NATIVE_VIDEO_RENDER_SMOKE_DEBUG_PORT);
const renderPort = Number(process.env.SIGNAL_LOOM_NATIVE_VIDEO_RENDER_PORT || NATIVE_VIDEO_RENDER_SMOKE_RENDER_PORT);

async function main() {
  if (!Number.isInteger(remoteDebuggingPort) || remoteDebuggingPort <= 0) {
    throw new Error('SIGNAL_LOOM_NATIVE_VIDEO_RENDER_SMOKE_PORT must be a positive integer.');
  }
  if (!Number.isInteger(renderPort) || renderPort <= 0) {
    throw new Error('SIGNAL_LOOM_NATIVE_VIDEO_RENDER_PORT must be a positive integer.');
  }

  const paths = buildNativeVideoRenderSmokePaths(smokeRoot);
  await rm(paths.rootDir, { recursive: true, force: true });
  await mkdir(paths.userDataDir, { recursive: true });
  await writeFile(paths.projectPath, `${JSON.stringify(buildNativeVideoRenderSmokeProjectDocument(), null, 2)}\n`, 'utf8');
  await writeFile(paths.startupProjectStatePath, buildNativeRealProjectStartupState(paths.projectPath), 'utf8');

  const renderer = launchNativeRenderer(paths.outputVideoPath);
  const electron = launchElectron(paths.rootDir);

  try {
    const nativeRenderHealth = await waitForNativeRendererHealth(renderer);
    const mainTarget = await waitForSignalLoomTarget(electron, remoteDebuggingPort);
    await configureNativeRenderSettings(mainTarget.webSocketDebuggerUrl);
    const openResult = await openVideoWorkspace(mainTarget.webSocketDebuggerUrl);
    const videoTarget = await waitForWorkspaceTarget(electron, remoteDebuggingPort, 'editor');
    const workspacePreflight = await waitForVideoWorkspaceReady(videoTarget.webSocketDebuggerUrl);
    const render = await exerciseVideoRender(videoTarget.webSocketDebuggerUrl);
    let outputVideo;
    if (render.mp4Base64) {
      await writeFile(paths.outputVideoPath, Buffer.from(render.mp4Base64, 'base64'));
    } else if (render.render?.sourceLibraryVideoItem?.nativeFilePath) {
      await writeFile(paths.outputVideoPath, await readFile(render.render.sourceLibraryVideoItem.nativeFilePath));
    }

    const hasOutputVideo = await stat(paths.outputVideoPath).then(() => true, () => false);
    if (hasOutputVideo) {
      outputVideo = await verifyFile(paths.outputVideoPath, {
        minBytes: 1000,
        magicOffset: 4,
        magic: Buffer.from('ftyp'),
      });
      if (!render.render.bytes) {
        render.render.bytes = outputVideo.bytes;
      }
      if (!render.render.fileSignature) {
        render.render.fileSignature = outputVideo.fileSignature;
      }
    }
    const reportPayload = {
      ok: true,
      rootDir: paths.rootDir,
      projectPath: paths.projectPath,
      nativeRender: {
        port: renderPort,
        health: nativeRenderHealth,
      },
      openResult,
      workspacePreflight,
      workspace: render.workspace,
      render: {
        ...render.render,
        outputVideoPath: paths.outputVideoPath,
      },
      files: {
        outputVideo,
      },
    };
    let report;

    try {
      report = assertNativeVideoRenderSmokeResult(reportPayload);
    } catch (error) {
      await writeFile(paths.reportPath, `${JSON.stringify({
        ...reportPayload,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        reportPath: paths.reportPath,
      }, null, 2)}\n`, 'utf8');
      throw error;
    }

    await writeFile(paths.reportPath, `${JSON.stringify({ ...report, reportPath: paths.reportPath }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, reportPath: paths.reportPath }, null, 2));
  } finally {
    await stopProcess(electron);
    await stopProcess(renderer);
  }
}

function launchNativeRenderer(outputPath) {
  const child = spawn(process.execPath, ['ops/native-render/local-renderer.mjs'], {
    cwd: repoRoot,
    env: buildNativeVideoRenderSmokeRendererEnvironment({
      baseEnv: process.env,
      renderPort,
      outputPath,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  child.logs = logs;
  return child;
}

function launchElectron(rootDir) {
  const electronCli = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const args = process.platform === 'win32'
    ? [`--remote-debugging-port=${remoteDebuggingPort}`, '.']
    : [electronCli, `--remote-debugging-port=${remoteDebuggingPort}`, '.'];
  const command = process.platform === 'win32' ? electronCli : process.execPath;
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: buildNativeVideoRenderSmokeEnvironment({ baseEnv: process.env, rootDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  child.logs = logs;
  return child;
}

async function waitForNativeRendererHealth(renderer) {
  const url = `http://127.0.0.1:${renderPort}/health`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (renderer.exitCode !== null) {
      throw new Error(`Native render service exited before health was reachable.\n${renderer.logs.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Service may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for native render service on ${url}.\n${renderer.logs.join('')}`);
}

async function waitForSignalLoomTarget(electron, port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before the Signal Loom target appeared.\n${electron.logs.join('')}`);
    }
    try {
      const targets = await fetch(url).then((response) => response.json());
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

async function waitForWorkspaceTarget(electron, port, workspace) {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before the ${workspace} workspace target appeared.\n${electron.logs.join('')}`);
    }
    try {
      const targets = await fetch(url).then((response) => response.json());
      const target = targets.find((candidate) => {
        try {
          return new URL(candidate.url).searchParams.get('workspace') === workspace && candidate.webSocketDebuggerUrl;
        } catch {
          return false;
        }
      });
      if (target?.webSocketDebuggerUrl) {
        return target;
      }
    } catch {
      // Window may still be opening.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${workspace} workspace target.`);
}

async function configureNativeRenderSettings(webSocketDebuggerUrl) {
  return evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      localStorage.setItem('flow-settings-storage', ${JSON.stringify(buildNativeVideoRenderSmokeSettingsStorage({ renderPort }))});
      return { ok: true, settings: localStorage.getItem('flow-settings-storage') };
    })()
  `, 15000);
}

async function openVideoWorkspace(webSocketDebuggerUrl) {
  return evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const bridge = window.signalLoomNative;
      if (!bridge) return { error: 'native bridge missing' };
      return bridge.openWorkspaceWindow('editor');
    })()
  `, 30000);
}

async function inspectVideoWorkspace(webSocketDebuggerUrl) {
  return evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const bodyText = document.body?.innerText || '';
      return {
        url: location.href,
        title: document.title,
        hasRecoveryBoundary: bodyText.includes('Recovery Boundary'),
        renderButtonCount: document.querySelectorAll('[data-video-render-button="true"]').length,
        renderedPreviewCount: document.querySelectorAll('[data-video-rendered-preview="true"]').length,
        bodyText: bodyText.slice(0, 1000),
      };
    })()
  `, 15000);
}

async function waitForVideoWorkspaceReady(webSocketDebuggerUrl) {
  let lastState = {};
  for (let attempt = 0; attempt < 160; attempt += 1) {
    lastState = await inspectVideoWorkspace(webSocketDebuggerUrl);
    if (lastState.hasRecoveryBoundary || lastState.renderButtonCount > 0) {
      return lastState;
    }
    await delay(250);
  }
  return lastState;
}

async function exerciseVideoRender(webSocketDebuggerUrl) {
  const clicked = await clickVideoRenderButton(webSocketDebuggerUrl);
  if (!clicked.clickedRender || clicked.hasRecoveryBoundary) {
    return {
      workspace: clicked,
      render: {
        previewVideoPresent: false,
        bytes: 0,
      },
    };
  }

  let lastState = {
    workspace: clicked,
    render: {
      previewVideoPresent: false,
      bytes: 0,
      statusMessage: 'Timed out waiting for rendered preview.',
    },
  };

  for (let attempt = 0; attempt < 240; attempt += 1) {
    let nextState;
    try {
      nextState = await readVideoRenderState(webSocketDebuggerUrl);
    } catch (error) {
      const inspected = await inspectVideoWorkspace(webSocketDebuggerUrl).catch(() => ({}));
      nextState = {
        workspace: {
          url: inspected.url,
          hasRecoveryBoundary: Boolean(inspected.hasRecoveryBoundary),
          renderButtonFound: inspected.renderButtonCount > 0,
          clickedRender: true,
          sourceLoaded: inspected.bodyText?.includes('Native Video Render Smoke') || inspected.bodyText?.includes('Native video render source'),
          bodyText: inspected.bodyText,
        },
        render: {
          previewVideoPresent: false,
          bytes: 0,
          failed: true,
          statusMessage: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (nextState?.workspace || nextState?.render) {
      lastState = nextState;
    } else {
      const inspected = await inspectVideoWorkspace(webSocketDebuggerUrl);
      lastState = {
        workspace: {
          url: inspected.url,
          hasRecoveryBoundary: inspected.hasRecoveryBoundary,
          renderButtonFound: inspected.renderButtonCount > 0,
          clickedRender: true,
          sourceLoaded: inspected.bodyText?.includes('Native Video Render Smoke') || inspected.bodyText?.includes('Native video render source'),
          bodyText: inspected.bodyText,
        },
        render: {
          previewVideoPresent: false,
          bytes: 0,
          statusMessage: 'Render poll returned an empty CDP object.',
        },
      };
    }
    if (lastState.render?.previewVideoPresent || lastState.workspace?.hasRecoveryBoundary || lastState.render?.failed) {
      return lastState;
    }
    await delay(500);
  }

  return lastState;
}

async function clickVideoRenderButton(webSocketDebuggerUrl) {
  return evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const bodyText = document.body?.innerText || '';
      const button = document.querySelector('[data-video-render-button="true"]');
      if (button) button.click();
      return {
        url: location.href,
        hasRecoveryBoundary: bodyText.includes('Recovery Boundary'),
        renderButtonFound: Boolean(button),
        clickedRender: Boolean(button),
        sourceLoaded: bodyText.includes('Native Video Render Smoke') || bodyText.includes('Native video render source'),
        bodyText: bodyText.slice(0, 1200),
      };
    })()
  `, 15000);
}

async function readVideoRenderState(webSocketDebuggerUrl) {
  return evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const bytesToBase64 = (bytes) => {
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        return btoa(binary);
      };
      const signatureOf = (bytes) => Array.from(bytes.slice(0, 16))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      const readBlobUrl = async (url) => {
        try {
          const response = await fetch(url);
          return await response.blob();
        } catch (fetchError) {
          return await new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open('GET', url);
            request.responseType = 'blob';
            request.onload = () => {
              if (request.status === 0 || (request.status >= 200 && request.status < 300)) {
                resolve(request.response);
              } else {
                reject(new Error(\`XHR blob read failed with status \${request.status}\`));
              }
            };
            request.onerror = () => reject(fetchError instanceof Error ? fetchError : new Error(String(fetchError)));
            request.send();
          });
        }
      };
      const bodyText = document.body?.innerText || '';
      let video = document.querySelector('[data-video-rendered-preview="true"]');
      const renderedPreviewTab = document.querySelector('[data-video-rendered-preview-tab="true"]');
      if (!video && renderedPreviewTab && !renderedPreviewTab.disabled) {
        renderedPreviewTab.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        video = document.querySelector('[data-video-rendered-preview="true"]');
      }
      const workspace = {
        url: location.href,
        hasRecoveryBoundary: bodyText.includes('Recovery Boundary'),
        renderButtonFound: Boolean(document.querySelector('[data-video-render-button="true"]')),
        clickedRender: true,
        sourceLoaded: bodyText.includes('Native Video Render Smoke') || bodyText.includes('Native video render source'),
        renderedPreviewTabEnabled: Boolean(renderedPreviewTab && !renderedPreviewTab.disabled),
      };

      if (video?.src) {
        const result = {
          workspace,
          render: {
            previewVideoPresent: true,
            bytes: 0,
            mimeType: 'video/mp4',
            videoSrc: video.src,
            statusMessage: bodyText.match(/Rendered editor sequence[^\\n]+/)?.[0] || '',
          },
        };
        try {
          const blob = await readBlobUrl(video.src);
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          result.render.bytes = bytes.byteLength;
          result.render.mimeType = blob.type || 'video/mp4';
          result.render.fileSignature = signatureOf(bytes);
          result.mp4Base64 = bytesToBase64(bytes);
        } catch (error) {
          result.render.fetchError = error instanceof Error ? error.message : String(error);
          const bridge = window.signalLoomNative;
          const snapshot = bridge ? await bridge.getSourceLibrarySnapshot() : undefined;
          const items = (snapshot?.snapshot?.bins ?? []).flatMap((bin) => bin.items ?? []);
          const videoItem = [...items].reverse().find((item) => item.kind === 'video' && (item.nativeFilePath || item.assetUrl));
          result.render.sourceLibraryVideoItem = videoItem
            ? {
                id: videoItem.id,
                label: videoItem.label,
                mimeType: videoItem.mimeType,
                assetUrl: videoItem.assetUrl,
                nativeFilePath: videoItem.nativeFilePath,
                scratchFileName: videoItem.scratchFileName,
              }
            : undefined;
        }
        return result;
      }

      return {
        workspace: {
          ...workspace,
          bodyText: bodyText.slice(0, 1200),
        },
        render: {
          previewVideoPresent: false,
          bytes: 0,
          failed: bodyText.includes('Render Failed'),
          statusMessage: bodyText.includes('Render Failed')
            ? bodyText.match(/Render Failed[\\s\\S]{0,500}/)?.[0] || ''
            : bodyText.match(/Rendering live[\\s\\S]{0,300}/)?.[0] || '',
        },
      };
    })()
  `, 30000);
}

async function evaluateCdpExpression(webSocketDebuggerUrl, expression, timeoutMs) {
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

    if (response.result?.exceptionDetails) {
      const details = response.result.exceptionDetails;
      throw new Error(`CDP expression failed: ${details.text || details.exception?.description || JSON.stringify(details)}`);
    }

    if (response.result?.result?.subtype === 'error') {
      throw new Error(`CDP expression returned an error object: ${response.result.result.description || JSON.stringify(response.result.result)}`);
    }

    const value = response.result?.result?.value;
    if (!value) {
      throw new Error(`CDP expression returned no value: ${JSON.stringify(response)}`);
    }
    return value;
  } finally {
    socket.close();
  }
}

function sendCdp(socket, pending, nextId, method, params, timeoutMs) {
  const callId = nextId();
  socket.send(JSON.stringify({ id: callId, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(callId);
      reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    pending.set(callId, { resolve, timeout });
  });
}

async function verifyFile(filePath, { minBytes, magic, magicOffset = 0 }) {
  const info = await stat(filePath);
  if (info.size < minBytes) {
    throw new Error(`${filePath} is too small for native video render smoke output: ${info.size} bytes.`);
  }
  const firstBytes = await readFile(filePath, { encoding: null });
  if (!firstBytes.subarray(magicOffset, magicOffset + magic.length).equals(magic)) {
    throw new Error(`${filePath} did not match expected file signature.`);
  }
  return {
    filePath,
    bytes: info.size,
    fileSignature: firstBytes.subarray(0, 16).toString('hex'),
  };
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    delay(5000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit').catch(() => undefined);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
