#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import WebSocket from 'ws';

const args = new Map(process.argv.slice(2).map((entry) => {
  const [key, ...rest] = entry.split('=');
  return [key, rest.join('=')];
}));
const documentPath = resolve(args.get('--document') || '');
const outputPath = resolve(args.get('--output') || '');
const screenshotPath = resolve(args.get('--screenshot') || `${outputPath}.soft-proof.png`);
const port = Number(args.get('--port') || process.env.SIGNAL_LOOM_NATIVE_SMOKE_PORT || 9250);
const appPath = process.env.SIGNAL_LOOM_INSTALLED_APP || '/home/cabewse/.local/opt/signal-loom/signal-loom';

async function main() {
  if (!args.get('--document') || !args.get('--output')) {
    throw new Error('Usage: native-paper-kdp-soft-proof-smoke.mjs --document=/path/file.slppr --output=/path/file.pdf [--screenshot=/path/proof.png] [--port=9250]');
  }
  if (!Number.isInteger(port) || port <= 0) throw new Error('--port must be a positive integer.');
  await Promise.all([stat(documentPath), stat(appPath)]);
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(screenshotPath), { recursive: true });

  const app = launchInstalledApp();
  try {
    const mainTarget = await waitForTarget(app, (target) => {
      try {
        return target.type === 'page'
          && new URL(target.url).searchParams.get('workspace') === 'flow'
          && target.webSocketDebuggerUrl;
      } catch {
        return false;
      }
    }, 30000);
    const openResult = await evaluate(mainTarget.webSocketDebuggerUrl, `
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let bridge = window.signalLoomNative;
        const startedAt = Date.now();
        while (!bridge && Date.now() - startedAt < 10000) {
          await sleep(100);
          bridge = window.signalLoomNative;
        }
        if (!bridge) return { error: 'native bridge missing', href: location.href };
        return bridge.openWorkspaceWindow('paper');
      })()
    `, 20000);
    if (openResult?.error || openResult?.ok === false) {
      throw new Error(`Could not open Paper workspace: ${JSON.stringify(openResult)}`);
    }

    const paperTarget = await waitForTarget(app, (target) => {
      try {
        return new URL(target.url).searchParams.get('workspace') === 'paper' && target.webSocketDebuggerUrl;
      } catch {
        return false;
      }
    }, 30000);

    await setFileInputFiles(
      paperTarget.webSocketDebuggerUrl,
      'input[accept*=".slppr"]',
      [documentPath],
      15000,
    );
    const opened = await waitForPaperDocument(paperTarget.webSocketDebuggerUrl, 2, 60000);
    const softProof = await exerciseSoftProof(paperTarget.webSocketDebuggerUrl, screenshotPath);
    const kdp = await exerciseKdpExport(paperTarget.webSocketDebuggerUrl);
    const pdf = await waitForFile(outputPath, 1000, 600000);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      documentPath,
      outputPath,
      screenshotPath,
      opened,
      softProof,
      kdp,
      pdf,
    }, null, 2)}\n`);
  } finally {
    await stopApp(app);
  }
}

function launchInstalledApp() {
  const child = spawn(appPath, [`--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS: '1',
      SIGNAL_LOOM_AUTOMATION_PAPER_PDF_PATH: outputPath,
      SIGNAL_LOOM_ELECTRON_PANEL_MENU: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.logs = [];
  child.stdout.on('data', (chunk) => child.logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => child.logs.push(chunk.toString()));
  return child;
}

async function waitForTarget(app, predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (app.exitCode !== null) throw new Error(`Installed app exited early.\n${app.logs.join('')}`);
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const target = targets.find(predicate);
      if (target) return target;
    } catch {
      // DevTools endpoint may still be starting.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for an installed-app target on port ${port}.\n${app.logs.join('')}`);
}

async function waitForPaperDocument(webSocketDebuggerUrl, expectedPages, timeoutMs) {
  const result = await evaluate(webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const startedAt = Date.now();
      while (Date.now() - startedAt < ${JSON.stringify(timeoutMs)}) {
        const bodyText = document.body?.innerText ?? '';
        if (bodyText.includes('Recovery Boundary')) return { error: 'Recovery Boundary' };
        const workspace = document.querySelector('[data-signal-loom-paper-workspace="true"]');
        const pageCount = Number(workspace?.getAttribute('data-paper-page-count') || '0');
        if (pageCount >= ${JSON.stringify(expectedPages)}) {
          return { pageCount, title: document.title, href: location.href };
        }
        await sleep(200);
      }
      return { error: 'timeout', bodyText: (document.body?.innerText ?? '').slice(0, 1000) };
    })()
  `, timeoutMs + 5000);
  if (result.error) throw new Error(`Paper document did not open: ${JSON.stringify(result)}`);
  return result;
}

async function exerciseSoftProof(webSocketDebuggerUrl, destination) {
  const result = await evaluate(webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.dispatchEvent(new CustomEvent('signal-loom:native-renderer-command', {
        detail: { command: 'paper:soft-proof' },
      }));
      const startedAt = Date.now();
      while (Date.now() - startedAt < 180000) {
        const ready = document.querySelector('img[data-soft-proof-status="ready"]');
        if (ready) {
          return {
            status: 'ready',
            width: ready.naturalWidth,
            height: ready.naturalHeight,
            dataUrlPrefix: ready.getAttribute('src')?.slice(0, 32),
            heading: document.querySelector('[data-paper-soft-proof-modal="true"]')?.textContent?.trim().slice(0, 240),
            elapsedMs: Date.now() - startedAt,
          };
        }
        const error = document.querySelector('[data-soft-proof-status="error"]');
        if (error) return { status: 'error', message: error.textContent?.trim() };
        await sleep(250);
      }
      return { status: 'timeout', bodyText: (document.body?.innerText ?? '').slice(-1500) };
    })()
  `, 190000);
  if (result.status !== 'ready' || result.width <= 0 || result.height <= 0) {
    throw new Error(`Soft Proof did not render: ${JSON.stringify(result)}`);
  }

  const previewDataUrl = await evaluate(webSocketDebuggerUrl, `
    document.querySelector('img[data-soft-proof-status="ready"]')?.getAttribute('src') || ''
  `, 30000);
  const previewBase64 = typeof previewDataUrl === 'string' ? previewDataUrl.split(',', 2)[1] : '';
  if (!previewBase64) throw new Error('Soft Proof produced no PNG preview bytes.');
  await writeFile(destination, Buffer.from(previewBase64, 'base64'));
  await evaluate(webSocketDebuggerUrl, `(() => {
    document.querySelector('button[aria-label="Close soft proof"]')?.click();
    return !document.querySelector('[data-paper-soft-proof-modal="true"]');
  })()`, 10000);
  return result;
}

