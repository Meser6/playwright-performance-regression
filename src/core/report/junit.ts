// junit.xml of a test-mode run (16): the evaluation of the run report as JUnit XML for the test
// views of CI systems. Pure: a function of the run report only (16-REQ-04, 16-D-08).
import { DEFAULT_CONFIG } from '../config/index.ts';
import { buildOutcome } from '../evaluate/outcome.ts';
import { exceedance, formatActual, formatLimit, formatMs, overText } from '../format/violation.ts';
import { compileStatusMatcher } from '../stats/classification.ts';
import type { Aggregate, Check, Issue, KeyEvaluation, Kind, RunReport } from '../types/index.ts';

/** File name in report.dir (16-REQ-01, 16-D-02). */
export const JUNIT_FILE = 'junit.xml';
/** Longest `message` attribute, in characters (16-REQ-10). */
export const JUNIT_MESSAGE_MAX = 500;
/** Longest text of one failure, error, skipped or system-out element (16-REQ-10). */
export const JUNIT_TEXT_MAX = 4_000;
/** Warnings listed in the system-out of the run test case (16-REQ-08). */
export const JUNIT_MAX_WARNINGS = 50;

const RULE_ORDER: readonly Check['rule'][] = [
  'median',
  'percentile',
  'p99',
  'apdex',
  'wilson',
  'errors',
  'nonSuccess',
];

const SUITES: readonly { kind: Kind; name: string; classname: string }[] = [
  { kind: 'api', name: 'pw-perf endpoints', classname: 'pw-perf.endpoints' },
  { kind: 'step', name: 'pw-perf steps', classname: 'pw-perf.steps' },
];

// Characters not allowed in XML 1.0, and lone surrogates (16-REQ-12).
const INVALID_CHARS =
  // eslint-disable-next-line no-control-regex -- the control characters are what is replaced
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Replaces characters not allowed in XML 1.0 with U+FFFD (16-REQ-12). */
function xmlChars(text: string): string {
  return text.replace(INVALID_CHARS, '\uFFFD');
}

/** Escaped element text (16-REQ-12). */
function escapeText(text: string): string {
  return xmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Escaped attribute value; tabs and line breaks as references so parsers keep them. */
function escapeAttr(text: string): string {
  return escapeText(text).replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
}

/** At most `max` characters (code points), cut at the end with "…" (16-REQ-10). */
export function truncateEnd(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** Whole milliseconds as seconds with 3 decimal places: 412 → "0.412" (16-REQ-07). */
function seconds(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  return `${String(Math.floor(whole / 1000))}.${String(whole % 1000).padStart(3, '0')}`;
}

interface Attrs {
  [name: string]: string | number;
}

function attrs(values: Attrs): string {
  return Object.entries(values)
    .map(([name, value]) => ` ${name}="${escapeAttr(String(value))}"`)
    .join('');
}

/** A child element of a test case: failure, error, skipped or system-out. */
interface Child {
  tag: 'failure' | 'error' | 'skipped' | 'system-out';
  attrs?: Attrs;
  text?: string;
}

function childXml(child: Child, indent: string): string {
  const a =
    child.attrs === undefined
      ? ''
      : attrs(
          Object.fromEntries(
            Object.entries(child.attrs).map(([k, v]) => [
              k,
              k === 'message' ? truncateEnd(String(v), JUNIT_MESSAGE_MAX) : v,
            ]),
          ),
        );
  if (child.text === undefined || child.text === '') return `${indent}<${child.tag}${a}/>`;
  return `${indent}<${child.tag}${a}>${escapeText(truncateEnd(child.text, JUNIT_TEXT_MAX))}</${child.tag}>`;
}

interface TestCase {
  classname: string;
  name: string;
  /** Whole milliseconds. */
  ms: number;
  /** "0" instead of "0.000" for a case without time (16-REQ-07). */
  noTime: boolean;
  children: Child[];
}

interface Suite {
  name: string;
  cases: TestCase[];
  /** Explicit suite time; the sum of the case times otherwise. */
  time?: string;
  properties?: [string, string][];
}

function count(cases: TestCase[], tag: Child['tag']): number {
  return cases.filter((c) => c.children.some((child) => child.tag === tag)).length;
}

function totals(cases: TestCase[]): { tests: number; failures: number; errors: number } {
  return {
    tests: cases.length,
    failures: count(cases, 'failure'),
    errors: count(cases, 'error'),
  };
}

function isMuteActive(evaluation: KeyEvaluation): boolean {
  return evaluation.muted !== null && !evaluation.muted.expired;
}

/** Failed checks of one key: blocking first, then relative exceedance, then rule (09-REQ-20). */
function failedChecks(evaluation: KeyEvaluation): Check[] {
  const r = exceedance;
  return evaluation.checks
    .filter((c) => !c.passed)
    .sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) ||
        (r(a) === r(b) ? 0 : r(b) > r(a) ? 1 : -1) ||
        RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule),
    );
}

