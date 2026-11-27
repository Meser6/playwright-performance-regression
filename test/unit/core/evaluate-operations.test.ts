// Thresholds after enabling keys.operations (18-REQ-12): the hints of THRESHOLDS_UNSEEN_ENTRIES and
// THRESHOLDS_KEYS_ON_DEFAULTS give the order of the steps.
import { describe, expect, test } from 'vitest';
import { evaluate } from '../../../src/core/evaluate/index.ts';
import { aggregate, config, files, loaded, options, SOURCE } from './evaluate-helpers.ts';
import { generated } from './thresholds-helpers.ts';

const OLD = 'POST /graphql';
const run = (keys: string[], normalization: string) =>
  evaluate(
    {
      endpoints: Object.fromEntries(
        keys.map((key) => [key, aggregate({ durations: [[30, 100]] })]),
      ),
    },
    files(
      loaded('api', { [OLD]: { percentile: 900 }, 'GET /x': { percentile: 900 } }, generated()),
    ),
    config(),
    options({ source: { ...SOURCE, normalization } }),
  );
const hints = (e: ReturnType<typeof run>) =>
  Object.fromEntries(
    e.warnings
      .filter(
        (w) => w.code === 'THRESHOLDS_UNSEEN_ENTRIES' || w.code === 'THRESHOLDS_KEYS_ON_DEFAULTS',
      )
      .map((w) => [w.code, w.hint]),
  );

describe('thresholds after keys.operations (18-REQ-11, 18-REQ-12)', () => {
  test('a changed fingerprint with operation keys: prune, review the diff, commit', () => {
    const e = run(
      ['POST /graphql#GetTickets', 'POST /graphql#CreateOrder', 'GET /x'],
      'ffffffffffffff',
    );
    expect(e.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['THRESHOLDS_SOURCE_MISMATCH']),
    );
    const h = hints(e);
    expect(h.THRESHOLDS_UNSEEN_ENTRIES).toContain('PW_PERF_PRUNE=1');
    expect(h.THRESHOLDS_UNSEEN_ENTRIES).toContain('keys.operations');
    expect(h.THRESHOLDS_KEYS_ON_DEFAULTS).toContain('review the diff and commit');
  });

  test('the same fingerprint, or no operation keys, keeps the usual hints', () => {
    for (const e of [
      run(['POST /graphql#GetTickets', 'GET /x'], SOURCE.normalization),
      run(['POST /graphql/v2', 'GET /x'], 'ffffffffffffff'),
    ]) {
      const h = hints(e);
      expect(h.THRESHOLDS_UNSEEN_ENTRIES).toBe(
        'Run the full suite, or remove stale entries with `PW_PERF_MODE=thresholds PW_PERF_PRUNE=1 <your test command>`.',
      );
      expect(h.THRESHOLDS_KEYS_ON_DEFAULTS).not.toContain('keys.operations');
    }
  });
});
