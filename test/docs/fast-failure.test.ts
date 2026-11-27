// docs/thresholds.md "Fast failures and workload changes" comes from a real run (13-REQ-28): its
// console blocks are excerpts of the golden console cases written by
// `node scripts/build-demo-report.mjs --docs`, and the demo links both reports (13-REQ-29, 13-AC-15).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { RunReport } from '../../src/core/types/index.ts';
import { DEMO_PAGES, demoIndex } from '../../scripts/build-demo-report.mjs';

const ROOT = join(import.meta.dirname, '../..');
const CONSOLE = join(ROOT, 'test/golden/console');
const HEADING = '## Fast failures and workload changes';

function section(): string {
  const doc = readFileSync(join(ROOT, 'docs/thresholds.md'), 'utf8');
  const start = doc.indexOf(`\n${HEADING}\n`);
  expect(start, HEADING).toBeGreaterThan(-1);
  const next = doc.indexOf('\n## ', start + HEADING.length + 1);
  return doc.slice(start, next === -1 ? undefined : next);
}

function golden(name: string): RunReport {
  const data = JSON.parse(readFileSync(join(CONSOLE, `${name}.json`), 'utf8')) as {
    input: RunReport;
  };
  return data.input;
}

describe('13-AC-15 the fast-failure section and the demo', () => {
  test('13-AC-15 every console block of the section is an excerpt of a golden console file', () => {
    const texts = ['fast-failure', 'fast-failure-rule-off'].map((name) =>
      readFileSync(join(CONSOLE, `${name}.w120.txt`), 'utf8'),
    );
    const blocks = [...section().matchAll(/^```text\n([\s\S]*?)\n```$/gmu)].map((m) => m[1] ?? '');
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const block of blocks) {
      expect(
        texts.some((text) => text.includes(block)),
        block,
      ).toBe(true);
    }
  });

  test('13-AC-15 the screenshots of the section exist', () => {
    const images = [...section().matchAll(/!\[[^\]]*\]\((img\/[^)]+\.png)\)/gu)].map((m) => m[1]);
    expect(images.length).toBeGreaterThanOrEqual(5);
    for (const image of images)
      expect(existsSync(join(ROOT, 'docs', image ?? '')), image).toBe(true);
  });

  test('13-AC-15 the golden run fails by nonSuccess and warns about the workload; without the rule it passes', () => {
    const fast = golden('fast-failure');
    const failing = fast.endpoints['GET /api/products'];
    const rule = failing?.evaluation.checks.find((c) => c.rule === 'nonSuccess');
    expect(rule).toMatchObject({ passed: false, blocking: true });
    expect(failing?.successCount).toBe(0);
    expect(fast.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        'THRESHOLDS_ENTRY_NOT_TIMED',
        'THRESHOLDS_WORKLOAD_SHIFT',
        'STATS_COLD_SLOW',
      ]),
    );
    const off = golden('fast-failure-rule-off');
    expect(off.config.checks?.nonSuccess?.enabled).toBe(false);
    expect(off.evaluation.counts.api.blockingViolations).toBe(0);
    expect(off.configDir).toBe('examples/with-setup');
  });

  test('13-AC-15 the demo page links the slow-endpoint and fast-failure reports', () => {
    expect(DEMO_PAGES).toEqual(['index.html', 'slow-endpoint.html', 'fast-failure.html']);
    const index = demoIndex('1.1.0');
    expect(index).toContain('<a href="slow-endpoint.html">');
    expect(index).toContain('<a href="fast-failure.html">');
    expect(readFileSync(join(ROOT, '.github/workflows/demo.yml'), 'utf8')).toContain(
      'node scripts/build-demo-report.mjs --out "$RUNNER_TEMP/demo"',
    );
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8')).toContain(
      'https://meser6.github.io/playwright-performance-regression/',
    );
  });
});
