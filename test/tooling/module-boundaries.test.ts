import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

// Dependency rules between modules (01, chapter 5; 01-REQ-25) for mode, registry and config.
const root = join(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: root });

async function violations(dir: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, dir, 'probe.ts') });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const RULE = '@typescript-eslint/no-restricted-imports';

describe('module import boundaries', () => {
  test('mode imports only core/types', async () => {
    expect(await violations('src/mode', "export type * from '../core/types/index.ts';\n")).toEqual(
      [],
    );
    for (const code of [
      "export { resolveConfig } from '../core/config/index.ts';\n",
      "export { getRegistered } from '../registry/index.ts';\n",
      "import { env } from 'node:process';\nexport const a = env;\n",
    ]) {
      expect(await violations('src/mode', code), code).toContain(RULE);
    }
  });

  test('registry imports core/types and mode, and core/config only as types', async () => {
    for (const code of [
      "export type * from '../core/types/index.ts';\n",
      "export { readModeState } from '../mode/index.ts';\n",
      "import type { ResolvedConfig } from '../core/config/index.ts';\nexport type R = ResolvedConfig;\n",
    ]) {
      expect(await violations('src/registry', code), code).toEqual([]);
    }
    for (const code of [
      "export { resolveConfig } from '../core/config/index.ts';\n",
      "export { withPerf } from '../config/index.ts';\n",
    ]) {
      expect(await violations('src/registry', code), code).toContain(RULE);
    }
  });

  test('config imports core, mode, registry and only the types of @playwright/test', async () => {
    for (const code of [
      "export { resolveConfig } from '../core/config/index.ts';\n",
      "export { readModeState } from '../mode/index.ts';\n",
      "export { setRegistered } from '../registry/index.ts';\n",
      "import type { PlaywrightTestConfig } from '@playwright/test';\nexport type C = PlaywrightTestConfig;\n",
    ]) {
      expect(await violations('src/config', code), code).toEqual([]);
    }
    for (const code of [
      "import { test } from '@playwright/test';\nexport const a = test;\n",
      "import { join } from 'node:path';\nexport const a = join;\n",
      "export { writeJson } from '../io/json.ts';\n",
    ]) {
      expect(await violations('src/config', code), code).toContain(RULE);
    }
  });
});
