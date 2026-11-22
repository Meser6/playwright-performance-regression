// Recognized file layouts of the init wizard (04-REQ-39, 04-D-17): each function returns the
// changed text, or null when the layout is not one it knows, so the caller prints a manual
// instruction instead. Pure.
import { PACKAGE_NAME } from '../../core/types/index.ts';
import { addImports, callParen, matchBracket, onlyTrailing, statementEnds } from './scan.ts';

/** How playwright.config refers to the package config file (04-REQ-46, 04-D-48). */
export interface PerfConfigRef {
  /** Specifier of `import perfConfig from '…'`, e.g. "./pw-perf.config". */
  import: string;
  /** Expression in a CommonJS config, e.g. "require('./pw-perf.config').default". */
  require: string;
}

/** The reference to a package config file by its name and, for `.js`, its text (04-REQ-46). */
export function perfConfigRef(file: string, text: string | null): PerfConfigRef {
  if (/\.[cm]?ts$/u.test(file)) {
    const base = `./${file.replace(/\.[cm]?ts$/u, '')}`;
    return { import: base, require: `require('${base}').default` };
  }
  const cjs =
    file.endsWith('.cjs') || (file.endsWith('.js') && /\bmodule\.exports\b/u.test(text ?? ''));
  const path = `./${file}`;
  if (!cjs) return { import: path, require: `require('${path}').default` };
  return { import: path, require: `require('${file.endsWith('.js') ? path.slice(0, -3) : path}')` };
}

/**
 * playwright.config wrapped in withPerf() (03, chapter 3.1): `export default defineConfig({...})`,
 * `export default {...}`, `module.exports = defineConfig({...})` or `module.exports = {...}` as
 * the last statement of the file. `perf` refers to the package config file: the specifier of an
 * ES module import and the expression of a CommonJS config (04-REQ-46).
 */
export function wrapPlaywrightConfig(text: string, perf: PerfConfigRef): string | null {
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
  const perfConfig = isEsm ? 'perfConfig' : perf.require;
  const wrapped = `${text.slice(0, start)}withPerf(${value}, ${perfConfig})${text.slice(end)}`;
  return addImports(
    wrapped,
    isEsm
      ? [
          `import { withPerf } from '${PACKAGE_NAME}/config';`,
          `import perfConfig from '${perf.import}';`,
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

// Trailing globs that match everything inside a folder: "/*", "/**" and "/**" + "/*".
const FOLDER_GLOB = /\/(?:\*\*\/\*|\*\*|\*)$/u;

/**
 * Whether .gitignore already ignores `dir` or a folder that contains it (D-47, 04-AC-55), also
 * with a trailing glob (reports/ followed by * or **), unless a `!` line re-includes something
 * under it.
 */
export function ignores(gitignore: string, dir: string): boolean {
  const lines = gitignore.split(/\r?\n/u).map((line) => line.trim());
  const negated = lines
    .filter((line) => line.startsWith('!'))
    .map((line) => line.slice(1).replace(/^\//u, ''));
  return lines.some((line) => {
    if (line === '' || line.startsWith('#') || line.startsWith('!')) return false;
    const path = line.replace(/^\//u, '');
    const glob = FOLDER_GLOB.test(path);
    const entry = path.replace(FOLDER_GLOB, '').replace(/\/$/u, '');
    if (entry === '' || !(entry === dir || dir.startsWith(`${entry}/`))) return false;
    // Git cannot re-include a file under an excluded folder, but it can under a glob.
    return !glob || !negated.some((n) => n === entry || n.startsWith(`${entry}/`));
  });
}

/** .gitignore with `dir/` appended. */
export function addIgnore(gitignore: string | null, dir: string): string {
  if (gitignore === null || gitignore === '') return `${dir}/\n`;
  const nl = gitignore.includes('\r\n') ? '\r\n' : '\n';
  return `${gitignore}${gitignore.endsWith('\n') ? '' : nl}${dir}/${nl}`;
}
