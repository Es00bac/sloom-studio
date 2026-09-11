import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { createLogger } from 'vite'
import { Features } from 'lightningcss'
import { fileURLToPath, URL } from 'node:url'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const resizeObserverLoopLogSnippets = [
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
]

export function isResizeObserverLoopLogMessage(message: unknown): boolean {
  const text = typeof message === 'string'
    ? message
    : message instanceof Error
      ? message.message
      : ''

  return resizeObserverLoopLogSnippets.some((snippet) => text.includes(snippet))
}

const logger = createLogger()
const loggerError = logger.error.bind(logger)
logger.error = (message, options) => {
  if (isResizeObserverLoopLogMessage(message)) {
    return
  }
  loggerError(message, options)
}

const harfBuzzWasmSource = fileURLToPath(new URL('./node_modules/harfbuzzjs/dist/harfbuzz.wasm', import.meta.url))
const harfBuzzWasmOutput = fileURLToPath(new URL('./dist/assets/harfbuzz.wasm', import.meta.url))

const copyHarfBuzzWasm = {
  name: 'copy-harfbuzz-wasm',
  apply: 'build' as const,
  closeBundle: async () => {
    await mkdir(dirname(harfBuzzWasmOutput), { recursive: true })
    await copyFile(harfBuzzWasmSource, harfBuzzWasmOutput)
  },
}

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  customLogger: logger,
  plugins: [react(), copyHarfBuzzWasm],
  css: {
    lightningcss: {
      // Tailwind's generated palette and Sloom's configurable theme both use modern colors.
      // Emit a broadly supported fallback before each guarded color-mix/OKLab declaration.
      include: Features.Colors,
    },
  },
  resolve: {
    alias: {
      util: fileURLToPath(new URL('./src/lib/nodeUtilBrowserShim.ts', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  test: {
    // Agent-isolation worktrees actually land at .claude/worktrees/<id>/ (Claude Code's
    // worktree tool), not the .worktrees/ this pattern originally assumed — without the
    // .claude/ prefix, a stray leftover worktree's duplicate test files get collected and
    // run (and fail) alongside the real suite. Excluding all of .claude/ (independently
    // arrived at on both lines of this merge) is the more robust fix — it also covers any
    // other stray non-worktree content Claude Code drops there.
    exclude: [
      ...configDefaults.exclude,
      '**/.worktrees/**',
      '**/.claude/**',
      // This isolated fulfillment-service suite intentionally uses node:test and is run with
      // `node --test`; collecting it through Vitest executes the tests and then reports a false
      // "No test suite found" failure because it registers no Vitest cases.
      'ops/play-license-service/service.test.mjs',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    // ChromeOS's Android container can expose an older WebView than the Chromebook's desktop
    // browser. Chrome 89 supports the top-level-await dependency used by managed typography while
    // avoiding ES2022-only syntax that caused otherwise supported Chromebooks to render partially.
    target: 'chrome89',
    cssTarget: 'chrome80',
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('@xyflow/react')) {
              return 'vendor-xyflow';
            }
            if (id.includes('@google/genai') || id.includes('@google/generative-ai')) {
              return 'vendor-google';
            }
            if (id.includes('openai')) {
              return 'vendor-openai';
            }
            if (id.includes('@huggingface')) {
              return 'vendor-huggingface';
            }
            if (id.includes('@ffmpeg')) {
              return 'vendor-ffmpeg';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('zustand')) {
              return 'vendor-react';
            }
          }
          return undefined;
        },
      },
    },
  },
})
