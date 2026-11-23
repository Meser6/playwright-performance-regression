// 12-PERF-05: junit.xml of the reference report of 16-REQ-17 (500 endpoint and 500 step keys,
// 20% violations): file size and the time of buildJunitXml. The size is also checked on push by
// test/unit/core/junit.test.ts; the time only here, isolated from the parallel CI suite (12-D-05).
import { describe, expect, test } from 'vitest';
import { buildJunitXml } from '../../src/core/report/index.ts';
import { junitReferenceReport } from '../unit/core/junit-fixtures.ts';
import { median, recordResult } from './helpers.ts';

const MAX_BYTES = 1024 * 1024;
const MAX_BUILD_MS = 200;

describe('12-PERF-05 junit.xml of the reference report', () => {
  test('16-AC-10 below 1 MB, built in under 200 ms', () => {
    const report = junitReferenceReport();
    buildJunitXml(report);
    const times: number[] = [];
    let xml = '';
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      xml = buildJunitXml(report);
      times.push(performance.now() - started);
    }
    const bytes = Buffer.byteLength(xml, 'utf8');
    recordResult('12-PERF-05', {
      keys: 1000,
      bytes,
      maxBytes: MAX_BYTES,
      buildMs: times.map(Math.round),
      buildMedianMs: Math.round(median(times)),
      maxBuildMs: MAX_BUILD_MS,
    });
    expect(bytes).toBeLessThan(MAX_BYTES);
    expect(median(times)).toBeLessThan(MAX_BUILD_MS);
  });
});
