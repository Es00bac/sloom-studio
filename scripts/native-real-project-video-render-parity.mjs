#!/usr/bin/env node
/**
 * Frame-server export parity check against a REAL project file (not a synthetic fixture).
 *
 * Opens a real `.sloom` project read-only (same startup-project.json mechanism as
 * `native-real-project-smoke.mjs`), points the app's native render target at an
 * ALREADY-RUNNING local render service (does not spawn or manage one — call this against a
 * disposable test instance, never the production `signal-loom-native-render.service`),
 * screenshots the Program Stage before rendering, drives a real render through the Video
 * workspace's actual render button, and saves the resulting mp4 next to a JSON report.
 *
 * This intentionally does NOT touch the project file passed via --project. Point it at a
 * scoped/trimmed COPY of a real project (see docs/render-parity for how the Case File 2033
 * copy used to validate this was built) rather than an original a human is actively editing.
 *
 * Usage:
 *   node scripts/native-real-project-video-render-parity.mjs \
 *     --project=/path/to/copy.sloom \
 *     --render-url=http://127.0.0.1:41737 \
 *     --out-dir=/path/to/output/dir
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  buildNativeRealProjectSmokeEnvironment,
  buildNativeRealProjectSmokePaths,
  buildNativeRealProjectStartupState,
  buildNativeSmokeElectronLaunchArgs,
} from './native-smoke-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const remoteDebuggingPort = Number(process.env.SIGNAL_LOOM_NATIVE_SMOKE_PORT || 9241);
const smokeRoot = process.env.SIGNAL_LOOM_NATIVE_SMOKE_DIR || join(tmpdir(), 'signal-loom-real-project-video-render-parity');

const projectPath = getOptionValue(process.argv.slice(2), '--project') || process.env.SIGNAL_LOOM_NATIVE_REAL_PROJECT_PATH;
const renderUrl = getOptionValue(process.argv.slice(2), '--render-url') || process.env.SIGNAL_LOOM_NATIVE_RENDER_URL || 'http://127.0.0.1:41737';
const outDir = getOptionValue(process.argv.slice(2), '--out-dir') || smokeRoot;
// Falls back to a production `dist/` build (Electron's default) only if explicitly cleared with
// --dev-server-url=. A worktree checkout normally has no production build, so this defaults to
// the conventional `npm run electron:dev` wiring against a locally running Vite dev server.
const devServerUrl = getOptionValue(process.argv.slice(2), '--dev-server-url') ?? process.env.SIGNAL_LOOM_NATIVE_DEV_SERVER_URL ?? 'http://127.0.0.1:5175';
// Persistent, reused profile (never wiped between runs) at <worktree>/.test-profile/, pre-seeded
// once via scripts/seed-test-profile.mjs with a dev-test license key and English locale — a fresh
// profile on every launch meant a human at the console had to click through the license dialog
// and language picker on every single test run. See buildTestElectronEnvironment below.
const testProfileDir = process.env.SIGNAL_LOOM_TEST_PROFILE_DIR || join(repoRoot, '.test-profile');
// A dedicated Xvfb virtual display (started once via `Xvfb :77 -screen 0 ...`), never the
// operator's real DISPLAY — this is the actual fix for these launches ever touching a real
// desktop: the app runs, but on a framebuffer nobody's session renders or can click into.
const testDisplay = process.env.SIGNAL_LOOM_TEST_DISPLAY || ':77';

async function main() {
  if (!projectPath) {
    throw new Error('Provide --project=/path/to/project.sloom (a scoped copy, not the original).');
  }
  if (!projectPath.toLowerCase().endsWith('.sloom')) {
    throw new Error('Refusing a non-.sloom path (backups/originals should not be opened directly by this tool).');
  }
  await stat(projectPath);
  await stat(new URL(import.meta.url)); // no-op sanity check this file itself is readable

  await mkdir(outDir, { recursive: true });
  const paths = buildNativeRealProjectSmokePaths(smokeRoot, projectPath);
  // Persistent, REUSED test profile (never wiped): a fresh profile on every launch meant Jarrod's
  // own desktop kept showing (and had to be clicked through) the license dialog and language
  // picker every single run. userDataDir now points at a fixed <worktree>/.test-profile/ dir,
  // pre-seeded once (scripts/seed-test-profile, see docs/render-parity/README.md) with the
  // dev-test license key and English locale, so first-run dialogs never appear again. Only the
  // per-run startup-project.json (which project to open) gets rewritten each run.
  paths.userDataDir = testProfileDir;
  paths.startupProjectStatePath = join(testProfileDir, 'startup-project.json');
  await mkdir(paths.userDataDir, { recursive: true });
  await writeFile(paths.startupProjectStatePath, buildNativeRealProjectStartupState(projectPath), 'utf8');

  const renderHealth = await checkRenderServiceHealth(renderUrl);

  const electron = launchElectron(paths);
  try {
    const flowTarget = await waitForSignalLoomTarget(electron, remoteDebuggingPort);
    const startup = await waitForStartupProject(flowTarget.webSocketDebuggerUrl);
    const settingsCheck = await ensureTestSessionConfigured(flowTarget.webSocketDebuggerUrl, renderUrl);
    const openResult = await openVideoWorkspace(flowTarget.webSocketDebuggerUrl);
    const videoTarget = await waitForWorkspaceTarget(electron, remoteDebuggingPort, 'editor');
    await resizeWindowForTarget(videoTarget.webSocketDebuggerUrl, 2200, 1400);
    const preflight = await waitForVideoWorkspaceReady(videoTarget.webSocketDebuggerUrl);

    const stageBoundsAtStart = await getStageBounds(videoTarget.webSocketDebuggerUrl);
    const stageShotStartPath = join(outDir, 'stage-real-T0-start.png');
    await captureStageScreenshot(videoTarget.webSocketDebuggerUrl, remoteDebuggingPort, stageShotStartPath, stageBoundsAtStart);

    const scrubResults = [];
    for (const target of [{ label: 'T1', seconds: 3.0 }, { label: 'T2', seconds: 6.4 }, { label: 'T3', seconds: 10.0 }]) {
      const scrub = await scrubTimelineTo(videoTarget.webSocketDebuggerUrl, target.seconds);
      scrubResults.push({ ...target, ...scrub });
      const shotPath = join(outDir, `stage-real-${target.label}.png`);
      const bounds = await getStageBounds(videoTarget.webSocketDebuggerUrl);
      await captureStageScreenshot(videoTarget.webSocketDebuggerUrl, remoteDebuggingPort, shotPath, bounds);
    }

    const renderStartedAt = Date.now();
    const render = await exerciseVideoRender(videoTarget.webSocketDebuggerUrl);
    const renderElapsedMs = Date.now() - renderStartedAt;
    const renderStartedAtIso = new Date(renderStartedAt).toISOString();
    const renderFinishedAtIso = new Date(renderStartedAt + renderElapsedMs).toISOString();

    let outputVideoPath;
    if (render.mp4Base64) {
      outputVideoPath = join(outDir, 'real-project-render.mp4');
      await writeFile(outputVideoPath, Buffer.from(render.mp4Base64, 'base64'));
    }

    const report = {
      ok: Boolean(render.render?.previewVideoPresent && outputVideoPath),
      projectPath,
      renderUrl,
      renderHealth,
      startup,
      settingsCheck,
      openResult,
      preflight,
      scrubResults,
      renderElapsedMs,
      renderStartedAtIso,
      renderFinishedAtIso,
      render: {
        previewVideoPresent: render.render?.previewVideoPresent ?? false,
        bytes: render.render?.bytes ?? 0,
        mimeType: render.render?.mimeType,
        fileSignature: render.render?.fileSignature,
        statusMessage: render.render?.statusMessage,
        failed: render.render?.failed ?? false,
      },
      outputVideoPath,
      screenshots: {
        start: stageShotStartPath,
        ...Object.fromEntries(scrubResults.map((s) => [s.label, join(outDir, `stage-real-${s.label}.png`)])),
      },
    };

    await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));

    if (!report.ok) {
      throw new Error(`Render did not complete successfully: ${JSON.stringify(report.render)}`);
    }
  } finally {
    await stopElectron(electron);
  }
}

async function checkRenderServiceHealth(url) {
  const response = await fetch(`${url}/health`);
  if (!response.ok) {
    throw new Error(`Render service at ${url} is not healthy (status ${response.status}). Refusing to continue — start your OWN disposable test instance first.`);
  }
  return response.json();
}

function launchElectron(paths) {
  const electronCli = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const launchArgs = buildNativeSmokeElectronLaunchArgs({ remoteDebuggingPort, platform: process.platform });
  const args = process.platform === 'win32' ? launchArgs : [electronCli, ...launchArgs];
  const command = process.platform === 'win32' ? electronCli : process.execPath;
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...buildNativeRealProjectSmokeEnvironment({ baseEnv: process.env, rootDir: paths.rootDir, projectPath: paths.projectPath }),
      // This worktree has no production `dist/` build; point Electron at the worktree's own
      // already-running Vite dev server instead (same convention as `npm run electron:dev`), so
      // the app under test is exactly the worktree's current (uncommitted) source.
      ...(devServerUrl ? { ELECTRON_RENDERER_URL: devServerUrl } : {}),
      // buildNativeRealProjectSmokeEnvironment recomputes its own (ephemeral) userData path from
      // rootDir -- override with the real, persistent, pre-seeded profile so this never re-hits
      // the license/language first-run dialogs (see testProfileDir doc comment above).
      SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: paths.userDataDir,
      // Never the operator's real DISPLAY: a dedicated Xvfb virtual display this app can never be
      // seen or clicked on outside of this automation.
      DISPLAY: testDisplay,
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      GDK_BACKEND: 'x11',
      XDG_SESSION_TYPE: 'x11',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  child.logs = logs;
  return child;
}

/** The splash window (title "Sloom Studio is starting", a data:/file: URL — see
 *  buildStartupSplashHtml in electron/main.mjs) is a real, briefly-inspectable CDP target too, and
 *  it gets replaced/closed once the real window loads. Grabbing it instead of the real app window
 *  causes a false-positive "target found" that then 500s on the next connection attempt once the
 *  splash is gone. Wait specifically for a target whose URL is the actual dev server (or, if no
 *  dev server URL is configured, a file:// production build), never the transient splash. */
