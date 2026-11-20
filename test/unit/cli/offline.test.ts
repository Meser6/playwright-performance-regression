import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveBaseDir } from '../../../src/cli/base-dir.ts';
import {
  loadFailureHint,
  resolveCliConfig,
  snapshotDifferences,
} from '../../../src/cli/config-file.ts';
import { main } from '../../../src/cli/main.ts';
import type { RunReport } from '../../../src/core/types/index.ts';
import { fakeConfig, fakeHost, registered, runTests, session } from '../reporter/harness.ts';
import { fakeCliHost } from './harness.ts';

let root: string;
/** Directory of the Playwright config of the source run (configDir of the report). */
let project: string;
/** Current directory of the CLI. */
let cwd: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pw-perf-cli-offline-'));
  project = join(root, 'project');
  cwd = join(root, 'cwd');
  mkdirSync(project);
  mkdirSync(cwd);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const PATHS = ['/api/items/1', '/api/cart'];
const steady = (i: number, path: string): number => (path === '/api/cart' ? 100 : 50) + (i % 7);

/** A thresholds run of the reporter in `project`: report.json and the thresholds files. */
async function reporterRun(mode: 'test' | 'thresholds' = 'thresholds'): Promise<string> {
  const captured = fakeHost(project);
  const s = session(captured, registered({}, { mode, runId: 'run-src' }));
  s.begin(fakeConfig(project), { allTests: () => [] });
  runTests(s, project, 30, PATHS, steady);
  await s.end({ status: 'passed' });
  return join(project, 'pw-perf-results', 'report.json');
}

function cli(extra: { importModule?: (url: string) => Promise<unknown> } = {}) {
  const fake = fakeCliHost({ cwd, ...extra });
  fake.host.packageVersion = '0.0.0-test';
  return fake;
}

const readReport = (path: string): RunReport => JSON.parse(readFileSync(path, 'utf8')) as RunReport;

