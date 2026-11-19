// The pw-perf.config.ts written by the init wizard (04-REQ-38 step 9): only the values that differ
// from the defaults, plus comments with the options changed most often. Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import { DOCS_CONFIG_URL, PACKAGE_NAME } from '../../core/types/index.ts';

export interface InitAnswers {
  originLabels: Record<string, string>;
  scope: 'all' | 'tagged';
  repeatTest: number;
  warnOnly: boolean;
  envLabels: string[];
  addCi: boolean;
}

/** A value as TypeScript source with single quotes, on one line. */
function ts(value: unknown): string {
  if (typeof value === 'string')
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(ts).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(
      ([k, v]) => `${/^[A-Za-z_$][\w$]*$/u.test(k) ? k : ts(k)}: ${ts(v)}`,
    );
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  return String(value);
}

/** Text of pw-perf.config.ts for the answers. */
export function renderPerfConfig(answers: InitAnswers): string {
  const d = DEFAULT_CONFIG;
  const body: string[] = [];
  const origins = Object.entries(answers.originLabels);
  if (origins.length > 0) {
    body.push(
      '  keys: {',
      '    // Labels of the backend origins in the endpoint keys.',
      '    origins: {',
    );
    for (const [origin, label] of origins) body.push(`      ${ts(origin)}: ${ts(label)},`);
    body.push('    },', '  },');
  }
  if (answers.repeatTest !== d.run.repeat.test) {
    body.push(
      '  run: {',
      `    // Repetitions per test in measurement runs (default ${d.run.repeat.test}).`,
      `    repeat: { test: ${answers.repeatTest} },`,
      '  },',
    );
  }
  if (answers.warnOnly !== d.gate.warnOnly) {
    body.push(
      '  gate: {',
      answers.warnOnly
        ? '    // Report regressions without failing the run; remove after the first weeks.'
        : '    // Fail the run on a regression.',
      `    warnOnly: ${answers.warnOnly},`,
      '  },',
    );
  }
  if (body.length > 0) body.push('');
  body.push(
    '  // Options changed most often, with their default values:',
    `  // run: ${ts({ repeat: d.run.repeat, projects: d.run.projects, keepReporters: d.run.keepReporters })},`,
    `  // measure: ${ts({ exclude: d.measure.exclude })},`,
    `  // gate: ${ts({ warnOnly: d.gate.warnOnly, tolerance: d.gate.tolerance, maxFailedTestShare: d.gate.maxFailedTestShare })},`,
    `  // thresholds: ${ts({ dir: d.thresholds.dir })},`,
    `  // report: ${ts({ dir: d.report.dir })},`,
  );
  return [
    `// Configuration of ${PACKAGE_NAME}, written by "npx pw-perf init".`,
    '// Only the values that differ from the defaults are set. All options:',
    `// ${DOCS_CONFIG_URL}`,
    `import { definePerfConfig } from '${PACKAGE_NAME}';`,
    '',
    'export default definePerfConfig({',
    ...body,
    '});',
    '',
  ].join('\n');
}
