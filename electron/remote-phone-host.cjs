'use strict';

const REMOTE_PHONE_PROXY_ORIGIN = 'signal-loom-phone://host';
const REMOTE_PHONE_API_PATH = '/__loom/api';
const REMOTE_PHONE_PORT = '8723';
const REMOTE_PHONE_FALLBACK_PORT_START = 8740;
const REMOTE_PHONE_FALLBACK_PORT_END = 8749;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT']);
const ALLOWED_REQUEST_HEADERS = new Set([
  'accept',
  'content-type',
  'if-none-match',
  'range',
]);

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === '::1') return true;
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return Number.isFinite(first)
    && ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80);
}

function isAllowedPhoneHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost'
    || isPrivateIpv4(normalized)
    || isPrivateIpv6(normalized);
}

function isAllowedRemotePhonePort(value) {
  const port = Number(value);
  return value === REMOTE_PHONE_PORT
    || (Number.isInteger(port)
      && port >= REMOTE_PHONE_FALLBACK_PORT_START
      && port <= REMOTE_PHONE_FALLBACK_PORT_END);
}

/** Validate an explicit owner-entered Android host and return its canonical origin. */
function normalizeRemotePhoneHostBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) {
    throw new Error('Enter the LAN address shown by Sloom Studio on the phone.');
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim())
    ? value.trim()
    : `http://${value.trim()}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('The phone address is invalid.');
  }
  if (url.protocol !== 'http:') throw new Error('The phone link must use http:// on the local network.');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('The phone address cannot include credentials, a query, or a fragment.');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Enter only the phone host address, without an API path.');
  }
  if (!isAllowedPhoneHost(url.hostname)) {
    throw new Error('The phone address must be a private or loopback IP address.');
  }
  const requestedPort = url.port || REMOTE_PHONE_PORT;
  if (!isAllowedRemotePhonePort(requestedPort)) {
    throw new Error('The phone address must use a Hane Link-assigned local port.');
  }
  url.port = requestedPort;
  return url.origin;
}

function normalizeRemotePhoneMethod(value) {
  const method = String(value || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error('That phone-host request method is not allowed.');
  return method;
}

/** Map only the fixed custom-scheme API namespace to the configured private phone origin. */
function buildRemotePhoneHostTarget(baseUrl, requestUrl) {
  const normalizedBase = normalizeRemotePhoneHostBaseUrl(baseUrl);
  let request;
  try {
    request = new URL(requestUrl);
  } catch {
    throw new Error('The phone proxy request URL is invalid.');
  }
  if (request.protocol !== 'signal-loom-phone:' || request.hostname !== 'host') {
    throw new Error('The phone proxy accepts only its fixed application origin.');
  }
  if (/%(?:2e|00|2f|5c)/i.test(requestUrl)) {
    throw new Error('Encoded path traversal is not allowed.');
  }
  if (request.pathname !== REMOTE_PHONE_API_PATH
    && !request.pathname.startsWith(`${REMOTE_PHONE_API_PATH}/`)) {
    throw new Error('The phone proxy accepts only the Sloom Studio API namespace.');
  }
  const target = new URL(`${request.pathname}${request.search}`, `${normalizedBase}/`);
  if (target.origin !== normalizedBase || !target.pathname.startsWith(REMOTE_PHONE_API_PATH)) {
    throw new Error('The phone proxy target escaped its configured authority.');
  }
  return target.toString();
}

function filterRemotePhoneRequestHeaders(headers) {
  const filtered = {};
  for (const [name, value] of new Headers(headers).entries()) {
    if (ALLOWED_REQUEST_HEADERS.has(name.toLowerCase())) filtered[name] = value;
  }
  return filtered;
}

module.exports = {
  REMOTE_PHONE_API_PATH,
  REMOTE_PHONE_PROXY_ORIGIN,
  buildRemotePhoneHostTarget,
  filterRemotePhoneRequestHeaders,
  isAllowedPhoneHost,
  isAllowedRemotePhonePort,
  normalizeRemotePhoneHostBaseUrl,
  normalizeRemotePhoneMethod,
};
