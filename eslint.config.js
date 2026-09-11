import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist` is the web build; `android/app/build` holds Gradle-generated copies
  // of the synced web bundle (build intermediates) that must never be linted.
  globalIgnores([
    'dist',
    'android/app/build',
    // These files are immutable, hash-checked source copies plus deterministic
    // runtime output from the renderer shipped with Hane. Lint the Sloom
    // adapter around them, but never rewrite the release-authoritative inputs.
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // The codebase uses a leading underscore to mark a binding as
      // intentionally unused — most often the destructure-and-omit pattern
      // (`const { foo: _foo, ...rest } = obj`) and signature-conformance
      // parameters. Honour that convention so only genuinely-unused (un-marked)
      // bindings are flagged.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      // Advisory diagnostics, kept visible as warnings rather than hard errors.
      // The React Compiler rules are optimization hints — `preserve-manual-
      // memoization`/`set-state-in-effect`/`immutability` flag components the
      // compiler will simply skip auto-optimizing; the code is still correct,
      // and mechanically restructuring effects/memoization in hot image-editor
      // paths to silence them would risk stability for no runtime benefit.
      // `only-export-components` is a dev fast-refresh ergonomics rule, and this
      // codebase deliberately co-locates pure, separately-tested helpers next to
      // their component. All remain warnings so they stay tracked for an
      // incremental migration. (`exhaustive-deps` is already a warning upstream.)
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // Tests legitimately use `any` for partial fixtures, mock modules, and
    // dynamic-descriptor assertions; keep source strict but relax it here.
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
