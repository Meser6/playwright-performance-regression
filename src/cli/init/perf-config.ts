// The package config file written by the init wizard (04-REQ-38 step 8, 04-REQ-46, v4 D6): the
// most important options only (CONFIG_FILE_OPTIONS), in schema order with a short comment each;
// the answers that differ from the defaults as active values, the other options commented out
// with their default value, and a link to the full option list in the docs. Defaults and order
// come from the schema (generated/config-options.ts). The text is English and does
// not depend on the wizard language (04-REQ-43). Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import type { MarginPreset } from '../../core/config/index.ts';
import { DOCS_CONFIG_URL, PACKAGE_NAME } from '../../core/types/index.ts';
import { CONFIG_OPTIONS } from './generated/config-options.ts';
import type { TemplateOption } from './generated/config-options.ts';

/** Answer of step 4 (04-REQ-47): what to measure. */
export type MeasureAnswer = 'all' | 'api' | 'steps';

export interface InitAnswers {
  /** Step 2: 'tagged' → run.grep '@perf' (03-REQ-25). */
  scope: 'all' | 'tagged';
  /** Step 3: run.passes.test (D-39). */
  passesTest: number;
  /** Step 4: 'api' → measure.steps false, 'steps' → measure.api false (04-REQ-47). */
  measure: MeasureAnswer;
  /** Step 5: thresholds.preset (D-41). */
  preset: MarginPreset;
  /** Step 6: the test command C as typed, by default the package manager's (04-REQ-55). */
  command: string;
  /** Step 7: write the CI jobs. */
  addCi: boolean;
  /** Step 6: false after 'skip' and without a terminal; step 9 asks before the check (04-REQ-58). */
  runCheck: boolean;
}

/** The tag of step 2 written to run.grep (03-REQ-25). */
export const PERF_TAG = '@perf';

/** Width of the written lines. */
const WIDTH = 100;

/** Package config values of the answers that differ from the defaults: option path → value. */
export function activeValues(answers: InitAnswers): Map<string, unknown> {
  const values = new Map<string, unknown>();
  if (answers.passesTest !== DEFAULT_CONFIG.run.passes.test)
    values.set('run.passes.test', answers.passesTest);
  if (answers.scope === 'tagged') values.set('run.grep', PERF_TAG);
  // Only the kind turned off differs from the defaults (both on, 03-REQ-28).
  if (answers.measure === 'steps') values.set('measure.api', false);
  if (answers.measure === 'api') values.set('measure.steps', false);
  if (answers.preset !== DEFAULT_CONFIG.thresholds.preset)
    values.set('thresholds.preset', answers.preset);
  return values;
}

/** A value as TypeScript source with single quotes, on one line. */
export function ts(value: unknown): string {
  if (typeof value === 'string')
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(ts).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(
      ([k, v]) => `${/^[A-Za-z_$][\w$]*$/u.test(k) ? k : ts(k)}: ${ts(v)}`,
    );
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  return String(value);
}

/** Words of `text` in lines of at most `width` characters (a longer word gets its own line). */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line === '' ? word : `${line} ${word}`;
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Where lines go: spaces before the code, and once commented out, "// " and inner spaces. */
interface Place {
  indent: string;
  commented: boolean;
  inner: string;
}

const nested = (place: Place): Place =>
  place.commented
    ? { ...place, inner: `${place.inner}  ` }
    : { ...place, indent: `${place.indent}  ` };

const lineAt = (place: Place, text: string): string =>
  place.commented ? `${place.indent}// ${place.inner}${text}`.trimEnd() : `${place.indent}${text}`;

const prefixLength = (place: Place): number =>
  place.indent.length + (place.commented ? 3 + place.inner.length : 0);

class Renderer {
  readonly lines: string[] = [];
  readonly #children = new Map<string, TemplateOption[]>();
  readonly #active: Map<string, unknown>;

  constructor(active: Map<string, unknown>) {
    this.#active = active;
    for (const option of CONFIG_OPTIONS) {
      if (!inFile(option.path)) continue;
      const parent = option.path.split('.').slice(0, -1).join('.');
      this.#children.set(parent, [...(this.#children.get(parent) ?? []), option]);
    }
  }

  children(path: string): readonly TemplateOption[] {
    return this.#children.get(path) ?? [];
  }

  #isActive(path: string): boolean {
    for (const key of this.#active.keys())
      if (key === path || key.startsWith(`${path}.`)) return true;
    return false;
  }

