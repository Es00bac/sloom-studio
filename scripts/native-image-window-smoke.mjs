#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = /^--([^=]+)=(.*)$/.exec(argument);
  if (!match) throw new Error(`Unknown argument: ${argument}`);
  return [match[1], match[2]];
}));
const appPath = resolve(
  options.app?.trim() || '/home/cabewse/.local/opt/signal-loom/signal-loom',
);
const outputPath = resolve(
  options.output?.trim() || join(repoRoot, 'output/playwright/installed-image-window.png'),
);
const port = Number(options.port || 9247);

if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error('--port must be between 1024 and 65535.');
}

const profileRoot = await mkdtemp(join(tmpdir(), 'sloom-native-image-window-'));
const userDataPath = join(profileRoot, 'user-data');
await mkdir(userDataPath, { recursive: true });
// Avoid the intentional first-GPU-crash relaunch obscuring the CDP target in
// headless Xvfb environments. This profile is isolated and deleted afterward.
await writeFile(join(userDataPath, 'gpu-fallback.flag'), String(Date.now()));
const logs = [];
const launch = process.platform === 'linux'
  ? {
      command: '/usr/bin/xvfb-run',
      args: ['-a', appPath, `--remote-debugging-port=${port}`, '--ozone-platform=x11'],
    }
  : {
      command: appPath,
      args: [`--remote-debugging-port=${port}`],
    };