/** Context of the texts of one report. */
interface Ctx {
  report: RunReport;
  level: string;
  details: string;
  /** measure.successStatuses of the report's config (08-REQ-01). */
  isSuccess: (label: string) => boolean;
}

/** Statuses named in a nonSuccess failure line (16-REQ-21). */
const NON_SUCCESS_STATUSES = 3;

/** One line for a failed check, as in the console violation table (16-REQ-09). */
function checkLine(
  check: Check,
  evaluation: KeyEvaluation,
  ctx: Ctx,
  aggregate?: Aggregate,
): string {
  const rule = check.rule === 'percentile' ? ctx.level : check.rule;
  const sign = check.rule === 'apdex' ? '<' : '>';
  const source = evaluation.thresholdSource === 'file' ? 'thresholds file' : 'default thresholds';
  const statuses =
    check.rule === 'nonSuccess' && aggregate !== undefined
      ? nonSuccessStatuses(aggregate, ctx)
      : '';
  let line = `${rule} ${formatActual(check)} ${sign} limit ${formatLimit(check)} (${overText(check)}), ${String(check.n)} samples${statuses}, ${source}`;
  if (check.hardLimitExceeded) line += ', HARD limit';
  if (evaluation.muted?.expired === true) line += `, muting expired on ${evaluation.muted.until}`;
  return line;
}

function share(value: number): string {
  return value.toFixed(3);
}

/** Statuses outside successStatuses counted by the nonSuccess check: ": 20 × 401" (16-REQ-21). */
function nonSuccessStatuses(aggregate: Aggregate, ctx: Ctx): string {
  const labels = Object.entries(aggregate.statuses)
    .filter(([label]) => /^[1-5][0-9]{2}$/u.test(label) && !ctx.isSuccess(label))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, NON_SUCCESS_STATUSES)
    .map(([label, n]) => `${String(n)} × ${label}`);
  return labels.length === 0 ? '' : `: ${labels.join(', ')}`;
}

/** Body of a failure (and of the not-blocking system-out, 16-REQ-09). */
function violationBody(key: string, aggregate: Aggregate, checks: Check[], ctx: Ctx): string[] {
  const evaluation = aggregate.evaluation;
  const lines = checks.map(
    (c) =>
      `${checkLine(c, evaluation, ctx, aggregate)} (${c.blocking ? 'blocking' : 'not blocking'})`,
  );
  const l = evaluation.limits;
  let limits = `Limits: median ${formatMs(l.median)}, ${ctx.level} ${formatMs(l.percentile)}, p99 ${formatMs(l.p99)}, errors <= ${share(l.maxErrorRate)}`;
  if (l.t !== null) {
    limits += `, T ${formatMs(l.t)}`;
    if (l.minApdex !== null) limits += `, apdex >= ${share(l.minApdex)}`;
    if (l.maxWilson !== null) limits += `, wilson <= ${share(l.maxWilson)}`;
  }
  if (l.maxNonSuccessRate !== null) limits += `, nonSuccess <= ${share(l.maxNonSuccessRate)}`;
  lines.push(limits);
  lines.push(`Samples: ${String(aggregate.count)}, errors ${String(aggregate.errorCount)}`);
  const slowest = aggregate.slowest[0];
  if (slowest !== undefined) {
    const t = slowest.test;
    lines.push(
      `Slowest: ${formatMs(slowest.duration)} in "${t.title}" (${t.file}:${String(t.line)})`,
    );
  }
  lines.push(`Details: ${ctx.details} (key "${key}")`);
  return lines;
}

