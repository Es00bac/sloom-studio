const { existsSync, realpathSync, statSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');

const INVENTORY_PATH = join('inventory', 'font-inventory.json');

function validLibraryRoot(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return undefined;
  const absolute = resolve(candidate);
  if (!existsSync(join(absolute, INVENTORY_PATH))) return undefined;
  try {
    return realpathSync(absolute);
  } catch {
    return undefined;
  }
}

function resolveBundledFontLibraryRoot(options) {
  const env = options?.env ?? process.env;
  const candidates = [
    env.SLOOM_FONT_PACK_DIR,
    options?.appIsPackaged ? join(options.resourcesPath, 'font-library') : undefined,
    options?.appRoot ? join(options.appRoot, 'build', 'font-library') : undefined,
    options?.appRoot ? resolve(options.appRoot, '..', 'fonts') : undefined,
  ];
  for (const candidate of candidates) {
    const root = validLibraryRoot(candidate);
    if (root) return root;
  }
  return undefined;
}

function resolveBundledFontResourcePath(root, requestUrl) {
  const verifiedRoot = validLibraryRoot(root);
  if (!verifiedRoot || typeof requestUrl !== 'string') return undefined;
  // WHATWG URL parsing normalizes encoded dot-segments, so reject them before parsing.
  if (/(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i.test(requestUrl.replace(/\\/g, '/'))) return undefined;
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'signal-loom-font:' || parsed.hostname !== 'library') return undefined;
  let decoded;
  try {
    decoded = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  } catch {
    return undefined;
  }
  if (!decoded || decoded.includes('\0') || decoded.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return undefined;
  }
  const target = resolve(verifiedRoot, ...decoded.split('/'));
  const within = relative(verifiedRoot, target);
  if (!within || within === '..' || within.startsWith(`..${sep}`)) return undefined;
  if (!existsSync(target)) return undefined;
  try {
    const realTarget = realpathSync(target);
    const realRelative = relative(verifiedRoot, realTarget);
    if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${sep}`)) return undefined;
    return statSync(realTarget).isFile() ? realTarget : undefined;
  } catch {
    return undefined;
  }
}

module.exports = {
  resolveBundledFontLibraryRoot,
  resolveBundledFontResourcePath,
};
