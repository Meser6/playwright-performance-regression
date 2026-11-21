// Init wizard flow (04, chapter 4.10) with a fake host: --yes, no terminal, --dry-run, scripted
// answers on stdin, Ctrl+C, a second run and the errors.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterAll, describe, expect, test } from 'vitest';
import type { Prompt } from '../../../src/cli/host.ts';
import { PromptAborted, readlinePrompt } from '../../../src/cli/init/index.ts';
import { main } from '../../../src/cli/main.ts';
import { stripAnsi } from '../../../src/console/color.ts';
import { fakeCliHost } from './harness.ts';
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

describe('init wizard', () => {
  test('04-REQ-38 without tests tagged @perf, --yes measures all tests and shows INIT_NO_TAGGED_TESTS as information', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], fake.host)).toBe(0);
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
    expect(out).toContain('Run: PW_PERF_MODE=test npm run test');
    expect(out).toContain('PW_PERF_MODE=check npm run test: see what will be measured');
    expect(out).toContain('pw-perf-results/report.html');
    expect(out).toContain('pw-perf-results/outcome.json');
    expect(out).toContain('Commit pw-perf-thresholds.json.');
    expect(out).not.toMatch(/warnOnly|warn-only/u);
  });

  test('04-AC-17 with tests tagged @perf the default is still all tests, also with --yes', async () => {
    const dir = copyProject('init-import-swap');
    const fake = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    expect(out).toContain('Files with tests tagged @perf: 1.');
    expect(out).toContain('Measure all tests or only tests tagged @perf? [all/@perf] (all) → all');
    expect(out).not.toContain('INIT_NO_TAGGED_TESTS');
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).not.toHaveProperty(
      'scripts',
    );
    expect(readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8')).not.toMatch(/^\s*grep: /mu);
  });

  test('04-AC-17 04-AC-48 steps [0/11] to [11/11] without skipped ones; no origin, trial or environment question', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    const steps = [...out.matchAll(/^\[(\d+)\/(\d+)\] /gmu)].map((m) => `${m[1]}/${m[2]}`);
    // 3 (one project) and 6 (no test.step) are skipped.
    expect(steps).toEqual([
      '0/11',
      '1/11',
      '2/11',
      '4/11',
      '5/11',
      '7/11',
      '8/11',
      '9/11',
      '10/11',
      '11/11',
    ]);
    expect(out).toContain('[1/11] Package and project');
    expect(out).toContain('measures the response times of backend endpoints');
    expect(out).not.toMatch(/warn-only|several environments|Environment labels/u);
    expect(out).toContain(
      'How much headroom should derived thresholds have? [strict/normal/loose] (normal) → normal',
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

  test('04-AC-19 --yes writes the changes; a second run changes no file', async () => {
    const dir = copyProject('init-esm-ts');
    const first = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], first.host)).toBe(0);
    expect(first.written.length).toBe(5);
    const after = snapshot(dir);
    const second = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], second.host)).toBe(0);
    expect(second.written).toEqual([]);
    expect(snapshot(dir)).toEqual(after);
    expect(second.stdout.join('')).toContain('Nothing to change');
  });

  test('04-AC-19 without a terminal and without --yes, and with --dry-run, nothing is written', async () => {
    const dir = copyProject('init-import-swap');
    const before = snapshot(dir);
    const noTty = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init'], noTty.host)).toBe(0);
    expect(noTty.written).toEqual([]);
    expect(noTty.stderr.join('')).toContain(
      'no terminal: the default answers are used and nothing is written',
    );
    // The plan is shown in full; test files are never changed (04-REQ-67).
    expect(noTty.stdout.join('')).toContain('+++ b/pw-perf.config.ts');
    expect(noTty.stdout.join('')).not.toContain('+++ b/tests/shop.spec.ts');
    const dry = fakeCliHost({ cwd: dir, playwright: null, prompt: scriptedPrompt([]).prompt });
    expect(await main(['init', '--dry-run'], dry.host)).toBe(0);
    expect(dry.written).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  });

  test('04-AC-19 Ctrl+C before the changes step leaves no changes and ends with 130', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    // Questions before the changes step: tutorial (0a), language (0), Enter (1), script (2),
    // scope (4), passes (5), preset (7), CI (8).
    for (let at = 0; at < 8; at += 1) {
      const script = scriptedPrompt([], at);
      const fake = fakeCliHost({ cwd: dir, playwright: null, prompt: script.prompt });
      expect(await main(['init'], fake.host), `abort at question ${at}`).toBe(130);
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
      '3', // invalid script number, asked again
      '2', // plain playwright test
      '@perf', // scope
      '0', // invalid passes, asked again
      '3',
      'tight', // invalid preset, asked again
      'loose',
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
    expect(await main(['init'], fake.host)).toBe(0);
    expect(output).toContain('Passes of the test command in measurement runs? (5)');
    expect(output).toContain('Run a check now? (Y/n)');
    expect(fake.stdout.join('')).toContain('Run: PW_PERF_MODE=test npx playwright test');
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
    expect(await main(['init'], fake.host)).toBe(130);
    expect(fake.written).toEqual([]);
  });

  test('an existing pw-perf.config.ts is overwritten only after its own confirmation', async () => {
    const dir = copyProject('init-esm-ts');
    writeFileSync(join(dir, 'pw-perf.config.ts'), 'export default {};\n');
    const yes = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], yes.host)).toBe(0);
    expect(readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8')).toBe('export default {};\n');
    expect(yes.stdout.join('')).toContain(
      'pw-perf.config.ts exists and is kept (--yes does not overwrite it).',
    );

    // Interactive: every default, then "y" to the overwrite question.
    const script = scriptedPrompt(['', '', '', '', '', '', '', '', 'y']);
    const tty = fakeCliHost({ cwd: dir, playwright: null, prompt: script.prompt });
    expect(await main(['init'], tty.host)).toBe(0);
    expect(script.asked.map(stripAnsi)).toContain(
      '  pw-perf.config.ts exists. Overwrite it? (y/N) ',
    );
    expect(readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8')).toContain('definePerfConfig');
  });

  test('errors: no playwright.config, Playwright too old, a file that cannot be written', async () => {
    const empty = copyProject('init-esm-ts');
    for (const name of ['playwright.config.ts']) writeFileSync(join(empty, name), '');
    const none = fakeCliHost({ cwd: join(empty, 'tests'), playwright: null });
    expect(await main(['init', '--yes'], none.host)).toBe(3);
    expect(none.stderr.join('')).toContain('error INIT_NO_PLAYWRIGHT_CONFIG');

    const old = fakeCliHost({ cwd: empty, playwright: { cliPath: '/x', version: '1.49.1' } });
    expect(await main(['init', '--yes'], old.host)).toBe(3);
    expect(old.stderr.join('')).toContain(
      'error INIT_PLAYWRIGHT_TOO_OLD: @playwright/test 1.49.1 is older than 1.57.0',
    );
    expect(old.written).toEqual([]);

    const dir = copyProject('init-esm-ts');
    const failing = fakeCliHost({ cwd: dir, playwright: null });
    failing.host.writeText = async () => {
      throw new Error('EACCES: permission denied');
    };
    expect(await main(['init', '--yes'], failing.host)).toBe(3);
    expect(failing.stderr.join('')).toContain(
      'error INIT_WRITE_FAILED: Could not write pw-perf.config.ts: EACCES: permission denied',
    );
    expect(existsSync(join(dir, 'pw-perf.config.ts'))).toBe(false);
  });

  test('04-AC-38 step 10 runs the check through the package manager with PW_PERF_MODE=check', async () => {
    const dir = copyProject('init-esm-ts');
    const script = scriptedPrompt([]);
    const fake = fakeCliHost({
      cwd: dir,
      playwright: null,
      env: { NO_COLOR: '1', npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js' },
      prompt: script.prompt,
      onSpawn: (f) => f.child.exit(1),
    });
    // A failing check does not change the exit code of the wizard.
    expect(await main(['init'], fake.host)).toBe(0);
    expect(script.asked).toContain('  Run a check now? (Y/n) ');
    expect(fake.spawned).toHaveLength(1);
    const [spawned] = fake.spawned;
    expect(spawned?.file).toBe('/usr/bin/node');
    expect(spawned?.args).toEqual(['/usr/lib/node_modules/npm/bin/npm-cli.js', 'run', 'test']);
    expect(spawned?.options).toMatchObject({ shell: false, stdio: 'inherit' });
    expect(spawned?.options.env['PW_PERF_MODE']).toBe('check');
    const out = fake.stdout.join('');
    expect(out).toContain('The check ended with exit code 1.');
    // The check ran: no check step in the next steps.
    expect(out).not.toContain('PW_PERF_MODE=check npm run test: see what');
    expect(out).toContain('(The check above shows an estimate.)');

    // --yes never runs it.
    const yes = fakeCliHost({ cwd: copyProject('init-esm-ts'), playwright: null });
    expect(await main(['init', '--yes'], yes.host)).toBe(0);
    expect(yes.spawned).toEqual([]);
  });

  test('04-AC-46 tests importing @playwright/test: no test file changes and the red box', async () => {
    for (const env of [{ NO_COLOR: '1' }, { TERM: 'dumb' }] as Record<string, string>[]) {
      const dir = copyProject('init-import-swap');
      const before = snapshot(dir);
      const fake = fakeCliHost({ cwd: dir, playwright: null, env });
      expect(await main(['init', '--yes'], fake.host)).toBe(0);
      const after = snapshot(dir);
      for (const path of before.keys())
        if (path.startsWith('tests/')) expect(after.get(path), path).toBe(before.get(path));
      const out = fake.stdout.join('');
      // In step 9 and again in the summary.
      expect(
        out.split('INIT_TEST_OBJECT_MANUAL · Action needed: nothing is measured yet'),
      ).toHaveLength(3);
      expect(out).toContain(
        "import { test, expect } from 'playwright-performance-regression/test';",
      );
      expect(out).toContain(
        "import { withPerfFixtures } from 'playwright-performance-regression/fixture';",
      );
      expect(out).toContain('(3 files)');
      if (env.TERM === 'dumb') {
        expect(out).toContain('+---');
        expect(out).not.toContain('╭');
      } else expect(out).toContain('╭');
    }
  });

  test('04-AC-33 the projects question selects the --project projects and keeps them', async () => {
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
    // tutorial, language, Enter, script, projects: "3" without E2E (asked again), then "1,3".
    const script = scriptedPrompt(['', '', '', '', '3', '1,3']);
    const fake = fakeCliHost({
      cwd: dir,
      playwright: null,
      prompt: script.prompt,
      env: { NO_COLOR: '1' },
    });
    expect(await main(['init'], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    expect(out).toContain('1. [x] E2E');
    expect(out).toContain('2. [ ] API (looks like API tests');
    expect(out).toContain('setup: setup/teardown, runs as a dependency');
    expect(out).toContain('The script runs --project E2E: keep these projects selected.');
    expect(readFileSync(join(dir, 'pw-perf.config.ts'), 'utf8')).toContain(
      "    projects: ['E2E', 'smoke-eu'],",
    );
    const yes = copyProject('init-esm-ts');
    for (const name of ['playwright.config.ts', 'package.json'])
      writeFileSync(join(yes, name), readFileSync(join(dir, name), 'utf8'));
    expect(await main(['init', '--yes'], fakeCliHost({ cwd: yes, playwright: null }).host)).toBe(0);
    expect(readFileSync(join(yes, 'pw-perf.config.ts'), 'utf8')).toContain(
      "    projects: ['E2E'],",
    );
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
      env: { NO_COLOR: '1' },
    });
    expect(await main(['init', '--lang', 'en'], fake.host)).toBe(3);
    // Only the tutorial question comes before the language is known.
    expect(script.asked).toEqual([
      '  Set up playwright-performance-regression with a guided tutorial? (Y/n) ',
    ]);
    expect(fake.written).toEqual([]);
    expect(fake.stderr.join('')).toContain('error INIT_NO_PLAYWRIGHT_CONFIG');
  });

  test('04-AC-23 init --yes --lang pl gives Polish wizard texts and the same files as --lang en', async () => {
    const en = copyProject('init-esm-ts');
    const pl = copyProject('init-esm-ts');
    const fakeEn = fakeCliHost({ cwd: en, playwright: null });
    const fakePl = fakeCliHost({ cwd: pl, playwright: null });
    expect(await main(['init', '--yes', '--lang', 'en'], fakeEn.host)).toBe(0);
    expect(await main(['init', '--yes', '--lang', 'pl'], fakePl.host)).toBe(0);
    expect(snapshot(pl)).toEqual(snapshot(en));
    expect(fakePl.written.length).toBe(fakeEn.written.length);
    const out = fakePl.stdout.join('');
    expect(out).toContain('[1/11] Paczka i projekt');
    expect(out).toContain('Zastosować tę zmianę?');
    expect(out).toContain('Następne kroki:');
    expect(out).not.toContain('Apply this change?');
    // Diffs, codes, file and option names stay in English.
    expect(out).toContain('+++ b/pw-perf.config.ts');
    expect(out).toContain('ℹ INIT_NO_TAGGED_TESTS Żaden test nie ma jeszcze tagu @perf');
    expect(out).toContain('keys.origins w pw-perf.config.ts');
    // Without --lang and without a terminal: English.
    const plain = copyProject('init-esm-ts');
    const fakeDefault = fakeCliHost({ cwd: plain, playwright: null });
    expect(await main(['init', '--yes'], fakeDefault.host)).toBe(0);
    expect(fakeDefault.stdout.join('')).toBe(fakeEn.stdout.join(''));
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
    expect(await main(['init'], fake.host)).toBe(0);
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
        env,
        ...(tty ? { prompt: script.prompt } : {}),
      });
      expect(await main(tty ? ['init', '--lang', 'en'] : ['init', '--yes'], fake.host)).toBe(0);
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
    expect(await main(['init'], fake.host)).toBe(0);
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

  test('04-AC-25 --no-tutorial does the same without the question, also with --yes or --lang', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    const script = scriptedPrompt([]);
    const tty = fakeCliHost({ cwd: dir, playwright: null, prompt: script.prompt });
    expect(await main(['init', '--no-tutorial'], tty.host)).toBe(0);
    expect(script.asked).toEqual([]);
    expect(stripAnsi(tty.stdout.join(''))).toContain('To set it up by hand:');
    const yes = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes', '--no-tutorial', '--lang', 'pl'], yes.host)).toBe(0);
    expect(yes.stdout.join('')).toContain('Konfiguracja ręczna:');
    expect(yes.written).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  });

  test('04-AC-25 --yes skips the tutorial question and sets the project up', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    expect(out).not.toContain('guided tutorial');
    expect(out).toContain('[0/11] Language');
    expect(fake.written.length).toBe(5);
  });
});