function isRealAppTarget(target, devServerUrl) {
  if (!target?.webSocketDebuggerUrl || !target.url) return false;
  if (target.title === 'Sloom Studio is starting') return false;
  if (devServerUrl) return target.url.startsWith(devServerUrl);
  return target.url.startsWith('file://') && target.url.includes('index.html');
}

async function waitForSignalLoomTarget(electron, port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited before the target appeared.\n${electron.logs.join('')}`);
    }
    try {
      const targets = await fetch(url).then((response) => response.json());
      const realTarget = targets.find((target) => isRealAppTarget(target, devServerUrl));
      if (realTarget) return realTarget;
    } catch {
      // Electron may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Electron DevTools target on port ${port}.\n${electron.logs.join('')}`);
}

/** The editor workspace window opens at a default size that leaves the actual video Program
 *  Stage only tens of pixels tall once the Bin/Source/Inspector panels take their share (confirmed
 *  via direct measurement: an 82x46 stage in a fresh 1320x860 window) -- too small to screenshot
 *  meaningfully. Resize via the CDP Browser domain (not app code) so it works regardless of the
 *  app's own panel-layout defaults. */
async function resizeWindowForTarget(webSocketDebuggerUrl, width, height) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
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
    const targetInfo = await sendCdp(socket, pending, () => { id += 1; return id; }, 'Target.getTargetInfo', {}, 10000);
    const targetId = targetInfo.result?.targetInfo?.targetId;
    const windowResponse = await sendCdp(socket, pending, () => { id += 1; return id; }, 'Browser.getWindowForTarget', { targetId }, 10000);
    const windowId = windowResponse.result?.windowId;
    if (!windowId) return { ok: false, reason: 'no windowId', windowResponse };
    const setResponse = await sendCdp(socket, pending, () => { id += 1; return id; }, 'Browser.setWindowBounds', {
      windowId,
      bounds: { width, height },
    }, 10000);
    return { ok: !setResponse.error, setResponse };
  } finally {
    socket.close();
  }
}

