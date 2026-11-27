#!/usr/bin/env node
// Simulation of measure.coldSamples before a release (08-REQ-45): replays the pass files of one
// thresholds run and of test runs of the same project, recorded on the same machine, with
// coldSamples 0, 1 and 2, and reports per value:
// - evaluated keys and violations of the test runs against thresholds derived from the
//   thresholds run (no change of the application, so every violation is a false alarm);
// - whether a slowdown ×1.5 of one endpoint in the first test run is detected.
// Cold samples are counted per pass like the reporter does (08-REQ-41); --per-run counts them per
// run instead (the semantics before 2026-11-27), to compare both.
//
// Usage (the core is imported from src, no build needed):
//   node scripts/simulate-cold.mjs --thresholds <report dir> --test <report dir> [--test <dir>]
//        [--slow "<endpoint key>"] [--per-run] [--json]
// Each report dir holds report.json and pass-1.json … pass-N.json of one run: run the test
// command with PW_PERF_MODE=thresholds, copy reports/pw-perf aside, then twice PW_PERF_MODE=test.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveConfig } from '../src/core/config/index.ts';
import { evaluate } from '../src/core/evaluate/index.ts';
import { buildRunReport } from '../src/core/report/index.ts';
import { parseRunReport } from '../src/core/schema/index.ts';
import { Aggregator } from '../src/core/stats/index.ts';
import { reportSource } from '../src/core/thresholds/derive.ts';
import { deriveThresholds } from '../src/core/thresholds/index.ts';
import { replayEntries } from '../src/reporter/pass-file.ts';

/** @typedef {import('../src/core/types/index.ts').RunReport} RunReport */
/** @typedef {import('../src/core/types/index.ts').Kind} Kind */
/** @typedef {import('../src/core/config/index.ts').ResolvedConfig} ResolvedConfig */
/** @typedef {import('../src/core/config/types.ts').ResolvedConfigResult} Resolved */
/** @typedef {import('../src/core/stats/index.ts').Aggregates} Aggregates */
/** @typedef {import('../src/core/evaluate/index.ts').LoadedThresholds} LoadedThresholds */
/** @typedef {import('../src/core/evaluate/index.ts').Evaluation} Evaluation */
/** @typedef {import('../src/reporter/pass-file.ts').PassEntry} PassEntry */
/** @typedef {{ report: RunReport, entries: PassEntry[], passes: number }} Run */

const COLD_VALUES = [0, 1, 2];
const SLOWDOWN = 1.5;

