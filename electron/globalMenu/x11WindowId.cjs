// Resolve the real X11 window id (XID) for an Electron toplevel window.
//
// Why this is needed: under KDE's XWayland + Electron's Ozone/X11 backend, BrowserWindow
// .getNativeWindowHandle() does not reliably return the toplevel XID (it comes back as 0x1 here), and
// the KDE AppMenu registrar is keyed strictly on the real XID. So we correlate by the X11 window
// metadata instead: enumerate managed toplevels and match on the owning pid + the window title (every
// Sloom Studio workspace window has a distinct title, which disambiguates multiple windows in one pid).
//
// Pure-ish: all process spawning goes through an injectable `exec` so the matching logic is unit-tested
// without X11. Returns a positive integer XID, or null if it can't be resolved (caller falls back to
// the in-window menu — never a crash).

const { execFileSync } = require('child_process');

function defaultExec(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** "0x3800014" or "58720276" -> 58720276 (positive int) or null. */
function parseWindowId(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const value = /^0x[0-9a-f]+$/i.test(text) ? parseInt(text, 16) : parseInt(text, 10);
  return Number.isInteger(value) && value > 1 ? value : null;
}

/** Tokenize a candidate-id blob (xdotool prints one id per line; xprop comma-separates hex). */
function extractIds(blob) {
  if (!blob) return [];
  const ids = [];
  for (const match of String(blob).matchAll(/0x[0-9a-f]+|\b\d{3,}\b/gi)) {
    const id = parseWindowId(match[0]);
    if (id != null) ids.push(id);
  }
  return ids;
}

function normalizeTitle(value) {
  // X11 titles can carry bidi/isolate control chars (xprop shows ‎⁨…⁩); strip them for matching.
  return String(value ?? '')
    .replace(/[‎‏⁦-⁩]/g, '')
    .trim()
    .toLowerCase();
}

/** xdotool's --name takes a REGEX; our titles contain regex metachars ("Sloom Studio (probe)").
 *  Escape them so the search can't error out or match the wrong thing. */
function escapeForXdotoolName(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Resolve the real XID for an Electron toplevel. CRITICAL CORRECTNESS RULE: this must NEVER return a
// window that isn't confidently ours. The KDE AppMenu registrar is keyed on the XID, so handing back
// some other app's window id would hijack that app's global menu and replace it with ours. So every
// return path below is gated on positive evidence (a title match, or a single unambiguous managed
// candidate). When the evidence is weak or ambiguous we return null and the caller falls back to the
// in-window menu — a missing global menu is acceptable; a stolen one is not.
function resolveX11WindowId({ pid, titleIncludes, exec = defaultExec } = {}) {
  const wantTitle = normalizeTitle(titleIncludes);

  const candidates = [];
  const pushAll = (blob) => {
    for (const id of extractIds(blob)) {
      if (!candidates.includes(id)) candidates.push(id);
    }
  };

  // Prefer the pid-scoped search (xdotool), then a title search, then the EWMH client list (xprop).
  if (Number.isInteger(pid) && pid > 0) {
    pushAll(exec('xdotool', ['search', '--pid', String(pid)]));
  }
  if (wantTitle) {
    pushAll(exec('xdotool', ['search', '--name', escapeForXdotoolName(titleIncludes)]));
  }
  if (candidates.length === 0) {
    pushAll(exec('xprop', ['-root', '_NET_CLIENT_LIST']));
  }
  if (candidates.length === 0) return null;

  const managed = new Set(extractIds(exec('xprop', ['-root', '_NET_CLIENT_LIST'])));

  // Strongest signal: a candidate whose live window title actually contains the workspace title.
  // This is the only path that disambiguates multiple toplevels owned by the same pid, and it is the
  // only path we trust when there is any ambiguity.
  if (wantTitle) {
    for (const id of candidates) {
      const name = normalizeTitle(exec('xdotool', ['getwindowname', String(id)]));
      if (name && name.includes(wantTitle)) return id;
    }
    // We asked for a title but nothing matched it — refuse to guess (don't risk a foreign window).
    return null;
  }

  // No title to match on: only safe if exactly ONE candidate is a managed (EWMH) toplevel. More than
  // one and we can't tell which is ours, so we decline rather than gamble.
  const managedCandidates = candidates.filter((id) => managed.has(id));
  return managedCandidates.length === 1 ? managedCandidates[0] : null;
}

module.exports = {
  resolveX11WindowId,
  parseWindowId,
  extractIds,
  normalizeTitle,
  escapeForXdotoolName,
};
