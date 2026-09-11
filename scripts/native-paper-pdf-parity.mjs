#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  buildNativeRealProjectSmokeEnvironment,
  buildNativeRealProjectSmokePaths,
  buildNativeRealProjectStartupState,
} from './native-smoke-lib.mjs';
import { buildNativeWindowPageCrop } from './native-paper-pdf-parity-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const remoteDebuggingPort = Number(process.env.SIGNAL_LOOM_NATIVE_SMOKE_PORT || 9241);
const smokeRoot = process.env.SIGNAL_LOOM_NATIVE_SMOKE_DIR || join(tmpdir(), 'signal-loom-native-paper-pdf-parity');
const projectPath = getProjectPath(process.argv.slice(2), process.env);
const requestedPagesArg = getOptionValue(process.argv.slice(2), '--pages') || process.env.SIGNAL_LOOM_NATIVE_PDF_PARITY_PAGES || '';

async function main() {
  if (!projectPath) {
    throw new Error('Provide a real project with --project=/path/to/project.sloom or SIGNAL_LOOM_NATIVE_REAL_PROJECT_PATH.');
  }
  if (!projectPath.toLowerCase().endsWith('.sloom')) {
    throw new Error('PDF parity smoke requires a restored .sloom file, not a .sloom.bak-* backup path.');
  }
  if (!Number.isInteger(remoteDebuggingPort) || remoteDebuggingPort <= 0) {
    throw new Error('SIGNAL_LOOM_NATIVE_SMOKE_PORT must be a positive integer.');
  }

  await stat(projectPath);
  const paths = buildNativeRealProjectSmokePaths(smokeRoot, projectPath);
  const capturesDir = join(paths.rootDir, 'editor-pages');
  const pdfPagesDir = join(paths.rootDir, 'pdf-pages');
  const diffsDir = join(paths.rootDir, 'diffs');

  await rm(paths.rootDir, { recursive: true, force: true });
  await mkdir(paths.userDataDir, { recursive: true });
  await mkdir(capturesDir, { recursive: true });
  await mkdir(pdfPagesDir, { recursive: true });
  await mkdir(diffsDir, { recursive: true });
  await writeFile(paths.startupProjectStatePath, buildNativeRealProjectStartupState(projectPath), 'utf8');

  const electron = launchElectron(paths);

  try {
    const flowTarget = await waitForSignalLoomTarget(electron, remoteDebuggingPort);
    const startup = await inspectStartupProjectAndOpenPaper(flowTarget.webSocketDebuggerUrl);
    const pages = parseRequestedPages(requestedPagesArg, startup.paperPages);
    const paperTarget = await waitForPaperTarget(electron, remoteDebuggingPort);
    await preparePaperWorkspaceForParityCapture(paperTarget.webSocketDebuggerUrl, startup.paperPages);
    const editorCaptures = [];
    for (const pageNumber of pages) {
      editorCaptures.push(await captureEditorPage(paperTarget.webSocketDebuggerUrl, {
        outputPath: join(capturesDir, `editor-page-${padPage(pageNumber)}.png`),
        pageNumber,
        totalPages: startup.paperPages,
      }));
    }

    const paperExport = await exportPaperPdfFromPaperWorkspace(paperTarget.webSocketDebuggerUrl, startup.paperPages);
    const pdf = await waitForFile(paths.pdfPath, 1000, 300000);
    const comparisons = [];
    for (const capture of editorCaptures) {
      const pdfPage = await rasterizePdfPage({
        outputDir: pdfPagesDir,
        pageNumber: capture.pageNumber,
        pdfPath: paths.pdfPath,
      });
      comparisons.push(await compareEditorCaptureToPdfPage({
        diffPath: join(diffsDir, `page-${padPage(capture.pageNumber)}-diff.png`),
        editorCapture: capture,
        pdfPage,
        resizedPdfPath: join(pdfPagesDir, `pdf-page-${padPage(capture.pageNumber)}-resized.png`),
      }));
    }

    const report = {
      ok: true,
      rootDir: paths.rootDir,
      projectPath,
      startup,
      requestedPages: pages,
      paperExport,
      pdf,
      editorCaptures,
      comparisons,
      note: 'Diff metrics are evidence for review, not an automatic visual-pass threshold. Editor captures hide Paper editor-only overlays before screenshot.',
    };
    const reportPath = join(paths.rootDir, 'paper-pdf-parity-report.json');
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
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
  const args = process.platform === 'win32'
    ? [`--remote-debugging-port=${remoteDebuggingPort}`, '.']
    : [electronCli, `--remote-debugging-port=${remoteDebuggingPort}`, '.'];
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

async function inspectStartupProjectAndOpenPaper(webSocketDebuggerUrl) {
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
      const paperWindow = await bridge.openWorkspaceWindow('paper');
      return {
        currentProjectPath: state?.currentProjectPath,
        projectName: document?.name,
        sourceItems: (document?.sourceBin?.bins ?? []).reduce((total, bin) => total + (bin.items?.length ?? 0), 0),
        paperTitle: paperDocument?.title,
        paperPages: paperDocument?.pages?.length ?? 0,
        paperWindow,
        bodyHasRecovery: Boolean(document.body?.innerText.includes('Recovery Boundary')),
      };
    })()
  `, 90000);

  if (result.error) throw new Error(String(result.error));
  if (result.bodyHasRecovery) throw new Error('PDF parity smoke opened Flow to a recovery boundary.');
  if (!result.currentProjectPath || !result.projectName || result.paperPages < 1) {
    throw new Error(`PDF parity smoke did not load a Paper project: ${JSON.stringify(result)}`);
  }
  if (!result.paperWindow?.ok) {
    throw new Error(`PDF parity smoke could not open Paper workspace: ${JSON.stringify(result.paperWindow)}`);
  }
  return result;
}

async function preparePaperWorkspaceForParityCapture(webSocketDebuggerUrl, expectedPaperPages) {
  const result = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const expectedPaperPages = ${JSON.stringify(expectedPaperPages)};
      const startedAt = Date.now();
      while (Date.now() - startedAt < 60000) {
        const paperWorkspace = document.querySelector('[data-signal-loom-paper-workspace="true"]');
        const readyPageCount = Number(paperWorkspace?.getAttribute('data-paper-page-count') || '0');
        if (readyPageCount >= expectedPaperPages) break;
        if ((document.body?.innerText || '').includes('Recovery Boundary')) {
          return { hasRecoveryBoundary: true, readyPageCount };
        }
        await sleep(250);
      }
      const fitButton = Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Fit');
      fitButton?.click();
      await sleep(500);
      const spreadsButton = Array.from(document.querySelectorAll('button'))
        .find((button) => button.getAttribute('aria-label') === 'Spreads');
      const spreadViewMounted = () => Array.from(document.querySelectorAll('section'))
        .some((section) => section.querySelectorAll('[data-paper-page-view]').length > 1);
      if (spreadsButton && spreadViewMounted()) {
        spreadsButton.click();
        for (let attempt = 0; attempt < 20 && spreadViewMounted(); attempt += 1) {
          await sleep(150);
        }
        fitButton?.click();
        await sleep(500);
      }
      const style = document.createElement('style');
      style.id = 'signal-loom-pdf-parity-capture-style';
      style.textContent = [
        '[data-signal-loom-usage-bar] { display: none !important; }',
        '[data-dockable-workspace-id="paper"] { display: none !important; }',
        '[data-paper-editor-overlay] { display: none !important; }',
        '[data-paper-page-view] { outline: none !important; box-shadow: none !important; }',
        '.paper-selection-box, .paper-resize-handle, .paper-rotate-handle { display: none !important; }',
      ].join('\\n');
      document.head.appendChild(style);
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const page = document.querySelector('[data-paper-page-view]');
        const rect = page?.getBoundingClientRect();
        if (rect && rect.height <= window.innerHeight - 24 && rect.width <= window.innerWidth - 24) break;
        const zoomOutButton = Array.from(document.querySelectorAll('button'))
          .find((button) => button.textContent?.trim() === '-');
        if (!zoomOutButton) break;
        zoomOutButton.click();
        await sleep(120);
      }
      return {
        hasRecoveryBoundary: Boolean((document.body?.innerText || '').includes('Recovery Boundary')),
        readyPageCount: Number(document.querySelector('[data-signal-loom-paper-workspace="true"]')?.getAttribute('data-paper-page-count') || '0'),
      };
    })()
  `, 75000);

  if (result.hasRecoveryBoundary) throw new Error('PDF parity Paper workspace reached a recovery boundary.');
  if (result.readyPageCount < expectedPaperPages) {
    throw new Error(`PDF parity Paper workspace did not restore all pages: ${JSON.stringify(result)}`);
  }
  return result;
}

