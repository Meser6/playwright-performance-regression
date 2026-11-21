import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveExitCode } from '../../../src/cli/exit.ts';
import { main } from '../../../src/cli/main.ts';
import { planRun, runTests, versionAtLeast } from '../../../src/cli/run.ts';
import type { RunCommand } from '../../../src/cli/run.ts';
import { withPerfReporterArg } from '../../../src/cli/reporter-arg.ts';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { SCHEMA_VERSIONS } from '../../../src/core/schema/index.ts';
import type { Outcome } from '../../../src/core/types/index.ts';
import { generateRunId } from '../../../src/mode/index.ts';
import { fakeCliHost } from './harness.ts';
import type { FakeHost } from './harness.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-perf-cli-'));
  mkdirSync(join(dir, 'tmp'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const RUN_ID = '2026-11-18T10-00-00-0a71';

function command(extra: Partial<RunCommand> = {}): RunCommand {
  return { kind: 'run', mode: 'test', prune: false, playwrightArgs: [], listOnly: false, ...extra };
}

function outcome(extra: Partial<Outcome> = {}): Outcome {
  return {
    schemaVersion: SCHEMA_VERSIONS.outcome,
    runId: RUN_ID,
    mode: 'test',
    exitCode: 2,
    tests: { status: 'passed' },
    evaluation: { status: 'failed', gateEnabled: true },
    toolErrors: [],
    paths: {
      reportJson: '/p/pw-perf-results/report.json',
      reportHtml: null,
      thresholds: [],
      thresholdsDiff: null,
    },
    ...extra,
  };
}

/** Playwright run that writes `value` to the outcome file and exits with `code`. */
function writesOutcome(value: Outcome | string | null, code: number | null = 1) {
  return (fake: FakeHost, options: { env: Record<string, string> }): void => {
    const file = options.env.PW_PERF_OUTCOME_FILE as string;
    if (value !== null) {
      writeFileSync(file, typeof value === 'string' ? value : stringifyStable(value));
    }
    fake.child.exit(code);
  };
}

const outcomeFiles = (): string[] => readdirSync(join(dir, 'tmp'));

describe('planRun', () => {
  const input = {
    env: { PATH: '/bin', PW_PERF_PASSES: '9', PW_PERF_MODE: '' },
    runId: RUN_ID,
    outcomeFile: '/tmp/x.outcome.json',
    reporterPath: '/pkg/dist/reporter.js',
  };

  test('04-REQ-09 sets the PW_PERF_* variables and replaces the ones already set', () => {
    const plan = planRun(command({ mode: 'thresholds', passes: 3, env: 'qa', prune: true }), input);
    if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
    expect(plan.value.env).toEqual({
      PATH: '/bin',
      PW_PERF_MODE: 'thresholds',
      PW_PERF_PASSES: '3',
      PW_PERF_ENV: 'qa',
      PW_PERF_RUN_ID: RUN_ID,
      PW_PERF_OUTCOME_FILE: '/tmp/x.outcome.json',
      PW_PERF_PRUNE: '1',
    });
    expect(plan.value.warnings).toEqual([
      expect.objectContaining({
        code: 'CLI_MODE_ALREADY_SET',
        message: expect.stringContaining('PW_PERF_PASSES is already set'),
      }),
    ]);

    const plain = planRun(command(), { ...input, env: { PW_PERF_PASSES: '9' } });
    if (!plain.ok) throw new Error('plan failed');
    // Without --passes the variable is not passed on: the config decides (04-REQ-17).
    expect(plain.value.env).toEqual({
      PW_PERF_MODE: 'test',
      PW_PERF_RUN_ID: RUN_ID,
      PW_PERF_OUTCOME_FILE: '/tmp/x.outcome.json',
    });
  });

  test('04-REQ-17 no --workers, --retries or --repeat-each are added', () => {
    const plan = planRun(command({ playwrightArgs: ['--grep', '@perf'] }), input);
    expect(plan.ok && plan.value.args).toEqual(['--grep', '@perf']);
  });

  test('04-REQ-20 the CLI prints no mode line: the start banner of the reporter shows it', () => {
    const lines = (cmd: RunCommand): string[] => {
      const plan = planRun(cmd, input);
      if (!plan.ok) throw new Error('plan failed');
      return plan.value.lines;
    };
    expect(lines(command({ passes: 5 }))).toEqual([]);
    expect(lines(command({ mode: 'thresholds', playwrightArgs: ['tests/cart.spec.ts'] }))).toEqual(
      [],
    );
  });

  test('04-AC-22 the reporter goes to the last --reporter only; a path with a comma is refused', () => {
    expect(withPerfReporterArg(['--reporter=line', '--reporter', 'dot'], '/r.js')).toEqual({
      ok: true,
      value: ['--reporter=line', '--reporter', 'dot,/r.js'],
    });
    expect(withPerfReporterArg(['--reporter=html', '--headed'], '/a b/r.js')).toEqual({
      ok: true,
      value: ['--reporter=html,/a b/r.js', '--headed'],
    });
    expect(withPerfReporterArg(['--grep', 'x'], '/a,b/r.js')).toEqual({
      ok: true,
      value: ['--grep', 'x'],
    });
    const refused = withPerfReporterArg(['--reporter', 'list'], '/a,b/r.js');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.issues[0]?.code).toBe('CLI_REPORTER_PATH_UNSUPPORTED');
      expect(refused.issues[0]?.hint).toContain('Remove --reporter');
    }
  });
});

