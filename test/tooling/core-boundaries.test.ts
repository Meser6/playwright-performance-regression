import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

// The ESLint rule that keeps src/core free of Node built-ins and Playwright (01-REQ-02,
// ADR-0005). Linting a virtual file under src/core proves the rule is active in CI.
const root = join(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: root });

async function coreViolations(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, 'src/core/probe.ts') });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

describe('core import boundaries', () => {
  test('01-AC-01 core may not import @playwright/test or node:* modules', async () => {
    for (const code of [
      "import { test } from '@playwright/test';\nexport const a = test;\n",
      "import type { Page } from '@playwright/test';\nexport type P = Page;\n",
      "import { readFileSync } from 'node:fs';\nexport const a = readFileSync;\n",
      "import path from 'path';\nexport const a = path;\n",
      "export { a } from 'node:crypto';\n",
    ]) {
      expect(await coreViolations(code), code).toContain('no-restricted-imports');
    }
  });

  test('01-AC-01 core may not use process, console, Date.now or Math.random', async () => {
    expect(await coreViolations('export const a = process.env;\n')).toContain(
      'no-restricted-globals',
    );
    expect(await coreViolations("console.log('x');\n")).toContain('no-restricted-globals');
    expect(await coreViolations('export const a = Date.now();\n')).toContain(
      'no-restricted-properties',
    );
    expect(await coreViolations('export const a = Math.random();\n')).toContain(
      'no-restricted-properties',
    );
  });

  test('01-AC-01 core may import other core modules', async () => {
    expect(await coreViolations("export type * from './types/index.ts';\n")).toEqual([]);
  });
});