async function captureEditorPage(webSocketDebuggerUrl, { outputPath, pageNumber, totalPages }) {
  const geometry = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const pageNumber = ${JSON.stringify(pageNumber)};
      const totalPages = ${JSON.stringify(totalPages)};
      const selector = '[data-paper-page-view][data-paper-page-number="' + pageNumber + '"]';
      const workspace = document.querySelector('[data-signal-loom-paper-workspace="true"]');
      const scroller = workspace?.querySelector('[data-paper-scroll-container="true"]') || workspace?.querySelector('main');
      const median = (values) => {
        const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
        if (!finite.length) return undefined;
        const middle = Math.floor(finite.length / 2);
        return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
      };
      let lastState = {};
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const page = document.querySelector(selector);
        if (page) {
          page.scrollIntoView({ block: 'center', inline: 'center' });
          await sleep(250);
          const pageMount = page.closest('section') || page.parentElement || page;
          const mountedPageNumbers = Array.from(pageMount.querySelectorAll('[data-paper-page-view]'))
            .map((node) => Number(node.getAttribute('data-paper-page-number') || '0'))
            .filter((value) => Number.isFinite(value) && value > 0);
          const nativeState = await window.signalLoomNative?.getNativeState?.().catch(() => undefined);
          const projectDocument = nativeState?.startupProject?.document?.paper?.document;
          const projectPages = projectDocument?.pages ?? [];
          const targetProjectPage = projectPages.find((candidate) => candidate.pageNumber === pageNumber);
          const expectedImageCount = projectPages
            .filter((candidate) => mountedPageNumbers.includes(candidate.pageNumber))
            .reduce((total, projectPage) => total + (projectPage.frames ?? []).filter((frame) =>
              (frame.kind === 'image' || frame.kind === 'panel')
              && frame.asset?.src
              && frame.asset?.mimeType !== 'application/pdf'
            ).length, 0);
          pageMount.querySelectorAll('img').forEach((image) => {
            image.loading = 'eager';
            image.decoding = 'sync';
          });
          const imageStates = Array.from(pageMount.querySelectorAll('img')).map((image) => ({
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            currentSrc: image.currentSrc || image.src || '',
          }));
          const pendingImages = imageStates.filter((image) => !image.complete || image.naturalWidth <= 0);
          const missingRenderedImages = Math.max(0, expectedImageCount - imageStates.length);
          if ((pendingImages.length > 0 || missingRenderedImages > 0) && attempt < 80) {
            lastState = {
              found: true,
              waitingForImages: true,
              expectedImageCount,
              missingRenderedImages,
              pendingImages: pendingImages.length,
              imageCount: imageStates.length,
              hasRecoveryBoundary: Boolean((document.body?.innerText || '').includes('Recovery Boundary')),
              pageNumber,
            };
            await sleep(500);
            continue;
          }
          const pageRect = page.getBoundingClientRect();
          const frameRectProbe = (() => {
            const frameById = new Map((targetProjectPage?.frames ?? []).map((frame) => [frame.id, frame]));
            const probes = Array.from(pageMount.querySelectorAll('[data-paper-frame][data-paper-frame-page-number="' + pageNumber + '"]'))
              .map((node) => {
                const frame = frameById.get(node.getAttribute('data-paper-frame-id') || '');
                const offsetParentRect = node.offsetParent?.getBoundingClientRect?.();
                const leftPx = Number.parseFloat(node.style.left || '');
                const topPx = Number.parseFloat(node.style.top || '');
                const widthPx = Number.parseFloat(node.style.width || '');
                const heightPx = Number.parseFloat(node.style.height || '');
                if (!frame || !offsetParentRect || !Number.isFinite(leftPx) || !Number.isFinite(topPx) || !Number.isFinite(widthPx) || !Number.isFinite(heightPx)) return null;
                if (!frame.widthMm || !frame.heightMm) return null;
                const scaleX = widthPx / frame.widthMm;
                const scaleY = heightPx / frame.heightMm;
                if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;
                return {
                  left: offsetParentRect.left + leftPx - frame.xMm * scaleX,
                  top: offsetParentRect.top + topPx - frame.yMm * scaleY,
                  scaleX,
                  scaleY,
                };
              })
              .filter(Boolean);
            const pageWidthMm = projectDocument?.page?.widthMm;
            const pageHeightMm = projectDocument?.page?.heightMm;
            const scaleX = median(probes.map((probe) => probe.scaleX));
            const scaleY = median(probes.map((probe) => probe.scaleY));
            const left = median(probes.map((probe) => probe.left));
            const top = median(probes.map((probe) => probe.top));
            if (
              probes.length < 2
              || !Number.isFinite(pageWidthMm)
              || !Number.isFinite(pageHeightMm)
              || !Number.isFinite(scaleX)
              || !Number.isFinite(scaleY)
              || !Number.isFinite(left)
              || !Number.isFinite(top)
            ) {
              return null;
            }
            return {
              frameProbeCount: probes.length,
              rect: {
                x: left,
                y: top,
                width: pageWidthMm * scaleX,
                height: pageHeightMm * scaleY,
              },
            };
          })();
          const rect = frameRectProbe?.rect ?? pageRect;
          lastState = {
            found: true,
            hasRecoveryBoundary: Boolean((document.body?.innerText || '').includes('Recovery Boundary')),
            expectedImageCount,
            imageCount: imageStates.length,
            pendingImages: pendingImages.length,
            missingRenderedImages,
            pageNumber,
            rectSource: frameRectProbe ? 'frame-derived' : 'page-element',
            frameProbeCount: frameRectProbe?.frameProbeCount ?? 0,
            pageRect: {
              x: Math.max(0, pageRect.left),
              y: Math.max(0, pageRect.top),
              width: Math.max(1, pageRect.width),
              height: Math.max(1, pageRect.height),
            },
            rect: {
              x: Math.max(0, rect.x ?? rect.left),
              y: Math.max(0, rect.y ?? rect.top),
              width: Math.max(1, rect.width),
              height: Math.max(1, rect.height),
            },
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
              deviceScaleFactor: window.devicePixelRatio || 1,
            },
          };
          return lastState;
        }
        if (scroller) {
          const renderedPageNumbers = Array.from(document.querySelectorAll('[data-paper-page-view]'))
            .map((node) => Number(node.getAttribute('data-paper-page-number') || '0'))
            .filter((value) => Number.isFinite(value) && value > 0);
          const minRenderedPage = renderedPageNumbers.length ? Math.min(...renderedPageNumbers) : 0;
          const maxRenderedPage = renderedPageNumbers.length ? Math.max(...renderedPageNumbers) : 0;
          const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          if (maxRenderedPage > 0 && pageNumber > maxRenderedPage) {
            scroller.scrollTop = Math.min(maxScrollTop, scroller.scrollTop + Math.max(240, scroller.clientHeight * 0.85));
          } else if (minRenderedPage > 0 && pageNumber < minRenderedPage) {
            scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.max(240, scroller.clientHeight * 0.85));
          } else {
            const denominator = Math.max(1, totalPages - 1);
            const ratio = Math.min(1, Math.max(0, (pageNumber - 1) / denominator));
            scroller.scrollTop = ratio * maxScrollTop;
          }
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        lastState = {
          found: false,
          hasPaperWorkspace: Boolean(workspace),
          readyPageCount: Number(workspace?.getAttribute('data-paper-page-count') || '0'),
          scrollTop: scroller?.scrollTop,
          scrollHeight: scroller?.scrollHeight,
          clientHeight: scroller?.clientHeight,
          renderedPageCount: document.querySelectorAll('[data-paper-page-view]').length,
          renderedPageNumbers: Array.from(document.querySelectorAll('[data-paper-page-view]'))
            .map((node) => node.getAttribute('data-paper-page-number'))
            .filter(Boolean)
            .slice(0, 12),
          bodySnippet: (document.body?.innerText || '').slice(0, 500),
          location: location.href,
          pageNumber,
        };
        await sleep(300);
      }
      return {
        ...lastState,
        found: false,
        hasRecoveryBoundary: Boolean((document.body?.innerText || '').includes('Recovery Boundary')),
        pageNumber,
      };
    })()
  `, 95000);

  if (geometry.hasRecoveryBoundary) throw new Error(`PDF parity page ${pageNumber} reached a recovery boundary.`);
  if (!geometry.found || !geometry.rect) {
    throw new Error(`PDF parity could not locate editor page ${pageNumber}: ${JSON.stringify(geometry)}`);
  }
  if (geometry.pendingImages > 0 || geometry.missingRenderedImages > 0) {
    throw new Error(`PDF parity page ${pageNumber} did not finish loading editor images: ${JSON.stringify(geometry)}`);
  }

  const focus = await focusEditorPageForNativeCapture(webSocketDebuggerUrl, pageNumber);
  const viewportPath = outputPath.replace(/\.png$/i, '-viewport.png');
  const screenshot = await captureNativeWindowPng(webSocketDebuggerUrl);
  await writeFile(viewportPath, Buffer.from(screenshot.base64, 'base64'));
  const crop = buildNativeWindowPageCrop({ focus, screenshot });
  await runCommand('convert', [
    viewportPath,
    '-crop',
    crop.argument,
    '+repage',
    outputPath,
  ], {
    cwd: repoRoot,
    timeoutMs: 120000,
  });
  await clearEditorPageNativeCaptureFocus(webSocketDebuggerUrl);
  const size = await identifyImageSize(outputPath);
  return {
    pageNumber,
    outputPath,
    viewportPath,
    geometry: { ...geometry, captureFocus: focus },
    ...size,
  };
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
        const splashGone = !bodyText.includes('Opening Project') && !bodyText.includes('Starting New Project');
        const button = Array.from(document.querySelectorAll('button'))
          .find((candidate) => candidate.textContent?.trim() === 'PDF');
        if (button && splashGone && readyPageCount >= expectedPaperPages) {
          button.click();
          clicked = true;
          break;
        }
        await sleep(250);
      }
      while (Date.now() - startedAt < 15000) {
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
      };
    })()
  `, 320000);

  if (result.hasRecoveryBoundary) throw new Error('PDF parity Paper export reached a recovery boundary.');
  if (result.readyPageCount < expectedPaperPages) {
    throw new Error(`PDF parity Paper export did not wait for the expected page count: ${JSON.stringify(result)}`);
  }
      if (!result.clicked) throw new Error('PDF parity Paper export could not find the PDF button.');
  if (result.statusLine?.includes('failed') || result.statusLine?.includes('canceled')) {
    throw new Error(`PDF parity Paper export did not finish successfully: ${JSON.stringify(result)}`);
  }
  return result;
}