describe('resolveExitCode', () => {
  const ok = { ok: true as const, value: outcome() };

  test('04-REQ-22 a signal gives 130/143 whatever the outcome; --list the Playwright code', () => {
    expect(
      resolveExitCode({ outcome: ok, childExitCode: 1, receivedSignal: 'SIGINT', listOnly: false }),
    ).toEqual({ code: 130, issues: [] });
    expect(
      resolveExitCode({
        outcome: { ok: false, reason: 'missing' },
        childExitCode: null,
        receivedSignal: 'SIGTERM',
        listOnly: false,
      }),
    ).toEqual({ code: 143, issues: [] });
    expect(
      resolveExitCode({
        outcome: { ok: false, reason: 'missing' },
        childExitCode: 1,
        listOnly: true,
      }).code,
    ).toBe(1);
    expect(resolveExitCode({ outcome: ok, childExitCode: 1, listOnly: false }).code).toBe(2);
  });

  test('04-REQ-23 a missing outcome file is 3 with the Playwright code and the causes', () => {
    const missing = resolveExitCode({
      outcome: { ok: false, reason: 'missing' },
      childExitCode: 0,
      listOnly: false,
    });
    expect(missing.code).toBe(3);
    expect(missing.issues[0]?.code).toBe('CLI_OUTCOME_MISSING');
    expect(missing.issues[0]?.message).toContain('Playwright exited with code 0');
    expect(missing.issues[0]?.hint).toContain('withPerf()');
    expect(missing.issues[0]?.hint).toContain('npx pw-perf init');
    const invalid = resolveExitCode({
      outcome: { ok: false, reason: 'invalid', detail: 'bad' },
      childExitCode: 1,
      listOnly: false,
    });
    expect(invalid).toMatchObject({ code: 3, issues: [{ code: 'CLI_OUTCOME_INVALID' }] });
  });
});

