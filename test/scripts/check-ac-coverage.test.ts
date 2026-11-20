import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { acIdsInTitles, checkAcCoverage } from '../../scripts/check-ac-coverage.mjs';

const script = join(import.meta.dirname, '../../scripts/check-ac-coverage.mjs');

interface Fixture {
  acs: string[];
  inScope: string[];
  manual?: string[];
  /** ACs exported with "withdrawn": true (12-REQ-21). */
  withdrawn?: string[];
  /** Test files (relative to test/) with the AC IDs used in their test titles. */
  tests: Record<string, string[]>;
}

// Builds a throw-away repository root with spec-ids.json, the two script configs and tests.
// Titles are assembled at runtime so that this file itself contains no AC IDs in titles.
function makeRoot(fixture: Fixture): string {
  const root = mkdtempSync(join(tmpdir(), 'check-ac-coverage-'));
  const withdrawn = fixture.withdrawn ?? [];
  const ids = [
    ...fixture.acs.map((id) => ({ id, kind: 'AC' })),
    ...withdrawn.map((id) => ({ id, kind: 'AC', withdrawn: true })),
  ];
  writeFileSync(join(root, 'spec-ids.json'), JSON.stringify({ specCommit: 'x@0', ids }));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts/ac-scope.json'), JSON.stringify({ inScope: fixture.inScope }));
  const criteria = (fixture.manual ?? []).map((id) => ({ id, how: 'by hand' }));
  writeFileSync(join(root, 'scripts/ac-manual.json'), JSON.stringify({ criteria }));
  for (const [file, acIds] of Object.entries(fixture.tests)) {
    const path = join(root, 'test', file);
    mkdirSync(join(path, '..'), { recursive: true });
    const fn = 'test';
    writeFileSync(path, acIds.map((id) => `${fn}('${id} does a thing', () => {});\n`).join(''));
  }
  return root;
}

const run = (root: string, ...args: string[]) => {
  try {
    const stdout = execFileSync(process.execPath, [script, '--root', root, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stderr: string };
    return { status: e.status, output: e.stderr };
  }
};

describe('check-ac-coverage', () => {
  test('12-AC-01 detects a missing test for a fictional criterion and passes after removal', () => {
    const base: Fixture = {
      acs: ['01-AC-01', '01-AC-02'],
      inScope: ['01'],
      tests: { 'unit/a.test.ts': ['01-AC-01', '01-AC-02'] },
    };
    expect(run(makeRoot(base)).status).toBe(0);

    const withFictional = { ...base, acs: [...base.acs, '01-AC-99'] };
    const failing = run(makeRoot(withFictional));
    expect(failing.status).toBe(1);
    expect(failing.output).toContain('01-AC-99 has no test');

    expect(run(makeRoot(base)).status).toBe(0);
  });

  test('12-AC-01 reports a test title with an ID that is not in spec-ids.json', () => {
    const root = makeRoot({
      acs: ['01-AC-01'],
      inScope: ['01-AC-01'],
      tests: { 'unit/a.test.ts': ['01-AC-01', '01-AC-77'] },
    });
    expect(checkAcCoverage({ root }).unknown).toEqual([
      { id: '01-AC-77', where: 'test/unit/a.test.ts' },
    ]);
    expect(run(root).status).toBe(1);
  });

  test('12-AC-01 counts manual criteria as covered and rejects unknown manual IDs', () => {
    const root = makeRoot({
      acs: ['13-AC-05', '13-AC-06'],
      inScope: ['13'],
      manual: ['13-AC-05', 'S-01', '13-AC-50'],
      tests: { 'b.test.ts': ['13-AC-06'] },
    });
    const result = checkAcCoverage({ root });
    expect(result.missing).toEqual([]);
    expect(result.unknown).toEqual([{ id: '13-AC-50', where: 'scripts/ac-manual.json' }]);
  });

  test('12-AC-01 checks only the criteria in scope unless --all is given', () => {
    const root = makeRoot({
      acs: ['01-AC-01', '02-AC-01', '02-AC-02', '03-AC-01'],
      inScope: ['01', '02-AC-02'],
      tests: { 'a.test.ts': ['01-AC-01', '02-AC-02'] },
    });
    expect(checkAcCoverage({ root })).toMatchObject({ missing: [], inScope: 2, covered: 2 });
    expect(checkAcCoverage({ root, all: true }).missing).toEqual(['02-AC-01', '03-AC-01']);
    expect(run(root).status).toBe(0);
    expect(run(root, '--all').status).toBe(1);
  });

  test('12-AC-01 rejects scope entries that are not ACs or spec file prefixes', () => {
    const root = makeRoot({ acs: ['01-AC-01'], inScope: ['01-AC-02'], tests: {} });
    expect(checkAcCoverage({ root }).unknown).toEqual([
      { id: '01-AC-02', where: 'scripts/ac-scope.json' },
    ]);
  });

  test('12-AC-07 withdrawn criteria need no test, also with --all and a file prefix in scope', () => {
    const root = makeRoot({
      acs: ['06-AC-09'],
      withdrawn: ['06-AC-01', '06-AC-02'],
      inScope: ['06'],
      tests: { 'a.test.ts': ['06-AC-09'] },
    });
    expect(checkAcCoverage({ root })).toMatchObject({
      missing: [],
      unknown: [],
      withdrawn: [],
      inScope: 1,
      covered: 1,
    });
    expect(checkAcCoverage({ root, all: true }).missing).toEqual([]);
    expect(run(root).status).toBe(0);
    expect(run(root, '--all').status).toBe(0);
  });

  test('12-AC-07 a test title or a manual entry naming a withdrawn criterion fails the check', () => {
    // The ID is assembled at runtime so that this file has no withdrawn ID in a title.
    const old = ['06', 'AC', '01'].join('-');
    const root = makeRoot({
      acs: ['06-AC-09'],
      withdrawn: [old, '06-AC-02'],
      inScope: ['06-AC-09'],
      manual: ['06-AC-02'],
      tests: { 'unit/old.test.ts': [old, '06-AC-09'] },
    });
    expect(checkAcCoverage({ root, all: true }).withdrawn).toEqual([
      { id: '06-AC-02', where: 'scripts/ac-manual.json' },
      { id: old, where: 'test/unit/old.test.ts' },
    ]);
    const failing = run(root, '--all');
    expect(failing.status).toBe(1);
    expect(failing.output).toContain(`${old} in test/unit/old.test.ts is withdrawn`);
    expect(run(root).status).toBe(1);
  });

  test('finds AC IDs only in test, it and describe titles', () => {
    const [t, i, d] = ['test', 'it', 'describe'];
    const source = [
      `${d}('01-AC-01 group', () => {`,
      `  ${t}.skip("01-AC-02 and 01-AC-03 together", () => {});`,
      `  ${i}(\`01-AC-04 template\`, () => {});`,
      `  const note = '01-AC-05 not a title';`,
      '});',
    ].join('\n');
    expect(acIdsInTitles(source).sort()).toEqual(['01-AC-01', '01-AC-02', '01-AC-03', '01-AC-04']);
  });
});
