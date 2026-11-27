// junit.xml (16): golden files, the mapping of key states, the texts of a violation, escaping,
// truncation and the totals. GOLDEN_UPDATE=1 rewrites test/golden/junit/*.xml (12-REQ-16); the
// diff must be reviewed. Validation against junit-10.xsd uses xmllint when it is installed
// (always on Linux and macOS in CI).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  JUNIT_MAX_WARNINGS,
  JUNIT_MESSAGE_MAX,
  JUNIT_TEXT_MAX,
  buildJunitXml,
  truncateEnd,
} from '../../../src/core/report/index.ts';
import type { Aggregate, Check, Issue, RunReport } from '../../../src/core/types/index.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';
import { fullRun, stepsRun } from '../html/fixtures.ts';
import { junitReferenceReport, warnedReport } from './junit-fixtures.ts';

const DIR = join(GOLDEN_DIR, 'junit');
const XSD = join(DIR, 'junit-10.xsd');
const update = process.env['GOLDEN_UPDATE'] === '1';

function inputOf(...path: string[]): RunReport {
  return (JSON.parse(readFileSync(join(GOLDEN_DIR, ...path), 'utf8')) as { input: RunReport })
    .input;
}

/** Golden cases: test/golden/junit/<name>.xml from these run reports (16, chapter 10). */
const CASES: Record<string, () => RunReport> = {
  'full-run': () => inputOf('run-report', 'valid', 'full-run.json'),
  'failed-run': () => inputOf('console', 'failed-run.json'),
  warned: warnedReport,
  'tool-error': () => inputOf('console', 'tool-error.json'),
  empty: () => inputOf('run-report', 'valid', 'empty-run.json'),
  steps: stepsRun,
  // A merge of two shards (17-REQ-17, 16-REQ-13: pw-perf.shards).
  merged: () => inputOf('run-report', 'valid', 'merged.json'),
};

const xmllint = spawnSync('xmllint', ['--version']).status === 0;
const requireXmllint = process.env['CI'] !== undefined && process.platform !== 'win32';

