// Thresholds files of 1.1.0 (10, chapter 7a): maxNonSuccessRate, the source block, the generated
// fields coldSamples and sourcePasses, and entries of version 2 files.
import { describe, expect, test } from 'vitest';
import type { LoadedThresholds } from '../../../src/core/evaluate/index.ts';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { deriveThresholds, diffThresholds } from '../../../src/core/thresholds/index.ts';
import type { DerivedThresholds } from '../../../src/core/thresholds/index.ts';
import type { ThresholdsEntry, ThresholdsFile } from '../../../src/core/types/index.ts';
import {
  cfg,
  deriveOptions,
  existing,
  file,
  generated,
  loadedFile,
  runReport,
} from './thresholds-helpers.ts';
import type { ReportSpec } from './thresholds-helpers.ts';

const KEY = 'GET /api/tickets';

function derive(spec: ReportSpec, files: LoadedThresholds = existing()): DerivedThresholds {
  const result = deriveThresholds(runReport(spec), cfg(), files, deriveOptions());
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function content(d: DerivedThresholds): ThresholdsFile {
  const c = d.files.find((f) => f.kind === 'api')?.content;
  if (c === null || c === undefined) throw new Error('api not written');
  return c;
}

describe('maxNonSuccessRate and source (10-REQ-25, 10-REQ-26)', () => {
  test('10-AC-24 20 × 200 give maxNonSuccessRate 0.05 and the source block; a key with only 404s gets no entry', () => {
    const d = derive({
      endpoints: {
        [KEY]: { durations: [[20, 120]] },
        'GET /api/other': { durations: [[60, 80]] },
        'GET /api/missing': { other: 20 },
        'GET /api/mixed': { durations: [[15, 120]], other: 5 },
      },
    });
    const entries = content(d).entries;
    expect(entries[KEY]).toMatchObject({
      maxNonSuccessRate: 0.05,
      // 20 of 120 samples of the kind, 4 places rounded down.
      source: { count: 20, successCount: 20, passes: 10, share: 0.1666 },
    });
    // u = 1 for a key without successful samples: no entry (10-REQ-02).
    expect(entries['GET /api/missing']).toBeUndefined();
    // u = 0.25: 0.25 × 1.5 + 0.02 = 0.395.
    expect(entries['GET /api/mixed']?.maxNonSuccessRate).toBe(0.395);
    expect(content(d).generated).toMatchObject({ coldSamples: 1, sourcePasses: 10 });
  });

  test('step entries get a source block but no maxNonSuccessRate', () => {
    const d = derive({ steps: { 'open page': { durations: [[20, 1200]] } } });
    const step = d.files.find((f) => f.kind === 'step')?.content?.entries['open page'];
    expect(step).toBeDefined();
    expect(step).not.toHaveProperty('maxNonSuccessRate');
    expect(step?.source).toEqual({ count: 20, successCount: 20, passes: 10, share: 1 });
  });

  test('10-AC-25 runs differing only by ±5% samples of a key change no file (hysteresis, source ignored)', () => {
    const first = derive({ endpoints: { [KEY]: { durations: [[200, 120]] } } });
    const files = existing(loadedFile(content(first)));
    for (const n of [190, 210]) {
      const again = derive({ endpoints: { [KEY]: { durations: [[n, 120]] } } }, files);
      expect(again.files[0]?.changed, String(n)).toBe(false);
      expect(stringifyStable(content(again))).toBe(stringifyStable(content(first)));
    }
    // generated.sourcePasses alone does not write the file either.
    const report = runReport({ endpoints: { [KEY]: { durations: [[200, 120]] } } });
    const other = deriveThresholds(
      { ...report, passes: { planned: 12, completed: 12, failed: [] } },
      cfg(),
      files,
      deriveOptions(),
    );
    expect(other.ok && other.value.files[0]?.changed).toBe(false);
  });

  test('a change of measure.coldSamples writes the file (10-REQ-26)', () => {
    const first = derive({ endpoints: { [KEY]: { durations: [[200, 120]] } } });
    const files = existing(loadedFile(content(first)));
    const report = runReport({ endpoints: { [KEY]: { durations: [[200, 120]] } } });
    const changed = deriveThresholds(
      {
        ...report,
        config: { ...report.config, measure: { ...report.config.measure, coldSamples: 0 } },
      },
      cfg(),
      files,
      deriveOptions(),
    );
    expect(changed.ok && changed.value.files[0]?.changed).toBe(true);
    expect(changed.ok && changed.value.files[0]?.content?.generated?.coldSamples).toBe(0);
    expect(changed.ok && changed.value.warnings.map((w) => w.code)).toContain(
      'THRESHOLDS_SOURCE_MISMATCH',
    );
  });
});

describe('version 2 files (10-REQ-27, 02-REQ-43)', () => {
  test('10-AC-26 a v2 file is written as v3; entries kept by hysteresis get maxNonSuccessRate and source, limits byte for byte', () => {
    const fresh = derive({ endpoints: { [KEY]: { durations: [[200, 120]] } } });
    const {
      maxNonSuccessRate: _m,
      source: _s,
      ...v2Entry
    } = content(fresh).entries[KEY] as ThresholdsEntry;
    const { coldSamples: _c, sourcePasses: _p, ...v2Generated } = generated();
    const v2: ThresholdsFile = {
      schemaVersion: 3,
      kind: 'api',
      generated: v2Generated,
      entries: { [KEY]: v2Entry },
    };
    const files = existing(loadedFile(v2, 2));
    const report = runReport({ endpoints: { [KEY]: { durations: [[205, 121]] } } });
    const result = deriveThresholds(report, cfg(), files, deriveOptions());
    if (!result.ok) throw new Error('refused');
    const api = result.value.files[0];
    expect(api?.changed).toBe(true);
    expect(api?.content?.schemaVersion).toBe(3);
    const entry = api?.content?.entries[KEY];
    // The limits of the kept entry are unchanged; the fields of 1.1.0 are added.
    expect(entry).toEqual({
      ...v2Entry,
      maxNonSuccessRate: 0.05,
      source: { count: 205, successCount: 205, passes: 10, share: 1 },
    });
    // The diff lists the key as unchanged with "+new fields" (10-REQ-27).
    const diff = diffThresholds(
      files.api,
      api ?? { kind: 'api', content: null, changed: false },
      report,
      cfg(),
    );
    expect(diff.keys.find((k) => k.key === KEY)).toMatchObject({
      category: 'unchanged',
      newFields: true,
    });
  });

  test('a replaced entry of a v2 file gets both fields; adding maxNonSuccessRate is no change in the diff', () => {
    const old: ThresholdsEntry = {
      t: 500,
      median: 150,
      percentile: 200,
      p99: 300,
      minApdex: 0.9,
      maxWilson: 0.1,
      maxErrorRate: 0.05,
    };
    const files = existing(file('api', { [KEY]: old }));
    const report = runReport({ endpoints: { [KEY]: { durations: [[200, 120]] } } });
    const result = deriveThresholds(report, cfg(), files, deriveOptions());
    if (!result.ok) throw new Error('refused');
    const api = result.value.files[0];
    expect(api?.content?.entries[KEY]).toMatchObject({ maxNonSuccessRate: 0.05, source: {} });
    const diff = diffThresholds(
      files.api,
      api ?? { kind: 'api', content: null, changed: false },
      report,
      cfg(),
    );
    const k = diff.keys.find((x) => x.key === KEY);
    expect(k?.changes.map((c) => c.limit)).not.toContain('maxNonSuccessRate');
  });
});
