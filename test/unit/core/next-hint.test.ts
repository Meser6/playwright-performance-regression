// The Next: hint and the commands it names (09-REQ-32, 04-REQ-55).
import { describe, expect, test } from 'vitest';
import { nextHint, perfCommand, suggestCommand } from '../../../src/core/report/index.ts';
import type { CommandContext, NextHintInput } from '../../../src/core/report/index.ts';

const CTX: CommandContext = {
  env: null,
  lifecycleEvent: 'e2e:qa',
  lifecycleScript: 'npm run prepare && npx playwright test --project=E2E',
  userAgent: 'npm/10.8.0 node/v22.18.0 linux x64',
  lockFiles: { pnpm: false, yarn: false },
  scripts: null,
  platform: 'linux',
};
const cmd = (mode: 'test' | 'thresholds' | 'check', ctx: Partial<CommandContext> = {}) =>
  suggestCommand(mode, { ...CTX, ...ctx });

describe('09-AC-27 suggestCommand', () => {
  test('package manager from the user agent, cross-env on win32', () => {
    expect(cmd('test')).toBe('PW_PERF_MODE=test npm run e2e:qa');
    expect(cmd('test', { lifecycleEvent: 'e2e', userAgent: 'pnpm/9.0.0 npm/? node/v22' })).toBe(
      'PW_PERF_MODE=test pnpm run e2e',
    );
    expect(cmd('test', { lifecycleEvent: 'e2e', userAgent: 'yarn/4.1.0 npm/? node/v22' })).toBe(
      'PW_PERF_MODE=test yarn e2e',
    );
    expect(cmd('test', { lifecycleEvent: 'e2e', platform: 'win32' })).toBe(
      'npx cross-env PW_PERF_MODE=test npm run e2e',
    );
    expect(
      cmd('test', {
        lifecycleEvent: null,
        userAgent: null,
        lockFiles: { pnpm: true, yarn: false },
      }),
    ).toBe('PW_PERF_MODE=test pnpm exec playwright test');
  });

  test('npx, pnpm exec and yarn set npm_lifecycle_event to no script of the project (04-REQ-63)', () => {
    const scripts = { test: 'playwright test' };
    const plain = { lifecycleScript: 'playwright test', scripts };
    expect(cmd('check', { ...plain, lifecycleEvent: 'npx' })).toBe(
      'PW_PERF_MODE=check npx playwright test',
    );
    expect(cmd('check', { ...plain, lifecycleEvent: 'test' })).toBe(
      'PW_PERF_MODE=check npm run test',
    );
  });

  test('a script that sets the mode: the matching script of package.json', () => {
    const scripts = { 'perf:test': 'pw-perf test', 'perf:thresholds': 'pw-perf thresholds' };
    expect(
      cmd('thresholds', { lifecycleEvent: 'perf:test', lifecycleScript: 'pw-perf test', scripts }),
    ).toBe('npm run perf:thresholds');
    const own = { m: 'PW_PERF_MODE=thresholds npm run e2e', t: 'PW_PERF_MODE=test npm run e2e' };
    expect(cmd('thresholds', { lifecycleEvent: 't', lifecycleScript: own.t, scripts: own })).toBe(
      'npm run m',
    );
  });

  test('with an environment label: the variable, never a runner option (04-REQ-70)', () => {
    expect(cmd('thresholds', { env: 'qa' })).toBe(
      'PW_PERF_MODE=thresholds PW_PERF_ENV=qa npm run e2e:qa',
    );
    expect(perfCommand('check', null, 'npx playwright test', 'linux')).toBe(
      'PW_PERF_MODE=check npx playwright test',
    );
  });
});