/** xmllint against junit-10.xsd: null when valid, else the messages. */
function xsdErrors(xml: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'pw-perf-junit-'));
  try {
    const file = join(dir, 'junit.xml');
    writeFileSync(file, xml);
    const r = spawnSync('xmllint', ['--noout', '--schema', XSD, file], { encoding: 'utf8' });
    return r.status === 0 ? null : r.stderr;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Counts of an element in the XML. */
function countTag(xml: string, tag: string): number {
  return xml.match(new RegExp(`<${tag}[ >/]`, 'gu'))?.length ?? 0;
}

function unescape(text: string): string {
  return text
    .replace(/&#(\d+);/gu, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

interface ParsedCase {
  name: string;
  classname: string;
  time: string;
  body: string;
}

function attr(tag: string, name: string): string {
  const m = new RegExp(` ${name}="([^"]*)"`, 'u').exec(tag);
  return m === null ? '' : unescape(m[1] as string);
}

/** Test cases of a junit.xml in file order (attributes unescaped, body raw). */
function testCases(xml: string): ParsedCase[] {
  const out: ParsedCase[] = [];
  for (const m of xml.matchAll(/<testcase( [^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/gu)) {
    const head = m[1] as string;
    out.push({
      name: attr(head, 'name'),
      classname: attr(head, 'classname'),
      time: attr(head, 'time'),
      body: m[3] ?? '',
    });
  }
  return out;
}

function suiteHeads(xml: string): string[] {
  return [...xml.matchAll(/<testsuite [^>]*>/gu)].map((m) => m[0]);
}

describe('junit.xml golden files', () => {
  test('16-AC-01 each golden run report gives its golden junit.xml byte for byte; it passes junit-10.xsd', () => {
    for (const [name, report] of Object.entries(CASES)) {
      const xml = buildJunitXml(report());
      const file = join(DIR, `${name}.xml`);
      if (update) writeFileSync(file, xml);
      expect(existsSync(file), file).toBe(true);
      expect(xml, name).toBe(readFileSync(file, 'utf8'));
      if (xmllint) expect(xsdErrors(xml), name).toBeNull();
    }
    if (!xmllint) expect(requireXmllint, 'xmllint is required in CI').toBe(false);
  });

  test('16-REQ-01 16-REQ-12 UTF-8 declaration, 2-space indent, final line break, no CDATA', () => {
    const xml = buildJunitXml(CASES['failed-run']?.() as RunReport);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<testsuites ')).toBe(true);
    expect(xml.endsWith('</testsuites>\n')).toBe(true);
    expect(xml).not.toContain('CDATA');
    expect(xml.charCodeAt(0)).not.toBe(0xfeff);
    expect(xml).toContain('\n  <testsuite name="pw-perf run"');
    expect(xml).not.toMatch(/="[\d.]+e[+-]?\d/u);
  });

  test('16-REQ-04 the XML is deterministic and does not change the report', () => {
    const report = CASES['failed-run']?.() as RunReport;
    const before = structuredClone(report);
    expect(buildJunitXml(report)).toBe(buildJunitXml(report));
    expect(report).toEqual(before);
  });

  test('16-REQ-04 reports differing only in run times differ only in timestamp, time and the run properties', () => {
    const a = CASES['failed-run']?.() as RunReport;
    const b: RunReport = {
      ...a,
      runId: 'other-run',
      startedAt: '2026-11-19T10:00:00.000Z',
      finishedAt: '2026-11-19T10:10:00.000Z',
    };
    const normalize = (xml: string): string =>
      xml
        .replace(/ timestamp="[^"]*"/gu, '')
        .replace(/<testsuites ([^>]*) time="[^"]*"/u, '<testsuites $1')
        .replace(/name="pw-perf.runId" value="[^"]*"/u, '');
    expect(normalize(buildJunitXml(b))).toBe(normalize(buildJunitXml(a)));
  });
});

describe('junit.xml totals and states (16-REQ-05, 16-REQ-06)', () => {
  test('16-AC-02 failures = blocking violations, skipped = not evaluated + actively muted failing keys; suite attributes are sums', () => {
    for (const [name, make] of Object.entries(CASES)) {
      const report = make();
      const xml = buildJunitXml(report);
      const counts = report.evaluation.counts;
      expect(countTag(xml, 'failure'), name).toBe(
        counts.api.blockingViolations + counts.step.blockingViolations,
      );
      const keys = [...Object.values(report.endpoints), ...Object.values(report.steps)];
      const skipped = keys.filter(
        (a) =>
          a.evaluation.result === 'not-evaluated' ||
          (a.evaluation.result === 'fail' &&
            !a.evaluation.checks.some((c) => !c.passed && c.blocking) &&
            a.evaluation.muted !== null &&
            !a.evaluation.muted.expired),
      ).length;
      expect(countTag(xml, 'skipped'), name).toBe(skipped);
      // Each suite: its counters are the sums over its test cases.
      const parts = xml.split('<testsuite ').slice(1);
      let total = { tests: 0, failures: 0, errors: 0 };
      for (const part of parts) {
        const head = `<testsuite ${part.slice(0, part.indexOf('>') + 1)}`;
        const cases = testCases(part);
        const sum = {
          tests: cases.length,
          failures: cases.filter((c) => c.body.includes('<failure')).length,
          errors: cases.filter((c) => c.body.includes('<error')).length,
          skipped: cases.filter((c) => c.body.includes('<skipped')).length,
        };
        expect(attr(head, 'tests'), name).toBe(String(sum.tests));
        expect(attr(head, 'failures'), name).toBe(String(sum.failures));
        expect(attr(head, 'errors'), name).toBe(String(sum.errors));
        expect(attr(head, 'skipped'), name).toBe(String(sum.skipped));
        total = {
          tests: total.tests + sum.tests,
          failures: total.failures + sum.failures,
          errors: total.errors + sum.errors,
        };
      }
      const root = /<testsuites [^>]*>/u.exec(xml)?.[0] ?? '';
      expect(attr(root, 'tests'), name).toBe(String(total.tests));
      expect(attr(root, 'failures'), name).toBe(String(total.failures));
      expect(attr(root, 'errors'), name).toBe(String(total.errors));
      expect(root).not.toContain('skipped=');
      expect(root).not.toContain('timestamp=');
    }
  });

  test('16-REQ-05 the run suite first, then endpoints and steps; keys in report order with prefixes kept', () => {
    const report = stepsRun();
    const xml = buildJunitXml(report);
    expect(suiteHeads(xml).map((h) => attr(h, 'name'))).toEqual([
      'pw-perf run',
      'pw-perf endpoints',
      'pw-perf steps',
    ]);
    const cases = testCases(xml);
    expect(cases[0]).toMatchObject({ classname: 'pw-perf.run', name: 'measurement run' });
    const api = cases.filter((c) => c.classname === 'pw-perf.endpoints').map((c) => c.name);
    const steps = cases.filter((c) => c.classname === 'pw-perf.steps').map((c) => c.name);
    expect(api).toEqual(Object.keys(report.endpoints).sort());
    expect(steps).toEqual(Object.keys(report.steps).sort());
    const withRequest: RunReport = {
      ...report,
      endpoints: {
        ...report.endpoints,
        'request GET /api/health': Object.values(report.endpoints)[0] as Aggregate,
      },
    };
    expect(testCases(buildJunitXml(withRequest)).map((c) => c.name)).toContain(
      'request GET /api/health',
    );
  });

  test('16-REQ-05 a kind without keys has no suite', () => {
    const xml = buildJunitXml(inputOf('run-report', 'valid', 'empty-run.json'));
    expect(suiteHeads(xml).map((h) => attr(h, 'name'))).toEqual(['pw-perf run']);
    expect(suiteHeads(buildJunitXml(fullRun())).map((h) => attr(h, 'name'))).toEqual([
      'pw-perf run',
      'pw-perf endpoints',
    ]);
  });

  test('16-REQ-07 testcase time is the median in seconds; no stats gives "0"; the suite sums its cases', () => {
    const report = fullRun();
    const xml = buildJunitXml(report);
    const cases = testCases(xml);
    const tickets = cases.find((c) => c.name === 'GET /api/tickets/:id');
    const median = report.endpoints['GET /api/tickets/:id']?.stats?.percentiles['p50'] as number;
    expect(tickets?.time).toBe((median / 1000).toFixed(3));
    expect(cases.find((c) => c.name === 'POST /api/orders')?.time).toBe('0');
    const suite = suiteHeads(xml).find((h) => h.includes('pw-perf endpoints')) ?? '';
    expect(attr(suite, 'time')).toBe((median / 1000).toFixed(3));
    // testsuites: finishedAt − startedAt.
    const root = /<testsuites [^>]*>/u.exec(xml)?.[0] ?? '';
    const seconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;
    expect(attr(root, 'time')).toBe(seconds.toFixed(3));
  });

  test('16-AC-03 a warned report has no failure; both keys say "not blocking" with the tolerance', () => {
    const report = warnedReport();
    expect(report.evaluation.status).toBe('warned');
    const xml = buildJunitXml(report);
    expect(countTag(xml, 'failure')).toBe(0);
    for (const key of ['GET /api/tickets', 'POST /api/orders']) {
      const c = testCases(xml).find((t) => t.name === key);
      expect(c?.body, key).toMatch(/^\s*<system-out>[\s\S]*\(not blocking\)/u);
      expect(c?.body, key).toContain('not blocking: within gate.tolerance (2)');
    }
  });

  function failingKey(
    evaluation: Partial<Aggregate['evaluation']>,
    report: RunReport = fullRun(),
  ): string {
    const key = 'GET /api/tickets/:id';
    const aggregate = report.endpoints[key] as Aggregate;
    const checks: Check[] = aggregate.evaluation.checks.map((c) =>
      c.rule === 'median' ? { ...c, passed: false, blocking: false, actual: c.limit * 1.5 } : c,
    );
    const changed: RunReport = {
      ...report,
      endpoints: {
        [key]: {
          ...aggregate,
          evaluation: { ...aggregate.evaluation, result: 'fail', checks, ...evaluation },
        },
      },
    };
    return testCases(buildJunitXml(changed)).find((c) => c.name === key)?.body ?? '';
  }

  test('16-REQ-06 the not-blocking reason: default thresholds at warn, gate off, tolerance', () => {
    const warnDefaults = fullRun();
    warnDefaults.config = {
      ...warnDefaults.config,
      gate: { ...warnDefaults.config.gate, defaultThresholds: 'warn' },
    };
    expect(failingKey({ muted: null, thresholdSource: 'default' }, warnDefaults)).toContain(
      'not blocking: default thresholds only warn (gate.defaultThresholds: warn)',
    );
    const gateOff = fullRun();
    gateOff.evaluation = { ...gateOff.evaluation, gateEnabled: false };
    expect(failingKey({ muted: null, thresholdSource: 'file' }, gateOff)).toContain(
      'not blocking: the gate is off',
    );
    expect(failingKey({ muted: null, thresholdSource: 'file' })).toMatch(
      /not blocking: within gate\.tolerance \(\d+(\.\d+)?\)/u,
    );
  });

  test('16-REQ-06 an actively muted failing key is skipped with the mute and the first violation', () => {
    const body = failingKey({
      muted: { until: '2026-12-31', note: 'Known slow', expired: false },
    });
    expect(body).toMatch(
      /^\s*<skipped message="muted until 2026-12-31: Known slow; median \d+ ms &gt; limit \d+ ms \(\+50%\), \d+ samples, (thresholds file|default thresholds)">/u,
    );
    expect(body).not.toContain('<failure');
  });

  test('16-REQ-09 an expired mute is evaluated normally and says so in the line', () => {
    const report = fullRun();
    const key = 'GET /api/tickets/:id';
    const aggregate = report.endpoints[key] as Aggregate;
    const checks = aggregate.evaluation.checks.map((c) =>
      c.rule === 'median' ? { ...c, passed: false, blocking: true, actual: c.limit * 1.5 } : c,
    );
    report.endpoints = {
      [key]: {
        ...aggregate,
        evaluation: {
          ...aggregate.evaluation,
          result: 'fail',
          checks,
          muted: { until: '2026-01-31', note: 'old', expired: true },
        },
      },
    };
    const body = testCases(buildJunitXml(report)).find((c) => c.name === key)?.body ?? '';
    expect(body).toMatch(/<failure type="median" message="[^"]*, muting expired on 2026-01-31"/u);
  });

  test('16-REQ-06 a passing muted key has a system-out with the mute; a passing key has no children', () => {
    const cases = testCases(buildJunitXml(fullRun()));
    expect(cases.find((c) => c.name === 'GET /api/tickets/:id')?.body.trim()).toBe(
      '<system-out>muted until 2026-12-31: Known slow</system-out>',
    );
    const users = testCases(buildJunitXml(inputOf('console', 'failed-run.json'))).find(
      (c) => c.name === 'GET /api/users',
    );
    expect(users?.body).toBe('');
  });

  test('16-REQ-06 not evaluated: too few samples names the mildest enabled rule; invalid file; no rule', () => {
    const tooFew = testCases(buildJunitXml(inputOf('console', 'failed-run.json'))).find(
      (c) => c.name === 'GET /api/rare',
    );
    expect(tooFew?.body.trim()).toBe(
      '<skipped message="not evaluated: too few samples (2, the median rule needs 5)"/>',
    );
    const invalid = testCases(buildJunitXml(inputOf('console', 'tool-error.json'))).find(
      (c) => c.name === 'GET /api/users',
    );
    expect(invalid?.body).toContain(
      'not evaluated: thresholds file pw-perf-thresholds.api.json is invalid',
    );
    const report = fullRun();
    const aggregate = report.endpoints['POST /api/orders'] as Aggregate;
    report.endpoints = {
      'POST /api/orders': {
        ...aggregate,
        evaluation: {
          ...aggregate.evaluation,
          result: 'not-evaluated',
          reason: 'no-rules',
          checks: [],
        },
      },
    };
    expect(buildJunitXml(report)).toContain(
      '<skipped message="not evaluated: no enabled rule applies"/>',
    );
  });
});

describe('junit.xml texts (16-REQ-08, 16-REQ-09)', () => {
  test('16-REQ-09 failure: type of the first blocking rule, one-line message, body with every failed check, limits, samples, slowest, details', () => {
    const c = testCases(buildJunitXml(inputOf('console', 'failed-run.json'))).find(
      (t) => t.name === 'GET /api/search',
    );
    const body = unescape(c?.body ?? '');
    const head =
      '<failure type="wilson" message="wilson 0.309 (0.400) > limit 0.100 (+21 pp), 100 samples, thresholds file">';
    expect(body).toContain(head);
    const text = body.slice(body.indexOf(head) + head.length, body.indexOf('</failure>'));
    expect(text.split('\n')).toEqual([
      'wilson 0.309 (0.400) > limit 0.100 (+21 pp), 100 samples, thresholds file (blocking)',
      'apdex 0.781 (0.700) < limit 0.900 (+12 pp), 100 samples, thresholds file (blocking)',
      'Limits: median 500 ms, p95 2000 ms, p99 4000 ms, errors <= 0.050, T 300 ms, apdex >= 0.900, wilson <= 0.100',
      'Samples: 100, errors 0',
      'Slowest: 1500 ms in "search › full text" (tests/search.spec.ts:8)',
      'Details: report.html (key "GET /api/search")',
    ]);
  });

  test('16-REQ-09 Details points to report.json when report.html is false', () => {
    const report = fullRun();
    report.config = { ...report.config, report: { ...report.config.report, html: false } };
    expect(buildJunitXml(report)).toContain(
      'Details: report.json (key &quot;POST /api/orders&quot;)',
    );
  });

  test('16-REQ-09 HARD limit and >999% as in the console table', () => {
    const c = testCases(buildJunitXml(inputOf('console', 'failed-run.json'))).find(
      (t) => t.name === 'GET /api/health',
    );
    expect(unescape(c?.body ?? '')).toContain(
      'message="median 50 ms > limit 1 ms (>999%), 20 samples, thresholds file, HARD limit"',
    );
  });

  test('16-AC-04 tool errors give one error with the first code and every error in the body', () => {
    const report = inputOf('console', 'tool-error.json');
    const second: Issue = { code: 'RUN_INCOMPLETE', message: 'The run was interrupted.' };
    report.toolErrors = [...report.toolErrors, second];
    const xml = buildJunitXml(report);
    const run = testCases(xml)[0] as ParsedCase;
    expect(countTag(run.body, 'error')).toBe(1);
    const first = report.toolErrors[0] as Issue;
    expect(run.body).toContain(`<error type="${first.code}" message="`);
    const body = unescape(run.body);
    expect(body).toContain(`${first.code}: ${first.message}\nhint: ${String(first.hint)}`);
    expect(body).toContain('RUN_INCOMPLETE: The run was interrupted.');
    const suite = suiteHeads(xml)[0] ?? '';
    expect(attr(suite, 'errors')).toBe('1');
  });

  test('16-REQ-08 run system-out: mode, tests and passes, verdict, exit code, at most 50 warnings', () => {
    const report = fullRun();
    report.passes = { planned: 3, completed: 3, failed: [] };
    report.warnings = Array.from({ length: JUNIT_MAX_WARNINGS + 3 }, (_, i) => ({
      code: 'TESTS_FAILED',
      message: `warning ${String(i)}`,
    }));
    const xml = buildJunitXml(report);
    const out = unescape(testCases(xml)[0]?.body ?? '');
    expect(out).toContain('Mode: test (env qa)\n');
    expect(out).toContain('; passes 3/3\n');
    expect(out).toContain('Evaluation: failed (exit code 2)\n');
    expect(out).toContain(`TESTS_FAILED: warning ${String(JUNIT_MAX_WARNINGS - 1)}\n`);
    expect(out).not.toContain(`warning ${String(JUNIT_MAX_WARNINGS)}\n`);
    expect(out).toContain('… and 3 more warnings (see report.json)</system-out>');
    expect(xml).toContain('<property name="pw-perf.passes" value="3/3"/>');
  });

  test('16-REQ-13 run properties from the report; empty text for null', () => {
    const xml = buildJunitXml(inputOf('run-report', 'valid', 'empty-run.json'));
    const names = [...xml.matchAll(/<property name="([^"]+)" value="([^"]*)"\/>/gu)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(names.map(([n]) => n)).toEqual([
      'pw-perf.runId',
      'pw-perf.mode',
      'pw-perf.env',
      'pw-perf.toolVersion',
      'pw-perf.evaluation',
      'pw-perf.exitCode',
      'pw-perf.passes',
      'pw-perf.shards',
      'pw-perf.commit',
      'pw-perf.branch',
      'pw-perf.buildUrl',
    ]);
    expect(Object.fromEntries(names)).toMatchObject({
      'pw-perf.env': '',
      'pw-perf.shards': '0',
      'pw-perf.commit': '',
    });
    // Only the run suite has properties; no hostname anywhere (16-REQ-11).
    expect(countTag(xml, 'properties')).toBe(1);
    expect(xml).not.toContain('hostname');
  });
});

describe('junit.xml escaping and limits (16-REQ-10, 16-REQ-12)', () => {
  test('16-AC-06 a key with &, <, U+0001 and an emoji gives valid XML; name reads back with U+FFFD', () => {
    const report = fullRun();
    const key = 'GET /api/a&b<c\u0001d 🚀 "q" \'s\'';
    report.endpoints = { [key]: report.endpoints['POST /api/orders'] as Aggregate };
    const xml = buildJunitXml(report);
    const name = testCases(xml).find((c) => c.classname === 'pw-perf.endpoints')?.name;
    expect(name).toBe(key.replace('\u0001', '�'));
    // No raw control characters or lone surrogates in the file.
    // eslint-disable-next-line no-control-regex -- the control characters are what is checked
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u);
    if (xmllint) expect(xsdErrors(xml)).toBeNull();
  });

  test('16-REQ-12 lone surrogates and U+FFFE become U+FFFD', () => {
    const report = fullRun();
    const key = 'GET /x\uD800y\uDC00z￾';
    report.endpoints = { [key]: report.endpoints['POST /api/orders'] as Aggregate };
    const name = testCases(buildJunitXml(report)).find(
      (c) => c.classname === 'pw-perf.endpoints',
    )?.name;
    expect(name).toBe('GET /x�y�z�');
  });

  test('16-REQ-12 slowest raw URLs are never written, even with report.rawUrls', () => {
    const report = inputOf('run-report', 'valid', 'raw-urls-and-extra-percentile.json');
    const urls = Object.values(report.endpoints).flatMap((a) =>
      a.slowest.map((s) => s.url).filter((u): u is string => typeof u === 'string'),
    );
    expect(urls.length).toBeGreaterThan(0);
    const xml = buildJunitXml(report);
    for (const url of urls) expect(xml).not.toContain(url);
  });

  test('16-REQ-10 message at most 500 characters, element text at most 4000, cut with …; names are never cut', () => {
    expect(truncateEnd('abc', 3)).toBe('abc');
    expect(truncateEnd('abcd', 3)).toBe('ab…');
    expect(truncateEnd('🚀🚀🚀🚀', 3)).toBe('🚀🚀…');
    const report = inputOf('console', 'tool-error.json');
    const long = 'x'.repeat(5000);
    report.toolErrors = [{ code: 'RUN_INCOMPLETE', message: long }];
    const run = testCases(buildJunitXml(report))[0] as ParsedCase;
    const message = /<error [^>]*message="([^"]*)"/u.exec(run.body)?.[1] ?? '';
    expect(Array.from(message)).toHaveLength(JUNIT_MESSAGE_MAX);
    expect(message.endsWith('…')).toBe(true);
    const text = /<error [^>]*>([^<]*)<\/error>/u.exec(run.body)?.[1] ?? '';
    expect(Array.from(text)).toHaveLength(JUNIT_TEXT_MAX);
    expect(text.endsWith('…')).toBe(true);
    const longKey = `GET /api/${'k'.repeat(1990)}`;
    const keyed = fullRun();
    keyed.endpoints = { [longKey]: keyed.endpoints['POST /api/orders'] as Aggregate };
    expect(testCases(buildJunitXml(keyed)).map((c) => c.name)).toContain(longKey);
  });

  test('16-AC-10 the reference report gives less than 1 MB', () => {
    const xml = buildJunitXml(junitReferenceReport());
    expect(Buffer.byteLength(xml, 'utf8')).toBeLessThan(1024 * 1024);
    expect(countTag(xml, 'testcase')).toBe(1001);
    expect(countTag(xml, 'failure')).toBe(200);
  });
});

describe('1.1.0 in junit.xml (16-REQ-21)', () => {
  test('16-REQ-21 a nonSuccess failure has its type and the statuses; nonSuccess in the limits', () => {
    const xml = buildJunitXml(inputOf('run-report', 'valid', 'fast-failure.json'));
    expect(xml).toContain(
      '<failure type="nonSuccess" message="nonSuccess 0.839 (1.000) &gt; limit 0.050 (+79 pp), 20 samples: 20 × 401, thresholds file">',
    );
    expect(xml).toContain(
      'errors &lt;= 0.050, T 500 ms, apdex &gt;= 0.900, wilson &lt;= 0.100, nonSuccess &lt;= 0.050',
    );
  });

  test('16-REQ-21 system-out has the workload of a key with a source block and the cold start of a key', () => {
    const shift = buildJunitXml(inputOf('run-report', 'valid', 'workload-shift.json'));
    expect(shift).toContain('workload: 40 → 6 samples (per pass 4.0 → 1.2)');
    const cold = buildJunitXml(inputOf('run-report', 'valid', 'cold.json'));
    // Cold samples of 5 passes (08-REQ-41): the slowest of them.
    expect(cold).toContain('cold start: slowest of 5 first calls 1840 ms, warm p50 120 ms');
    // A cold sample kept in the statistics (too few samples) gives no line.
    expect(cold).not.toContain('first call 900 ms');
  });
});
