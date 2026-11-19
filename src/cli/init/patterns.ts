// Recognized file layouts of the init wizard (04-REQ-39, 04-D-17): each function returns the
// changed text, or null when the layout is not one it knows, so the caller prints a manual
// instruction instead. Pure.
import { PACKAGE_NAME } from '../../core/types/index.ts';
import { addImports, callParen, matchBracket, onlyTrailing, statementEnds } from './scan.ts';

/**
 * playwright.config wrapped in withPerf() (03, chapter 3.1): `export default defineConfig({...})`,
 * `export default {...}`, `module.exports = defineConfig({...})` or `module.exports = {...}` as
 * the last statement of the file. `perfImport` is the specifier of the package config file
 * without extension (e.g. "./pw-perf.config").
 */
export function wrapPlaywrightConfig(text: string, perfImport: string): string | null {
  const esm = [...text.matchAll(/^export\s+default\s+/gmu)];
  const cjs = [...text.matchAll(/^module\.exports\s*=\s*/gmu)];
  if (esm.length + cjs.length !== 1) return null;
  const isEsm = esm.length === 1;
  const match = (isEsm ? esm[0] : cjs[0]) as RegExpExecArray;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  let open: number;
  if (rest.startsWith('{')) open = start;
  else {
    const call = /^defineConfig\s*/u.exec(rest);
    if (call === null) return null;
    open = callParen(text, start + 'defineConfig'.length);
  }
  if (open === -1) return null;
  const end = matchBracket(text, open);
  if (end === -1 || !onlyTrailing(text, end)) return null;
  const value = text.slice(start, end);
  const perfConfig = isEsm ? 'perfConfig' : `require('${perfImport}').default`;
  const wrapped = `${text.slice(0, start)}withPerf(${value}, ${perfConfig})${text.slice(end)}`;
  return addImports(
    wrapped,
    isEsm
      ? [
          `import { withPerf } from '${PACKAGE_NAME}/config';`,
          `import perfConfig from '${perfImport}';`,
        ]
      : [`const { withPerf } = require('${PACKAGE_NAME}/config');`],
  );
}

/**
 * The project's test object wrapped in withPerfFixtures() (03, chapter 3.1):
 * `export const test = base.extend(...)` or `exports.test = base.test.extend(...)`, when it is the
 * only `.extend(` call of the file and the statement ends after it.
 */
export function wrapTestObject(text: string): string | null {
  const esm = /^export\s+const\s+test\s*=\s*([\w$.]+)\.extend\b/mu.exec(text);
  const cjs = /^(?:module\.)?exports\.test\s*=\s*([\w$.]+)\.extend\b/mu.exec(text);
  const match = esm ?? cjs;
  if (match === null || (esm !== null && cjs !== null)) return null;
  const exprStart = match.index + match[0].length - (match[1] as string).length - '.extend'.length;
  const open = callParen(text, match.index + match[0].length);
  if (open === -1) return null;
  const end = matchBracket(text, open);
  if (end === -1 || !statementEnds(text, end)) return null;
  const wrapped = `${text.slice(0, exprStart)}withPerfFixtures(${text.slice(exprStart, end)})${text.slice(end)}`;
  return addImports(wrapped, [
    esm !== null
      ? `import { withPerfFixtures } from '${PACKAGE_NAME}/fixture';`
      : `const { withPerfFixtures } = require('${PACKAGE_NAME}/fixture');`,
  ]);
}

interface Specifier {
  text: string;
  name: string;
  alias: string | null;
  type: boolean;
}

