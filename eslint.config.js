// @ts-check
import { builtinModules } from 'node:module';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// src/core is pure: no Node built-ins and no Playwright (01-REQ-02, ADR-0005).
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

/**
 * Lets the files of `dir` import only the given path prefixes; `typeOnly` prefixes only with
 * `import type` (01, chapter 5).
 * @param {string} dir
 * @param {string[]} allowed
 * @param {string[]} [typeOnly]
 * @returns {import('eslint').Linter.Config[]}
 */
function moduleBoundaries(dir, allowed, typeOnly = []) {
  const escape = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const any = [...allowed, ...typeOnly].map(escape).join('|');
  return [
    {
      files: [`${dir}/**/*.ts`],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: `^(?!${any})`,
                message: `${dir} may import only ${allowed.join(', ')} (01, chapter 5).`,
              },
              ...typeOnly.map((prefix) => ({
                regex: `^${escape(prefix)}`,
                allowTypeImports: true,
                message: `${dir} may import ${prefix} only with "import type" (01, chapter 5).`,
              })),
            ],
          },
        ],
      },
    },
  ];
}

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'node_modules/',
      'src/core/types/generated/',
      'src/core/config/generated/',
      // Sample Playwright projects run by the integration tests against the built package.
      'test/integration/projects/',
      'test/perf/projects/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['process', 'console', 'Buffer', 'require', 'module', '__dirname', '__filename'].map(
          (name) => ({
            name,
            message: 'src/core must not use I/O or the environment (01-REQ-02).',
          }),
        ),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Inject the clock (01-REQ-02).' },
        { object: 'Math', property: 'random', message: 'Inject the seed (01-REQ-02).' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins.map((name) => ({
            name,
            message: 'src/core must not import Node built-ins (01-REQ-02).',
          })),
          patterns: [
            {
              group: ['@playwright/*', 'playwright', 'playwright-core', 'playwright/*'],
              message: 'src/core must not import Playwright (01-REQ-02).',
            },
            {
              regex: '^(?!\\.)(?!node:)',
              message: 'src/core may import only other core modules (01, chapter 5).',
            },
          ],
        },
      ],
    },
  },

  // Module dependency rules (01, chapter 5; 01-REQ-25) for the modules outside src/core.
  ...moduleBoundaries('src/mode', ['./', '../core/types/']),
  ...moduleBoundaries('src/registry', ['./', '../core/types/', '../mode/'], ['../core/config/']),
  ...moduleBoundaries(
    'src/config',
    ['./', '../core/', '../mode/', '../registry/', '../../package.json'],
    ['@playwright/test'],
  ),
  ...moduleBoundaries(
    'src/collector',
    [
      './',
      // The state file of a check in the temporary directory (04-REQ-49).
      'node:fs',
      'node:os',
      'node:path',
      '../core/types/',
      '../core/schema/',
      // perfDefaults: the default config when withPerf() was not applied (01-REQ-07).
      '../core/config/',
      '../mode/',
      '../registry/',
      '../../package.json',
    ],
    ['@playwright/test'],
  ),
  ...moduleBoundaries(
    'src/reporter',
    [
      './',
      '../core/',
      '../mode/',
      '../registry/',
      '../io/',
      '../html/',
      '../console/',
      // Package version when withPerf() was not applied (01-REQ-07).
      '../../package.json',
    ],
    ['@playwright/test'],
  ),
  // io may use the pure core (stable JSON, format parsers) besides node:* (01-REQ-20).
  ...moduleBoundaries('src/io', ['./', 'node:', '../core/']),
  ...moduleBoundaries('src/html', ['./', '../core/types/']),
  // The page script runs in the browser and has no imports (11-REQ-25).
  {
    files: ['src/html/template/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  ...moduleBoundaries('src/console', ['./', '../core/types/']),
  ...moduleBoundaries('src/cli', [
    './',
    '../core/',
    '../mode/',
    '../io/',
    '../html/',
    '../console/',
    'node:',
    '../../package.json',
  ]),
  // The init wizard is part of the CLI: the same modules, one directory deeper (04, chapter 4.10).
  ...moduleBoundaries('src/cli/init', [
    './',
    '../host.ts',
    '../output.ts',
    '../run.ts',
    '../../console/color.ts',
    '../../console/box.ts',
    '../../core/',
    '../../mode/',
    'node:',
  ]),
  // @playwright/test at runtime only in the "./test" entry point (01-REQ-26).
  {
    files: ['src/entries/**/*.ts'],
    ignores: ['src/entries/test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@playwright/test$',
              allowTypeImports: true,
              message:
                'Only src/entries/test.ts may import @playwright/test at runtime (01-REQ-26).',
            },
          ],
        },
      ],
    },
  },
);