/** Why the violations of a key do not block (16-REQ-06). */
function notBlockingReason(evaluation: KeyEvaluation, report: RunReport): string {
  const gate = report.config.gate;
  const defaultThresholds = gate?.defaultThresholds ?? DEFAULT_CONFIG.gate.defaultThresholds;
  if (evaluation.thresholdSource === 'default' && defaultThresholds === 'warn') {
    return 'default thresholds only warn (gate.defaultThresholds: warn)';
  }
  if (!report.evaluation.gateEnabled) return 'the gate is off';
  return `within gate.tolerance (${String(gate?.tolerance ?? DEFAULT_CONFIG.gate.tolerance)})`;
}

/** The rule with the smallest minSamples among the enabled ones (16-REQ-06). */
function mildestRule(report: RunReport): { rule: Check['rule']; minSamples: number } | null {
  const checks = report.config.checks;
  const d = DEFAULT_CONFIG.checks;
  const rules: { rule: Check['rule']; enabled: boolean; minSamples: number }[] = [
    {
      rule: 'median',
      enabled: checks?.time?.median?.enabled ?? d.time.median.enabled,
      minSamples: checks?.time?.median?.minSamples ?? d.time.median.minSamples,
    },
    {
      rule: 'percentile',
      enabled: checks?.time?.percentile?.enabled ?? d.time.percentile.enabled,
      minSamples: checks?.time?.percentile?.minSamples ?? d.time.percentile.minSamples,
    },
    {
      rule: 'p99',
      enabled: checks?.time?.p99?.enabled ?? d.time.p99.enabled,
      minSamples: checks?.time?.p99?.minSamples ?? d.time.p99.minSamples,
    },
    {
      rule: 'apdex',
      enabled: checks?.slowShare?.apdex?.enabled ?? d.slowShare.apdex.enabled,
      minSamples: checks?.slowShare?.apdex?.minSamples ?? d.slowShare.apdex.minSamples,
    },
    {
      rule: 'wilson',
      enabled: checks?.slowShare?.wilson?.enabled ?? d.slowShare.wilson.enabled,
      minSamples: checks?.slowShare?.wilson?.minSamples ?? d.slowShare.wilson.minSamples,
    },
    {
      rule: 'errors',
      enabled: checks?.errors?.enabled ?? d.errors.enabled,
      minSamples: checks?.errors?.minSamples ?? d.errors.minSamples,
    },
  ];
  let best: { rule: Check['rule']; minSamples: number } | null = null;
  for (const r of rules) {
    if (r.enabled && (best === null || r.minSamples < best.minSamples)) {
      best = { rule: r.rule, minSamples: r.minSamples };
    }
  }
  return best;
}

function notEvaluatedMessage(kind: Kind, aggregate: Aggregate, report: RunReport): string {
  switch (aggregate.evaluation.reason) {
    case 'too-few-samples': {
      const mildest = mildestRule(report);
      if (mildest === null) return `too few samples (${String(aggregate.successCount)})`;
      const n = mildest.rule === 'errors' ? aggregate.count : aggregate.successCount;
      const rule = mildest.rule === 'percentile' ? levelOf(report) : mildest.rule;
      return `too few samples (${String(n)}, the ${rule} rule needs ${String(mildest.minSamples)})`;
    }
    case 'thresholds-error': {
      const file = report.thresholdFiles.find((f) => f.kind === kind && f.status === 'invalid');
      return file === undefined
        ? 'the thresholds file is invalid'
        : `thresholds file ${file.path} is invalid`;
    }
    default:
      return 'no enabled rule applies';
  }
}

function levelOf(report: RunReport): string {
  return (
    report.config.checks?.time?.percentile?.level ?? DEFAULT_CONFIG.checks.time.percentile.level
  );
}

/**
 * system-out lines of 1.1.0 (16-REQ-21): `workload: 40 → 12 samples (per pass 4.0 → 2.4)` for a
 * key with evaluation.workload and `cold start: first call 1840 ms, warm p50 120 ms` for a key
 * whose cold samples were left out of the statistics.
 */