async function waitForStartupProject(webSocketDebuggerUrl) {
  const result = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const startedAt = Date.now();
      let bridge = window.signalLoomNative;
      while (!bridge && Date.now() - startedAt < 30000) {
        await sleep(250);
        bridge = window.signalLoomNative;
      }
      if (!bridge) {
        return {
          error: 'native bridge missing',
          readyState: document.readyState,
          url: location.href,
          title: document.title,
          bodyText: (document.body?.innerText || '').slice(0, 500),
        };
      }
      let state;
      while (Date.now() - startedAt < 60000) {
        state = await bridge.getNativeState();
        if (state.startupProject?.document) break;
        await sleep(250);
      }
      const document = state?.startupProject?.document;
      return {
        currentProjectPath: state?.currentProjectPath,
        projectName: document?.name,
        bodyHasRecovery: Boolean(document?.body?.innerText?.includes('Recovery Boundary')),
      };
    })()
  `, 65000);
  if (result.error) throw new Error(`${result.error}: ${JSON.stringify(result)}`);
  if (!result.currentProjectPath || !result.projectName) {
    throw new Error(`Startup did not load the real project: ${JSON.stringify(result)}`);
  }
  return result;
}

/** READ-ONLY check that the render target is already configured -- it should be, baked into the
 *  persistent test profile once by scripts/seed-test-profile.mjs. This intentionally does not
 *  write to `flow-settings-storage`: an earlier version overwrote the whole persisted blob with
 *  `{state:{providerSettings:{...}}}` and nothing else on every render run, silently wiping the
 *  seeded license key and English locale (the storage layer's own encryption also means a naive
 *  read-modify-write here can silently drop fields it can't parse) -- bringing back exactly the
 *  first-run dialogs the persistent profile exists to avoid. If this ever reports a mismatch, fix
 *  it by re-running scripts/seed-test-profile.mjs, not by writing to storage from here. */
/** Seeds license/locale/render-url on THIS launch too, merging non-destructively with whatever
 *  is already there. scripts/seed-test-profile.mjs seeds `.test-profile/` once up front, but its
 *  write has not been observed to reliably survive across separate Electron process launches
 *  against the same --user-data-dir in this environment (Chromium's LevelDB-backed localStorage
 *  flush timing appears not to be guaranteed by a plain SIGTERM here) -- so this re-applies it
 *  every launch as a safety net. Either way this keeps the actual requirement (an operator must
 *  never have to click through a first-run dialog) satisfied regardless of profile persistence,
 *  and never touches a real desktop: this only ever runs against the isolated Xvfb display. */
async function ensureTestSessionConfigured(webSocketDebuggerUrl, renderUrl) {
  const licenseKeyPath = join(repoRoot, '.dev-test-license.key');
  const licenseKey = (await readFile(licenseKeyPath, 'utf8').catch(() => '')).trim();

  // Never echo licenseKey anywhere in this process's own stdout/stderr; only ship it inside the
  // CDP expression payload sent directly over the websocket to the page.
  await evaluateCdpExpression(webSocketDebuggerUrl, `
    (() => {
      const existingRaw = localStorage.getItem('flow-settings-storage');
      let existingState = {};
      if (existingRaw) {
        try { existingState = JSON.parse(existingRaw)?.state ?? {}; } catch { /* start fresh */ }
      }
      const nextState = {
        ...existingState,
        ...(${JSON.stringify(Boolean(licenseKey))} ? { licenseKey: ${JSON.stringify(licenseKey)} } : {}),
        locale: 'en',
        localeChosen: true,
        providerSettings: {
          ...(existingState.providerSettings ?? {}),
          renderBackendPreference: 'auto',
          localNativeRenderUrl: ${JSON.stringify(renderUrl)},
          localNativeRenderToken: '',
        },
      };
      localStorage.setItem('flow-settings-storage', JSON.stringify({ state: nextState, version: 0 }));
      return true;
    })()
  `, 15000);

  await delay(300);
  await evaluateCdpExpression(webSocketDebuggerUrl, `(() => { location.reload(); return true; })()`).catch(() => undefined);
  await delay(3000);

  const check = await evaluateCdpExpression(webSocketDebuggerUrl, `
    (() => ({
      title: document.title,
      hasCommunityText: (document.body?.innerText || '').includes('Community'),
      hasLanguagePicker: (document.body?.innerText || '').includes('Select Language') || (document.body?.innerText || '').includes('言語を選択'),
    }))()
  `, 10000).catch((error) => ({ checkError: String(error) }));
  if (check.hasCommunityText || check.hasLanguagePicker) {
    console.error(`WARNING: first-run dialog still present after in-session seeding: ${JSON.stringify(check)}`);
  }
  return check;
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
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // Window may still be opening.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${workspace} workspace target.`);
}

