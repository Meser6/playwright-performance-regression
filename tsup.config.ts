import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Library entry points: ESM and CJS with separate declarations (01-REQ-34).
    entry: {
      index: 'src/entries/index.ts',
      config: 'src/entries/config.ts',
      fixture: 'src/entries/fixture.ts',
      test: 'src/entries/test.ts',
      reporter: 'src/entries/reporter.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'node22',
    platform: 'node',
    clean: false,
    sourcemap: false,
    splitting: false,
    treeshake: true,
  },
  {
    // CLI binary: ESM only, no declarations.
    entry: { cli: 'src/entries/cli.ts' },
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
    sourcemap: false,
  },
]);
