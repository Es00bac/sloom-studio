#!/usr/bin/env node
/**
 * One-time setup for the persistent Electron test profile at `.test-profile/` (gitignored, local
 * only): seeds the dev-test license key + English locale + local native render URL so automated
 * launches (native-real-project-video-render-parity.mjs and friends) never hit a first-run
 * dialog. Before this existed, every automated launch used a FRESH profile, so a human at the
 * console had to click through the license dialog and the language picker on every single run --
 * treat that as a bug, not a quirk: test automation must never require a human in the loop, and
 * must never surface on a real operator's desktop at all (see the dedicated Xvfb display this and
 * sibling scripts launch against).
 *
 * Run once per machine (or whenever `.test-profile/` is deleted):
 *   node scripts/seed-test-profile.mjs
 *
 * Requires `.dev-test-license.key` (chmod 600, gitignored) next to this repo's root. Never prints
 * the key's contents; only ships it inside a CDP payload sent directly to the page.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { buildNativeSmokeElectronLaunchArgs } from './native-smoke-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const profileDir = process.env.SIGNAL_LOOM_TEST_PROFILE_DIR || join(repoRoot, '.test-profile');
const testDisplay = process.env.SIGNAL_LOOM_TEST_DISPLAY || ':77';
const devServerUrl = process.env.SIGNAL_LOOM_NATIVE_DEV_SERVER_URL || 'http://127.0.0.1:5175';
const renderUrl = process.env.SIGNAL_LOOM_NATIVE_RENDER_URL || 'http://127.0.0.1:41737';
const remoteDebuggingPort = Number(process.env.SIGNAL_LOOM_NATIVE_SMOKE_PORT || 9260);

async function main() {
  const licenseKeyPath = join(repoRoot, '.dev-test-license.key');
  const licenseKey = (await readFile(licenseKeyPath, 'utf8')).trim();
  if (!licenseKey) {
    throw new Error(`${licenseKeyPath} is empty.`);
  }
  await mkdir(profileDir, { recursive: true });

  const electronCli = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const launchArgs = buildNativeSmokeElectronLaunchArgs({ remoteDebuggingPort, platform: process.platform });
  const command = process.platform === 'win32' ? electronCli : process.execPath;
  const args = process.platform === 'win32' ? launchArgs : [electronCli, ...launchArgs];
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      DISPLAY: testDisplay,
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      GDK_BACKEND: 'x11',
      XDG_SESSION_TYPE: 'x11',
      ELECTRON_RENDERER_URL: devServerUrl,
      SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: profileDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (c) => logs.push(c.toString()));
  child.stderr.on('data', (c) => logs.push(c.toString()));

  try {
    let target;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const targets = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/list`).then((r) => r.json());
        target = targets.find((t) => {
          try { return t.url.startsWith(devServerUrl) && t.webSocketDebuggerUrl && t.title !== 'Sloom Studio is starting'; } catch { return false; }
        });
        if (target) break;
      } catch { /* still starting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!target) throw new Error(`No app target found (is the dev server running on ${devServerUrl}?).\n${logs.join('')}`);
    // A brand-new profile takes a moment longer to get past the splash into the real page than a
    // reused one -- give the page a beat to settle before evaluating anything on it.
    await new Promise((r) => setTimeout(r, 1500));

    // Never echo licenseKey anywhere in this process's own stdout/stderr; only ship it inside the
    // CDP expression payload sent directly over the websocket to the page.
    const result = await evalOn(target.webSocketDebuggerUrl, `
      (() => {
        const existingRaw = localStorage.getItem('flow-settings-storage');
        let existingState = {};
        if (existingRaw) {
          try { existingState = JSON.parse(existingRaw)?.state ?? {}; } catch { /* start fresh */ }
        }
        const nextState = {
          ...existingState,
          licenseKey: ${JSON.stringify(licenseKey)},
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
        return { ok: true, hadExistingState: Boolean(existingRaw) };
      })()
    `);
    console.log('Seed write:', JSON.stringify(result));

    // Give the already-mounted startup-notice component a moment, then reload once so
    // revalidateLicense() runs against the freshly-seeded key and persists the verified
    // {licensed:true,...} result too (rather than leaving that to the next real test launch).
    await new Promise((r) => setTimeout(r, 500));
    await evalOn(target.webSocketDebuggerUrl, `(() => { location.reload(); return true; })()`).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 4000));

    const verify = await evalOn(target.webSocketDebuggerUrl, `
      (() => {
        const bodyText = document.body?.innerText || '';
        return {
          title: document.title,
          hasCommunityText: bodyText.includes('Community'),
          hasLanguagePicker: bodyText.includes('Select Language') || bodyText.includes('言語を選択'),
        };
      })()
    `).catch((error) => ({ verifyError: String(error) }));
    console.log('Post-reload check (no secret values):', JSON.stringify(verify));

    if (verify.hasCommunityText || verify.hasLanguagePicker) {
      throw new Error('Profile still shows a first-run dialog after seeding -- do not use it for unattended runs yet.');
    }
    console.log(`Profile ready at ${profileDir}. Future automated launches should reuse it (never wipe it) and target DISPLAY=${testDisplay}.`);
  } finally {
    // SIGKILL can outrun LevelDB's write-behind flush for the localStorage write above (Chromium
    // normally flushes on a clean shutdown) -- ask nicely first and only force-kill if it ignores
    // the request, so the seeded settings actually make it to disk.
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
}

async function evalOn(wsUrl, expression) {
  const socket = new WebSocket(wsUrl);
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
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const thisId = (id += 1);
  const payload = JSON.stringify({ id: thisId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } });
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(thisId); reject(new Error('timeout')); }, 40000);
    pending.set(thisId, { resolve, reject, timeout });
    socket.send(payload);
  });
  socket.close();
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails));
  }
  return response.result?.result?.value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
