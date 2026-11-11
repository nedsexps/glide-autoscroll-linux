// Lints the extension's scripts (ESLint recommended rules plus a few stricter ones).
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    js.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 2023, sourceType: 'script',
        globals: { ...globals.browser, ...globals.serviceworker, chrome: 'readonly' },
      },
      rules: {
        'no-unused-vars': ['warn', { args: 'after-used', caughtErrors: 'none', varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
        'no-empty': ['warn', { allowEmptyCatch: true }],
        eqeqeq: 'warn', 'no-shadow': 'warn', 'no-var': 'warn', 'prefer-const': 'warn',
        'no-implicit-globals': 'warn', 'no-redeclare': 'error',
        'no-use-before-define': ['warn', { functions: false, variables: true }],
      },
    },
  ],
});
const results = await eslint.lintFiles(['glide-autoscroll/*.js']);
const problems = results.reduce((n, r) => n + r.errorCount + r.warningCount, 0);
const text = (await eslint.loadFormatter('stylish')).format(results);
console.log(text || `lint: ${results.length} files, no problems`);
process.exit(problems ? 1 : 0);
