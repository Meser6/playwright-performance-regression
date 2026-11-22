// The pw-perf.config.ts written by the init wizard (04-REQ-38 step 7, 04-REQ-46): the answers
// that differ from the defaults as active values, and every other option of the schema as a
// comment with its default value and a one-sentence description, in schema order. The option
// list is generated from the schema (generated/config-options.ts). The text is English and does
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
  /** Step 6: write the CI jobs. */
  addCi: boolean;
  /** Step 8: run a check (04-REQ-58). */
  runCheck: boolean;
}

/** The tag of step 2 written to run.grep (03-REQ-25). */
export const PERF_TAG = '@perf';

/** Width of the written lines. */
const WIDTH = 100;

/** Shown for options without a default value. */
const NO_DEFAULT: Record<string, string> = {
  'keys.keyBuilder': '({ method, url, resourceType }) => undefined',
};

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
      option.leaf && active
        ? ts(this.#active.get(option.path))
        : (NO_DEFAULT[option.path] ?? ts(option.default));
    const description =
      option.leaf && active
        ? `${option.description} Default: ${ts(option.default)}.`
        : option.description;
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
 * The "Most important settings" block at the top of the file (04-REQ-46, note #30): a short
 * paragraph per option with an example line. Every option named here exists in the schema (test).
 */
export const IMPORTANT_SETTINGS: readonly { option: string; text: string; example: string }[] = [
  {
    option: 'run.passes',
    text: 'How many times your test command runs in one measurement run. More passes give more samples per endpoint and steadier thresholds, but the run takes longer (tests x passes on 1 worker).',
    example: 'run: { passes: { test: 5, thresholds: 10 } },',
  },
  {
    option: 'run.grep',
    text: 'Measure only the tests whose title or tags match, e.g. tests tagged @perf. Setup and teardown projects still run in full.',
    example: "run: { grep: '@perf' },",
  },
  {
    option: 'thresholds.preset',
    text: "Headroom added to the measured times when thresholds are derived. 'strict' catches smaller regressions but alarms more often on a noisy environment, 'loose' only flags clear regressions.",
    example: "thresholds: { preset: 'normal' },",
  },
  {
    option: 'run.env',
    text: 'Environment label: each label has its own thresholds files (pw-perf-thresholds.<env>.json). Usually set per run with PW_PERF_ENV=staging instead; see docs/dynamic-environments.md.',
    example: "run: { env: 'staging' },",
  },
  {
    option: 'keys.origins',
    text: 'Short labels for backend hosts in endpoint keys; the baseURL host has no label. Host patterns with * merge random CI hosts, e.g. pr-123.ci.example.com.',
    example:
      "keys: { origins: { 'https://auth.example.com': 'auth', 'https://pr-*.ci.example.com': '' } },",
  },
  {
    option: 'measure.steps',
    text: 'The duration of your test.step blocks is measured too (on by default), with their own thresholds file (pw-perf-thresholds.steps.json). Step titles are sanitized: ids, e-mails, URLs and secrets do not reach the keys. Set false to measure only the backend requests.',
    example: 'measure: { steps: false },',
  },
  {
    option: 'gate.tolerance',
    text: 'How many endpoints may exceed their thresholds before the run fails (a number or a share like "5%"). Values far above a threshold (hardLimitFactor) fail the run anyway.',
    example: 'gate: { tolerance: 0 },',
  },
];

function importantSettings(): string[] {
  const lines = ['// Most important settings', '//'];
  IMPORTANT_SETTINGS.forEach((setting, i) => {
    if (i > 0) lines.push('//');
    const words = wrap(`${setting.option}: ${setting.text}`, WIDTH - 3);
    lines.push(...words.map((l) => `// ${l}`), `//   ${setting.example}`);
  });
  return lines;
}

/** Text of pw-perf.config.ts for the answers. */
export function renderPerfConfig(answers: InitAnswers): string {
  const renderer = new Renderer(activeValues(answers));
  const top: Place = { indent: '  ', commented: false, inner: '' };
  renderer.children('').forEach((section, i) => {
    if (i > 0) renderer.lines.push('');
    renderer.option(section, top);
  });
  return [
    `// Configuration of ${PACKAGE_NAME}, written by its guided setup.`,
    '// Only the values that differ from the defaults are set. Every other option is commented out',
    '// with its default value: uncomment a line (and its enclosing objects) to change it. Objects',
    '// are merged with the defaults; an array you set replaces the default array. All options:',
    `// ${DOCS_CONFIG_URL}`,
    '//',
    ...importantSettings(),
    `import { definePerfConfig } from '${PACKAGE_NAME}';`,
    '',
    'export default definePerfConfig({',
    ...renderer.lines,
    '});',
    '',
  ].join('\n');
}
