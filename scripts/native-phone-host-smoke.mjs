#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  return [match[1], match[2]];
}));
const host = options.host?.trim();
if (Object.prototype.hasOwnProperty.call(options, 'pin')) {
  throw new Error('Do not pass the pairing PIN on the command line; set SIGNAL_LOOM_PHONE_PIN instead.');
}
const pin = process.env.SIGNAL_LOOM_PHONE_PIN?.trim();
delete process.env.SIGNAL_LOOM_PHONE_PIN;
const appPath = options.app?.trim() || '/home/cabewse/.local/opt/signal-loom/signal-loom';
const port = Number(options.port || 9239);

if (!host || !/^https?:\/\/[^/]+(?::\d+)?\/?$/.test(host)) {
  throw new Error('Usage: SIGNAL_LOOM_PHONE_PIN=NNNNNN npm run smoke:native:phone-host -- --host=http://PHONE-IP:8723 [--app=/path/to/signal-loom]');
}
if (!/^\d{6}$/.test(pin || '')) {
  throw new Error('Set SIGNAL_LOOM_PHONE_PIN to the current six-digit phone code.');
}
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be between 1024 and 65535.');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profileRoot = await mkdtemp(join(tmpdir(), 'sloom-native-phone-smoke-'));
const logs = [];
const child = spawn(appPath, [`--remote-debugging-port=${port}`, '--ozone-platform=x11'], {
  env: {
    ...process.env,
    SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: join(profileRoot, 'user-data'),
    SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

try {
  const target = await waitForTarget();
  const result = await evaluate(target.webSocketDebuggerUrl, `
    (async () => {
      const waitFor = async (predicate, label, timeoutMs = 20000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const setInput = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const buttonNamed = (name) => [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === name);

      const address = await waitFor(
        () => document.querySelector('#native-phone-host-address'),
        'native phone address field',
      );
      setInput(address, ${JSON.stringify(host)});
      await new Promise((resolve) => setTimeout(resolve, 150));
      (await waitFor(() => buttonNamed('Link phone'), 'Link phone button')).click();

      let pinInput;
      try {
        pinInput = await waitFor(
          () => document.querySelector('input[placeholder="000000"]'),
          'phone pairing prompt',
        );
      } catch (error) {
        throw new Error(error.message + ': ' + document.body.innerText.replace(/\s+/g, ' ').slice(-1200));
      }
      setInput(pinInput, ${JSON.stringify(pin)});
      await new Promise((resolve) => setTimeout(resolve, 150));
      (await waitFor(() => buttonNamed('Connect'), 'Connect button')).click();

      let banner;
      try {
        banner = await waitFor(
          () => document.querySelector('[data-remote-host-paired-banner="true"]'),
          'paired phone banner',
          30000,
        );
      } catch (error) {
        throw new Error(error.message + ': ' + document.body.innerText.replace(/\s+/g, ' ').slice(-1200));
      }
      const status = await waitFor(async () => {
        const candidate = await window.signalLoomNative.getRemotePhoneHostStatus();
        return candidate.configured
          && candidate.paired
          && candidate.verified
          && candidate.stateSeeded
          && candidate.localSaveSuspended
          ? candidate
          : null;
      }, 'phone-owned project seed', 30000);
      const collaboration = await waitFor(
        () => document.querySelector('[data-remote-host-collaboration="simultaneous"]'),
        'simultaneous collaboration capability',
      );
      return {
        banner: banner.textContent.replace(/\\s+/g, ' ').trim(),
        collaboration: collaboration.getAttribute('data-remote-host-collaboration'),
        batonControlPresent: Boolean(document.querySelector('[data-edit-baton-control]')),
        readOnlyOverlayPresent: Boolean(document.querySelector('[data-edit-baton-readonly-overlay]')),
        status,
        title: document.title,
      };
    })()
  `, 45_000);

  if (!result?.status?.configured
    || !result.status.paired
    || !result.status.verified
    || !result.status.stateSeeded
    || !result.status.localSaveSuspended
    || result.collaboration !== 'simultaneous'
    || result.batonControlPresent
    || result.readOnlyOverlayPresent) {
    throw new Error(`Installed phone-host state was incomplete: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  await stopChild();
  await rm(profileRoot, { recursive: true, force: true });
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Installed app exited early.\n${logs.join('').slice(-4000)}`);
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const target = targets.find((candidate) => candidate.type === 'page'
        && candidate.webSocketDebuggerUrl
        && !candidate.url?.includes('signal-loom-splash.html')
        && candidate.title !== 'Sloom Studio is starting');
      if (target) return target;
    } catch {
      // Electron is still starting.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for installed Electron on ${port}.\n${logs.join('').slice(-4000)}`);
}

async function evaluate(webSocketDebuggerUrl, expression, timeoutMs) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  try {
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for installed-app CDP evaluation.')), timeoutMs);
      socket.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.id !== 1) return;
        clearTimeout(timer);
        resolve(parsed);
      });
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    const exceptionDetails = message.result?.exceptionDetails;
    if (exceptionDetails) {
      const description = exceptionDetails.exception?.description
        || exceptionDetails.text
        || 'unknown installed-app evaluation error';
      throw new Error(`Installed-app CDP evaluation threw: ${description}`);
    }
    const value = message.result?.result;
    if (!value || !Object.prototype.hasOwnProperty.call(value, 'value')) {
      throw new Error(`Installed-app CDP evaluation failed: ${JSON.stringify(message)}`);
    }
    return value.value;
  } finally {
    socket.close();
  }
}

async function stopChild() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000).then(() => child.kill('SIGKILL')),
  ]);
}
