export default {
  plugins: {
    '@tailwindcss/postcss': {},
    // Tailwind 4 intentionally targets Chrome 111+. ChromeOS can keep an older ARC WebView
    // even when the desktop browser is newer; in those WebViews an unsupported @layer block is
    // discarded wholesale and Sloom appears as raw HTML. Preserve layer precedence by compiling
    // it to selector specificity so the same stylesheet works in ChromeOS compatibility builds.
    '@csstools/postcss-cascade-layers': {},
    autoprefixer: {},
  },
}
