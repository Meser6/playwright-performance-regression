// docs/adoption.md "Situation → what to do": every situation of an existing project has a row,
// and every row is exercised by an integration test that runs the described way (13-AC-08).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');
const doc = readFileSync(join(ROOT, 'docs/adoption.md'), 'utf8');

/** Situation (start of the first cell) → integration test file and a title fragment in it. */
const ROWS: [string, string, string][] = [
  ['Tests import `test` directly', 'projects.test.ts', '03-AC-08 12-AC-03 swapping the imports'],
  ['Own `fixtures.ts`', 'projects.test.ts', 'own fixtures, own contexts'],
  ['Own `context` override that uses the base', 'projects.test.ts', 'own fixtures, own contexts'],
  ['Own `context` or `page` fixture created', 'projects.test.ts', 'own fixtures, own contexts'],
  ['Role fixtures', 'projects.test.ts', 'role pages'],
  ['Logged-in context with worker scope', 'projects.test.ts', 'a worker context are measured'],
  ['`mergeTests(a, b)`', 'projects.test.ts', 'test objects, mergeTests'],
  ['Several test objects', 'projects.test.ts', 'test objects, mergeTests'],
  ['playwright-bdd', 'projects.test.ts', 'playwright-bdd and mocks'],
  ['API-only tests', 'projects.test.ts', 'wrapper, reporters, test objects'],
  ['Login (`setup`) project', 'projects.test.ts', 'wrapper, reporters, test objects'],
  [
    'Another wrapper around the Playwright config',
    'projects.test.ts',
    'a config wrapper outside withPerf()',
  ],
  ['Own reporters', 'projects.test.ts', 'wrapper, reporters, test objects'],
  ['Firefox and WebKit projects', 'projects.test.ts', 'measures the Chromium project only'],
  ['`page.route()` mocks', 'projects.test.ts', 'playwright-bdd and mocks'],
  ['Tests that create data', 'projects.test.ts', 'the flaky one on retry'],
];

function tableRows(): string[] {
  const start = doc.search(/^\| Situation in your project +\|/mu);
  expect(start).toBeGreaterThan(0);
  const lines = doc.slice(start).split('\n');
  const end = lines.findIndex((line) => !line.startsWith('|'));
  return lines.slice(2, end).map((line) => line.split('|')[1]?.trim() ?? '');
}

describe('13-AC-08 docs/adoption.md situation table', () => {
  test('has a row for every situation, and no other rows', () => {
    const rows = tableRows();
    expect(rows).toHaveLength(ROWS.length);
    for (const [situation] of ROWS) {
      expect(
        rows.filter((row) => row.startsWith(situation)),
        situation,
      ).toHaveLength(1);
    }
  });

  test('every row has an integration test', () => {
    for (const [situation, file, title] of ROWS) {
      const source = readFileSync(join(ROOT, 'test/integration', file), 'utf8');
      expect(source.replace(/\s+/gu, ' '), situation).toContain(title);
    }
  });
});