function contextLines(aggregate: Aggregate): string[] {
  const lines: string[] = [];
  const workload = aggregate.evaluation.workload;
  if (workload !== null) {
    const perPass = (side: typeof workload.base): string => (side.count / side.passes).toFixed(1);
    lines.push(
      `workload: ${String(workload.base.count)} → ${String(workload.now.count)} samples (per pass ${perPass(workload.base)} → ${perPass(workload.now)})`,
    );
  }
  const cold = aggregate.cold;
  if (cold?.excluded === true && cold.warmP50 !== null) {
    lines.push(`cold start: first call ${formatMs(cold.max)}, warm p50 ${formatMs(cold.warmP50)}`);
  }
  return lines;
}

/** Test case of one key (16-REQ-05, 16-REQ-06, 16-REQ-07). */
function keyCase(
  kind: Kind,
  classname: string,
  key: string,
  aggregate: Aggregate,
  ctx: Ctx,
): TestCase {
  const evaluation = aggregate.evaluation;
  const median = aggregate.stats?.percentiles['p50'];
  const children: Child[] = [];
  const muted = evaluation.muted;
  if (evaluation.result === 'not-evaluated') {
    children.push({
      tag: 'skipped',
      attrs: { message: `not evaluated: ${notEvaluatedMessage(kind, aggregate, ctx.report)}` },
    });
  } else if (evaluation.result === 'fail') {
    const checks = failedChecks(evaluation);
    const body = violationBody(key, aggregate, checks, ctx);
    const first = checks[0];
    const blocking = checks.find((c) => c.blocking);
    if (blocking !== undefined) {
      children.push({
        tag: 'failure',
        attrs: { type: blocking.rule, message: checkLine(blocking, evaluation, ctx, aggregate) },
        text: body.join('\n'),
      });
    } else if (muted !== null && isMuteActive(evaluation)) {
      const exceeded =
        first === undefined ? '' : `; ${checkLine(first, evaluation, ctx, aggregate)}`;
      children.push({
        tag: 'skipped',
        attrs: { message: `muted until ${muted.until}: ${muted.note}${exceeded}` },
        text: body.join('\n'),
      });
    } else {
      body.push(`not blocking: ${notBlockingReason(evaluation, ctx.report)}`);
      children.push({ tag: 'system-out', text: body.join('\n') });
    }
  } else if (muted !== null && isMuteActive(evaluation)) {
    children.push({ tag: 'system-out', text: `muted until ${muted.until}: ${muted.note}` });
  }
  // Workload and cold start of the key (16-REQ-21), appended to its system-out.
  const context = contextLines(aggregate);
  if (context.length > 0) {
    const out = children.find((c) => c.tag === 'system-out');
    if (out === undefined) children.push({ tag: 'system-out', text: context.join('\n') });
    else out.text = [out.text ?? '', ...context].join('\n');
  }
  return {
    classname,
    name: key,
    ms: median === undefined ? 0 : median,
    noTime: median === undefined,
    children,
  };
}

function issueLines(issue: Issue): string {
  return issue.hint === undefined
    ? `${issue.code}: ${issue.message}`
    : `${issue.code}: ${issue.message}\nhint: ${issue.hint}`;
}

/** The `measurement run` test case (16-REQ-08). */
function runCase(report: RunReport, exitCode: number): TestCase {
  const children: Child[] = [];
  const first = report.toolErrors[0];
  if (first !== undefined) {
    children.push({
      tag: 'error',
      attrs: { type: first.code, message: first.message },
      text: report.toolErrors.map(issueLines).join('\n'),
    });
  }
  const t = report.tests;
  const lines = [
    `Mode: ${report.mode}${report.env === null ? '' : ` (env ${report.env})`}`,
    `Tests: ${String(t.expected)} passed, ${String(t.unexpected)} failed, ${String(t.flaky)} flaky, ${String(t.skipped)} skipped; passes ${String(report.passes.completed)}/${String(report.passes.planned)}`,
    `Evaluation: ${report.evaluation.status} (exit code ${String(exitCode)})`,
  ];
  const warnings = report.warnings;
  if (warnings.length === 0) {
    lines.push('Warnings: none');
  } else {
    lines.push(`Warnings: ${String(warnings.length)}`);
    for (const w of warnings.slice(0, JUNIT_MAX_WARNINGS)) lines.push(`${w.code}: ${w.message}`);
    if (warnings.length > JUNIT_MAX_WARNINGS) {
      const more = warnings.length - JUNIT_MAX_WARNINGS;
      lines.push(`… and ${String(more)} more warning${more === 1 ? '' : 's'} (see report.json)`);
    }
  }
  children.push({ tag: 'system-out', text: lines.join('\n') });
  return { classname: 'pw-perf.run', name: 'measurement run', ms: 0, noTime: true, children };
}

