'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');
const { hostname, networkInterfaces } = require('node:os');
const { isAllowedRemotePhonePort } = require('./remote-phone-host.cjs');

const HANE_QR_PAIRING_PROTOCOL = 'sloom-hane-qr-pair';
const HANE_QR_PAIRING_VERSION = 1;
const HANE_QR_PAIRING_TTL_MS = 5 * 60 * 1000;
const HANE_QR_PAIRING_PORT_START = 8731;
const HANE_QR_PAIRING_PORT_END = 8739;
const MAX_CALLBACK_BODY_BYTES = 8 * 1024;

function isPrivateIpv4(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function collectPrivateIpv4Addresses(value = networkInterfaces()) {
  const addresses = [];
  for (const entries of Object.values(value || {})) {
    for (const entry of entries || []) {
      const family = typeof entry.family === 'string' ? entry.family : String(entry.family);
      if (family !== 'IPv4' && family !== '4') continue;
      if (entry.internal || !isPrivateIpv4(entry.address) || entry.address.startsWith('127.')) continue;
      if (!addresses.includes(entry.address)) addresses.push(entry.address);
    }
  }
  return addresses.slice(0, 4);
}

function boundedDeviceLabel(value, fallback) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

function buildInvitationUri({
  invitationId,
  secret,
  expiresAt,
  deviceLabel,
  callbackUrls,
}) {
  const invitation = new URL('sloom-link://pair');
  invitation.searchParams.set('v', String(HANE_QR_PAIRING_VERSION));
  invitation.searchParams.set('id', invitationId);
  invitation.searchParams.set('secret', secret);
  invitation.searchParams.set('expires', String(expiresAt));
  invitation.searchParams.set('name', boundedDeviceLabel(deviceLabel, 'Sloom Studio'));
  for (const callbackUrl of callbackUrls) invitation.searchParams.append('callback', callbackUrl);
  return invitation.toString();
}

function normalizeHaneCompletion(value, invitationId, expectedSecret) {
  if (!value || typeof value !== 'object') return null;
  if (value.protocol !== HANE_QR_PAIRING_PROTOCOL
    || value.version !== HANE_QR_PAIRING_VERSION
    || value.invitationId !== invitationId
    || typeof value.secret !== 'string') return null;
  const actualSecret = Buffer.from(value.secret);
  const wantedSecret = Buffer.from(expectedSecret);
  if (actualSecret.length !== wantedSecret.length || !timingSafeEqual(actualSecret, wantedSecret)) {
    return null;
  }
  if (typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)) return null;
  let haneUrl;
  try {
    haneUrl = new URL(value.haneUrl);
  } catch {
    return null;
  }
  if (haneUrl.protocol !== 'http:'
    || haneUrl.username
    || haneUrl.password
    || haneUrl.search
    || haneUrl.hash
    || (haneUrl.pathname !== '/' && haneUrl.pathname !== '')
    || !isPrivateIpv4(haneUrl.hostname)
    || !isAllowedRemotePhonePort(haneUrl.port)) return null;
  return {
    haneUrl: `${haneUrl.origin}/`,
    token: value.token,
    haneDeviceLabel: boundedDeviceLabel(value.haneDeviceLabel, 'Hane mobile device'),
  };
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}