describe('thresholds --from', () => {
  test('04-AC-07 derives the same thresholds files as the reporter in a thresholds run', async () => {
    const report = await reporterRun();
    const api = join(project, 'pw-perf-thresholds.api.json');
    const fromReporter = readFileSync(api);
    renameSync(api, join(root, 'reporter.api.json'));

    const fake = cli();
    expect(await main(['thresholds', '--from', report], fake.host)).toBe(0);
    // No config file: the snapshot of the report, base directory = configDir of the report.
    const err = fake.stderr.join('');
    expect(err).toContain('config: the config snapshot in the report');
    expect(err).toContain(`base directory: ${project}`);
    expect(readFileSync(api).equals(fromReporter)).toBe(true);
    expect(readFileSync(join(project, 'pw-perf-results', 'thresholds-diff.md'), 'utf8')).toContain(
      '# Thresholds diff',
    );
    expect(fake.stdout.join('')).toContain('(created)');
    expect(err).toContain('1 thresholds file written · exit code 0');

    // Again from the same report: nothing changes.
    const again = cli();
    expect(await main(['thresholds', '--from', report], again.host)).toBe(0);
    expect(readFileSync(api).equals(fromReporter)).toBe(true);
    expect(again.stderr.join('')).toContain('thresholds files unchanged · exit code 0');
  });

  test('04-REQ-26 a report from another machine: the current directory with CLI_CONFIG_DIR_MISSING', async () => {
    const source = readReport(await reporterRun('test'));
    source.configDir = join(root, 'ci-machine', 'app');
    const report = join(cwd, 'report.json');
    writeFileSync(report, JSON.stringify(source));
    const fake = cli();
    expect(await main(['thresholds', '--from', 'report.json', '--env', 'ci'], fake.host)).toBe(0);
    const err = fake.stderr.join('');
    expect(err).toContain('warning CLI_CONFIG_DIR_MISSING');
    expect(err).toContain(`base directory: ${cwd}`);
    // --env wins over the label of the report; the source was a test-mode run.
    expect(existsSync(join(cwd, 'pw-perf-thresholds.api.ci.json'))).toBe(true);
    expect(err).toContain('warning THRESHOLDS_ENV_MISMATCH');
    expect(err).toContain('warning THRESHOLDS_SOURCE_TEST_MODE');
  });

  test('04-REQ-27 failed tests in the report warn with CLI_REPORT_TESTS_FAILED; an empty report is refused', async () => {
    const source = readReport(await reporterRun('test'));
    writeFileSync(
      join(cwd, 'failed.json'),
      JSON.stringify({ ...source, tests: { ...source.tests, status: 'failed' } }),
    );
    const failed = cli();
    expect(await main(['thresholds', '--from', 'failed.json'], failed.host)).toBe(0);
    expect(failed.stderr.join('')).toContain('warning CLI_REPORT_TESTS_FAILED');

    writeFileSync(
      join(cwd, 'empty.json'),
      JSON.stringify({ ...source, endpoints: {}, custom: {} }),
    );
    const empty = cli();
    expect(await main(['thresholds', '--from', 'empty.json'], empty.host)).toBe(3);
    expect(empty.stderr.join('')).toContain('error THRESHOLDS_EMPTY_REPORT');
  });

  test('04-REQ-27 a missing or invalid report ends with 3', async () => {
    const missing = cli();
    expect(await main(['thresholds', '--from', 'nope.json'], missing.host)).toBe(3);
    expect(missing.stderr.join('')).toContain('error CLI_REPORT_NOT_FOUND');

    writeFileSync(join(cwd, 'new.json'), JSON.stringify({ schemaVersion: 99 }));
    const tooNew = cli();
    expect(await main(['thresholds', '--from', 'new.json'], tooNew.host)).toBe(3);
    expect(tooNew.stderr.join('')).toContain('error SCHEMA_VERSION_TOO_NEW');
  });

  test('04-REQ-25 a pw-perf.config.json in the current directory wins over the snapshot', async () => {
    const report = await reporterRun('test');
    writeFileSync(
      join(cwd, 'pw-perf.config.json'),
      JSON.stringify({
        thresholds: { dir: 'thr' },
        checks: { time: { median: { margin: { relative: 0.5 } } } },
      }),
    );
    const fake = cli();
    expect(await main(['thresholds', '--from', report], fake.host)).toBe(0);
    const err = fake.stderr.join('');
    expect(err).toContain(`config: ${join(cwd, 'pw-perf.config.json')}`);
    expect(err).toContain(`base directory: ${cwd}`);
    expect(existsSync(join(cwd, 'thr', 'pw-perf-thresholds.api.json'))).toBe(true);
    // 01-REQ-31: thresholds.dir is a location, the margin changes the result.
    expect(err).toContain(
      'warning CONFIG_SNAPSHOT_DIFFERS: The package config file differs from the config the report was recorded with: checks.time.median.margin.relative.',
    );
  });

  test('04-REQ-25 a config file in the config directory of the report is found from another directory', async () => {
    const report = await reporterRun('test');
    writeFileSync(
      join(project, 'pw-perf.config.json'),
      JSON.stringify({ thresholds: { dir: 'thr' } }),
    );
    const fake = cli();
    expect(await main(['thresholds', '--from', report], fake.host)).toBe(0);
    expect(fake.stderr.join('')).toContain(`config: ${join(project, 'pw-perf.config.json')}`);
    expect(existsSync(join(project, 'thr', 'pw-perf-thresholds.api.json'))).toBe(true);
  });

  test('CLI_WRITE_FAILED when a thresholds file cannot be written', async () => {
    const report = await reporterRun('test');
    writeFileSync(join(cwd, 'pw-perf.config.json'), JSON.stringify({ thresholds: { dir: 'thr' } }));
    // A file where the thresholds directory should be.
    writeFileSync(join(cwd, 'thr'), '');
    const fake = cli();
    expect(await main(['thresholds', '--from', report], fake.host)).toBe(3);
    expect(fake.stderr.join('')).toContain(
      `error CLI_WRITE_FAILED: The thresholds file ${join(cwd, 'thr', 'pw-perf-thresholds.api.json')} could not be written`,
    );
  });
});