  option(option: TemplateOption, outer: Place): void {
    const active = this.#isActive(option.path);
    const place: Place = outer.commented || active ? outer : { ...outer, commented: true };
    const name = option.path.split('.').at(-1) as string;
    const valueText =
      option.leaf && active ? ts(this.#active.get(option.path)) : ts(option.default);
    const text = FILE_TEXTS.get(option.path) ?? option.description;
    const description = option.leaf && active ? `${text} Default: ${ts(option.default)}.` : text;
    // The description stays a plain comment where the option itself is commented out first.
    for (const l of wrap(description, WIDTH - prefixLength(outer) - 3))
      this.lines.push(lineAt(outer, `// ${l}`));
    if (!option.leaf) {
      this.lines.push(lineAt(place, `${name}: {`));
      for (const child of this.children(option.path)) this.option(child, nested(place));
      this.lines.push(lineAt(place, '},'));
      return;
    }
    const single = `${name}: ${valueText},`;
    if (prefixLength(place) + single.length <= WIDTH || !Array.isArray(option.default)) {
      this.lines.push(lineAt(place, single));
      return;
    }
    // A long list: its items in lines.
    const inside = nested(place);
    this.lines.push(lineAt(place, `${name}: [`));
    for (const l of wrap(
      (option.default as unknown[]).map((item) => `${ts(item)},`).join(' '),
      WIDTH - prefixLength(inside),
    ))
      this.lines.push(lineAt(inside, l));
    this.lines.push(lineAt(place, '],'));
  }
}

/**
 * The options of the written file (04-REQ-46, v4 D6): the most important ones, in schema order,
 * each with a short English comment. Every value the wizard answers set is among them (test);
 * the full list is in the docs (DOCS_CONFIG_URL).
 */
export const CONFIG_FILE_OPTIONS: readonly { option: string; text: string }[] = [
  {
    option: 'run.env',
    text: 'Environment label: each label has its own thresholds files (pw-perf-thresholds.<env>.json). Usually set per run with PW_PERF_ENV=staging instead; see docs/dynamic-environments.md.',
  },
  {
    option: 'run.passes.test',
    text: 'How many times your test command runs in a measurement run (PW_PERF_MODE=test). More passes give more samples per endpoint and steadier results, but the run takes longer (tests x passes on 1 worker).',
  },
  {
    option: 'run.passes.thresholds',
    text: 'Passes in a thresholds run (PW_PERF_MODE=thresholds): more passes give steadier thresholds.',
  },
  {
    option: 'run.grep',
    text: "Measure only the tests whose title or tags match this regular expression, e.g. '@perf'. Setup and teardown projects still run in full.",
  },
  {
    option: 'run.overrideSlowMo',
    text: 'true: slowMo is set to 0 in every measured project in perf mode, because it delays every browser action and distorts the times. false: slowMo stays and perf mode warns about it.',
  },
  {
    option: 'measure.api',
    text: 'The backend requests the browser makes and the calls of the request fixture (keys like "request GET /api/x") are measured as endpoint keys. Set false to measure only test.step durations (api and steps cannot both be off).',
  },
  {
    option: 'measure.include',
    text: "When not empty, only requests whose URL matches at least one pattern are measured. A string matches as a substring of the URL; { regex: '...' } is a regular expression.",
  },
  {
    option: 'measure.exclude',
    text: 'Requests whose URL matches any pattern (same forms as include) are not measured. Applied after include.',
  },
  {
    option: 'measure.steps',
    text: 'The durations of your test.step blocks are measured too, with their own thresholds file (pw-perf-thresholds.steps.json). Step titles are sanitized: ids, e-mails, URLs and secrets do not reach the keys. Set false to measure only the backend requests.',
  },
  {
    option: 'keys.origins',
    text: "Short labels for backend hosts in endpoint keys; the baseURL host has no label. Host patterns with * merge random CI hosts, e.g. { 'https://auth.example.com': 'auth', 'https://pr-*.ci.example.com': '' }.",
  },
  {
    option: 'gate.tolerance',
    text: "How many endpoints may exceed their thresholds before the run fails: a number, or a share of the measured keys like '5%'. 0: every violation fails the run.",
  },
  {
    option: 'gate.hardLimitFactor',
    text: 'A time above threshold x this factor fails the run regardless of tolerance. null turns hard limits off.',
  },
  {
    option: 'thresholds.preset',
    text: "Headroom added to the measured times when thresholds are derived. 'strict' catches smaller regressions but alarms more often on a noisy environment, 'loose' only flags clear regressions.",
  },
  {
    option: 'thresholds.dir',
    text: 'Directory of the thresholds files (commit them), relative to the Playwright config directory.',
  },
  {
    option: 'report.dir',
    text: 'Directory of report.json and report.html (do not commit it), relative to the Playwright config directory.',
  },
];

const FILE_TEXTS = new Map(CONFIG_FILE_OPTIONS.map((o) => [o.option, o.text]));

/** Whether the option or one of its children is written to the file. */
function inFile(path: string): boolean {
  for (const option of FILE_TEXTS.keys())
    if (option === path || option.startsWith(`${path}.`)) return true;
  return false;
}

/**
 * Form of the package config file (04-REQ-46, 04-D-48): TypeScript, or JavaScript as an ES module
 * or CommonJS like playwright.config.
 */
export type PerfConfigFormat = 'ts' | 'esm' | 'cjs';

/** Text of the package config file for the answers (pw-perf.config.ts by default). */
export function renderPerfConfig(answers: InitAnswers, format: PerfConfigFormat = 'ts'): string {
  const renderer = new Renderer(activeValues(answers));
  const top: Place = { indent: '  ', commented: false, inner: '' };
  renderer.children('').forEach((section, i) => {
    if (i > 0) renderer.lines.push('');
    renderer.option(section, top);
  });
  return [
    ...(format === 'ts' ? [] : ['// @ts-check']),
    `// Configuration of ${PACKAGE_NAME}, written by its guided setup.`,
    '// It lists the most important options only; every option, with its default, is described at',
    `// ${DOCS_CONFIG_URL}`,
    '// Only the values that differ from the defaults are set. The other options are commented out',
    '// with their default value: uncomment a line (and its enclosing objects) to change it. Objects',
    '// are merged with the defaults; an array you set replaces the default array.',
    format === 'cjs'
      ? `const { definePerfConfig } = require('${PACKAGE_NAME}');`
      : `import { definePerfConfig } from '${PACKAGE_NAME}';`,
    '',
    format === 'cjs' ? 'module.exports = definePerfConfig({' : 'export default definePerfConfig({',
    ...renderer.lines,
    '});',
    '',
  ].join('\n');
}