describe('runTests with a fake Playwright', () => {
  test('04-AC-06 Playwright runs with process.execPath, without a shell, with the run environment', async () => {
    const fake = fakeCliHost({ cwd: dir, onSpawn: writesOutcome(outcome({ exitCode: 0 }), 0) });
    const code = await runTests(command({ playwrightArgs: ['--reporter', 'list'] }), fake.host);
    expect(code).toBe(0);
    expect(fake.spawned).toEqual([
      {
        args: [
          '/project/node_modules/@playwright/test/cli.js',
          'test',
          '--reporter',
          'list,/pkg/dist/reporter.js',
        ],
        options: expect.objectContaining({ cwd: dir, stdio: 'inherit', shell: false }),
      },
    ]);
    expect(fake.spawned[0]?.options.env).toMatchObject({
      PW_PERF_MODE: 'test',
      PW_PERF_RUN_ID: RUN_ID,
      PW_PERF_OUTCOME_FILE: join(
        dir,
        'tmp',
        `playwright-performance-regression-${RUN_ID}.outcome.json`,
      ),
    });
    expect(outcomeFiles()).toEqual([]);
    expect(fake.stderr.join('')).toContain(
      'playwright-performance-regression: tests passed · performance failed · exit code 0',
    );
  });

  test('04-REQ-12 the exit code comes from the outcome file of this run; another run id is CLI_OUTCOME_INVALID', async () => {
    const two = fakeCliHost({ cwd: dir, onSpawn: writesOutcome(outcome(), 1) });
    expect(await runTests(command(), two.host)).toBe(2);
    // The reporter prints the report path at the end of its summary; the CLI does not repeat it.
    expect(two.stderr.join('')).toMatch(
      /^playwright-performance-regression: tests passed · performance failed · exit code 2\n$/mu,
    );
    expect(two.stderr.join('')).not.toContain('report');

    const other = fakeCliHost({ cwd: dir, onSpawn: writesOutcome(outcome({ runId: 'other' }), 1) });
    expect(await runTests(command(), other.host)).toBe(3);
    expect(other.stderr.join('')).toContain('error CLI_OUTCOME_INVALID');
    expect(outcomeFiles()).toEqual([]);

    const broken = fakeCliHost({ cwd: dir, onSpawn: writesOutcome('{', 1) });
    expect(await runTests(command(), broken.host)).toBe(3);
    expect(outcomeFiles()).toEqual([]);
  });

  test('04-AC-27 exit code 3 of an untrustworthy run: one line, performance result not trustworthy', async () => {
    const tooMany = outcome({
      exitCode: 3,
      tests: { status: 'failed' },
      evaluation: { status: 'passed', gateEnabled: true },
      toolErrors: [{ code: 'TESTS_FAILED_TOO_MANY', message: '30 of 101 test executions failed' }],
      paths: {
        reportJson: '/p/pw-perf-results/report.json',
        reportHtml: '/p/pw-perf-results/report.html',
        thresholds: [],
        thresholdsDiff: null,
      },
    });
    const fake = fakeCliHost({ cwd: dir, onSpawn: writesOutcome(tooMany, 1) });
    expect(await runTests(command(), fake.host)).toBe(3);
    expect(fake.stderr.join('')).toMatch(
      /^playwright-performance-regression: tests failed · performance result not trustworthy · exit code 3\n$/mu,
    );
    expect(fake.stderr.join('')).not.toContain('report');
    const invalid = outcome({
      exitCode: 3,
      evaluation: { status: 'error', gateEnabled: true },
      toolErrors: [{ code: 'SCHEMA_INVALID_JSON', message: 'x' }],
    });
    const other = fakeCliHost({ cwd: dir, onSpawn: writesOutcome(invalid, 1) });
    expect(await runTests(command(), other.host)).toBe(3);
    expect(other.stderr.join('')).toContain(
      'tests passed · performance not evaluated · exit code 3',
    );
  });

  test('04-AC-11 a run with failed tests and no outcome file ends with 3', async () => {
    const fake = fakeCliHost({ cwd: dir, onSpawn: writesOutcome(null, 1) });
    expect(await runTests(command(), fake.host)).toBe(3);
    expect(fake.stderr.join('')).toContain('error CLI_OUTCOME_MISSING');
    expect(fake.stderr.join('')).toContain('Playwright exited with code 1');
  });

  test('01-AC-07 with --list the Playwright code counts and no result line is printed', async () => {
    const fake = fakeCliHost({ cwd: dir, onSpawn: writesOutcome(null, 0) });
    expect(await runTests(command({ playwrightArgs: ['--list'], listOnly: true }), fake.host)).toBe(
      0,
    );
    expect(fake.stderr.join('')).not.toContain('exit code');
  });

  test('04-AC-05 SIGINT is forwarded, the CLI waits for Playwright, exits with 130 and removes the outcome file', async () => {
    const fake = fakeCliHost({
      cwd: dir,
      onSpawn: (f, options) => {
        f.signal('SIGINT');
        expect(f.child.kills).toEqual(['SIGINT']);
        // The reporter still writes an outcome file for the interrupted run.
        writeFileSync(
          options.env.PW_PERF_OUTCOME_FILE as string,
          stringifyStable(outcome({ exitCode: 3 })),
        );
        f.child.exit(130);
      },
    });
    expect(await runTests(command(), fake.host)).toBe(130);
    expect(outcomeFiles()).toEqual([]);
    expect(fake.signals.get('SIGINT')).toEqual([]);
  });

  test('04-REQ-16 a second SIGINT within 5 s kills Playwright; SIGTERM gives 143; Windows uses kill()', async () => {
    const twice = fakeCliHost({
      cwd: dir,
      onSpawn: (f) => {
        f.signal('SIGINT');
        f.advance(4000);
        f.signal('SIGINT');
        f.child.exit(null, 'SIGKILL');
      },
    });
    expect(await runTests(command(), twice.host)).toBe(130);
    expect(twice.child.kills).toEqual(['SIGINT', 'SIGKILL']);

    const late = fakeCliHost({
      cwd: dir,
      onSpawn: (f) => {
        f.signal('SIGINT');
        f.advance(6000);
        f.signal('SIGINT');
        f.child.exit(130);
      },
    });
    await runTests(command(), late.host);
    expect(late.child.kills).toEqual(['SIGINT', 'SIGINT']);

    const term = fakeCliHost({
      cwd: dir,
      platform: 'win32',
      onSpawn: (f) => {
        f.signal('SIGTERM');
        f.child.exit(1);
      },
    });
    expect(await runTests(command(), term.host)).toBe(143);
    expect(term.child.kills).toEqual([undefined]);
  });

  test('04-REQ-13 Playwright is resolved from the -c directory, else from the current directory', async () => {
    const plain = fakeCliHost({ cwd: dir, onSpawn: writesOutcome(outcome(), 1) });
    await runTests(command(), plain.host);
    expect(plain.resolvedFrom).toBe(dir);

    const file = fakeCliHost({ cwd: dir, onSpawn: writesOutcome(outcome(), 1) });
    await runTests(command({ playwrightArgs: ['-c', 'apps/web/playwright.config.ts'] }), file.host);
    expect(file.resolvedFrom).toBe(join(dir, 'apps/web'));

    const folder = fakeCliHost({
      cwd: dir,
      directories: [join(dir, 'apps/web')],
      onSpawn: writesOutcome(outcome(), 1),
    });
    await runTests(command({ playwrightArgs: ['--config=apps/web'] }), folder.host);
    expect(folder.resolvedFrom).toBe(join(dir, 'apps/web'));
  });

  test('04-REQ-14 no @playwright/test is CLI_PLAYWRIGHT_NOT_FOUND; an old version only warns', async () => {
    const none = fakeCliHost({ cwd: dir, playwright: null });
    expect(await runTests(command(), none.host)).toBe(3);
    expect(none.stderr.join('')).toContain('error CLI_PLAYWRIGHT_NOT_FOUND');
    expect(none.stderr.join('')).toContain('npm i -D @playwright/test');
    expect(none.spawned).toEqual([]);

    const old = fakeCliHost({
      cwd: dir,
      playwright: { cliPath: '/cli.js', version: '1.56.1' },
      onSpawn: writesOutcome(outcome({ exitCode: 0 }), 0),
    });
    expect(await runTests(command(), old.host)).toBe(0);
    expect(old.stderr.join('')).toContain('warning CLI_PLAYWRIGHT_UNSUPPORTED_VERSION');
    expect(versionAtLeast('1.65.0-alpha-2026', '1.57.0')).toBe(true);
    expect(versionAtLeast('1.9.0', '1.57.0')).toBe(false);
  });

  test('04-REQ-15 a reporter path with a comma and --reporter ends before Playwright starts', async () => {
    const fake = fakeCliHost({ cwd: dir, reporterPath: '/a,b/reporter.js' });
    expect(await runTests(command({ playwrightArgs: ['--reporter=dot'] }), fake.host)).toBe(3);
    expect(fake.spawned).toEqual([]);
    expect(fake.stderr.join('')).toContain('error CLI_REPORTER_PATH_UNSUPPORTED');
  });

  test('CLI_SPAWN_FAILED when Playwright cannot be started', async () => {
    const fake = fakeCliHost({
      cwd: dir,
      onSpawn: (f) => f.child.emit('error', new Error('spawn EACCES')),
    });
    expect(await runTests(command(), fake.host)).toBe(3);
    expect(fake.stderr.join('')).toContain(
      'error CLI_SPAWN_FAILED: The Playwright process could not be started: spawn EACCES',
    );
  });
});