describe('package config of the commands without tests', () => {
  const exists = async (path: string): Promise<boolean> => existsSync(path);

  test('03-AC-03 CONFIG_FILE_NOT_FOUND for a --config file that does not exist', async () => {
    const result = await resolveCliConfig(
      { explicit: join(cwd, 'missing.ts'), searchDirs: [cwd], mode: 'thresholds' },
      { exists },
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'CONFIG_FILE_NOT_FOUND',
          message: `The package config file given with --config does not exist: ${join(cwd, 'missing.ts')}`,
        }),
      ],
    });
    const fake = cli();
    writeFileSync(join(cwd, 'r.json'), readFileSync(await reporterRun('test')));
    expect(
      await main(['thresholds', '--from', 'r.json', '--config', 'missing.ts'], fake.host),
    ).toBe(3);
    expect(fake.stderr.join('')).toContain('error CONFIG_FILE_NOT_FOUND');
  });

  test('03-AC-03 01-REQ-41 CONFIG_FILE_LOAD_FAILED with the fix hint of the Node error', () => {
    const error = (code: string, message: string): Error =>
      Object.assign(new Error(message), { code });
    expect(
      loadFailureHint(
        error(
          'ERR_MODULE_NOT_FOUND',
          "Cannot find module '/p/cfg/helpers' imported from /p/pw-perf.config.ts",
        ),
      ),
    ).toContain('"./helpers.ts"');
    expect(
      loadFailureHint(
        error(
          'ERR_MODULE_NOT_FOUND',
          "Cannot find package '@cfg/helpers' imported from /p/pw-perf.config.ts",
        ),
      ),
    ).toContain('use a relative import');
    expect(
      loadFailureHint(
        error(
          'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
          'TypeScript enum is not supported in strip-only mode',
        ),
      ),
    ).toContain('replace enums');
    expect(loadFailureHint(new SyntaxError('Unexpected token'))).toContain(
      'Fix the error in the file',
    );
  });

  test('03-AC-03 01-REQ-38 a file found by name that fails to load is a warning; with --config an error', async () => {
    const report = readReport(await reporterRun('test'));
    writeFileSync(join(cwd, 'pw-perf.config.ts'), 'enum A { B }');
    const failing = async (): Promise<unknown> => {
      throw Object.assign(new Error('TypeScript enum is not supported in strip-only mode'), {
        code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
      });
    };
    const found = await resolveCliConfig(
      { searchDirs: [cwd], report, mode: 'thresholds' },
      { exists, importModule: failing },
    );
    if (!found.ok) throw new Error(JSON.stringify(found.issues));
    expect(found.value.source).toEqual({ kind: 'snapshot' });
    expect(found.value.warnings).toEqual([
      {
        code: 'CONFIG_FILE_LOAD_FAILED',
        message: `The package config ${join(cwd, 'pw-perf.config.ts')} cannot be loaded: TypeScript enum is not supported in strip-only mode The config snapshot of the report is used instead.`,
        hint: expect.stringContaining('erasable syntax'),
      },
    ]);

    const explicit = await resolveCliConfig(
      { explicit: join(cwd, 'pw-perf.config.ts'), searchDirs: [cwd], report, mode: 'thresholds' },
      { exists, importModule: failing },
    );
    expect(explicit.ok).toBe(false);
    if (!explicit.ok) expect(explicit.issues[0]?.code).toBe('CONFIG_FILE_LOAD_FAILED');
  });

  test('03-AC-03 CONFIG_SNAPSHOT_DIFFERS lists the options that change the result', () => {
    expect(
      snapshotDifferences(
        {
          run: { env: 'a' },
          report: { dir: 'x' },
          thresholds: { dir: 'a', hysteresis: 0.1 },
          gate: { warnOnly: false },
        },
        {
          run: { env: 'b' },
          report: { dir: 'y' },
          thresholds: { dir: 'b', hysteresis: 0.2 },
          gate: { warnOnly: true },
        },
      ),
    ).toEqual(['gate.warnOnly', 'thresholds.hysteresis']);
    expect(snapshotDifferences({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
  });

  test('01-REQ-41 Node loading warnings become one note; other warnings pass unchanged', async () => {
    writeFileSync(join(cwd, 'pw-perf.config.ts'), '');
    const seen: string[] = [];
    const listener = (w: Error): void => {
      seen.push(w.message);
    };
    process.on('warning', listener);
    try {
      const result = await resolveCliConfig(
        { searchDirs: [cwd], mode: 'thresholds' },
        {
          exists,
          importModule: async () => {
            process.emitWarning(
              'Type Stripping is an experimental feature and might change at any time',
              'ExperimentalWarning',
            );
            process.emitWarning('something else', 'DeprecationWarning');
            return { default: { gate: { warnOnly: true } } };
          },
        },
      );
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(result.value.config.gate.warnOnly).toBe(true);
      expect(result.value.notes).toEqual([
        'note: Node printed a warning while loading pw-perf.config.ts: Type Stripping is an experimental feature and might change at any time',
      ]);
      expect(seen).toEqual(['something else']);
    } finally {
      process.off('warning', listener);
    }
  });

  test('a module with { default } from a CJS file, a file without default export, an invalid config', async () => {
    writeFileSync(join(cwd, 'pw-perf.config.cjs'), '');
    const load = (module: unknown) =>
      resolveCliConfig(
        { searchDirs: [cwd], mode: 'thresholds' },
        { exists, importModule: async () => module },
      );
    const cjs = await load({ default: { default: { gate: { warnOnly: true } } } });
    expect(cjs.ok && cjs.value.config.gate.warnOnly).toBe(true);
    const none = await load({ other: 1 });
    expect(none.ok && none.value.warnings.map((w) => w.code)).toEqual(['CONFIG_FILE_LOAD_FAILED']);
    const invalid = await load({ default: { gate: { warnOnly: 'yes' } } });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues[0]?.code).toBe('CONFIG_INVALID_TYPE');
  });

  test('04-REQ-26 resolveBaseDir: the config file, the configDir of the report, else cwd', () => {
    const exists = (dir: string): boolean => dir === '/ci/app';
    expect(
      resolveBaseDir({
        loadedConfigFile: '/p/pw-perf.config.ts',
        reportConfigDir: '/ci/app',
        cwd: '/w',
        exists,
      }),
    ).toEqual({ dir: '/p', issues: [] });
    expect(resolveBaseDir({ reportConfigDir: '/ci/app', cwd: '/w', exists })).toEqual({
      dir: '/ci/app',
      issues: [],
    });
    const fallback = resolveBaseDir({ reportConfigDir: '/gone', cwd: '/w', exists });
    expect(fallback.dir).toBe('/w');
    expect(fallback.issues.map((i) => i.code)).toEqual(['CLI_CONFIG_DIR_MISSING']);
  });
});