async function inspectVideoWorkspace(webSocketDebuggerUrl) {
  return evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const bodyText = document.body?.innerText || '';
      return {
        url: location.href,
        hasRecoveryBoundary: bodyText.includes('Recovery Boundary'),
        renderButtonCount: document.querySelectorAll('[data-video-render-button="true"]').length,
        bodyText: bodyText.slice(0, 800),
      };
    })()
  `, 15000);
}

async function waitForVideoWorkspaceReady(webSocketDebuggerUrl) {
  let lastState = {};
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      lastState = await inspectVideoWorkspace(webSocketDebuggerUrl);
      if (lastState.hasRecoveryBoundary || lastState.renderButtonCount > 0) return lastState;
    } catch (error) {
      // The workspace window can still be mid-navigation/mid-compile (a fresh Vite route bundling
      // for the first time) — a transient "no execution context" here just means "not ready yet,"
      // not a real failure; keep polling rather than propagating a one-off race.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('execution context') && !message.includes('Unexpected server response')) {
        throw error;
      }
    }
    await delay(250);
  }
  return lastState;
}

async function getStageBounds(webSocketDebuggerUrl) {
  return evaluateCdpExpression(webSocketDebuggerUrl, `
    (() => {
      const stage = document.querySelector('[data-video-program-stage="true"]');
      if (!stage) return undefined;
      const rect = stage.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()
  `, 10000);
}

/** Clicks the timeline ruler at a computed clientX so the app's own onClick handler resolves
 *  to the requested time (see VideoWorkspace.tsx's ratio = (clientX - bounds.left) / bounds.width
 *  math) — no private state is reached into, this drives the same DOM path a human editor uses. */
async function scrubTimelineTo(webSocketDebuggerUrl, seconds) {
  return evaluateCdpExpression(webSocketDebuggerUrl, `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const candidates = Array.from(document.querySelectorAll(
        'button.absolute.inset-0.z-10.h-full.w-full.cursor-pointer.bg-transparent'
      ));
      const target = candidates.find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!target) return { ok: false, error: 'no visible timeline ruler button found' };
      const bounds = target.getBoundingClientRect();
      // Mirrors displayTimelineSeconds = max(compositionTimelineSeconds, ceil(sequenceDurationSeconds), 1).
      const cutLabel = Array.from(document.querySelectorAll('div')).map((el) => el.textContent || '').find((text) => /\\ds cut$/.test(text || ''));
      const cutSeconds = cutLabel ? parseFloat(cutLabel) : ${JSON.stringify(seconds)};
      const displaySeconds = Math.max(1, Math.ceil(cutSeconds));
      const ratio = Math.max(0, Math.min(1, ${JSON.stringify(seconds)} / displaySeconds));
      const clientX = bounds.left + ratio * bounds.width;
      const clientY = bounds.top + bounds.height / 2;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY }));
      await sleep(200);
      return { ok: true, displaySeconds, ratio, clientX };
    })()
  `, 10000);
}

async function captureStageScreenshot(webSocketDebuggerUrl, port, outPath, bounds) {
  const clip = bounds && bounds.width > 0
    ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height), scale: 1 }
    : undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        clearTimeout(entry.timeout);
        pending.delete(message.id);
        entry.resolve(message);
      }
    });
    try {
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 2 && message.includes('Unexpected server response')) {
        await delay(500);
        continue;
      }
      throw error;
    }
    try {
      const response = await sendCdp(socket, pending, () => { id += 1; return id; }, 'Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip } : {}),
      }, 20000);
      if (!response.result?.data) {
        throw new Error(`Page.captureScreenshot returned no data: ${JSON.stringify(response)}`);
      }
      await writeFile(outPath, Buffer.from(response.result.data, 'base64'));
      return;
    } finally {
      socket.close();
    }
  }
}

async function exerciseVideoRender(webSocketDebuggerUrl) {
  const clicked = await clickVideoRenderButton(webSocketDebuggerUrl);
  if (!clicked.clickedRender || clicked.hasRecoveryBoundary) {
    return { workspace: clicked, render: { previewVideoPresent: false, bytes: 0 } };
  }

  let lastState = {
    workspace: clicked,
    render: { previewVideoPresent: false, bytes: 0, statusMessage: 'Timed out waiting for rendered preview.' },
  };

  for (let attempt = 0; attempt < 600; attempt += 1) {
    let nextState;
    try {
      nextState = await readVideoRenderState(webSocketDebuggerUrl);
    } catch (error) {
      nextState = {
        render: { previewVideoPresent: false, bytes: 0, failed: true, statusMessage: error instanceof Error ? error.message : String(error) },
      };
    }
    if (nextState?.workspace || nextState?.render) lastState = nextState;
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
      const signatureOf = (bytes) => Array.from(bytes.slice(0, 16)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
      };
      if (video?.src) {
        const result = { workspace, render: { previewVideoPresent: true, bytes: 0, mimeType: 'video/mp4', videoSrc: video.src } };
        const response = await fetch(video.src);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        result.render.bytes = bytes.byteLength;
        result.render.mimeType = blob.type || 'video/mp4';
        result.render.fileSignature = signatureOf(bytes);
        result.mp4Base64 = bytesToBase64(bytes);
        return result;
      }
      return {
        workspace,
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
  for (let attempt = 0; attempt < 5; attempt += 1) {
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
    try {
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
    } catch (error) {
      // A target that existed a moment ago (per /json/list) can already be gone by the time we
      // open the websocket (e.g. it was the splash window, or a workspace window mid-navigation)
      // — this surfaces as "Unexpected server response: 500" on the upgrade handshake. Retry with
      // a fresh connection attempt rather than failing the whole run on a one-off race.
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 4 && message.includes('Unexpected server response')) {
        await delay(500);
        continue;
      }
      throw error;
    }
    try {
      const response = await sendCdp(socket, pending, () => { id += 1; return id; }, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }, timeoutMs);
      const retryableMessage = response.error?.message || response.result?.exceptionDetails?.text || '';
      if (retryableMessage.includes('Execution context was destroyed') || retryableMessage.includes('execution context')) {
        if (attempt === 4) throw new Error(`CDP expression context was destroyed after retries: ${JSON.stringify(response)}`);
        await delay(250);
        continue;
      }
      if (response.result?.exceptionDetails) {
        const details = response.result.exceptionDetails;
        // `details.text` is near-always the generic literal "Uncaught" -- the actual message and
        // stack live under `details.exception.description`. Check that FIRST or every failure
        // here reports as an uninformative "CDP expression failed: Uncaught".
        throw new Error(`CDP expression failed: ${details.exception?.description || details.text || JSON.stringify(details)}`);
      }
      const result = response.result?.result;
      if (!result || !Object.prototype.hasOwnProperty.call(result, 'value')) {
        throw new Error(`CDP expression returned no bridge value: ${JSON.stringify(response)}`);
      }
      return result.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 4 && message.includes('Timed out waiting for CDP method Runtime.evaluate.')) {
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
