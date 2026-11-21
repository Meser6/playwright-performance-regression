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