describe('report', () => {
  test('04-REQ-28 without --input: report.json of report.dir; missing gives CLI_REPORT_NOT_FOUND', async () => {
    const fake = cli();
    expect(await main(['report'], fake.host)).toBe(3);
    const err = fake.stderr.join('');
    expect(err).toContain(
      `error CLI_REPORT_NOT_FOUND: The run report ${join(cwd, 'pw-perf-results', 'report.json')} does not exist`,
    );
    expect(err).toContain('--input apps/web/pw-perf-results/report.json');
  });

  test('04-REQ-28 the HTML file goes next to the input, also with report.html false', async () => {
    const report = await reporterRun('test');
    cpSync(report, join(cwd, 'in', 'report.json'));
    writeFileSync(join(cwd, 'pw-perf.config.json'), JSON.stringify({ report: { html: false } }));
    const fake = cli();
    expect(
      await main(['report', '--input', 'in/report.json'], fake.host, {
        renderHtml: (r) => `<html>${r.runId}</html>`,
      }),
    ).toBe(0);
    expect(readFileSync(join(cwd, 'in', 'report.html'), 'utf8')).toBe('<html>run-src</html>');

    const custom = cli();
    expect(
      await main(['report', '--input', 'in/report.json', '--output', 'out/r.html'], custom.host, {
        renderHtml: () => 'x',
      }),
    ).toBe(0);
    expect(existsSync(join(cwd, 'out', 'r.html'))).toBe(true);
  });

  test('11-AC-10 report renders the same HTML as onEnd of the run', async () => {
    const report = await reporterRun('test');
    const fromRun = readFileSync(join(project, 'pw-perf-results', 'report.html'), 'utf8');
    cpSync(report, join(cwd, 'in', 'report.json'));
    const fake = cli();
    expect(await main(['report', '--input', 'in/report.json'], fake.host)).toBe(0);
    expect(readFileSync(join(cwd, 'in', 'report.html'), 'utf8') === fromRun).toBe(true);
    expect(fake.stderr.join('')).toContain(`report: ${join(cwd, 'in', 'report.html')}`);
  });

  test('11 chapter 13: a failing renderer gives HTML_RENDER_FAILED; a failing write CLI_WRITE_FAILED', async () => {
    const report = await reporterRun('test');
    const fake = cli();
    const broken = (): string => {
      throw new Error('render bug');
    };
    expect(await main(['report', '--input', report], fake.host, { renderHtml: broken })).toBe(3);
    expect(fake.stderr.join('')).toContain('error HTML_RENDER_FAILED');
    expect(fake.stderr.join('')).toContain('render bug');

    mkdirSync(join(cwd, 'out.html'));
    const write = cli();
    expect(await main(['report', '--input', report, '--output', 'out.html'], write.host)).toBe(3);
    expect(write.stderr.join('')).toContain('error CLI_WRITE_FAILED');
  });
});
