import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
// v0.5.x exports the plugin under `reactRefresh` (ESM interop).
import reactRefresh from 'eslint-plugin-react-refresh'
const refreshVite = (reactRefresh.reactRefresh || reactRefresh.default || reactRefresh).configs.vite
// v5.x: `configs.flat` was renamed; `recommended-latest` is the flat config.
const hooksRecommended = (reactHooks.configs.flat || reactHooks.configs)['recommended-latest']
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'release', 'node_modules']),
  // Minified third-party bundle (JSZip) — not our code.
  { ignores: ['devtools-extension/vendor/**'] },
  // DevTools extension runs inside the Chromium DevTools context:
  // browser DOM + chrome.* APIs.
  {
    files: ['devtools-extension/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly', JSZip: 'readonly' },
    },
  },
  // Electron main-process files are CommonJS running under Node.
  {
    files: ['electron/**/*.js', 'bin/**/*.js', 'test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      hooksRecommended,
      refreshVite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^(e|_.*|.*_)$',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^(e|_.*|.*_)$',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // `catch (_) { /* ignore */ }` is an established pattern here.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
