// Init wizard flow (04, chapter 4.10) with a fake host: default answers in a terminal, no
// terminal, PW_PERF_DRY_RUN, scripted answers on stdin, Ctrl+C, a second run and the errors.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterAll, describe, expect, test } from 'vitest';
import type { Prompt } from '../../../src/cli/host.ts';
import { PromptAborted, readlinePrompt } from '../../../src/cli/init/index.ts';
import { versionAtLeast } from '../../../src/cli/init/wizard.ts';
import { main } from '../../../src/cli/main.ts';
import { stripAnsi } from '../../../src/console/color.ts';
import { fakeCliHost } from './harness.ts';
import type { FakeHost, FakeHostOptions } from './harness.ts';
import { copyProject, INIT_GOLDEN, removeCopies, snapshot, snapshotDiff } from './init-helpers.ts';

afterAll(removeCopies);

/** A prompt that answers from a list and records the questions; `abortAt` aborts that question. */
function scriptedPrompt(
  answers: string[],
  abortAt = -1,
): { prompt: () => Prompt; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    prompt: () => ({
      ask: async (question) => {
        asked.push(question);
        if (asked.length - 1 === abortAt) throw new PromptAborted();
        return answers.shift() ?? '';
      },
      close: () => undefined,
    }),
  };
}

/**
 * A terminal session that takes every default answer (Enter), except "no" to the check question
 * (04-REQ-58). The questions are echoed to stdout like a terminal shows them; no colors.
 */
function defaultsHost(dir: string, options: Partial<FakeHostOptions> = {}): FakeHost {
  const fake: FakeHost = fakeCliHost({
    cwd: dir,
    playwright: null,
    ...options,
    env: { NO_COLOR: '1', ...options.env },
    prompt: () => ({
      ask: async (question) => {
        fake.stdout.push(`${question}\n`);
        return /Run a check now\?/u.test(question) ? 'n' : '';
      },
      close: () => undefined,
    }),
  });
  return fake;
}