async function rasterizePdfPage({ outputDir, pageNumber, pdfPath }) {
  const prefix = join(outputDir, `pdf-page-${padPage(pageNumber)}`);
  await runCommand('pdftoppm', ['-png', '-r', '144', '-f', String(pageNumber), '-l', String(pageNumber), pdfPath, prefix], {
    cwd: repoRoot,
    timeoutMs: 120000,
  });
  const outputPath = await findGeneratedPdfPage(outputDir, basename(prefix));
  const size = await identifyImageSize(outputPath);
  return {
    pageNumber,
    outputPath,
    ...size,
  };
}

async function compareEditorCaptureToPdfPage({ diffPath, editorCapture, pdfPage, resizedPdfPath }) {
  await runCommand('convert', [
    pdfPage.outputPath,
    '-resize',
    `${editorCapture.width}x${editorCapture.height}!`,
    resizedPdfPath,
  ], {
    cwd: repoRoot,
    timeoutMs: 120000,
  });

  const compare = await runCommand('compare', [
    '-metric',
    'RMSE',
    editorCapture.outputPath,
    resizedPdfPath,
    diffPath,
  ], {
    allowExitCodes: new Set([0, 1]),
    cwd: repoRoot,
    timeoutMs: 120000,
  });

  return {
    pageNumber: editorCapture.pageNumber,
    editorPath: editorCapture.outputPath,
    pdfPath: pdfPage.outputPath,
    resizedPdfPath,
    diffPath,
    editorSize: { width: editorCapture.width, height: editorCapture.height },
    pdfSize: { width: pdfPage.width, height: pdfPage.height },
    rmse: parseCompareRmse(compare.stderr),
    rawMetric: compare.stderr.trim(),
  };
}