async function exerciseKdpExport(webSocketDebuggerUrl) {
  const result = await evaluate(webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.dispatchEvent(new CustomEvent('signal-loom:native-renderer-command', {
        detail: { command: 'paper:export-kdp-pdf' },
      }));
      const startedAt = Date.now();
      let lastStatus = '';
      while (Date.now() - startedAt < 600000) {
        const lines = (document.body?.innerText ?? '').split('\\n').map((line) => line.trim()).filter(Boolean);
        lastStatus = lines.find((line) =>
          line.includes('Saved KDP-targeted PDF/X-1a')
          || line.includes('KDP PDF export failed')
          || line.includes('KDP PDF/X-1a export canceled')
          || line.includes('PDF/X-1a export blocked')
        ) || lastStatus;
        if (lastStatus) return { statusLine: lastStatus, elapsedMs: Date.now() - startedAt };
        await sleep(500);
      }
      return { error: 'timeout', lastStatus, bodyText: (document.body?.innerText ?? '').slice(-2000) };
    })()
  `, 610000);
  if (result.error || !result.statusLine?.includes('Saved KDP-targeted PDF/X-1a')) {
    throw new Error(`KDP export did not finish successfully: ${JSON.stringify(result)}`);
  }
  return result;
}

async function setFileInputFiles(webSocketDebuggerUrl, selector, files, timeoutMs) {
  return withCdp(webSocketDebuggerUrl, async (send) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const documentResult = await send('DOM.getDocument', {}, 5000);
      const rootNodeId = documentResult.result?.root?.nodeId;
      if (!rootNodeId) {
        await delay(100);
        continue;
      }
      const queryResult = await send('DOM.querySelector', { nodeId: rootNodeId, selector }, 5000);
      const nodeId = queryResult.result?.nodeId;
      if (!nodeId) {
        await delay(100);
        continue;
      }
      const setResult = await send('DOM.setFileInputFiles', { nodeId, files }, 10000);
      if (setResult.error) throw new Error(`DOM.setFileInputFiles failed: ${JSON.stringify(setResult.error)}`);
      return { selector, files };
    }
    throw new Error(`Timed out waiting for file input ${selector}.`);
  });
}

async function evaluate(webSocketDebuggerUrl, expression, timeoutMs) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await withCdp(webSocketDebuggerUrl, async (send) => {
        const response = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }, timeoutMs);
        const result = response.result?.result;
        if (response.error || response.result?.exceptionDetails || !result || !Object.prototype.hasOwnProperty.call(result, 'value')) {
          throw new Error(`CDP evaluation failed: ${JSON.stringify(response)}`);
        }
        return result.value;
      });
    } catch (error) {
      if (attempt === 2) throw error;
      await delay(300);
    }
  }
  throw new Error('CDP evaluation failed after retries.');
}

async function withCdp(webSocketDebuggerUrl, operation) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    pending.delete(message.id);
    entry.resolve(message);
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.once('open', resolveOpen);
    socket.once('error', rejectOpen);
  });
  const send = (method, params, timeoutMs) => {
    id += 1;
    const messageId = id;
    const result = new Promise((resolveMessage, rejectMessage) => {
      const timeout = setTimeout(() => {
        pending.delete(messageId);
        rejectMessage(new Error(`Timed out waiting for CDP ${method}.`));
      }, timeoutMs);
      pending.set(messageId, { resolve: resolveMessage, timeout });
    });
    socket.send(JSON.stringify({ id: messageId, method, params }));
    return result;
  };
  try {
    return await operation(send);
  } finally {
    socket.close();
  }
}

async function waitForFile(filePath, minimumBytes, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const info = await stat(filePath);
      if (info.size >= minimumBytes) return { bytes: info.size };
    } catch {
      // Save may still be in progress.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${filePath}.`);
}

async function stopApp(app) {
  if (app.exitCode !== null) return;
  app.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => app.once('exit', resolveExit)),
    delay(5000),
  ]);
  if (app.exitCode === null) app.kill('SIGKILL');
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