describe('09-AC-34 arguments of the run and the directory (09-REQ-32, 09-D-20)', () => {
  const script = { run: { script: true, tail: ['--', '--project=desktop'] } };
  test('test and check repeat the added arguments, thresholds never', () => {
    expect(cmd('check', { lifecycleEvent: 'e2e', ...script })).toBe(
      'PW_PERF_MODE=check npm run e2e -- --project=desktop',
    );
    expect(cmd('test', { lifecycleEvent: 'e2e', ...script })).toBe(
      'PW_PERF_MODE=test npm run e2e -- --project=desktop',
    );
    expect(cmd('thresholds', { lifecycleEvent: 'e2e', ...script })).toBe(
      'PW_PERF_MODE=thresholds npm run e2e',
    );
    const plain = { lifecycleEvent: null, run: { script: false, tail: ['--grep', '@cart smoke'] } };
    expect(cmd('test', plain)).toBe("PW_PERF_MODE=test npx playwright test --grep '@cart smoke'");
    // The run shape and the command must agree: plain arguments never follow a script.
    expect(cmd('test', { lifecycleEvent: 'e2e', run: plain.run })).toBe(
      'PW_PERF_MODE=test npm run e2e',
    );
  });

  test('a run started from another directory begins with cd', () => {
    expect(
      cmd('thresholds', {
        lifecycleEvent: 'e2e',
        userAgent: 'pnpm/9.0.0',
        directory: 'apps/admin-e2e',
      }),
    ).toBe('cd apps/admin-e2e && PW_PERF_MODE=thresholds pnpm run e2e');
    expect(cmd('thresholds', { lifecycleEvent: 'e2e', directory: null })).toBe(
      'PW_PERF_MODE=thresholds npm run e2e',
    );
  });
});

describe('09-AC-26 nextHint', () => {
  const commands = { test: cmd('test'), thresholds: cmd('thresholds'), check: cmd('check') };
  const report = (r: Partial<NextHintInput['report']> = {}): NextHintInput['report'] => ({
    mode: 'test',
    toolErrors: [],
    warnings: [],
    endpoints: { 'GET /a': {} as never },
    steps: {},
    ci: null,
    evaluation: { status: 'passed', gateEnabled: true, counts: {} as never },
    ...r,
  });
  const hint = (r: Partial<NextHintInput['report']>, written: NextHintInput['written'] = []) =>
    nextHint({ report: report(r), commands, written });

  test('test mode without the api file names the thresholds command', () => {
    const missing = { code: 'THRESHOLDS_FILE_MISSING', message: '', hint: '' };
    expect(hint({ warnings: [missing] })).toBe(
      'derive thresholds: PW_PERF_MODE=thresholds npm run e2e:qa',
    );
  });

  test('thresholds mode lists the written files; outside CI a note about CI machines', () => {
    const written = [
      { name: 'pw-perf-thresholds.json', entries: 42 },
      { name: 'pw-perf-thresholds.steps.json', entries: 6 },
    ];
    expect(hint({ mode: 'thresholds', ci: {} as never }, written)).toBe(
      'commit pw-perf-thresholds.json (42 keys) and pw-perf-thresholds.steps.json (6 keys)',
    );
    expect(hint({ mode: 'thresholds' }, written)).toContain(
      '; for CI, derive them on the CI machines (docs/thresholds.md)',
    );
  });

  test("the wizard's check: no commit hint for its temporary thresholds files (04-REQ-58)", () => {
    const written = [{ name: '/tmp/pw-perf-check-x/pw-perf-thresholds.json', entries: 4 }];
    expect(
      nextHint({ report: report({ mode: 'thresholds' }), commands, written, temporary: true }),
    ).toBeNull();
  });

  test('nothing measured, tool errors, failed and passed runs', () => {
    expect(hint({ endpoints: {} })).toBe(
      'nothing was measured: check use.baseURL and the projects of the test command, then run PW_PERF_MODE=check npm run e2e:qa',
    );
    expect(hint({ toolErrors: [{ code: 'X', message: '', hint: '' }] })).toBeNull();
    expect(hint({ evaluation: { status: 'failed', gateEnabled: true, counts: {} as never } })).toBe(
      'open the report; if the slowdown is intended, derive thresholds again: PW_PERF_MODE=thresholds npm run e2e:qa',
    );
    expect(hint({})).toBeNull();
  });
});