function specifiers(list: string, separator: 'as' | ':'): Specifier[] | null {
  const result: Specifier[] = [];
  for (const raw of list.split(',')) {
    const text = raw.trim();
    if (text === '') continue;
    const pattern =
      separator === 'as'
        ? /^(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/u
        : /^()([\w$]+)(?:\s*:\s*([\w$]+))?$/u;
    const m = pattern.exec(text);
    if (m === null) return null;
    result.push({
      text,
      name: m[2] as string,
      alias: m[3] ?? null,
      type: m[1] !== undefined && m[1] !== '',
    });
  }
  return result;
}

const SWAPPED = new Set(['test', 'expect']);

/**
 * Imports of `test` from @playwright/test replaced with the package's ready `test` (03, chapter
 * 3.2; D-14). Other names stay in an import from @playwright/test. Returns null when the file
 * has nothing to swap: no unaliased `test` import (`test as setup` stays as it is).
 */
export function swapTestImport(text: string): string | null {
  let changed = false;
  const esm = text.replace(
    /^import\s*\{([^}]*)\}\s*from\s*(['"])@playwright\/test\2(\s*;)?/gmu,
    (whole, list: string, quote: string, semi: string | undefined) => {
      const specs = specifiers(list, 'as');
      if (specs === null || !specs.some((s) => s.name === 'test' && s.alias === null && !s.type)) {
        return whole;
      }
      const swap = specs.filter((s) => SWAPPED.has(s.name) && s.alias === null && !s.type);
      const keep = specs.filter((s) => !swap.includes(s));
      changed = true;
      const end = semi === undefined ? '' : ';';
      const lines = [
        `import { ${swap.map((s) => s.text).join(', ')} } from ${quote}${PACKAGE_NAME}/test${quote}${end}`,
      ];
      if (keep.length > 0) {
        lines.push(
          `import { ${keep.map((s) => s.text).join(', ')} } from ${quote}@playwright/test${quote}${end}`,
        );
      }
      return lines.join('\n');
    },
  );
  const cjs = esm.replace(
    /^(const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])@playwright\/test\3\s*\)(\s*;)?/gmu,
    (whole, kind: string, list: string, quote: string, semi: string | undefined) => {
      const specs = specifiers(list, ':');
      if (specs === null || !specs.some((s) => s.name === 'test' && s.alias === null)) return whole;
      const swap = specs.filter((s) => SWAPPED.has(s.name) && s.alias === null);
      const keep = specs.filter((s) => !swap.includes(s));
      changed = true;
      const end = semi === undefined ? '' : ';';
      const lines = [
        `${kind} { ${swap.map((s) => s.text).join(', ')} } = require(${quote}${PACKAGE_NAME}/test${quote})${end}`,
      ];
      if (keep.length > 0) {
        lines.push(
          `${kind} { ${keep.map((s) => s.text).join(', ')} } = require(${quote}@playwright/test${quote})${end}`,
        );
      }
      return lines.join('\n');
    },
  );
  return changed ? cjs : null;
}

/** Whether .gitignore already ignores `dir`. */
export function ignores(gitignore: string, dir: string): boolean {
  return gitignore
    .split(/\r?\n/u)
    .some((line) => line.trim().replace(/^\//u, '').replace(/\/$/u, '') === dir);
}

/** .gitignore with `dir/` appended. */
export function addIgnore(gitignore: string | null, dir: string): string {
  if (gitignore === null || gitignore === '') return `${dir}/\n`;
  const nl = gitignore.includes('\r\n') ? '\r\n' : '\n';
  return `${gitignore}${gitignore.endsWith('\n') ? '' : nl}${dir}/${nl}`;
}

/** package.json with the scripts added; null when the file is not a JSON object. */
export function addScripts(text: string, scripts: Readonly<Record<string, string>>): string | null {
  let pkg: unknown;
  try {
    pkg = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) return null;
  const obj = pkg as Record<string, unknown>;
  const current = obj['scripts'];
  if (
    current !== undefined &&
    (typeof current !== 'object' || current === null || Array.isArray(current))
  ) {
    return null;
  }
  obj['scripts'] = { ...(current as Record<string, unknown> | undefined), ...scripts };
  const indent = /^[ \t]+(?=")/mu.exec(text)?.[0] ?? '  ';
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const json = JSON.stringify(obj, null, indent).replaceAll('\n', nl);
  return /\r?\n$/u.test(text) ? `${json}${nl}` : json;
}