const child = spawn(launch.command, launch.args, {
  cwd: repoRoot,
  detached: process.platform !== 'win32',
  env: {
    ...process.env,
    SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: userDataPath,
    SIGNAL_LOOM_ELECTRON_PANEL_MENU: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

try {
  const flowTarget = await waitForTarget((target) => {
    if (!target.webSocketDebuggerUrl || target.type !== 'page') return false;
    if (target.url?.includes('signal-loom-splash.html')) return false;
    return isRendererTarget(target) && workspaceFromTarget(target) === 'flow';
  }, 'Flow');

  const openResult = await evaluate(flowTarget.webSocketDebuggerUrl, `
    (async () => {
      const started = Date.now();
      while (!window.signalLoomNative?.openWorkspaceWindow) {
        if (Date.now() - started > 20000) throw new Error('Native bridge did not become ready.');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const languageGate = document.querySelector('[data-first-run-language-gate="true"]');
      if (languageGate) {
        const detectedLanguage = languageGate.querySelector('button[autofocus]')
          || languageGate.querySelector('button');
        if (detectedLanguage instanceof HTMLButtonElement) detectedLanguage.click();
      }
      while (Date.now() - started < 20000) {
        const communityNotice = document.querySelector('[data-community-notice="true"]');
        const continueButton = document.querySelector('[data-community-notice-continue="true"]');
        if (communityNotice && continueButton instanceof HTMLButtonElement && !continueButton.disabled) {
          continueButton.click();
        }
        if (
          !document.querySelector('[data-first-run-language-gate="true"]')
          && !document.querySelector('[data-community-notice="true"]')
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return window.signalLoomNative.openWorkspaceWindow('image');
    })()
  `);
  if (!openResult?.ok) {
    throw new Error(`Opening Image failed: ${JSON.stringify(openResult)}`);
  }

  const imageTarget = await waitForTarget(
    (target) => target.type === 'page'
      && Boolean(target.webSocketDebuggerUrl)
      && isRendererTarget(target)
      && workspaceFromTarget(target) === 'image',
    'Image',
  );
  const inspection = await evaluate(imageTarget.webSocketDebuggerUrl, `
    (async () => {
      const started = Date.now();
      while (document.readyState !== 'complete') {
        if (Date.now() - started > 20000) throw new Error('Image document did not finish loading.');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const languageGate = document.querySelector('[data-first-run-language-gate="true"]');
      if (languageGate) {
        const detectedLanguage = languageGate.querySelector('button[autofocus]')
          || languageGate.querySelector('button');
        if (!(detectedLanguage instanceof HTMLButtonElement)) {
          throw new Error('First-run language gate had no language button.');
        }
        detectedLanguage.click();
      }
      while (Date.now() - started < 30000) {
        const communityNotice = document.querySelector('[data-community-notice="true"]');
        const continueButton = document.querySelector('[data-community-notice-continue="true"]');
        if (communityNotice && continueButton instanceof HTMLButtonElement && !continueButton.disabled) {
          continueButton.click();
        }
        if (
          !document.querySelector('[data-first-run-language-gate="true"]')
          && !document.querySelector('[data-community-notice="true"]')
          && document.querySelector('[data-image-workspace-document-chrome="true"]')
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bodyText = document.body?.innerText ?? '';
      const snapProfileUrl = new URL('icc/SNAP_TR002_newsprint.icc', document.baseURI).href;
      const beforeFetch = location.href;
      const response = await fetch(snapProfileUrl);
      const profileBytes = response.ok ? (await response.arrayBuffer()).byteLength : 0;
      const fetchNavigationStable = location.href === beforeFetch;
      location.assign(snapProfileUrl);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        href: location.href,
        baseUri: document.baseURI,
        title: document.title,
        contentType: document.contentType,
        readyState: document.readyState,
        bodyTextStart: bodyText.replace(/\\s+/g, ' ').slice(0, 500),
        bodyTextLength: bodyText.length,
        rootChildCount: document.querySelector('#root')?.childElementCount ?? -1,
        imageChrome: document.querySelectorAll('[data-image-workspace-document-chrome="true"]').length,
        imageControls: document.querySelectorAll('[data-image-workspace-controls-bar="true"]').length,
        scripts: [...document.scripts].map((script) => script.src).filter(Boolean),
        styleSheetCount: document.styleSheets.length,
        snapProfile: {
          url: snapProfileUrl,
          ok: response.ok,
          status: response.status,
          bytes: profileBytes,
          fetchNavigationStable,
          mainFrameNavigationBlocked: location.href === beforeFetch,
        },
      };
    })()
  `);

  if (
    inspection.contentType !== 'text/html'
    || inspection.readyState !== 'complete'
    || inspection.rootChildCount < 1
    || inspection.imageChrome < 1
    || !inspection.snapProfile?.ok
    || !inspection.snapProfile?.fetchNavigationStable
    || !inspection.snapProfile?.mainFrameNavigationBlocked
    || inspection.bodyTextStart.includes('SNAP TR002')
  ) {
    throw new Error(`Installed Image workspace is invalid: ${JSON.stringify(inspection)}`);
  }

  await sendCdp(imageTarget.webSocketDebuggerUrl, 'Page.bringToFront', {});
  await evaluate(imageTarget.webSocketDebuggerUrl, `
    new Promise((resolve) => requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(() => resolve(true), 250))))
  `);
  const screenshot = await sendCdp(
    imageTarget.webSocketDebuggerUrl,
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false, fromSurface: false },
  );
  if (typeof screenshot?.data !== 'string' || screenshot.data.length === 0) {
    throw new Error('CDP did not return an Image screenshot.');
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));

  console.log(JSON.stringify({
    ok: true,
    appPath,
    outputPath,
    inspection,
  }, null, 2));
} finally {
  await stopChild();
  await rm(profileRoot, { recursive: true, force: true });
}

function workspaceFromTarget(target) {
  try {
    return new URL(target.url).searchParams.get('workspace') || 'flow';
  } catch {
    return null;
  }
}

function isRendererTarget(target) {
  try {
    return new URL(target.url).pathname.endsWith('/index.html');
  } catch {
    return false;
  }
}

async function waitForTarget(predicate, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Installed app exited before ${label} appeared.\n${logs.join('').slice(-5000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(predicate);
      if (target) return target;
    } catch {
      // Electron's DevTools endpoint may still be starting.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for installed ${label} target.\n${logs.join('').slice(-5000)}`);
}

async function evaluate(webSocketDebuggerUrl, expression) {
  const result = await sendCdp(webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, 45_000);
  if (result?.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Installed-app evaluation failed.',
    );
  }
  if (!result?.result || !Object.prototype.hasOwnProperty.call(result.result, 'value')) {
    throw new Error(`Installed-app evaluation returned no value: ${JSON.stringify(result)}`);
  }
  return result.result.value;
}

async function sendCdp(webSocketDebuggerUrl, method, params, timeoutMs = 30_000) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.once('open', resolveOpen);
    socket.once('error', rejectOpen);
  });
  try {
    return await new Promise((resolveMessage, rejectMessage) => {
      const timer = setTimeout(() => {
        rejectMessage(new Error(`Timed out waiting for CDP ${method}.`));
      }, timeoutMs);
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error) {
          rejectMessage(new Error(`CDP ${method} failed: ${JSON.stringify(message.error)}`));
        } else {
          resolveMessage(message.result);
        }
      });
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally {
    socket.close();
  }
}

async function stopChild() {
  if (child.exitCode !== null) return;
  const signal = (name) => {
    try {
      if (process.platform === 'win32') child.kill(name);
      else process.kill(-child.pid, name);
    } catch {
      // The isolated process group already exited.
    }
  };
  signal('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(3_000),
  ]);
  if (child.exitCode === null) signal('SIGKILL');
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
