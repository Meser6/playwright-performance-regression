// @ts-check
import { builtinModules } from 'node:module';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// src/core is pure: no Node built-ins and no Playwright (01-REQ-02, ADR-0005).
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'node_modules/',
      'src/core/types/generated/',
      // Throw-away spike (WP-02), never part of the package.
      'prototype/',
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
);
