// Resolve a path to a bundled asset in `public/` (copied verbatim into the Vite `dist/` root) to a URL
// that loads under BOTH a served http(s) origin (dev server, LAN serving, browser build) AND the bare
// `file://` origin the packaged Electron renderer runs on.
//
// Why this exists: the desktop app is built with Vite `base: './'` and the packaged Electron window
// loads `dist/index.html` over a bare `file://` URL (no custom protocol interceptor). Vite makes the
// app's OWN emitted `<script>`/`<link>` assets relative, so they load fine. But hand-written
// root-absolute strings like `/lcms.wasm` or `/icc/foo.icc` are NOT rewritten — under `file://` a
// leading-slash URL resolves to the filesystem ROOT (`file:///lcms.wasm`), which 404s. That silently
// broke the real CMYK / PDF-X / KDP export path for every desktop user even though the files ship in
// `dist/`. Resolving against `document.baseURI` restores the correct location in every runtime.

/** True when `value` is already an absolute URL (has a scheme, or is protocol-relative). */
function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

/**
 * Turn a bundled-asset path (typically root-absolute like `/icc/FOGRA39L_coated.icc`, or the bare
 * `lcms.wasm` the emscripten glue asks for) into a URL that fetches correctly under both a served
 * origin and packaged `file://`. Absolute URLs (http:, file:, data:, blob:, capacitor: …) pass through
 * untouched. In non-DOM runtimes (Node tests) the input is returned unchanged.
 */
export function resolveBundledAssetUrl(assetPath: string): string {
  if (isAbsoluteUrl(assetPath)) return assetPath;
  const relative = assetPath.replace(/^\/+/, '');
  const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : undefined;
  if (base) {
    try {
      return new URL(relative, base).href;
    } catch {
      // Fall through to the raw path if the base URL is somehow unparseable.
    }
  }
  return assetPath;
}