describe('main', () => {
  test('04-REQ-60 help, version and errors', async () => {
    const fake = fakeCliHost({ cwd: dir });
    expect(await main(['--version'], fake.host)).toBe(0);
    expect(fake.stdout).toEqual(['1.2.3\n']);
    expect(await main(['--help'], fake.host)).toBe(0);
    expect(fake.stdout[1]).toContain('Usage: npx pw-perf <command>');
    // 04-REQ-60: the recommended form comes first, the pw-perf runner is the advanced one.
    const general = fake.stdout[1] ?? '';
    expect(general.startsWith('Recommended: run your usual test command with PW_PERF_MODE')).toBe(
      true,
    );
    for (const mode of ['test', 'thresholds', 'check']) {
      expect(general).toContain(`PW_PERF_MODE=${mode} npm run e2e`);
    }
    expect(general).toContain('npx cross-env PW_PERF_MODE=test npm run e2e');
    expect(general).toContain('pw-perf-results/outcome.json');
    expect(general.indexOf('Advanced:')).toBeLessThan(general.indexOf('Usage:'));
    expect(general).toContain('--max-tests <n>');
    expect(await main(['test', '--help'], fake.host)).toBe(0);
    // 04-REQ-21: the repetition warning in the help of test and thresholds.
    expect(fake.stdout[2]).toContain('--grep-invert');
    expect(await main(['thresholds', '-h'], fake.host)).toBe(0);
    expect(fake.stdout[3]).toContain('--grep-invert');
    expect(await main(['nope'], fake.host)).toBe(3);
    expect(fake.stderr.join('')).toContain('error CLI_UNKNOWN_COMMAND: Unknown command "nope".');
  });

  test('an unexpected error is CLI_INTERNAL_ERROR with exit code 3', async () => {
    const fake = fakeCliHost({ cwd: dir });
    fake.host.resolvePlaywright = () => {
      throw new Error('boom');
    };
    expect(await main(['test'], fake.host)).toBe(3);
    expect(fake.stderr.join('')).toContain(
      'error CLI_INTERNAL_ERROR: Unexpected error in the CLI: Error: boom',
    );
  });

  test('colors only in a terminal without NO_COLOR', async () => {
    const tty = fakeCliHost({ cwd: dir });
    tty.host.stderr.isTTY = true;
    await main(['nope'], tty.host);
    expect(tty.stderr.join('')).toContain('\u001b[31m');
    const noColor = fakeCliHost({ cwd: dir, env: { NO_COLOR: '1' } });
    noColor.host.stderr.isTTY = true;
    await main(['nope'], noColor.host);
    expect(noColor.stderr.join('')).not.toContain('\u001b[');
  });
});

describe('generateRunId', () => {
  test('04-AC-10 the format of 04-REQ-10; two ids in the same second differ with other random values', () => {
    const at = new Date(Date.UTC(2026, 10, 18, 10, 0, 0, 999));
    const a = generateRunId(at, () => 0.0408);
    const b = generateRunId(at, () => 0.9999);
    expect(a).toBe('2026-11-18T10-00-00-0a71');
    expect(b).toMatch(/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-[0-9a-f]{4}$/u);
    expect(a).not.toBe(b);
    expect(generateRunId(at, () => 0)).toBe('2026-11-18T10-00-00-0000');
  });
});
