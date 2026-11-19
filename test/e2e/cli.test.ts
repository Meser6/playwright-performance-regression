// End-to-end tests of the built CLI (`node dist/cli.js`, 04 chapter 10): real Playwright with
// Chromium on test/integration/projects/reporter against the demo server. Needs `pnpm build` and
// the Chromium of the installed Playwright.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PACKAGE_NAME } from '../../src/core/types/index.ts';
import { startDemoServer } from '../demo-server/server.ts';
import type { DemoServer } from '../demo-server/server.ts';

const root = join(import.meta.dirname, '../..');
const cli = join(root, 'dist/cli.js');
const project = join(import.meta.dirname, '../integration/projects/reporter');
const RUN_TIMEOUT = 120_000;
const POSIX = process.platform !== 'win32';

let scratch = '';
/** Outcome files go here (TMPDIR), so the tests can check that none is left (04-REQ-11). */
let tmp = '';
let server: DemoServer;
let runs = 0;

beforeAll(async () => {
  if (!existsSync(cli)) {
    throw new Error('The e2e tests run the built CLI: run "pnpm build" first.');
  }
  // A space in every path the CLI handles (04-AC-06).
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pw-perf e2e-')));
  tmp = join(scratch, 'tmp dir');
  mkdirSync(tmp);
  server = await startDemoServer();
});

afterAll(async () => {
  await server?.close();
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr together. */
  output: string;
  out: string;
}

interface CliOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Called with the child process and its output so far on every chunk of output. */
  onOutput?: (child: ChildProcess, output: string) => void;
}

/** Runs `node dist/cli.js <args>`; INTEGRATION_OUT is a fresh directory of this run. */
function runCli(args: string[], options: CliOptions = {}): Promise<CliRun> {
  const out = join(scratch, `run ${++runs}`);
  mkdirSync(out);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: options.cwd ?? project,
      env: {
        ...clean,
        CI: '',
        NO_COLOR: '1',
        TMPDIR: tmp,
        TEMP: tmp,
        TMP: tmp,
        INTEGRATION_OUT: out,
        DEMO_URL: server.url,
        ...options.env,
      },
    });
    let stdout = '';
    let stderr = '';
    const seen = (): void => options.onOutput?.(child, stdout + stderr);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      seen();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      seen();
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, stdout, stderr, output: stdout + stderr, out });
    });
  });
}

const outcomeFilesLeft = (): string[] =>
  readdirSync(tmp).filter((f) => f.endsWith('.outcome.json'));
const reportPath = (run: CliRun): string => join(run.out, 'perf-results', 'report.json');

/** A thresholds run whose report and thresholds files other tests reuse. */
let source: Promise<{ run: CliRun; thresholds: string }> | undefined;
function sourceRun(): Promise<{ run: CliRun; thresholds: string }> {
  source ??= (async () => {
    const thresholds = join(scratch, 'source thresholds');
    const run = await runCli(['thresholds'], { env: { THRESHOLDS_DIR: thresholds } });
    return { run, thresholds };
  })();
  return source;
}