function caseTime(c: TestCase): string {
  return c.noTime ? '0' : seconds(c.ms);
}

function suiteXml(suite: Suite, timestamp: string): string[] {
  const t = totals(suite.cases);
  const ms = suite.cases.reduce(
    (sum, c) => sum + (c.noTime ? 0 : Math.max(0, Math.round(c.ms))),
    0,
  );
  const lines = [
    `  <testsuite${attrs({
      name: suite.name,
      tests: t.tests,
      failures: t.failures,
      errors: t.errors,
      skipped: count(suite.cases, 'skipped'),
      time: suite.time ?? seconds(ms),
      timestamp,
    })}>`,
  ];
  if (suite.properties !== undefined) {
    lines.push('    <properties>');
    for (const [name, value] of suite.properties) {
      lines.push(`      <property${attrs({ name, value })}/>`);
    }
    lines.push('    </properties>');
  }
  for (const c of suite.cases) {
    const head = `    <testcase${attrs({ classname: c.classname, name: c.name, time: caseTime(c) })}`;
    if (c.children.length === 0) {
      lines.push(`${head}/>`);
      continue;
    }
    lines.push(`${head}>`);
    for (const child of c.children) lines.push(childXml(child, '      '));
    lines.push('    </testcase>');
  }
  lines.push('  </testsuite>');
  return lines;
}

/**
 * junit.xml of a run report (16-REQ-04): a `pw-perf run` suite with the tool errors and run
 * properties, then one suite per key kind with keys (16-REQ-05). UTF-8, 2-space indent, a final
 * line break, no CDATA (16-REQ-12).
 */
export function buildJunitXml(report: RunReport): string {
  const exitCode = buildOutcome(report, {
    reportJson: null,
    reportHtml: null,
    thresholds: [],
    thresholdsDiff: null,
  }).exitCode;
  const ctx: Ctx = {
    report,
    level: levelOf(report),
    details: report.config.report?.html === false ? 'report.json' : 'report.html',
    isSuccess: compileStatusMatcher(
      report.config.measure?.successStatuses ?? DEFAULT_CONFIG.measure.successStatuses,
    ),
  };
  const ci = report.ci;
  const suites: Suite[] = [
    {
      name: 'pw-perf run',
      time: '0',
      cases: [runCase(report, exitCode)],
      properties: [
        ['pw-perf.runId', report.runId],
        ['pw-perf.mode', report.mode],
        ['pw-perf.env', report.env ?? ''],
        ['pw-perf.toolVersion', report.tool.version],
        ['pw-perf.evaluation', report.evaluation.status],
        ['pw-perf.exitCode', String(exitCode)],
        ['pw-perf.passes', `${String(report.passes.completed)}/${String(report.passes.planned)}`],
        // Number of merged shards (16-REQ-13, 17-REQ-17); 0 without a merge.
        ['pw-perf.shards', String(report.shards?.list.length ?? 0)],
        ['pw-perf.commit', ci?.commit ?? ''],
        ['pw-perf.branch', ci?.branch ?? ''],
        ['pw-perf.buildUrl', ci?.buildUrl ?? ''],
      ],
    },
  ];
  const byKind: Record<Kind, Record<string, Aggregate>> = {
    api: report.endpoints,
    step: report.steps,
  };
  for (const { kind, name, classname } of SUITES) {
    const keys = Object.keys(byKind[kind]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // A kind without keys has no suite: some CI systems show empty suites as broken (16-REQ-05).
    if (keys.length === 0) continue;
    suites.push({
      name,
      cases: keys.map((key) => keyCase(kind, classname, key, byKind[kind][key] as Aggregate, ctx)),
    });
  }
  const all = suites.flatMap((s) => s.cases);
  const t = totals(all);
  const duration = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites${attrs({
      name: 'pw-perf',
      tests: t.tests,
      failures: t.failures,
      errors: t.errors,
      time: seconds(Number.isFinite(duration) ? duration : 0),
    })}>`,
    ...suites.flatMap((s) => suiteXml(s, report.startedAt)),
    '</testsuites>',
  ];
  return `${lines.join('\n')}\n`;
}
