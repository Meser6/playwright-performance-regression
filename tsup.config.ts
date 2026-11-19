import { defineConfig } from 'tsup';

/** Library entry points (01, chapter 9). */
const entries = {
  index: 'src/entries/index.ts',
  config: 'src/entries/config.ts',
  fixture: 'src/entries/fixture.ts',
  test: 'src/entries/test.ts',
  reporter: 'src/entries/reporter.ts',
};

// Code splitting: modules used by several entry points go to shared chunks instead of being
// copied into each entry point (13-REQ-11 package size). Chunks stay next to the entry points in
// dist/, so the reporter path derived from the running file (src/config/reporter-path.ts) still
// points to dist/reporter.js or dist/reporter.cjs.
export default defineConfig([
  {
    // ESM: the library entry points and the CLI in one build, so they share chunks. The CLI
    // keeps the hashbang of src/entries/cli.ts.
    entry: { ...entries, cli: 'src/entries/cli.ts' },
    format: ['esm'],
    dts: { entry: entries },
    target: 'node22',
    platform: 'node',
    clean: false,
    sourcemap: false,
    splitting: true,
    treeshake: true,
    // UTF-8 output instead of \u escapes: the wizard texts (04-REQ-43) are mostly non-ASCII and
    // escaping would triple their size (13-REQ-11 package size).
    esbuildOptions(options) {
      options.charset = 'utf8';
    },
  },
  {
    // CJS: a separate CommonJS build of the library entry points with its own shared chunks
    // and declarations (01-REQ-34).
    entry: entries,
    format: ['cjs'],
    dts: true,
    target: 'node22',
    platform: 'node',
    clean: false,
    sourcemap: false,
    splitting: true,
    treeshake: true,
  },
]);
