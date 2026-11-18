// V-07: native loading of the package config (.ts) by Node, as the CLI does for commands that
// do not run tests. Runs in an ESM and a CJS project with each Node binary given.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepare } from '../lib.mjs';

const VARIANTS = {
  'plain (relative import with .ts)': 'pw-perf.plain.config.ts',
  'extensionless relative import': 'pw-perf.noext.config.ts',
  'tsconfig path alias': 'pw-perf.alias.config.ts',
  'enum (non-erasable syntax)': 'pw-perf.enum.config.ts',
};

function nodeBinaries() {
  const bins = { [process.version]: process.execPath };
  const n22 = process.env.PROTO_NODE22;
  if (n22 && existsSync(n22)) {
    const v = spawnSync(n22, ['-v'], { encoding: 'utf8' }).stdout.trim();
    bins[v] = n22;
  }
  return bins;
}

export function v07(version) {
  const out = [];
  for (const project of ['esm-ts', 'cjs-js']) {
    const dir = prepare(version, project);
    writeFileSync(
      join(dir, 'pw-perf.enum.config.ts'),
      "enum Mode { Fast = 'fast' }\nexport default { marker: 'enum', mode: Mode.Fast };\n",
    );
    for (const [nodeVersion, bin] of Object.entries(nodeBinaries())) {
      for (const [variant, file] of Object.entries(VARIANTS)) {
        // Same shape as the spec test, but with an absolute file URL like the CLI will use.
        const url = pathToFileURL(join(dir, file)).href;
        const code = `import(${JSON.stringify(url)}).then((m) => console.log(JSON.stringify(m.default)), (e) => { console.error('IMPORT_ERROR ' + (e.code ?? '') + ' ' + e.message.split('\\n')[0]); process.exit(1); })`;
        const r = spawnSync(bin, ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8' });
        const stderrLines = r.stderr.split('\n').filter((l) => l.trim() && !l.startsWith('(Use `node --trace'));
        out.push({
          project,
          node: nodeVersion,
          variant,
          ok: r.status === 0,
          value: r.status === 0 ? JSON.parse(r.stdout.trim()) : null,
          error: stderrLines.find((l) => l.startsWith('IMPORT_ERROR'))?.replaceAll(dir, '<project>') ?? null,
          warnings: stderrLines.filter((l) => !l.startsWith('IMPORT_ERROR')).map((l) => l.replaceAll(dir, '<project>')),
        });
      }
    }
  }
  return out;
}