describe('pw-perf test and thresholds', () => {
  test(
    '04-AC-03 04-AC-06 a passing test run from another directory with -c: exit code 0, no outcome file left',
    async () => {
      const cwd = join(scratch, 'monorepo root');
      mkdirSync(cwd);
      const run = await runCli(
        ['test', '-c', join(project, 'playwright.config.ts'), '--repeat', '2'],
        {
          cwd,
        },
      );
      expect(run.status, run.output).toBe(0);
      expect(run.stderr).toContain(
        `${PACKAGE_NAME}: perf mode "test", 2 repeats per test, 1 worker.`,
      );
      expect(run.stderr).toContain(`${PACKAGE_NAME}: tip: measure a subset`);
      expect(run.stdout).toContain('8 test executions (4 tests × 2 repeats)');
      expect(run.stderr).toContain(
        `${PACKAGE_NAME}: tests passed · performance passed · exit code 0`,
      );
      const html = join(dirname(reportPath(run)), 'report.html');
      expect(run.stderr).toContain(`${PACKAGE_NAME}: report: ${html}`);
      expect(existsSync(reportPath(run))).toBe(true);
      expect(readFileSync(html, 'utf8').startsWith('<!doctype html>')).toBe(true);
      expect(outcomeFilesLeft()).toEqual([]);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-07 thresholds --from gives the same thresholds files as the thresholds run',
    async () => {
      const { run, thresholds } = await sourceRun();
      expect(run.status, run.output).toBe(0);
      expect(run.stderr).toContain(
        `${PACKAGE_NAME}: tests passed · thresholds derived · exit code 0`,
      );
      const files = readdirSync(thresholds).sort();
      expect(files).toEqual(['perf-thresholds.api.json', 'perf-thresholds.custom.json']);

      // From another directory: the config file is found in the configDir of the report.
      const again = join(scratch, 'from thresholds');
      const cwd = join(scratch, 'elsewhere');
      mkdirSync(cwd);
      const from = await runCli(['thresholds', '--from', reportPath(run)], {
        cwd,
        env: { THRESHOLDS_DIR: again },
      });
      expect(from.status, from.output).toBe(0);
      expect(from.stderr).toContain(
        `${PACKAGE_NAME}: config: ${join(project, 'pw-perf.config.ts')}`,
      );
      expect(from.stderr).toContain(`${PACKAGE_NAME}: base directory: ${project}`);
      // 01-REQ-41: Node's own warnings while loading the .ts config are no errors.
      expect(from.stderr).not.toMatch(/^\(node:\d+\)/mu);
      expect(from.stderr).not.toContain('CONFIG_SNAPSHOT_DIFFERS');
      expect(readdirSync(again).sort()).toEqual(files);
      for (const file of files) {
        expect(
          readFileSync(join(again, file)).equals(readFileSync(join(thresholds, file))),
          file,
        ).toBe(true);
      }
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-03 a blocking violation gives exit code 2',
    async () => {
      const { thresholds } = await sourceRun();
      const tight = join(scratch, 'tight thresholds');
      cpSync(thresholds, tight, { recursive: true });
      const file = join(tight, 'perf-thresholds.api.json');
      const content = JSON.parse(readFileSync(file, 'utf8')) as {
        entries: Record<string, Record<string, number>>;
      };
      content.entries['GET /api/cart'] = {
        ...content.entries['GET /api/cart'],
        median: 1,
        percentile: 2,
        p99: 3,
      };
      writeFileSync(file, JSON.stringify(content));
      const run = await runCli(['test'], { env: { THRESHOLDS_DIR: tight } });
      expect(run.status, run.output).toBe(2);
      expect(run.stderr).toContain(
        `${PACKAGE_NAME}: tests passed · performance failed · exit code 2`,
      );
      expect(outcomeFilesLeft()).toEqual([]);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-04 04-AC-22 with --reporter the package reporter runs on the last flag and writes the outcome',
    async () => {
      const run = await runCli([
        'test',
        '--reporter=line',
        '--reporter',
        'list',
        '--grep',
        'checkout',
      ]);
      expect(run.status, run.output).toBe(0);
      expect(existsSync(reportPath(run))).toBe(true);
      expect(run.stdout).toContain('✓');
      expect(run.stderr).toContain('exit code 0');
      // A grep is a test filter: no tip.
      expect(run.stderr).not.toContain('tip:');
    },
    RUN_TIMEOUT,
  );

  test(
    '01-AC-07 test --list ends with the Playwright code, without report and outcome file',
    async () => {
      const run = await runCli(['test', '--list']);
      expect(run.status, run.output).toBe(0);
      expect(run.stdout).toContain('Total: 20 tests in 1 file');
      expect(existsSync(reportPath(run))).toBe(false);
      expect(run.stderr).not.toContain('exit code');
      expect(outcomeFilesLeft()).toEqual([]);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-11 04-AC-03 without withPerf() a run with failed tests ends with 3 and the init hint',
    async () => {
      const run = await runCli(['test', '-c', 'playwright.plain.config.ts'], {
        env: { FAIL_REPEATS: '1' },
      });
      expect(run.status, run.output).toBe(3);
      expect(run.stderr).toContain(`${PACKAGE_NAME}: error CLI_OUTCOME_MISSING`);
      expect(run.stderr).toContain('Playwright exited with code 1');
      expect(run.stderr).toContain('npx pw-perf init');
    },
    RUN_TIMEOUT,
  );

  test('04-AC-14 invalid options and --prune with a filter end with 3 before Playwright starts', async () => {
    const prune = await runCli(['thresholds', '--prune', '--grep', '@cart']);
    expect(prune.status).toBe(3);
    expect(prune.stderr).toContain(`${PACKAGE_NAME}: error CLI_PRUNE_WITH_FILTER`);
    expect(prune.stdout).toBe('');
    expect(prune.stderr).not.toContain('perf mode');

    const invalid = await runCli(['test', '--repeat', 'many']);
    expect(invalid.status).toBe(3);
    expect(invalid.stderr).toContain('error CLI_INVALID_OPTION: --repeat: expected an integer');
    const ui = await runCli(['test', '--ui']);
    expect(ui.status).toBe(3);
    expect(ui.stderr).toContain('error CLI_UNSUPPORTED_PLAYWRIGHT_OPTION');
  });

  test('04-REQ-14 without @playwright/test in the project: CLI_PLAYWRIGHT_NOT_FOUND', async () => {
    const cwd = join(scratch, 'no playwright');
    mkdirSync(cwd);
    const run = await runCli(['test'], { cwd });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain('error CLI_PLAYWRIGHT_NOT_FOUND');
    expect(run.stderr).toContain('npm i -D @playwright/test');
  });

  test(
    '04-AC-05 04-AC-15 SIGINT ends Playwright and the CLI with 130; thresholds files and the outcome file are not left changed',
    // Signals between processes are POSIX only; Windows is covered by the OS matrix (13-REQ-09).
    { skip: !POSIX, timeout: RUN_TIMEOUT },
    async () => {
      const { thresholds } = await sourceRun();
      const kept = join(scratch, 'interrupted thresholds');
      cpSync(thresholds, kept, { recursive: true });
      const before = readdirSync(kept).map((f) => readFileSync(join(kept, f)));
      let sent = false;
      const run = await runCli(['thresholds', '--repeat', '10'], {
        env: { THRESHOLDS_DIR: kept },
        onOutput: (child, output) => {
          // After the first finished test (list reporter).
          if (!sent && output.includes('✓')) {
            sent = true;
            child.kill('SIGINT');
          }
        },
      });
      expect(sent).toBe(true);
      expect(run.status, run.output).toBe(130);
      expect(readdirSync(kept).map((f) => readFileSync(join(kept, f)))).toEqual(before);
      expect(outcomeFilesLeft()).toEqual([]);
    },
  );

  test(
    '04-AC-03 SIGTERM ends the run with 143',
    // Signals between processes are POSIX only; Windows is covered by the OS matrix (13-REQ-09).
    { skip: !POSIX, timeout: RUN_TIMEOUT },
    async () => {
      let sent = false;
      const run = await runCli(['test', '--repeat', '10'], {
        onOutput: (child, output) => {
          if (!sent && output.includes('✓')) {
            sent = true;
            child.kill('SIGTERM');
          }
        },
      });
      expect(run.status, run.output).toBe(143);
      expect(outcomeFilesLeft()).toEqual([]);
    },
  );
});

describe('pw-perf without tests', () => {
  /** A directory without node_modules with a copy of the source report. */
  async function workspace(name: string): Promise<{ cwd: string; report: string }> {
    const { run } = await sourceRun();
    const cwd = join(scratch, name);
    mkdirSync(cwd);
    const report = join(cwd, 'report.json');
    cpSync(reportPath(run), report);
    return { cwd, report };
  }

  test(
    '01-AC-08 a .ts config with an extensionless import, a tsconfig alias or an enum gives CONFIG_FILE_LOAD_FAILED with its hint',
    async () => {
      const { cwd } = await workspace('ts configs');
      writeFileSync(join(cwd, 'helpers.ts'), 'export const warnOnly: boolean = true;\n');
      const files: Record<string, [string, string]> = {
        'noext.ts': [
          "import { warnOnly } from './helpers';\nexport default { gate: { warnOnly } };\n",
          '"./helpers.ts"',
        ],
        'alias.ts': [
          "import { warnOnly } from '@cfg/helpers';\nexport default { gate: { warnOnly } };\n",
          'use a relative import',
        ],
        'enum.ts': [
          "enum Mode { On = 'on' }\nexport default { gate: { warnOnly: Mode.On === 'on' } };\n",
          'replace enums',
        ],
      };
      for (const [name, [code, hint]] of Object.entries(files)) {
        writeFileSync(join(cwd, name), code);
        const run = await runCli(['thresholds', '--from', 'report.json', '--config', name], {
          cwd,
        });
        expect(run.status, run.output).toBe(3);
        expect(run.stderr, name).toContain(
          `error CONFIG_FILE_LOAD_FAILED: The package config ${join(cwd, name)} cannot be loaded`,
        );
        expect(run.stderr, name).toContain(hint);
      }

      // 04-AC-08 (thresholds --from part): no @playwright/test in this directory.
      writeFileSync(
        join(cwd, 'good.ts'),
        "import { warnOnly } from './helpers.ts';\nexport default { gate: { warnOnly }, thresholds: { dir: 'thr' } };\n",
      );
      const good = await runCli(['thresholds', '--from', 'report.json', '--config', 'good.ts'], {
        cwd,
      });
      expect(good.status, good.output).toBe(0);
      expect(good.stderr).not.toMatch(/^\(node:\d+\)/mu);
      expect(good.stderr).not.toContain('ExperimentalWarning:');
      expect(existsSync(join(cwd, 'thr', 'perf-thresholds.api.json'))).toBe(true);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-08 11-AC-10 report without @playwright/test gives the HTML of the run; a missing report for thresholds --from',
    async () => {
      const { cwd } = await workspace('report command');
      const missing = await runCli(['thresholds', '--from', 'nope.json'], { cwd });
      expect(missing.status).toBe(3);
      expect(missing.stderr).toContain('error CLI_REPORT_NOT_FOUND');
      const { run } = await sourceRun();
      const report = await runCli(['report', '--input', 'report.json'], { cwd });
      expect(report.status, report.output).toBe(0);
      const fromRun = readFileSync(join(dirname(reportPath(run)), 'report.html'), 'utf8');
      expect(readFileSync(join(cwd, 'report.html'), 'utf8') === fromRun).toBe(true);
    },
    RUN_TIMEOUT,
  );

  test('--help and --version', async () => {
    const help = await runCli(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: npx pw-perf <command>');
    const version = await runCli(['--version']);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(
      (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version,
    );
  });

  test('04-AC-02 no own option of the run commands is an option of playwright test', async () => {
    const help = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [
        join(root, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--help',
      ]);
      let text = '';
      child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString()));
      child.on('error', reject);
      child.on('close', () => resolve(text));
    });
    expect(help).toContain('--repeat-each');
    for (const option of ['--env', '--repeat', '--prune', '--from']) {
      expect(help, option).not.toMatch(new RegExp(`${option}[ ,=\\n]`, 'u'));
    }
  });
});