describe('init wizard', () => {
  test('versionAtLeast compares major, minor and patch; pre-release parts are ignored', () => {
    expect(versionAtLeast('1.57.0', '1.57.0')).toBe(true);
    expect(versionAtLeast('1.65.0-alpha-2026', '1.57.0')).toBe(true);
    expect(versionAtLeast('1.9.0', '1.57.0')).toBe(false);
  });

  test('04-REQ-38 without tests tagged @perf, the defaults measure all tests and show INIT_NO_TAGGED_TESTS as information', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = defaultsHost(dir);
    expect(await main([], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    expect(out).toContain(
      'ℹ INIT_NO_TAGGED_TESTS No test is tagged @perf yet; all tests are measured.',
    );
    expect(out).toContain("tag them with test('title', { tag: '@perf' }, ...)");
    expect(fake.stderr.join('')).not.toContain('INIT_NO_TAGGED_TESTS');
    // package.json is never changed (D-35); the summary shows the command with the variable.
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts).toEqual({
      test: 'playwright test',
    });
    expect(out).toContain('Run: PW_PERF_MODE=test npx playwright test');
    expect(out).toContain('PW_PERF_MODE=check npx playwright test: see what will be measured');
    expect(out).toContain('reports/pw-perf/report.html');
    expect(out).toContain('reports/pw-perf/outcome.json');
    expect(out).toContain('Commit pw-perf-thresholds.json.');
    expect(out).not.toMatch(/warnOnly|warn-only/u);
  });

  test('04-AC-17 with tests tagged @perf the default is still all tests', async () => {
    const dir = copyProject('init-import-swap');
    const fake = defaultsHost(dir);
    expect(await main([], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    expect(out).toContain('Files with tests tagged @perf: 1.');
    expect(out).toContain('Measure all tests or only tests tagged @perf? [all/@perf] (all)');
    expect(out).not.toContain('INIT_NO_TAGGED_TESTS');
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).not.toHaveProperty(
      'scripts',
    );
    expect(readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8')).not.toMatch(/^\s*grep: /mu);
  });

  test('04-AC-17 04-AC-48 04-AC-52 steps [0/10] to [10/10] without skipped ones; a command step, no script, projects, origin, trial or environment question', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = defaultsHost(dir);
    expect(await main([], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    const steps = [...out.matchAll(/^\[(\d+)\/(\d+)\] /gmu)].map((m) => `${m[1]}/${m[2]}`);
    expect(steps).toEqual([
      '0/10',
      '1/10',
      '2/10',
      '3/10',
      '4/10',
      '5/10',
      '6/10',
      '7/10',
      '8/10',
      '9/10',
      '10/10',
    ]);
    expect(out).toContain('[1/10] What it does and how to run it');
    expect(out).toContain('[2/10] Which tests');
    expect(out).toContain('[6/10] Test command');
    expect(out).toContain(
      'Which command do you usually run your tests with? (npx playwright test)',
    );
    expect(out).not.toMatch(/Which command runs|Which projects/u);
    expect(out).toContain('measures the response times of backend endpoints');
    expect(out).not.toMatch(/warn-only|several environments|Environment labels/u);
    expect(out).toContain(
      'How much headroom should derived thresholds have? [strict/normal/loose] (normal)',
    );
    expect(out).toContain('A CI job you start by hand with PW_PERF_MODE=thresholds');
    expect(out).not.toMatch(/Label for|Backend/u);
    expect(out).toContain(
      'Endpoint keys of the baseURL origin have no label and other hosts are labeled with their host; set shorter labels for them in keys.origins of pw-perf.config.ts.',
    );
    const config = readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8');
    expect(config).toContain('  //   origins: {},\n');
    expect(config).not.toContain("'https://api.example.com':");
  });

  test('04-AC-28 step 4 is asked without test.step: all by default, api and steps write the other kind off', async () => {
    const measured = async (
      answer: string,
    ): Promise<{ out: string; config: string; asked: string[] }> => {
      const dir = copyProject('init-esm-ts');
      const asked: string[] = [];
      const fake: FakeHost = fakeCliHost({
        cwd: dir,
        playwright: null,
        env: { NO_COLOR: '1' },
        prompt: () => ({
          ask: async (question) => {
            asked.push(question);
            fake.stdout.push(`${question}\n`);
            if (/What to measure\?/u.test(question)) return answer;
            return /Run a check now\?/u.test(question) ? 'n' : '';
          },
          close: () => undefined,
        }),
      });
      expect(await main([], fake.host)).toBe(0);
      return {
        out: fake.stdout.join(''),
        // The active lines only: commented-out options sit between them.
        config: readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8')
          .split('\n')
          .filter((l) => !/^\s*(\/\/|$)/u.test(l))
          .join('\n'),
        asked,
      };
    };
    const all = await measured('');
    expect(all.out).toContain('[4/10] What to measure');
    expect(all.out).toContain('api: response times of the backend requests');
    expect(all.out).toContain('steps: durations of your test.step blocks');
    expect(all.out).toContain('Step titles are sanitized');
    expect(all.out).toContain('Files with test.step: 0.');
    expect(all.out).toContain('No test.step found yet');
    expect(all.asked).toContain('  What to measure? [all/api/steps] (all) ');
    expect(all.config).not.toMatch(/^\s*measure: \{/mu);
    const commit = (out: string): string | undefined => /Commit (.*)\./u.exec(out)?.[1];
    expect(commit(all.out)).toBe('pw-perf-thresholds.json');
    expect(all.out).not.toContain('Only steps');

    const api = await measured('api');
    expect(api.config).toContain('  measure: {\n    steps: false,\n  },');
    expect(commit(api.out)).toBe('pw-perf-thresholds.json');

    const steps = await measured('steps');
    expect(steps.config).toContain('  measure: {\n    api: false,\n  },');
    expect(steps.out).toContain(
      '⚠ Only steps, but no test.step was found: nothing is measured until you add test.step blocks.',
    );
    expect(commit(steps.out)).toBe('pw-perf-thresholds.steps.json');
  });

  test('04-AC-48 step 1 explains how to run, the other variables and the files, without the detection dump', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = defaultsHost(dir);
    expect(await main([], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    const step1 = out.slice(out.indexOf('[1/10]'), out.indexOf('[2/10]'));
    expect(step1).toContain('1. PW_PERF_MODE=thresholds <your test command>');
    expect(step1).toContain('2. commit the thresholds files to the repository;');
    expect(step1).toContain('3. PW_PERF_MODE=test <your test command>');
    expect(step1).toContain('add --project <name> to measure one browser only');
    for (const name of [
      'PW_PERF_MODE=check',
      'PW_PERF_MAX_TESTS=<n>',
      'PW_PERF_ENV=<label>',
      'PW_PERF_PASSES=<n>',
      'PW_PERF_PRUNE=1',
      'pw-perf.config.ts',
      'pw-perf-thresholds*.json',
      'reports/pw-perf/',
    ])
      expect(step1).toContain(`    ${name}`);
    expect(step1).toContain('do not commit (listed in .gitignore)');
    expect(step1).not.toMatch(
      /Playwright \d|Test directory|\.extend\(\)|baseURL|CI: |Already set up/u,
    );
  });

  test('04-AC-19 the default answers in a terminal write the changes; a second run changes no file', async () => {
    const dir = copyProject('init-esm-ts');
    const first = defaultsHost(dir);
    expect(await main([], first.host)).toBe(0);
    expect(first.written.length).toBe(5);
    const after = snapshot(dir);
    const second = defaultsHost(dir);
    expect(await main([], second.host)).toBe(0);
    expect(second.written).toEqual([]);
    expect(snapshot(dir)).toEqual(after);
    expect(second.stdout.join('')).toContain('Nothing to change');
  });

  test('04-AC-19 without a terminal, and with PW_PERF_DRY_RUN=1 in one, nothing is written', async () => {
    const dir = copyProject('init-import-swap');
    const before = snapshot(dir);
    const noTty = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main([], noTty.host)).toBe(0);
    expect(noTty.written).toEqual([]);
    expect(noTty.stderr.join('')).toContain(
      'no terminal: the default answers are used and nothing is written',
    );
    // The plan is shown in full; test files are never changed (04-REQ-67).
    expect(noTty.stdout.join('')).toContain('+++ b/pw-perf.config.ts');
    expect(noTty.stdout.join('')).not.toContain('+++ b/tests/shop.spec.ts');
    const script = scriptedPrompt([]);
    const dry = fakeCliHost({
      cwd: dir,
      playwright: null,
      prompt: script.prompt,
      env: { PW_PERF_DRY_RUN: '1' },
    });
    expect(await main([], dry.host)).toBe(0);
    expect(script.asked).toEqual([]);
    expect(dry.written).toEqual([]);
    expect(dry.stderr.join('')).toContain('dry run: the planned changes are shown');
    // An invalid value is an error before any question (01-REQ-27).
    const invalid = fakeCliHost({ cwd: dir, playwright: null, env: { PW_PERF_DRY_RUN: 'yes' } });
    expect(await main([], invalid.host)).toBe(3);
    expect(invalid.stderr.join('')).toContain(
      'error MODE_INVALID_VALUE: PW_PERF_DRY_RUN: expected "1", got "yes"',
    );
    expect(invalid.stdout).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  });

  test('04-AC-19 Ctrl+C before the changes step leaves no changes and ends with 130', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    // Questions before the changes step: tutorial (0a), language (0), Enter (1), scope (2),
    // passes (3), preset (5), CI (6).
    for (let at = 0; at < 7; at += 1) {
      const script = scriptedPrompt([], at);
      const fake = fakeCliHost({ cwd: dir, playwright: null, prompt: script.prompt });
      expect(await main([], fake.host), `abort at question ${at}`).toBe(130);
      expect(fake.written).toEqual([]);
      expect(fake.stderr.join('')).toContain('interrupted');
    }
    expect(snapshot(dir)).toEqual(before);
  });

  test('04-AC-20 scripted answers on stdin give the expected files', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    const answers = [
      '', // tutorial: yes
      '', // language: en
      '', // Enter
      '@perf', // scope
      '0', // invalid passes, asked again
      '3',
      'everything', // invalid measure answer, asked again
      'all',
      'tight', // invalid preset, asked again
      'loose',
      'PW_PERF_MODE=test npm run e2e', // refused: the wizard adds PW_PERF_MODE, asked again
      'npm run e2e -- --grep "@smoke"', // test command
      'yes', // CI
      '', // apply: pw-perf.config.ts
      '', // playwright.config.ts
      '', // tests/fixtures.ts
      '', // .gitignore
      '', // CI file
      'n', // no check
    ];
    const input = new PassThrough();
    let output = '';
    const out = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += stripAnsi(chunk.toString());
        // Answer when a question is waiting: it ends with ") " (the default in parentheses).
        if (/(\) |continue\. )$/u.test(output))
          setImmediate(() => input.write(`${answers.shift() ?? ''}\n`));
        done();
      },
    });
    const fake = fakeCliHost({
      cwd: dir,
      playwright: null,
      prompt: () => readlinePrompt(input, out, false),
    });
    expect(await main([], fake.host)).toBe(0);
    expect(output).toContain('Passes of the test command in measurement runs? (5)');
    expect(output).toContain('Run a check now? (Y/n)');
    expect(fake.stdout.join('')).toContain(
      'Type the command without PW_PERF_ variables: the wizard adds PW_PERF_MODE itself.',
    );
    expect(fake.stdout.join('')).toContain('Run: PW_PERF_MODE=test npm run e2e -- --grep "@smoke"');
    const golden = readFileSync(join(INIT_GOLDEN, 'esm-ts-answers.diff'), 'utf8');
    expect(snapshotDiff(before, snapshot(dir))).toBe(golden);
  });

  test('04-AC-19 Ctrl+C in the terminal (readline SIGINT) ends with 130', async () => {
    const dir = copyProject('init-esm-ts');
    const input = new PassThrough();
    const out = new PassThrough();
    let shown = '';
    out.on('data', (chunk: Buffer) => {
      shown += stripAnsi(chunk.toString());
      // Enter for the tutorial and language questions, Ctrl+C at "Press Enter".
      if (shown.endsWith('Press Enter to continue. ')) input.write('\u0003');
      else if (shown.endsWith(') ')) setImmediate(() => input.write('\r'));
    });
    const fake = fakeCliHost({
      cwd: dir,
      playwright: null,
      prompt: () => readlinePrompt(input, out, true),
    });
    expect(await main([], fake.host)).toBe(130);
    expect(fake.written).toEqual([]);
  });

  test('an existing pw-perf.config.ts is overwritten only after its own confirmation', async () => {
    const dir = copyProject('init-esm-ts');
    writeFileSync(join(dir, 'pw-perf.config.ts'), 'export default {};\n');
    const noTty = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main([], noTty.host)).toBe(0);
    expect(readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8')).toBe('export default {};\n');
    expect(noTty.stdout.join('')).toContain('pw-perf.config.ts exists and is kept.');

    // Interactive: every default, then "y" to the overwrite question.
    const script = scriptedPrompt(['', '', '', '', '', '', '', '', '', 'y']);
    const tty = fakeCliHost({ cwd: dir, playwright: null, prompt: script.prompt });
    expect(await main([], tty.host)).toBe(0);
    expect(script.asked.map(stripAnsi)).toContain(
      '  pw-perf.config.ts exists. Overwrite it? (y/N) ',
    );
    expect(readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8')).toContain('definePerfConfig');
  });

  test('errors: no playwright.config, Playwright too old, a file that cannot be written', async () => {
    const empty = copyProject('init-esm-ts');
    for (const name of ['playwright.config.ts']) writeFileSync(join(empty, name), '');
    const none = fakeCliHost({ cwd: join(empty, 'tests'), playwright: null });
    expect(await main([], none.host)).toBe(3);
    expect(none.stderr.join('')).toContain('error INIT_NO_PLAYWRIGHT_CONFIG');

    const old = fakeCliHost({ cwd: empty, playwright: { cliPath: '/x', version: '1.49.1' } });
    expect(await main([], old.host)).toBe(3);
    expect(old.stderr.join('')).toContain(
      'error INIT_PLAYWRIGHT_TOO_OLD: @playwright/test 1.49.1 is older than 1.57.0',
    );
    expect(old.written).toEqual([]);

    const dir = copyProject('init-esm-ts');
    const failing = defaultsHost(dir);
    failing.host.writeText = async () => {
      throw new Error('EACCES: permission denied');
    };
    expect(await main([], failing.host)).toBe(3);
    expect(failing.stderr.join('')).toContain(
      'error INIT_WRITE_FAILED: Could not write pw-perf.config.ts: EACCES: permission denied',
    );
    expect(existsSync(join(dir, 'pw-perf.config.ts'))).toBe(false);
  });

  test('04-AC-38 step 9 runs thresholds then test through the Playwright CLI with 2 passes', async () => {
    const dir = copyProject('init-esm-ts');
    const script = scriptedPrompt([]);
    const fake = fakeCliHost({
      cwd: dir,
      env: {
        NO_COLOR: '1',
        npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js',
        PW_PERF_PASSES: '9',
      },
      prompt: script.prompt,
      // The thresholds run fails; the test run still starts.
      onSpawn: (f) => f.child.exit(f.spawned.length === 1 ? 1 : 0),
    });
    // A failing run does not change the exit code of the wizard.
    expect(await main([], fake.host)).toBe(0);
    expect(script.asked).toContain('  Run a check now? (Y/n) ');
    expect(fake.spawned).toHaveLength(2);
    for (const spawned of fake.spawned) {
      expect(spawned.file).toBe('/usr/bin/node');
      expect(spawned.args).toEqual(['/project/node_modules/@playwright/test/cli.js', 'test']);
      expect(spawned.options).toMatchObject({ shell: false, stdio: 'inherit' });
      expect(spawned.options.env['PW_PERF_PASSES']).toBe('2');
      expect(spawned.options.env['NO_COLOR']).toBe('1');
    }
    expect(fake.spawned.map((s) => s.options.env['PW_PERF_MODE'])).toEqual(['thresholds', 'test']);
    // Both runs use the same temporary thresholds dir, outside the project, removed afterwards.
    expect(fake.tempDirs).toHaveLength(1);
    const [tmp] = fake.tempDirs;
    expect(tmp).toBeDefined();
    expect(tmp?.startsWith(dir)).toBe(false);
    expect(fake.spawned.map((s) => s.options.env['PW_PERF_THRESHOLDS_DIR'])).toEqual([tmp, tmp]);
    expect(fake.spawned.map((s) => s.options.env['PW_PERF_MIN_SAMPLES'])).toEqual(['2', '2']);
    expect(fake.removedDirs).toEqual([tmp]);
    expect(existsSync(tmp ?? '')).toBe(false);
    const out = fake.stdout.join('');
    expect(out).toContain('$ PW_PERF_MODE=thresholds PW_PERF_PASSES=2 npx playwright test');
    expect(out).toContain('$ PW_PERF_MODE=test PW_PERF_PASSES=2 npx playwright test');
    expect(out).not.toContain('PW_PERF_THRESHOLDS_DIR');
    expect(out).not.toContain('PW_PERF_MIN_SAMPLES');
    expect(out).toContain('The check with PW_PERF_MODE=thresholds ended with exit code 1.');
    expect(out).toContain('The check with PW_PERF_MODE=test ended with exit code 0.');
    // The check ran: no check step in the next steps.
    expect(out).not.toContain('PW_PERF_MODE=check npx playwright test: see what');
    expect(out).toContain('(The start box of the run shows a time estimate from the last run.)');

    // Ctrl+C in the thresholds run: no test run, the temporary dir is removed, code 130.
    const stopped = fakeCliHost({
      cwd: copyProject('init-esm-ts'),
      env: { NO_COLOR: '1' },
      prompt: scriptedPrompt([]).prompt,
      onSpawn: (f) => f.child.exit(null, 'SIGINT'),
    });
    expect(await main([], stopped.host)).toBe(130);
    expect(stopped.spawned).toHaveLength(1);
    expect(stopped.removedDirs).toEqual(stopped.tempDirs);
    expect(stopped.tempDirs).toHaveLength(1);

    // Without a terminal it never runs.
    const noTty = fakeCliHost({ cwd: copyProject('init-esm-ts'), playwright: null });
    expect(await main([], noTty.host)).toBe(0);
    expect(noTty.spawned).toEqual([]);
  });

  test('04-AC-52 step 6: a typed command is run for the check through the shell and used everywhere', async () => {
    const session = (
      command: string,
      options: Partial<FakeHostOptions> = {},
    ): { fake: FakeHost; asked: string[] } => {
      const asked: string[] = [];
      const fake: FakeHost = fakeCliHost({
        cwd: copyProject('init-esm-ts'),
        ...options,
        env: { NO_COLOR: '1', SHELL: '/bin/zsh', ...options.env },
        prompt: () => ({
          ask: async (question) => {
            asked.push(question);
            return /usually run your tests/u.test(question) ? command : '';
          },
          close: () => undefined,
        }),
      });
      return { fake, asked };
    };

    const typed = session('npm run e2e -- --grep "@smoke"');
    expect(await main([], typed.fake.host)).toBe(0);
    expect(typed.asked).toContain(
      '  Which command do you usually run your tests with? (npx playwright test) ',
    );
    expect(typed.fake.spawned).toHaveLength(2);
    for (const spawned of typed.fake.spawned) {
      expect(spawned.file).toBe('npm run e2e -- --grep "@smoke"');
      expect(spawned.args).toEqual([]);
      expect(spawned.options).toMatchObject({ shell: '/bin/zsh', stdio: 'inherit' });
    }
    expect(typed.fake.spawned.map((s) => s.options.env['PW_PERF_MODE'])).toEqual([
      'thresholds',
      'test',
    ]);
    const out = typed.fake.stdout.join('');
    expect(out).toContain(
      '$ PW_PERF_MODE=thresholds PW_PERF_PASSES=2 npm run e2e -- --grep "@smoke"',
    );
    expect(out).toContain('Run: PW_PERF_MODE=test npm run e2e -- --grep "@smoke"');
    expect(out).not.toContain('chains several commands');
    const ci = readFileSync(join(typed.fake.host.cwd, '.github/workflows/perf.yml'), 'utf8');
    expect(ci).toContain('          npm run e2e -- --grep "@smoke" || true\n');

    // Windows: the platform shell (%ComSpec%), cross-env in the shown commands.
    const win = session('npm run e2e', { platform: 'win32' });
    expect(await main([], win.fake.host)).toBe(0);
    expect(win.fake.spawned[0]?.options.shell).toBe(true);
    expect(win.fake.stdout.join('')).toContain('Run: npx cross-env PW_PERF_MODE=test npm run e2e');

    // A chain gets the yellow line.
    const chain = session('npm run seed && npx playwright test');
    expect(await main([], chain.fake.host)).toBe(0);
    expect(chain.fake.stdout.join('')).toContain(
      'This command chains several commands: PW_PERF_MODE=... in front of it only reaches the first one.',
    );

    // skip: no check question and no process; the default command everywhere.
    const skip = session('skip');
    expect(await main([], skip.fake.host)).toBe(0);
    expect(skip.asked).not.toContain('  Run a check now? (Y/n) ');
    expect(skip.fake.spawned).toEqual([]);
    const skipped = skip.fake.stdout.join('');
    expect(skipped).toContain('PW_PERF_MODE=check npx playwright test: see what will be measured');
    expect(skipped).toContain('Run: PW_PERF_MODE=test npx playwright test');

    // Without a terminal: the default command, no check.
    const noTty = fakeCliHost({ cwd: copyProject('init-esm-ts'), playwright: null });
    expect(await main([], noTty.host)).toBe(0);
    expect(noTty.stdout.join('')).toContain(
      'Which command do you usually run your tests with? (npx playwright test) → npx playwright test',
    );
    expect(noTty.spawned).toEqual([]);
  });

  test('04-AC-46 tests importing @playwright/test: no test file changes and the red box', async () => {
    for (const env of [{ NO_COLOR: '1' }, { TERM: 'dumb' }] as Record<string, string>[]) {
      const dir = copyProject('init-import-swap');
      const before = snapshot(dir);
      const fake = fakeCliHost({ cwd: dir, playwright: null, env });
      expect(await main([], fake.host)).toBe(0);
      const after = snapshot(dir);
      for (const path of before.keys())
        if (path.startsWith('tests/')) expect(after.get(path), path).toBe(before.get(path));
      const out = fake.stdout.join('');
      // In step 7 and again in the summary.
      expect(
        out.split('INIT_TEST_OBJECT_MANUAL · Action needed: nothing is measured yet'),
      ).toHaveLength(3);
      expect(out).toContain(
        "import { test, expect } from 'playwright-performance-regression/test';",
      );
      expect(out).toContain(
        "import { withPerfFixtures } from 'playwright-performance-regression/fixture';",
      );
      expect(out).toContain('(files: 3)');
      if (env.TERM === 'dumb') {
        expect(out).toContain('+---');
        expect(out).not.toContain('╭');
      } else expect(out).toContain('╭');
    }
  });

  test('09-REQ-22 the red box takes the terminal width, and 100 when the terminal reports 0 columns', async () => {
    const boxWidth = async (columns?: number): Promise<number> => {
      const fake = fakeCliHost({
        cwd: copyProject('init-import-swap'),
        playwright: null,
        env: { NO_COLOR: '1' },
        ...(columns === undefined ? {} : { columns }),
      });
      expect(await main([], fake.host)).toBe(0);
      const top = fake.stdout
        .join('')
        .split('\n')
        .find((line) => line.startsWith('╭'));
      return [...(top ?? '')].length;
    };
    const unknown = await boxWidth();
    expect(await boxWidth(0)).toBe(unknown);
    expect(unknown).toBeGreaterThan(90);
    expect(await boxWidth(72)).toBe(72);
    expect(await boxWidth(20)).toBe(40);
  });

  test('04-AC-53 with the red box there is no check step; the answer steps gives no red box and a check step', async () => {
    const wizard = async (measure: string): Promise<{ out: string; asked: string[] }> => {
      const asked: string[] = [];
      const fake: FakeHost = fakeCliHost({
        cwd: copyProject('init-import-swap'),
        playwright: null,
        env: { NO_COLOR: '1' },
        prompt: () => ({
          ask: async (question) => {
            asked.push(question);
            if (/What to measure\?/u.test(question)) return measure;
            return /Run a check now\?/u.test(question) ? 'n' : '';
          },
          close: () => undefined,
        }),
      });
      expect(await main([], fake.host)).toBe(0);
      return { out: fake.stdout.join(''), asked };
    };
    const box = 'INIT_TEST_OBJECT_MANUAL · Action needed: nothing is measured yet';
    const red = await wizard('');
    expect(red.out).toContain(box);
    const steps = [...red.out.matchAll(/^\[(\d+)\/(\d+)\] /gmu)].map((m) => `${m[1]}/${m[2]}`);
    expect(steps).toEqual([
      '0/10',
      '1/10',
      '2/10',
      '3/10',
      '4/10',
      '5/10',
      '6/10',
      '7/10',
      '8/10',
      '10/10',
    ]);
    expect(red.out).not.toContain('[9/10]');
    expect(red.out).not.toContain('Skipped.');
    expect(red.asked.some((q) => /Run a check now\?/u.test(q))).toBe(false);
    expect(red.out).toContain('PW_PERF_MODE=check npx playwright test');
    const onlySteps = await wizard('steps');
    expect(onlySteps.out).not.toContain(box);
    expect(onlySteps.out).toContain('[9/10] ');
    expect(onlySteps.asked.some((q) => /Run a check now\?/u.test(q))).toBe(true);
  });

  test('04-REQ-18 several projects give no projects question and no run.projects (D-44)', async () => {
    const dir = copyProject('init-esm-ts');
    writeFileSync(
      join(dir, 'playwright.config.ts'),
      `import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  projects: [
    { name: 'setup', testMatch: /global.setup.ts/ },
    { name: 'E2E', dependencies: ['setup'] },
    { name: 'API', testDir: './api' },
    { name: 'smoke-eu' },
  ],
});
`,
    );
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ type: 'module', scripts: { e2e: 'playwright test --project=E2E' } }),
    );
    const fake = defaultsHost(dir);
    expect(await main([], fake.host)).toBe(0);
    expect(fake.stdout.join('')).not.toContain('Which projects');
    expect(readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8')).not.toMatch(/^\s*projects:/mu);
  });

  test('04-AC-41 04-AC-46 without playwright.config the wizard stops before any question', async () => {
    const dir = copyProject('init-esm-ts');
    writeFileSync(join(dir, 'playwright.config.ts'), '');
    const empty = join(dir, 'tests');
    const script = scriptedPrompt([]);
    const fake = fakeCliHost({
      cwd: empty,
      playwright: null,
      prompt: script.prompt,
      env: { NO_COLOR: '1', PW_PERF_LANG: 'en' },
    });
    expect(await main([], fake.host)).toBe(3);
    // Only the tutorial question comes before the language is known.
    expect(script.asked).toEqual([
      '  Set up playwright-performance-regression with a guided tutorial? (Y/n) ',
    ]);
    expect(fake.written).toEqual([]);
    expect(fake.stderr.join('')).toContain('error INIT_NO_PLAYWRIGHT_CONFIG');
  });

  test('04-AC-23 PW_PERF_LANG=pl gives Polish wizard texts and the same files as PW_PERF_LANG=en', async () => {
    const en = copyProject('init-esm-ts');
    const pl = copyProject('init-esm-ts');
    const fakeEn = defaultsHost(en, { env: { PW_PERF_LANG: 'en' } });
    const fakePl = defaultsHost(pl, { env: { PW_PERF_LANG: 'pl' } });
    expect(await main([], fakeEn.host)).toBe(0);
    expect(await main([], fakePl.host)).toBe(0);
    expect(snapshot(pl)).toEqual(snapshot(en));
    expect(fakePl.written.length).toBe(fakeEn.written.length);
    const out = fakePl.stdout.join('');
    expect(out).toContain('[1/10] Co robi paczka i jak ją uruchamiać');
    expect(out).toContain('Zastosować tę zmianę?');
    expect(out).toContain('Następne kroki:');
    expect(out).not.toContain('Apply this change?');
    // Diffs, codes, file and option names stay in English.
    expect(out).toContain('+++ b/pw-perf.config.ts');
    expect(out).toContain('ℹ INIT_NO_TAGGED_TESTS Żaden test nie ma jeszcze tagu @perf');
    expect(out).toContain('keys.origins w pw-perf.config.ts');
    // Without PW_PERF_LANG and without a terminal: English, the same as PW_PERF_LANG=en.
    const plain = copyProject('init-esm-ts');
    const fakeDefault = fakeCliHost({ cwd: plain, playwright: null });
    const fakeLangEn = fakeCliHost({ cwd: plain, playwright: null, env: { PW_PERF_LANG: 'en' } });
    expect(await main([], fakeDefault.host)).toBe(0);
    expect(await main([], fakeLangEn.host)).toBe(0);
    expect(fakeDefault.stdout.join('')).toBe(fakeLangEn.stdout.join(''));
    // An unknown code is an error with the list of codes.
    const unknown = fakeCliHost({ cwd: plain, playwright: null, env: { PW_PERF_LANG: 'xx' } });
    expect(await main([], unknown.host)).toBe(3);
    expect(unknown.stderr.join('')).toContain(
      'PW_PERF_LANG: expected one of en, es, fr, pl, it, uk, ru, got "xx"',
    );
  });

  test('04-AC-23 the language chosen in step 0 of a terminal session is used for the questions', async () => {
    const dir = copyProject('init-esm-ts');
    const script = scriptedPrompt(['', 'pl']);
    const fake = fakeCliHost({
      cwd: dir,
      playwright: null,
      prompt: script.prompt,
      env: { NO_COLOR: '1' },
    });
    expect(await main([], fake.host)).toBe(0);
    expect(script.asked[0]).toBe(
      '  Set up playwright-performance-regression with a guided tutorial? (Y/n) ',
    );
    expect(script.asked[1]).toBe('  Language / Język? [en/es/fr/pl/it/uk/ru] (en) ');
    expect(script.asked[2]).toBe('  Naciśnij Enter, aby kontynuować. ');
    expect(script.asked).toContain('  Ile przebiegów polecenia testów w pomiarze? (5) ');
    expect(script.asked).toContain(
      '  Jaki zapas mają mieć wyznaczone progi? [strict/normal/loose] (normal) ',
    );
  });

  test('04-AC-24 wizard colors in a terminal; none with NO_COLOR, TERM=dumb or without a terminal; FORCE_COLOR without one', async () => {
    const ESC = String.fromCharCode(27);
    const output = async (env: Record<string, string>, tty: boolean): Promise<string> => {
      const dir = copyProject('init-esm-ts');
      const script = scriptedPrompt([]);
      const fake = fakeCliHost({
        cwd: dir,
        playwright: null,
        env: tty ? { ...env, PW_PERF_LANG: 'en' } : env,
        ...(tty ? { prompt: script.prompt } : {}),
      });
      expect(await main([], fake.host)).toBe(0);
      return [...script.asked, ...fake.stdout, ...fake.stderr].join('');
    };
    const colored = await output({}, true);
    expect(colored).toContain(ESC);
    expect(colored).toContain(`${ESC}[36m`); // cyan step headers
    expect(colored).toContain(`${ESC}[32m+`); // green added diff lines
    const noColor = await output({ NO_COLOR: '1' }, true);
    expect(noColor).not.toContain(ESC);
    expect(stripAnsi(colored)).toBe(noColor);
    expect(await output({ TERM: 'dumb' }, true)).not.toContain(ESC);
    const pipe = await output({}, false);
    expect(pipe).not.toContain(ESC);
    const forced = await output({ FORCE_COLOR: '1' }, false);
    expect(forced).toContain(ESC);
    expect(stripAnsi(forced)).toBe(pipe);
  });

  test('04-AC-25 "no" to the tutorial question ends with 0, changes no file and prints the manual setup', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    const script = scriptedPrompt(['n']);
    const fake = fakeCliHost({ cwd: dir, playwright: null, prompt: script.prompt });
    expect(await main([], fake.host)).toBe(0);
    expect(script.asked.map(stripAnsi)).toEqual([
      '  Set up playwright-performance-regression with a guided tutorial? (Y/n) ',
    ]);
    expect(fake.written).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
    const out = stripAnsi(fake.stdout.join(''));
    expect(out).toContain('playwright-performance-regression is installed; no file was changed.');
    expect(out).toContain('withPerf() from playwright-performance-regression/config');
    expect(out).toContain('withPerfFixtures() from playwright-performance-regression/fixture');
    expect(out).toContain('PW_PERF_MODE=test npx playwright test');
    expect(out).toContain('docs/adoption.md');
  });

  test('04-AC-25 PW_PERF_NO_TUTORIAL=1 does the same without the question, also with PW_PERF_LANG', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    const script = scriptedPrompt([]);
    const tty = fakeCliHost({
      cwd: dir,
      playwright: null,
      prompt: script.prompt,
      env: { PW_PERF_NO_TUTORIAL: '1' },
    });
    expect(await main([], tty.host)).toBe(0);
    expect(script.asked).toEqual([]);
    expect(stripAnsi(tty.stdout.join(''))).toContain('To set it up by hand:');
    const pl = fakeCliHost({
      cwd: dir,
      playwright: null,
      env: { PW_PERF_NO_TUTORIAL: '1', PW_PERF_LANG: 'pl' },
    });
    expect(await main([], pl.host)).toBe(0);
    expect(pl.stdout.join('')).toContain('Konfiguracja ręczna:');
    expect(pl.written).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  });

  test('04-AC-25 without a terminal the tutorial question is skipped and the plan is shown', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main([], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    expect(out).not.toContain('guided tutorial');
    expect(out).toContain('[0/10] Language');
    expect(out).toContain('+++ b/pw-perf.config.ts');
    expect(fake.written).toEqual([]);
  });

  test('04-AC-01 arguments end with CLI_UNKNOWN_COMMAND and the help, without the wizard', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], fake.host)).toBe(3);
    expect(fake.stderr.join('')).toContain(
      'error CLI_UNKNOWN_COMMAND: The package has no commands or options, got "init --yes".',
    );
    const help = fake.stdout.join('');
    expect(help).toContain('Run your usual test command with PW_PERF_MODE set');
    expect(help).toContain('PW_PERF_DRY_RUN=1');
    expect(help).not.toContain('[0/10]');
    expect(fake.written).toEqual([]);
  });
});
