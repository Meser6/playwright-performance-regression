import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

// Dependency rules between modules (01, chapter 5; 01-REQ-25) for every module outside core.
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

  test('collector imports core/types, core/schema, core/config, mode, registry and Playwright types', async () => {
    for (const code of [
      "export type * from '../core/types/index.ts';\n",
      "export { parseSampleBatch } from '../core/schema/index.ts';\n",
      "export { perfDefaults } from '../core/config/index.ts';\n",
      "export { readModeState } from '../mode/index.ts';\n",
      "export { trackedContexts } from '../registry/index.ts';\n",
      "import type { BrowserContext } from '@playwright/test';\nexport type C = BrowserContext;\n",
    ]) {
      expect(await violations('src/collector', code), code).toEqual([]);
    }
    for (const code of [
      "import { test } from '@playwright/test';\nexport const a = test;\n",
      "export { buildKey } from '../core/normalize/index.ts';\n",
      "export { aggregate } from '../core/stats/index.ts';\n",
      "export { withPerf } from '../config/index.ts';\n",
      "export { writeJson } from '../io/json.ts';\n",
      "import { join } from 'node:path';\nexport const a = join;\n",
    ]) {
      expect(await violations('src/collector', code), code).toContain(RULE);
    }
  });

  test('only the ./test entry point imports @playwright/test at runtime (01-REQ-26)', async () => {
    const runtime = "import { test } from '@playwright/test';\nexport const a = test;\n";
    expect(await violations('src/entries', runtime)).toContain(RULE);
    const [result] = await eslint.lintText(runtime, {
      filePath: join(root, 'src/entries/test.ts'),
    });
    expect(result?.messages ?? []).toEqual([]);
    expect(
      await violations(
        'src/entries',
        "import type { TestType } from '@playwright/test';\nexport type T = TestType<object, object>;\n",
      ),
    ).toEqual([]);
  });
  test('reporter imports core, mode, registry, io, html, console and Playwright types', async () => {
    for (const code of [
      "export { evaluate } from '../core/evaluate/index.ts';\n",
      "export { readModeState } from '../mode/index.ts';\n",
      "export { getRegistered } from '../registry/index.ts';\n",
      "export { writeJsonStable } from '../io/index.ts';\n",
      "export { formatSummary } from '../console/summary.ts';\n",
      "export { renderHtmlReport } from '../html/index.ts';\n",
      "import type { Reporter } from '@playwright/test/reporter';\nexport type R = Reporter;\n",
    ]) {
      expect(await violations('src/reporter', code), code).toEqual([]);
    }
    for (const code of [
      "import { join } from 'node:path';\nexport const a = join;\n",
      "export { withPerf } from '../config/index.ts';\n",
      "export { withPerfFixtures } from '../collector/index.ts';\n",
      "import { test } from '@playwright/test';\nexport const a = test;\n",
    ]) {
      expect(await violations('src/reporter', code), code).toContain(RULE);
    }
  });

  test('io imports node:* and the pure core only', async () => {
    for (const code of [
      "import { join } from 'node:path';\nexport const a = join;\n",
      "export { parseThresholdsFile } from '../core/schema/index.ts';\n",
    ]) {
      expect(await violations('src/io', code), code).toEqual([]);
    }
    for (const code of [
      "export { getRegistered } from '../registry/index.ts';\n",
      "export { formatSummary } from '../console/summary.ts';\n",
      "import type { Reporter } from '@playwright/test/reporter';\nexport type R = Reporter;\n",
    ]) {
      expect(await violations('src/io', code), code).toContain(RULE);
    }
  });

  test('console and html import core/types only', async () => {
    for (const dir of ['src/console', 'src/html']) {
      expect(await violations(dir, "export type * from '../core/types/index.ts';\n")).toEqual([]);
      for (const code of [
        "export { evaluate } from '../core/evaluate/index.ts';\n",
        "import { join } from 'node:path';\nexport const a = join;\n",
        "export { writeJsonStable } from '../io/index.ts';\n",
      ]) {
        expect(await violations(dir, code), `${dir}: ${code}`).toContain(RULE);
      }
    }
  });

  test('cli imports core, mode, io, html, console and node:*, never Playwright', async () => {
    for (const code of [
      "export { buildOutcome } from '../core/evaluate/index.ts';\n",
      "export { writeModeState } from '../mode/index.ts';\n",
      "export { readTextFile } from '../io/index.ts';\n",
      "import { spawn } from 'node:child_process';\nexport const a = spawn;\n",
    ]) {
      expect(await violations('src/cli', code), code).toEqual([]);
    }
    for (const code of [
      "export { getRegistered } from '../registry/index.ts';\n",
      "import type { Reporter } from '@playwright/test/reporter';\nexport type R = Reporter;\n",
      "export { withPerf } from '../config/index.ts';\n",
    ]) {
      expect(await violations('src/cli', code), code).toContain(RULE);
    }
  });

  test('the init wizard imports what the CLI imports, from one directory deeper', async () => {
    for (const code of [
      "export { DEFAULT_CONFIG } from '../../core/config/index.ts';\n",
      "export { isEnvLabel } from '../../mode/index.ts';\n",
      "export { runTests } from '../run.ts';\n",
      "import { createInterface } from 'node:readline/promises';\nexport const a = createInterface;\n",
    ]) {
      expect(await violations('src/cli/init', code), code).toEqual([]);
    }
    for (const code of [
      "export { getRegistered } from '../../registry/index.ts';\n",
      "export { withPerf } from '../../config/index.ts';\n",
      "import { test } from '@playwright/test';\nexport const a = test;\n",
    ]) {
      expect(await violations('src/cli/init', code), code).toContain(RULE);
    }
  });

  test('01-AC-02 every module outside core has a dependency rule', async () => {
    for (const dir of [
      'src/mode',
      'src/registry',
      'src/config',
      'src/collector',
      'src/reporter',
      'src/io',
      'src/html',
      'src/console',
      'src/cli',
      'src/cli/init',
    ]) {
      expect(
        await violations(dir, "export { a } from '../unknown-module/index.ts';\n"),
        dir,
      ).toContain(RULE);
    }
  });
});