async function identifyImageSize(filePath) {
  const result = await runCommand('identify', ['-format', '%w %h', filePath], {
    cwd: repoRoot,
    timeoutMs: 30000,
  });
  const [width, height] = result.stdout.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Could not identify image dimensions for ${filePath}: ${result.stdout}`);
  }
  return { width, height };
}

function parseCompareRmse(value) {
  const match = value.match(/([0-9.]+)(?:\s+\(([0-9.]+)\))?/);
  if (!match) return null;
  return {
    absolute: Number(match[1]),
    normalized: match[2] === undefined ? null : Number(match[2]),
  };
}

async function findGeneratedPdfPage(outputDir, prefixBaseName) {
  const files = await readdir(outputDir);
  const matches = files
    .filter((file) => file.startsWith(prefixBaseName) && file.endsWith('.png'))
    .sort();
  if (matches.length < 1) {
    throw new Error(`pdftoppm did not create a PNG for ${prefixBaseName} in ${outputDir}.`);
  }
  return join(outputDir, matches[0]);
}

async function waitForSignalLoomTarget(electron, port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before the PDF parity target appeared.\n${electron.logs.join('')}`);
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

async function waitForPaperTarget(electron, port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before the PDF parity Paper target appeared.\n${electron.logs.join('')}`);
    }
    try {
      const targets = await fetch(url).then((response) => response.json());
      const paperTarget = targets.find((target) => {
        try {
          return new URL(target.url).searchParams.get('workspace') === 'paper';
        } catch {
          return false;
        }
      });
      if (paperTarget?.webSocketDebuggerUrl) return paperTarget;
    } catch {
      // Window may still be opening.
    }
    await delay(250);
  }
  throw new Error('Timed out waiting for the Paper workspace target.');
}

async function captureNativeWindowPng(webSocketDebuggerUrl) {
  const result = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const bridge = window.signalLoomNative;
      if (!bridge?.captureCurrentWindowPng) return { error: 'native window capture bridge missing' };
      return bridge.captureCurrentWindowPng();
    })()
  `, 120000);
  if (result.error || result.canceled || !result.base64) {
    throw new Error(`Native window capture failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function focusEditorPageForNativeCapture(webSocketDebuggerUrl, pageNumber) {
  const result = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const pageNumber = ${JSON.stringify(pageNumber)};
      document.querySelectorAll('[data-signal-loom-pdf-parity-focused="true"]').forEach((node) => {
        const originalStyle = node.getAttribute('data-signal-loom-pdf-parity-original-style');
        if (originalStyle === null) node.removeAttribute('style');
        else node.setAttribute('style', originalStyle);
        node.removeAttribute('data-signal-loom-pdf-parity-focused');
        node.removeAttribute('data-signal-loom-pdf-parity-original-style');
      });
      document.getElementById('signal-loom-pdf-parity-focus-style')?.remove();

      const page = document.querySelector('[data-paper-page-view][data-paper-page-number="' + pageNumber + '"]');
      const pasteboard = page?.parentElement;
      if (!page || !pasteboard) {
        return { error: 'target page or pasteboard missing', pageNumber };
      }

      const pageRectBeforeFocus = page.getBoundingClientRect();
      pasteboard.setAttribute('data-signal-loom-pdf-parity-focused', 'true');
      pasteboard.setAttribute('data-signal-loom-pdf-parity-original-style', pasteboard.getAttribute('style') || '');
      const focusStyle = document.createElement('style');
      focusStyle.id = 'signal-loom-pdf-parity-focus-style';
      focusStyle.textContent = [
        'html, body { margin: 0 !important; overflow: hidden !important; background: #000 !important; }',
        'body * { visibility: hidden !important; }',
        '[data-signal-loom-pdf-parity-focused="true"], [data-signal-loom-pdf-parity-focused="true"] * { visibility: visible !important; }',
      ].join('\\n');
      document.head.appendChild(focusStyle);
      Object.assign(pasteboard.style, {
        position: 'fixed',
        left: String(-page.offsetLeft) + 'px',
        top: String(-page.offsetTop) + 'px',
        margin: '0',
        transform: 'none',
        zIndex: '2147483647',
      });
      document.body.style.background = '#000';
      await Promise.race([
        new Promise((resolve) => {
          if (typeof requestAnimationFrame !== 'function') {
            resolve(true);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
        new Promise((resolve) => setTimeout(resolve, 300)),
      ]);
      const pageRect = page.getBoundingClientRect();

      return {
        pageNumber,
        pageRect: {
          x: Math.max(0, pageRect.left),
          y: Math.max(0, pageRect.top),
          width: Math.max(1, pageRect.width),
          height: Math.max(1, pageRect.height),
        },
        originalPageRect: {
          x: Math.max(0, pageRectBeforeFocus.left),
          y: Math.max(0, pageRectBeforeFocus.top),
          width: Math.max(1, pageRectBeforeFocus.width),
          height: Math.max(1, pageRectBeforeFocus.height),
        },
        offsets: {
          left: page.offsetLeft,
          top: page.offsetTop,
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          deviceScaleFactor: window.devicePixelRatio || 1,
        },
      };
    })()
  `, 30000);
  if (result.error) throw new Error(`Could not focus Paper page for capture: ${JSON.stringify(result)}`);
  return result;
}

