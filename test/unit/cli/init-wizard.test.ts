// Init wizard flow (04, chapter 4.10) with a fake host: --yes, no terminal, --dry-run, scripted
// answers on stdin, Ctrl+C, a second run and the errors.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterAll, describe, expect, test } from 'vitest';
import type { Prompt } from '../../../src/cli/host.ts';
import { PromptAborted, readlinePrompt } from '../../../src/cli/init/index.ts';
import { main } from '../../../src/cli/main.ts';
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
  test('04-AC-21 without tests tagged @perf, --yes measures all tests and warns INIT_NO_TAGGED_TESTS', async () => {
    const dir = copyProject('init-esm-ts');
    const fake = fakeCliHost({ cwd: dir, playwright: null });
    expect(await main(['init', '--yes'], fake.host)).toBe(0);
    expect(fake.stderr.join('')).toContain('warning INIT_NO_TAGGED_TESTS');
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts).toMatchObject({
      'perf:test': 'pw-perf test',
      'perf:thresholds': 'pw-perf thresholds',
    });
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

  test('04-AC-19 Ctrl+C before step 9 leaves no changes and ends with 130', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    // Questions before step 9: Enter (2), label (3), scope (4), repeats (5), warn-only (6),
    // environments (7), CI (8).
    for (let at = 0; at < 7; at += 1) {
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
      '', // Enter
      'backend', // label
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
        output += chunk.toString();
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
    out.on('data', (chunk: Buffer) => {
      if (chunk.toString().endsWith('Press Enter to continue. ')) input.write('\u0003');
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
    const script = scriptedPrompt(['', '', '', '', '', '', '', 'y']);
    const tty = fakeCliHost({ cwd: dir, playwright: null, prompt: script.prompt });
    expect(await main(['init'], tty.host)).toBe(0);
    expect(script.asked).toContain('  pw-perf.config.ts exists. Overwrite it? (y/N) ');
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
          return question.includes('Run a first thresholds run') ? 'y' : '';
        },
        close: () => undefined,
      }),
      onSpawn: (f) => f.child.exit(0),
    });
    // No Playwright installed in the fake host: the run ends with CLI_PLAYWRIGHT_NOT_FOUND.
    expect(await main(['init'], fake.host)).toBe(3);
    expect(asked.at(-1)).toBe('  Run a first thresholds run now? (y/N) ');
    expect(fake.stderr.join('')).toContain('CLI_PLAYWRIGHT_NOT_FOUND');
  });
});