async function startHaneQrPairingServer(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const ttlMs = Number.isFinite(options.ttlMs)
    ? Math.max(15_000, Math.min(HANE_QR_PAIRING_TTL_MS, Number(options.ttlMs)))
    : HANE_QR_PAIRING_TTL_MS;
  const addresses = Array.isArray(options.addresses)
    ? options.addresses.filter((address) => isPrivateIpv4(address) && !address.startsWith('127.')).slice(0, 4)
    : collectPrivateIpv4Addresses();
  if (addresses.length === 0) {
    throw new Error('No private LAN address is available for QR pairing.');
  }

  const invitationId = randomBytes(16).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const expiresAt = now() + ttlMs;
  const deviceLabel = boundedDeviceLabel(
    options.deviceLabel,
    `Sloom Studio on ${hostname() || process.platform}`,
  );
  let completion = null;
  let closed = false;
  let listeningPort = 0;
  let server = null;
  const callbackPath = `/__loom/api/hane-pair/complete/${invitationId}`;

  const handleRequest = (request, response) => {
    if (closed) {
      sendJson(response, 410, { ok: false, error: 'invitation-closed' });
      return;
    }
    if (request.method !== 'POST' || request.url !== callbackPath) {
      sendJson(response, 404, { ok: false, error: 'not-found' });
      return;
    }
    if (now() > expiresAt) {
      sendJson(response, 410, { ok: false, error: 'invitation-expired' });
      return;
    }
    if (completion) {
      sendJson(response, 409, { ok: false, error: 'invitation-used' });
      return;
    }
    const declaredLength = Number(request.headers['content-length'] ?? 0);
    if (!Number.isSafeInteger(declaredLength)
      || declaredLength < 0
      || declaredLength > MAX_CALLBACK_BODY_BYTES) {
      sendJson(response, 413, { ok: false, error: 'payload-too-large' });
      request.destroy();
      return;
    }
    let received = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_CALLBACK_BODY_BYTES) {
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (received > MAX_CALLBACK_BODY_BYTES) return;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        sendJson(response, 400, { ok: false, error: 'invalid-json' });
        return;
      }
      const accepted = normalizeHaneCompletion(parsed, invitationId, secret);
      if (!accepted) {
        sendJson(response, 401, { ok: false, error: 'invalid-invitation-proof' });
        return;
      }
      completion = accepted;
      sendJson(response, 200, { ok: true, invitationId });
    });
  };

  const startPort = Number.isInteger(options.portStart)
    ? Number(options.portStart)
    : HANE_QR_PAIRING_PORT_START;
  const endPort = Number.isInteger(options.portEnd)
    ? Math.max(startPort, Number(options.portEnd))
    : HANE_QR_PAIRING_PORT_END;
  let lastError;
  for (let port = startPort; port <= endPort; port += 1) {
    const candidate = createServer(handleRequest);
    try {
      await listen(candidate, port);
      server = candidate;
      listeningPort = port;
      break;
    } catch (error) {
      lastError = error;
      candidate.close();
    }
  }
  if (!server || listeningPort === 0) {
    throw new Error(lastError instanceof Error
      ? `Could not open a local QR pairing receiver: ${lastError.message}`
      : 'Could not open a local QR pairing receiver.');
  }

  const callbackUrls = addresses.map(
    (address) => `http://${address}:${listeningPort}${callbackPath}`,
  );
  const payload = buildInvitationUri({
    invitationId,
    secret,
    expiresAt,
    deviceLabel,
    callbackUrls,
  });
  const expiryTimer = setTimeout(() => {
    if (!completion) {
      closed = true;
      server?.close();
    }
  }, ttlMs + 500);
  expiryTimer.unref?.();

  return {
    invitation: {
      invitationId,
      payload,
      expiresAt,
      deviceLabel,
    },
    poll(requestedId) {
      if (requestedId !== invitationId) {
        return { status: 'invalid', error: 'That QR invitation is no longer active.' };
      }
      if (completion) return { status: 'completed', ...completion };
      if (closed || now() > expiresAt) return { status: 'expired' };
      return { status: 'pending' };
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(expiryTimer);
      server?.close();
    },
  };
}

module.exports = {
  HANE_QR_PAIRING_PROTOCOL,
  HANE_QR_PAIRING_TTL_MS,
  HANE_QR_PAIRING_VERSION,
  buildInvitationUri,
  collectPrivateIpv4Addresses,
  isPrivateIpv4,
  normalizeHaneCompletion,
  startHaneQrPairingServer,
};