const { values } = parseArgs({
  options: {
    thresholds: { type: 'string' },
    test: { type: 'string', multiple: true },
    slow: { type: 'string' },
    'per-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});
if (values.thresholds === undefined || (values.test ?? []).length === 0) {
  process.stderr.write(
    'usage: node scripts/simulate-cold.mjs --thresholds <dir> --test <dir> [--test <dir>] [--slow "<key>"] [--per-run] [--json]\n',
  );
  process.exit(2);
}

const perRun = values['per-run'] === true;

/**
 * report.json and the entries of every pass file of a report dir, passes in order; each pass after
 * the first starts with a pass boundary (08-REQ-41), unless --per-run.
 * @param {string} dir
 * @returns {Run}
 */
function readRun(dir) {
  const base = resolve(dir);
  const parsed = parseRunReport(readFileSync(join(base, 'report.json'), 'utf8'), 'report.json');
  if (!parsed.ok) throw new Error(`${base}: ${JSON.stringify(parsed.issues)}`);
  const passes = readdirSync(base)
    .map((f) => /^pass-([1-9][0-9]*)\.json$/u.exec(f))
    .flatMap((m) => (m === null ? [] : [Number(m[1])]))
    .sort((a, b) => a - b);
  if (passes.length === 0) {
    throw new Error(`${base}: no pass files; run with at least 2 passes (run.passes)`);
  }
  const entries = passes.flatMap((k, i) => {
    const file = /** @type {{ entries: PassEntry[] }} */ (
      JSON.parse(readFileSync(join(base, `pass-${String(k)}.json`), 'utf8'))
    );
    /** @type {PassEntry[]} */
    const boundary = i === 0 || perRun ? [] : [['p']];
    return [...boundary, ...file.entries];
  });
  return { report: parsed.value, entries, passes: passes.length };
}

/**
 * The run's config with measure.coldSamples set to `cold`.
 * @param {RunReport} report
 * @param {number} cold
 * @returns {Resolved}
 */
function configOf(report, cold) {
  const snapshot = structuredClone(report.config);
  snapshot.measure = { ...snapshot.measure, coldSamples: cold };
  // The snapshot is the JSON form of the config (03-REQ-04).
  const input = /** @type {import('../src/core/config/index.ts').PerfConfigInput} */ (
    /** @type {unknown} */ (snapshot)
  );
  const resolved = resolveConfig(input, { source: 'snapshot' });
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  return resolved.value;
}

/**
 * Replays the run into an aggregator; `slowKey` slows that endpoint down by SLOWDOWN.
 * @param {Run} run
 * @param {ResolvedConfig} cfg
 * @param {string | null} [slowKey]
 * @returns {Aggregates}
 */
function aggregate(run, cfg, slowKey = null) {
  const measured = new Set(
    run.report.runConditions.projects.filter((p) => p.role === 'measured').map((p) => p.name),
  );
  const agg = new Aggregator({
    advanced: cfg.advanced,
    successStatuses: cfg.measure.successStatuses,
    errors: { statuses: cfg.checks.errors.statuses },
    measuredProjects: measured,
    evaluatedPercentile: cfg.checks.time.percentile.level,
    rawUrls: false,
    coldSamples: cfg.measure.coldSamples,
    minSamples: cfg.checks.time.median.minSamples,
  });
  const entries =
    slowKey === null
      ? run.entries
      : run.entries.map(
          /** @returns {PassEntry} */
          (e) =>
            e[0] === 'r' && e[1] === slowKey && e[2].duration !== null
              ? ['r', e[1], { ...e[2], duration: e[2].duration * SLOWDOWN }, e[3], e[4], e[5]]
              : e,
        );
  replayEntries(agg, entries);
  return agg.finalize();
}

/** @type {LoadedThresholds} */
const MISSING = {
  api: {
    status: 'missing',
    kind: 'api',
    path: 'pw-perf-thresholds.json',
    envlessFileExists: false,
  },
  step: {
    status: 'missing',
    kind: 'step',
    path: 'pw-perf-thresholds.steps.json',
    envlessFileExists: false,
  },
};

/**
 * A run report of the replayed run, as the reporter builds it.
 * @param {Run} run
 * @param {Resolved} resolved
 * @param {Aggregates} aggregates
 * @param {LoadedThresholds} thresholds
 * @param {'test' | 'thresholds'} mode
 * @returns {{ report: RunReport, evaluation: Evaluation }}
 */
function reportOf(run, resolved, aggregates, thresholds, mode) {
  const cfg = resolved.config;
  const source = { ...reportSource(run.report), coldSamples: cfg.measure.coldSamples };
  const evaluation = evaluate(aggregates, thresholds, cfg, {
    mode,
    env: run.report.env,
    fatalToolError: false,
    source,
    startedAt: run.report.startedAt,
    passes: run.passes,
    workers: run.report.runConditions.workers,
  });
  const report = buildRunReport({
    meta: run.report,
    config: resolved.snapshot,
    normalization: run.report.normalization,
    stepNormalization: run.report.stepNormalization,
    passes: { planned: run.passes, completed: run.passes, failed: [] },
    runConditions: run.report.runConditions,
    tests: run.report.tests,
    aggregates,
    evaluation,
    warnings: [...aggregates.issues, ...evaluation.warnings],
    toolErrors: [],
  });
  return { report, evaluation };
}

/**
 * Thresholds files derived from the thresholds run, as loaded files.
 * @param {Run} run
 * @param {Resolved} resolved
 * @returns {LoadedThresholds}
 */
function deriveFrom(run, resolved) {
  const aggregates = aggregate(run, resolved.config);
  const { report } = reportOf(run, resolved, aggregates, MISSING, 'thresholds');
  const derived = deriveThresholds(report, resolved.config, MISSING, {
    env: run.report.env,
    prune: false,
    toolVersion: 'simulation',
  });
  if (!derived.ok) throw new Error(JSON.stringify(derived.issues));
  /** @type {LoadedThresholds} */
  const loaded = { ...MISSING };
  for (const file of derived.value.files) {
    if (file.content !== null) {
      loaded[file.kind] = {
        status: 'loaded',
        kind: file.kind,
        path: 'simulated',
        file: file.content,
      };
    }
  }
  return loaded;
}

/**
 * Evaluated keys and violations of one evaluation.
 * @param {Evaluation} evaluation
 */
function summary(evaluation) {
  let evaluated = 0;
  let violations = 0;
  /** @type {string[]} */
  const failed = [];
  for (const kind of /** @type {Kind[]} */ (['api', 'step'])) {
    for (const [key, e] of Object.entries(evaluation.perKey[kind])) {
      if (e.result !== 'not-evaluated') evaluated += 1;
      if (e.result === 'fail') {
        violations += 1;
        failed.push(`${kind} ${key}`);
      }
    }
  }
  return { evaluated, violations, failed };
}

const thresholdsRun = readRun(values.thresholds);
const testRuns = (values.test ?? []).map(readRun);
const firstRun = testRuns[0];
if (firstRun === undefined) throw new Error('no test run');
// The endpoint slowed down: the given key, or the most called endpoint of the first test run.
/** @type {Map<string, number>} */
const counts = new Map();
for (const e of firstRun.entries) if (e[0] === 'r') counts.set(e[1], (counts.get(e[1]) ?? 0) + 1);
const slowKey =
  values.slow ?? [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;

const results = COLD_VALUES.map((cold) => {
  const files = deriveFrom(thresholdsRun, configOf(thresholdsRun.report, cold));
  const runs = testRuns.map((run) => {
    const resolved = configOf(run.report, cold);
    return summary(
      reportOf(run, resolved, aggregate(run, resolved.config), files, 'test').evaluation,
    );
  });
  let detected = null;
  if (slowKey !== null) {
    const resolved = configOf(firstRun.report, cold);
    const slowed = reportOf(
      firstRun,
      resolved,
      aggregate(firstRun, resolved.config, slowKey),
      files,
      'test',
    );
    detected = slowed.evaluation.perKey.api[slowKey]?.result === 'fail';
  }
  return {
    coldSamples: cold,
    evaluatedKeys: runs.map((r) => r.evaluated),
    falseAlarms: runs.map((r) => r.violations),
    falseAlarmKeys: runs.map((r) => r.failed),
    slowdownDetected: detected,
  };
});

if (values.json) {
  process.stdout.write(
    `${JSON.stringify({ per: perRun ? 'run' : 'pass', slowKey, results }, null, 2)}\n`,
  );
} else {
  process.stdout.write(`cold samples counted per ${perRun ? 'run' : 'pass'}\n`);
  process.stdout.write(`slowdown ×${SLOWDOWN} of: ${slowKey ?? '(no endpoint)'}\n`);
  process.stdout.write(
    'coldSamples | evaluated keys per test run | false alarms per test run | slowdown detected\n',
  );
  for (const r of results) {
    process.stdout.write(
      `${String(r.coldSamples).padEnd(11)} | ${r.evaluatedKeys.join(', ').padEnd(27)} | ${r.falseAlarms.join(', ').padEnd(25)} | ${r.slowdownDetected === null ? '—' : r.slowdownDetected ? 'yes' : 'no'}\n`,
    );
  }
  const [base, one] = results;
  if (base === undefined || one === undefined) throw new Error('no results');
  /** @param {number[]} list */
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  const keep =
    sum(one.evaluatedKeys) >= sum(base.evaluatedKeys) &&
    sum(one.falseAlarms) <= sum(base.falseAlarms);
  process.stdout.write(
    `\nDefault coldSamples 1 ${keep ? 'holds' : 'does NOT hold'} on this data (08-REQ-45): evaluated keys ${sum(one.evaluatedKeys)} vs ${sum(base.evaluatedKeys)}, false alarms ${sum(one.falseAlarms)} vs ${sum(base.falseAlarms)}.\n`,
  );
}