async function clearEditorPageNativeCaptureFocus(webSocketDebuggerUrl) {
  await evaluateCdpExpression(webSocketDebuggerUrl, `
    (() => {
      document.querySelectorAll('[data-signal-loom-pdf-parity-focused="true"]').forEach((node) => {
        const originalStyle = node.getAttribute('data-signal-loom-pdf-parity-original-style');
        if (originalStyle === null) node.removeAttribute('style');
        else node.setAttribute('style', originalStyle);
        node.removeAttribute('data-signal-loom-pdf-parity-focused');
        node.removeAttribute('data-signal-loom-pdf-parity-original-style');
      });
      document.getElementById('signal-loom-pdf-parity-focus-style')?.remove();
      return { ok: true };
    })()
  `, 10000);
}

async function evaluateCdpExpression(webSocketDebuggerUrl, expression, timeoutMs) {
  const startedAt = Date.now();
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await withCdpSession(webSocketDebuggerUrl, async ({ socket, pending, nextId }) => {
        const response = await sendCdp(socket, pending, nextId, 'Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }, Math.max(1000, timeoutMs - (Date.now() - startedAt)));
        if (response.error) {
          throw new Error(`CDP evaluation failed: ${JSON.stringify(response.error)}`);
        }
        const value = response.result?.result?.value;
        if (!value) throw new Error(`CDP expression returned no value: ${JSON.stringify(response)}`);
        return value;
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableCdpEvaluationError(error) || Date.now() - startedAt >= timeoutMs - 1000) {
        break;
      }
      await delay(500);
    }
  }
  throw lastError;
}

function isRetryableCdpEvaluationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Execution context was destroyed')
    || message.includes('Cannot find context with specified id')
    || message.includes('Inspected target navigated or closed');
}

async function withCdpSession(webSocketDebuggerUrl, callback) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const nextId = () => {
    id += 1;
    return id;
  };
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
    return await callback({ socket, pending, nextId });
  } finally {
    socket.close();
  }
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
      const info = await stat(filePath);
      if (info.size >= minimumBytes) return { filePath, bytes: info.size };
    } catch {
      // File may not exist yet.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${filePath} to reach ${minimumBytes} bytes.`);
}

function runCommand(command, args, { allowExitCodes = new Set([0]), cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(chunk.toString()));
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      const result = {
        code: code ?? 0,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      };
      if (!allowExitCodes.has(result.code)) {
        reject(new Error(`${command} exited with ${result.code}.\n${result.stderr || result.stdout}`));
        return;
      }
      resolve(result);
    });
  });
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

function parseRequestedPages(value, totalPages) {
  const fallback = [1, 2, Math.min(10, totalPages), totalPages];
  const rawPages = value
    ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
    : fallback;
  const pages = rawPages.map((entry) => {
    if (entry === 'last') return totalPages;
    const page = Number(entry);
    if (!Number.isInteger(page)) throw new Error(`Invalid page number "${entry}".`);
    return page;
  });
  const unique = [...new Set(pages)];
  for (const page of unique) {
    if (page < 1 || page > totalPages) {
      throw new Error(`Page ${page} is outside the document page range 1-${totalPages}.`);
    }
  }
  return unique;
}

function getOptionValue(argv, name) {
  const prefix = `${name}=`;
  const match = argv.find((entry) => typeof entry === 'string' && entry.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function padPage(pageNumber) {
  return String(pageNumber).padStart(3, '0');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
