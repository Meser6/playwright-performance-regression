// The pw-perf.config.ts written by the init wizard (04-REQ-38 step 9, 04-REQ-46): the answers
// that differ from the defaults as active values, and every other option of the schema as a
// comment with its default value and a one-sentence description, in schema order. The option
// list is generated from the schema (generated/config-options.ts). The text is English and does
// not depend on the wizard language (04-REQ-43). Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import { DOCS_CONFIG_URL, PACKAGE_NAME } from '../../core/types/index.ts';
import { CONFIG_OPTIONS } from './generated/config-options.ts';
import type { TemplateOption } from './generated/config-options.ts';

export interface InitAnswers {
  scope: 'all' | 'tagged';
  repeatTest: number;
  warnOnly: boolean;
  /** measure.steps (04-REQ-47). */
  steps: boolean;
  envLabels: string[];
  addCi: boolean;
}

/** Width of the written lines. */
const WIDTH = 100;

/** Shown for options without a default value. */
const NO_DEFAULT: Record<string, string> = {
  'keys.keyBuilder': '({ method, url, resourceType }) => undefined',
};

/** Package config values of the answers that differ from the defaults: option path → value. */
export function activeValues(answers: InitAnswers): Map<string, unknown> {
  const values = new Map<string, unknown>();
  if (answers.repeatTest !== DEFAULT_CONFIG.run.repeat.test)
    values.set('run.repeat.test', answers.repeatTest);
  if (answers.warnOnly !== DEFAULT_CONFIG.gate.warnOnly)
    values.set('gate.warnOnly', answers.warnOnly);
  if (answers.steps) values.set('measure.steps', true);
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

/** Text of pw-perf.config.ts for the answers. */
export function renderPerfConfig(answers: InitAnswers): string {
  const renderer = new Renderer(activeValues(answers));
  const top: Place = { indent: '  ', commented: false, inner: '' };
  renderer.children('').forEach((section, i) => {
    if (i > 0) renderer.lines.push('');
    renderer.option(section, top);
  });
  return [
    `// Configuration of ${PACKAGE_NAME}, written by "npx pw-perf init".`,
    '// Only the values that differ from the defaults are set. Every other option is commented out',
    '// with its default value: uncomment a line (and its enclosing objects) to change it. Objects',
    '// are merged with the defaults; an array you set replaces the default array. All options:',
    `// ${DOCS_CONFIG_URL}`,
    `import { definePerfConfig } from '${PACKAGE_NAME}';`,
    '',
    'export default definePerfConfig({',
    ...renderer.lines,
    '});',
    '',
  ].join('\n');
}
