import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkPrTitle, SCOPES, TYPES } from '../../scripts/check-pr-title.mjs';

const script = join(import.meta.dirname, '../../scripts/check-pr-title.mjs');

describe('check-pr-title', () => {
  test('13-AC-13 accepts a title with a scope', () => {
    expect(checkPrTitle('feat(collector): track requests in new browser contexts')).toEqual([]);
  });

  test('13-AC-13 accepts a title without a scope', () => {
    expect(checkPrTitle('build: set up toolchain and CI')).toEqual([]);
  });

  test('13-AC-13 accepts a breaking change marker with and without a scope', () => {
    expect(checkPrTitle('feat(config)!: rename the gate option')).toEqual([]);
    expect(checkPrTitle('refactor!: drop Node 22 support')).toEqual([]);
  });

  test('13-AC-13 accepts every type and every scope from the commit rules', () => {
    for (const type of TYPES) expect(checkPrTitle(`${type}: do something`), type).toEqual([]);
    for (const scope of SCOPES) {
      expect(checkPrTitle(`fix(${scope}): do something`), scope).toEqual([]);
    }
  });

  test('13-AC-13 accepts a title of exactly 72 characters', () => {
    const title = `fix: ${'a'.repeat(72 - 'fix: '.length)}`;
    expect(title).toHaveLength(72);
    expect(checkPrTitle(title)).toEqual([]);
  });

  test('13-AC-13 rejects an unknown type', () => {
    expect(checkPrTitle('feature: add collector')).toEqual([
      expect.stringContaining('unknown type "feature"'),
    ]);
  });

  test('13-AC-13 rejects an unknown scope', () => {
    expect(checkPrTitle('feat(api): add collector')).toEqual([
      expect.stringContaining('unknown scope "api"'),
    ]);
  });

  test('13-AC-13 rejects an uppercase letter after the colon', () => {
    expect(checkPrTitle('feat: Add collector')).toEqual([
      expect.stringContaining('lowercase letter'),
    ]);
  });

  test('13-AC-13 rejects a trailing period', () => {
    expect(checkPrTitle('feat: add collector.')).toEqual([expect.stringContaining('period')]);
  });

  test('13-AC-13 rejects a title longer than 72 characters', () => {
    const title = `fix: ${'a'.repeat(73 - 'fix: '.length)}`;
    expect(checkPrTitle(title)).toEqual([expect.stringContaining('73 characters')]);
  });

  test('13-AC-13 rejects titles that are not Conventional Commits', () => {
    for (const title of [
      'Add collector',
      'feat:add collector',
      'feat : add collector',
      'feat(): add collector',
      'feat: ',
      'FEAT: add collector',
    ]) {
      expect(checkPrTitle(title), title).not.toEqual([]);
    }
  });

  test('13-AC-13 the command line exits 0 for a valid and 1 for an invalid title', () => {
    const run = (title: string) => {
      try {
        execFileSync(process.execPath, [script], {
          env: { ...process.env, PR_TITLE: title },
          stdio: 'pipe',
        });
        return 0;
      } catch (error) {
        return (error as { status: number }).status;
      }
    };
    expect(run('ci: add CI workflow')).toBe(0);
    expect(run('ci: Add CI workflow.')).toBe(1);
  });
});
