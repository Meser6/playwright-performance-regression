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
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts).toMatchObject({
      'perf:test': 'pw-perf test',
      'perf:thresholds': 'pw-perf thresholds',
    });
  });

  test('04-AC-17 with tests tagged @perf the default is still all tests, also with --yes', async () => {
    const dir = copyProject('init-import-swap');
    const fake = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    expect(out).toContain('Files with tests tagged @perf: 1.');
    expect(out).toContain('Measure all tests or only tests tagged @perf? [all/@perf] (all) → all');
    expect(out).not.toContain('INIT_NO_TAGGED_TESTS');
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts).toMatchObject({
      'perf:test': 'pw-perf test',
      'perf:thresholds': 'pw-perf thresholds',
    });
  });

  test('04-AC-17 no origin label question: steps [1/10] to [10/10], keys.origins named in the summary', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], fake.host)).toBe(0);
    const out = fake.stdout.join('');
    const steps = [...out.matchAll(/^\[(\d+)\/(\d+)\] /gmu)].map((m) => `${m[1]}/${m[2]}`);
    expect(steps).toEqual(['0/10', ...Array.from({ length: 10 }, (_, i) => `${i + 1}/10`)]);
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
    expect(first.written.length).toBe(6);
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
    // The plan is shown in full.
    expect(noTty.stdout.join('')).toContain('+++ b/tests/shop.spec.ts');
    const dry = fakeCliHost({ cwd: dir, playwright: null, prompt: scriptedPrompt([]).prompt });
    expect(await main(['init', '--dry-run'], dry.host)).toBe(0);
    expect(dry.written).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  });

  test('04-AC-19 Ctrl+C before the changes step leaves no changes and ends with 130', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    // Questions before the changes step: tutorial (0a), language (0), Enter (2), scope (3),
    // repeats (4), warn-only (5), environments (6), CI (7).
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
      '@perf', // scope
      '0', // invalid repeat, asked again
      '3',
      'n', // warn-only
      'y', // environments
      'qa, staging',
      'yes', // CI
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
    expect(output).toContain('Repetitions per test in measurement runs? (5)');
    expect(output).toContain('Run a first thresholds run now? (y/N)');
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

  test('a first thresholds run after the setup starts Playwright in thresholds mode', async () => {
    const dir = copyProject('init-import-swap');
    const asked: string[] = [];
    const fake = fakeCliHost({
      cwd: dir,
      playwright: null,
      prompt: () => ({
        ask: async (question) => {
          asked.push(question);
          return stripAnsi(question).includes('Run a first thresholds run') ? 'y' : '';
        },
        close: () => undefined,
      }),
      onSpawn: (f) => f.child.exit(0),
    });
    // No Playwright installed in the fake host: the run ends with CLI_PLAYWRIGHT_NOT_FOUND.
    expect(await main(['init'], fake.host)).toBe(3);
    expect(stripAnsi(asked.at(-1) ?? '')).toBe('  Run a first thresholds run now? (y/N) ');
    expect(fake.stderr.join('')).toContain('CLI_PLAYWRIGHT_NOT_FOUND');
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
    expect(out).toContain('[1/10] Projekt');
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
    expect(script.asked).toContain('  Ile powtórzeń każdego testu w pomiarze? (5) ');
    expect(script.asked).toContain('  Zacząć w trybie warn-only przez pierwsze tygodnie? (T/n) ');
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
    expect(out).toContain('npx pw-perf thresholds');
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
    expect(out).toContain('[0/10] Language');
    expect(fake.written.length).toBe(6);
  });
});
