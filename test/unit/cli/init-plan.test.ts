// Init wizard, pure parts (04, chapter 4.10): detection, change plan with golden diffs (12,
// chapter 8: test/golden/init/), recognized layouts and the CI templates (13-AC-11).
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import typescript from 'typescript';
import { describe, expect, test } from 'vitest';
import {
  CI_COMMAND,
  CI_PATHS,
  ciFile,
  groovySingleQuoted,
  yamlScalar,
} from '../../../src/cli/init/ci.ts';
import { detectProject } from '../../../src/cli/init/detect.ts';
import { CI_TEMPLATES } from '../../../src/cli/init/generated/ci-templates.ts';
import { defaultAnswers, planInitChanges, unifiedDiff } from '../../../src/cli/init/index.ts';
import type { InitAnswers, InitPlan } from '../../../src/cli/init/index.ts';
import {
  addIgnore,
  ignores,
  perfConfigRef,
  swapTestImport,
  wrapPlaywrightConfig,
  wrapTestObject,
} from '../../../src/cli/init/patterns.ts';
import { CONFIG_OPTIONS } from '../../../src/cli/init/generated/config-options.ts';
import { LANGUAGES, MESSAGES } from '../../../src/cli/init/messages.ts';
import type { WizardLanguage } from '../../../src/cli/init/messages.ts';
import {
  activeValues,
  CONFIG_FILE_OPTIONS,
  renderPerfConfig,
  ts,
} from '../../../src/cli/init/perf-config.ts';
import { DEFAULT_CONFIG, resolveConfig } from '../../../src/core/config/index.ts';
import { addImports, matchBracket } from '../../../src/cli/init/scan.ts';
import { detectDir, INIT_GOLDEN, planDiff, PROJECTS } from './init-helpers.ts';

const TS_REF = perfConfigRef('pw-perf.config.ts', null);
const update = process.env['GOLDEN_UPDATE'] === '1';
const ROOT = join(import.meta.dirname, '../../..');

interface InitGolden {
  name: string;
  input: { project: string; answers: InitAnswers | null };
  expected: {
    manualSteps: { code: string; message: string }[];
    testObject: { extendFiles: string[]; importingFiles: number } | null;
    importSwap?: string[];
  };
}

const goldenFiles = readdirSync(INIT_GOLDEN)
  .filter((f) => f.endsWith('.json'))
  .sort();

function readGolden(file: string): InitGolden {
  return JSON.parse(readFileSync(join(INIT_GOLDEN, file), 'utf8')) as InitGolden;
}

function files(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

const ANSWERS: InitAnswers = {
  scope: 'all',
  passesTest: 5,
  measure: 'all',
  preset: 'normal',
  command: 'npx playwright test',
  addCi: false,
  runCheck: false,
};

/** Lines of the config that are code, not comments or blank lines. */
const activeLines = (config: string): string[] =>
  config.split('\n').filter((l) => !/^\s*(\/\/|$)/u.test(l));

describe('detectProject', () => {
  test('reads the project as text: config, version, package manager, module type, tests, CI', async () => {
    const info = await detectDir(join(PROJECTS, 'init-esm-ts'));
    expect(info.playwrightConfig?.path).toBe('playwright.config.ts');
    expect(info.playwrightVersion).toBe('1.57.0');
    expect(info.packageManager).toBe('npm');
    expect(info.moduleType).toBe('esm');
    expect(info.testDir).toBe('tests');
    expect(info.filesImportingPlaywrightTest).toEqual(['tests/fixtures.ts']);
    expect(info.filesWithExtend).toEqual(['tests/fixtures.ts']);
    expect(info.taggedPerfTestFiles).toBe(0);
    expect(info.ciPlatform).toBe('github');
    expect(info.existing).toEqual({
      perfConfig: null,
      wrappedConfig: false,
      wrappedTest: false,
      scripts: ['typecheck'],
    });

    const cjs = await detectDir(join(PROJECTS, 'init-cjs-js'));
    expect([cjs.packageManager, cjs.moduleType, cjs.ciPlatform]).toEqual(['pnpm', 'cjs', 'gitlab']);
    const swap = await detectDir(join(PROJECTS, 'init-import-swap'));
    expect([swap.packageManager, swap.ciPlatform, swap.taggedPerfTestFiles]).toEqual([
      'npm',
      'azure',
      1,
    ]);
    expect(swap.filesImportingPlaywrightTest).toEqual([
      'tests/auth.setup.ts',
      'tests/home.spec.ts',
      'tests/shop.spec.ts',
    ]);
    const existing = await detectDir(join(PROJECTS, 'init-existing-project'));
    expect(existing.ciPlatform).toBe('jenkins');
    expect(existing.filesWithExtend).toEqual(['tests/a11y.ts', 'tests/fixtures.ts']);
  });

  test('installed Playwright wins over the dependency range; yarn and packageManager; .mjs is ESM', () => {
    const info = detectProject(
      files({
        'package.json':
          '{"packageManager":"yarn@4.1.0","devDependencies":{"@playwright/test":"^1.50.0"}}',
        'node_modules/@playwright/test/package.json': '{"version":"1.58.2"}',
        'playwright.config.mjs': "export default { testDir: './e2e/' };",
        'pw-perf.config.json': '{}',
      }),
    );
    expect(info.playwrightVersion).toBe('1.58.2');
    expect(info.packageManager).toBe('yarn');
    expect(info.moduleType).toBe('esm');
    expect(info.testDir).toBe('e2e');
    expect(info.existing.perfConfig).toBe('pw-perf.config.json');
    expect(detectProject(files({ 'yarn.lock': '', 'package.json': '{}' })).packageManager).toBe(
      'yarn',
    );
    expect(detectProject(files({})).playwrightConfig).toBeNull();
  });

  test('expect.extend() is not a test object; withPerf and withPerfFixtures are detected', () => {
    const info = detectProject(
      files({
        'playwright.config.ts': 'export default withPerf(defineConfig({}), perfConfig);',
        'tests/matchers.ts': "import { expect } from '@playwright/test';\nexpect.extend({});",
        'tests/a.spec.ts': "import { test } from 'playwright-performance-regression/test';",
      }),
    );
    expect(info.filesWithExtend).toEqual([]);
    expect(info.existing.wrappedConfig).toBe(true);
    expect(info.existing.wrappedTest).toBe(true);
  });
});

describe('planInitChanges golden diffs (test/golden/init)', () => {
  for (const file of goldenFiles) {
    test(`04-AC-17 04-AC-18 04-AC-20 golden ${file}`, async () => {
      const golden = readGolden(file);
      const info = await detectDir(join(PROJECTS, golden.input.project));
      const plan = planInitChanges(info, golden.input.answers ?? defaultAnswers(info));
      const diff = planDiff(plan);
      const manualSteps = plan.manualSteps.map(({ code, message }) => ({ code, message }));
      const testObject = plan.testObject;
      const importSwap = plan.importSwap?.paths;
      const diffFile = join(INIT_GOLDEN, file.replace(/\.json$/u, '.diff'));
      if (update) {
        writeFileSync(diffFile, diff);
        writeFileSync(
          join(INIT_GOLDEN, file),
          `${JSON.stringify({ ...golden, expected: { manualSteps, testObject, importSwap } }, null, 2)}\n`,
        );
        return;
      }
      expect(diff).toBe(readFileSync(diffFile, 'utf8'));
      expect(manualSteps).toEqual(golden.expected.manualSteps);
      expect(testObject).toEqual(golden.expected.testObject);
      expect(importSwap).toEqual(golden.expected.importSwap);
    });
  }

  test('04-AC-18 a config wrapper and several test objects are not changed and give INIT_MANUAL_STEP', async () => {
    const info = await detectDir(join(PROJECTS, 'init-existing-project'));
    const plan = planInitChanges(info, defaultAnswers(info));
    const paths = plan.changes.map((c) => c.path);
    expect(paths).not.toContain('playwright.config.ts');
    expect(paths).not.toContain('tests/fixtures.ts');
    expect(paths).not.toContain('tests/a11y.ts');
    const messages = plan.manualSteps.map((s) => `${s.code} ${s.message}`);
    expect(messages.some((m) => m.startsWith('INIT_MANUAL_STEP playwright.config.ts'))).toBe(true);
    // Several test objects: the red box instead of a change (04-REQ-67).
    expect(plan.testObject).toEqual({
      // 04-D-49: the module the tests import first.
      extendFiles: ['tests/fixtures.ts', 'tests/a11y.ts'],
      importedBy: { 'tests/a11y.ts': 0, 'tests/fixtures.ts': 1 },
      workspace: {},
      importingFiles: 0,
      stepsMeasured: false,
    });
    // The instruction of 03, chapter 3.4 (other config wrapper).
    const hints = plan.manualSteps.map((s) => s.hint).join('\n');
    expect(hints).toContain('withPerf(otherWrapper(defineConfig({ ... })), perfConfig)');
  });

  test('04-AC-32 @perf becomes run.grep, package.json is never changed, no environments', () => {
    const pkg = `${JSON.stringify({ scripts: { e2e: 'playwright test' } }, null, 2)}\n`;
    const info = detectProject(
      files({
        'package.json': pkg,
        'playwright.config.ts': 'export default defineConfig({});\n',
        'tests/a.spec.ts': "import { test } from '@playwright/test';\ntest('a @perf', () => {});\n",
      }),
    );
    const plan = planInitChanges(info, { ...ANSWERS, scope: 'tagged' });
    expect(plan.changes.map((c) => c.path)).not.toContain('package.json');
    const config = plan.changes.find((c) => c.path === 'pw-perf.config.ts')?.after ?? '';
    expect(activeLines(config)).toEqual([
      "import { definePerfConfig } from 'playwright-performance-regression';",
      'export default definePerfConfig({',
      '  run: {',
      "    grep: '@perf',",
      '  },',
      '});',
    ]);
    // run.env stays the default: only a commented line.
    expect(config).toMatch(/^ {4}\/\/ env: null,$/mu);
  });

  test('04-AC-48 the preset becomes active code only when it differs', () => {
    const config = renderPerfConfig({ ...ANSWERS, preset: 'loose' });
    expect(activeLines(config)).toEqual([
      "import { definePerfConfig } from 'playwright-performance-regression';",
      'export default definePerfConfig({',
      '  thresholds: {',
      "    preset: 'loose',",
      '  },',
      '});',
    ]);
    expect(config).toMatch(/Default: 'normal'\.\n {4}preset: 'loose',/u);
    expect(activeLines(renderPerfConfig({ ...ANSWERS, preset: 'normal' }))).toHaveLength(3);
  });

  test('04-AC-48 04-REQ-46 the file lists at most 15 important options and links the full list', () => {
    const config = renderPerfConfig(ANSWERS);
    const head = config.slice(0, config.indexOf('import { definePerfConfig }'));
    expect(head).toContain('https://github.com/');
    expect(head).toContain('/docs/configuration.md\n');
    expect(head).not.toContain('Most important settings');
    const leaves = new Set(CONFIG_OPTIONS.filter((o) => o.leaf).map((o) => o.path));
    const listed = CONFIG_FILE_OPTIONS.map((o) => o.option);
    expect(listed.length).toBeLessThanOrEqual(15);
    for (const option of listed) expect(leaves, option).toContain(option);
    // In schema order.
    const order = CONFIG_OPTIONS.map((o) => o.path);
    expect([...listed].sort((x, y) => order.indexOf(x) - order.indexOf(y))).toEqual(listed);
    for (const option of ['measure.api', 'measure.steps', 'run.overrideSlowMo', 'keys.origins'])
      expect(listed).toContain(option);
    // Every value the answers can set is among them (04-REQ-38 steps 2-5).
    const answers: InitAnswers[] = [
      { ...ANSWERS, scope: 'tagged', passesTest: 3, measure: 'api', preset: 'strict' },
      { ...ANSWERS, measure: 'steps', preset: 'loose' },
    ];
    for (const a of answers)
      for (const path of activeValues(a).keys()) expect(listed, path).toContain(path);
  });

  test('04-AC-17 04-REQ-46 pw-perf.config.ts holds only values that differ from the defaults as active code', () => {
    const config = renderPerfConfig(ANSWERS);
    expect(activeLines(config)).toEqual([
      "import { definePerfConfig } from 'playwright-performance-regression';",
      'export default definePerfConfig({',
      '});',
    ]);
    // No origin labels from the wizard: they follow the baseURL (07-REQ-03).
    expect(config).toContain('  //   origins: {},\n');
    const other = renderPerfConfig({ ...ANSWERS, passesTest: 7 });
    expect(other.split('\n').filter((l) => !/^\s*(\/\/|$)/u.test(l))).toEqual([
      "import { definePerfConfig } from 'playwright-performance-regression';",
      'export default definePerfConfig({',
      '  run: {',
      '    passes: {',
      '      test: 7,',
      '    },',
      '  },',
      '});',
    ]);
    expect(other).toMatch(/ passes on 1 worker\)\. Default: 5\.\n {6}test: 7,/u);
  });

  test('04-REQ-46 every listed option is a comment with its default and its text, in schema order', () => {
    const config = renderPerfConfig(ANSWERS);
    const lines = config.split('\n');
    const listed = new Set(CONFIG_FILE_OPTIONS.map((o) => o.option));
    const shown = CONFIG_OPTIONS.filter(
      (o) => listed.has(o.path) || [...listed].some((l) => l.startsWith(`${o.path}.`)),
    );
    let at = lines.indexOf('export default definePerfConfig({');
    for (const option of shown) {
      const name = option.path.split('.').at(-1) as string;
      const depth = option.path.split('.').length - 1;
      const code =
        option.leaf && !Array.isArray(option.default)
          ? `${name}: ${ts(option.default)},`
          : `${name}: `;
      const index = lines.findIndex(
        (l, i) =>
          i >= at &&
          l
            .replace(/^\s*(\/\/ )?/u, '')
            .trimStart()
            .startsWith(code),
      );
      expect(index, option.path).toBeGreaterThanOrEqual(at);
      // Nested as in the config object: two more spaces per level.
      // With the default answers every option is commented out.
      expect(lines[index]?.indexOf(name), option.path).toBe(2 + 2 * depth + 3);
      // The text comes right before, wrapped.
      const text =
        CONFIG_FILE_OPTIONS.find((o) => o.option === option.path)?.text ?? option.description;
      expect(lines.slice(at, index).join(' '), option.path).toContain(
        text.split(' ').slice(0, 3).join(' '),
      );
      at = index + 1;
    }
    // Options outside the list are not in the file.
    for (const name of ['keepReporters', 'resourceTypes', 'idPatterns', 'checks', 'advanced'])
      expect(config, name).not.toContain(` ${name}: `);
    expect(CONFIG_OPTIONS.filter((o) => !o.path.includes('.')).map((o) => o.path)).toEqual([
      'run',
      'measure',
      'keys',
      'checks',
      'gate',
      'thresholds',
      'report',
      'advanced',
    ]);
    expect(
      CONFIG_OPTIONS.filter((o) => /^checks\.[^.]+$/u.test(o.path)).map((o) => o.path),
    ).toEqual(['checks.time', 'checks.slowShare', 'checks.errors']);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(100);
  });

  test('04-REQ-46 the option list has the defaults of DEFAULT_CONFIG and no specification references', () => {
    const leaves = CONFIG_OPTIONS.filter((o) => o.leaf);
    const get = (path: string): unknown =>
      path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], DEFAULT_CONFIG);
    for (const option of leaves) {
      if (option.path === 'keys.keyBuilder') expect(option.default).toBeUndefined();
      else expect(option.default, option.path).toEqual(get(option.path));
    }
    const paths = new Set(CONFIG_OPTIONS.map((o) => o.path));
    const walk = (value: unknown, prefix: string): void => {
      if (prefix !== '') expect(paths, prefix).toContain(prefix);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
      for (const [k, v] of Object.entries(value)) walk(v, prefix === '' ? k : `${prefix}.${k}`);
    };
    walk(DEFAULT_CONFIG, '');
    for (const option of CONFIG_OPTIONS) {
      expect(option.description, option.path).not.toMatch(
        /\b\d{2}-(?:REQ|AC|D)-\d+|\b(?:D|ADR|NF|P|V)-\d{2,4}\b|<pkg>|<PKG>/iu,
      );
      expect(option.description, option.path).toMatch(/^[^\s].*[.!?]$/u);
    }
  });

  test('04-AC-23 04-REQ-46 pw-perf.config.ts is valid TypeScript and the same in every wizard language', async () => {
    const info = await detectDir(join(PROJECTS, 'init-esm-ts'));
    const text = (lang: WizardLanguage): string =>
      planInitChanges(info, { ...ANSWERS, passesTest: 3 }, lang).changes.find(
        (c) => c.path === 'pw-perf.config.ts',
      )?.after ?? '';
    const en = text('en');
    for (const lang of LANGUAGES) expect(text(lang), lang).toBe(en);
    const answers = { ...ANSWERS, preset: 'strict', scope: 'tagged' } as const;
    for (const config of [en, renderPerfConfig(answers)]) {
      const out = typescript.transpileModule(config, { reportDiagnostics: true });
      expect(out.diagnostics ?? []).toEqual([]);
    }
  });

  test('04-AC-56 a JavaScript project gets pw-perf.config.js in the module system of playwright.config', () => {
    const cjsConfig =
      "const { defineConfig } = require('@playwright/test');\nmodule.exports = defineConfig({});\n";
    const esmConfig =
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({});\n";
    const plan = (entries: Record<string, string>): Map<string, string> =>
      new Map(
        planInitChanges(detectProject(files(entries)), ANSWERS).changes.map((c) => [
          c.path,
          c.after,
        ]),
      );
    const cjs = plan({ 'package.json': '{}', 'playwright.config.js': cjsConfig });
    expect(cjs.get('pw-perf.config.js')).toContain(
      '// @ts-check\n// Configuration of playwright-performance-regression',
    );
    expect(cjs.get('pw-perf.config.js')).toContain(
      "const { definePerfConfig } = require('playwright-performance-regression');\n\nmodule.exports = definePerfConfig({",
    );
    expect(cjs.get('playwright.config.js')).toContain(
      "module.exports = withPerf(defineConfig({}), require('./pw-perf.config'));",
    );
    const mjs = plan({ 'package.json': '{}', 'playwright.config.mjs': esmConfig });
    expect(mjs.get('pw-perf.config.mjs')).toContain(
      "import { definePerfConfig } from 'playwright-performance-regression';\n\nexport default definePerfConfig({",
    );
    expect(mjs.get('playwright.config.mjs')).toContain(
      "import perfConfig from './pw-perf.config.mjs';",
    );
    const esm = plan({ 'package.json': '{"type":"module"}', 'playwright.config.js': esmConfig });
    expect(esm.get('playwright.config.js')).toContain(
      "import perfConfig from './pw-perf.config.js';",
    );
    expect(esm.get('pw-perf.config.js')).toContain('export default definePerfConfig({');
    const cjsInEsm = plan({
      'package.json': '{"type":"module"}',
      'playwright.config.cjs': cjsConfig,
    });
    expect(cjsInEsm.get('playwright.config.cjs')).toContain("require('./pw-perf.config.cjs'))");
    expect(cjsInEsm.get('pw-perf.config.cjs')).toContain('module.exports = definePerfConfig({');
    const withTsconfig = plan({
      'package.json': '{}',
      'tsconfig.json': '{}',
      'playwright.config.js': cjsConfig,
    });
    expect([...withTsconfig.keys()]).toContain('pw-perf.config.ts');
    expect(withTsconfig.get('playwright.config.js')).toContain(
      "require('./pw-perf.config').default)",
    );
    // A pw-perf.config.ts of an earlier wizard is kept and referred to as before.
    const earlier = plan({
      'package.json': '{}',
      'pw-perf.config.ts': 'export default {};\n',
      'playwright.config.js': cjsConfig,
    });
    expect([...earlier.keys()]).not.toContain('pw-perf.config.js');
    expect(earlier.get('playwright.config.js')).toContain("require('./pw-perf.config').default)");
  });

  test('another package config format is never rewritten; the answers become a manual step', () => {
    const info = detectProject(
      files({
        'pw-perf.config.json': '{}',
        'playwright.config.ts': 'export default defineConfig({});\n',
      }),
    );
    const plan = planInitChanges(info, { ...ANSWERS, passesTest: 3 });
    expect(plan.changes.map((c) => c.path)).not.toContain('pw-perf.config.ts');
    expect(plan.changes.map((c) => c.path)).not.toContain('playwright.config.ts');
    expect(plan.manualSteps.map((s) => s.message)).toEqual([
      'pw-perf.config.json exists and was not changed.',
      'playwright.config.ts was not changed: the package config is pw-perf.config.json.',
    ]);
    expect(plan.testObject).toEqual({
      extendFiles: [],
      importedBy: {},
      workspace: {},
      importingFiles: 0,
      stepsMeasured: false,
    });
  });
});

describe('recognized layouts (04-REQ-39)', () => {
  test('playwright.config: defineConfig or an object, ESM or CommonJS, as the last statement', () => {
    expect(
      wrapPlaywrightConfig(
        "import { defineConfig } from '@playwright/test';\n\nexport default defineConfig({ a: ')' });\n",
        TS_REF,
      ),
    ).toBe(
      "import { defineConfig } from '@playwright/test';\nimport { withPerf } from 'playwright-performance-regression/config';\nimport perfConfig from './pw-perf.config';\n\nexport default withPerf(defineConfig({ a: ')' }), perfConfig);\n",
    );
    expect(wrapPlaywrightConfig('// header\nexport default {\n  testDir: `t`,\n};\n', TS_REF)).toBe(
      "// header\nimport { withPerf } from 'playwright-performance-regression/config';\nimport perfConfig from './pw-perf.config';\nexport default withPerf({\n  testDir: `t`,\n}, perfConfig);\n",
    );
    expect(
      wrapPlaywrightConfig("'use strict';\nmodule.exports = { retries: 0 } // done\n", TS_REF),
    ).toBe(
      "'use strict';\nconst { withPerf } = require('playwright-performance-regression/config');\nmodule.exports = withPerf({ retries: 0 }, require('./pw-perf.config').default) // done\n",
    );
    for (const text of [
      'export default withSomething(defineConfig({}));\n',
      'const config = defineConfig({});\nexport default config;\n',
      'export default defineConfig({}) satisfies X;\n',
      'export default defineConfig({});\nexport const other = 1;\n',
      'export default defineConfig({ a: (1 }));\n',
    ]) {
      expect(wrapPlaywrightConfig(text, TS_REF), text).toBeNull();
    }
  });

  test('test object: one base.extend(...) with type arguments, ESM or CommonJS', () => {
    expect(
      wrapTestObject(
        "import { test as base } from '@playwright/test';\nexport const test = base.extend<{ f: () => Promise<void> }>({ f: async ({}, use) => use(async () => {}) });\n",
      ),
    ).toBe(
      "import { test as base } from '@playwright/test';\nimport { withPerfFixtures } from 'playwright-performance-regression/fixture';\nexport const test = withPerfFixtures(base.extend<{ f: () => Promise<void> }>({ f: async ({}, use) => use(async () => {}) }));\n",
    );
    expect(
      wrapTestObject(
        'const pw = require("@playwright/test");\nexports.test = pw.test.extend({});\n',
      ),
    ).toBe(
      'const pw = require("@playwright/test");\nconst { withPerfFixtures } = require(\'playwright-performance-regression/fixture\');\nexports.test = withPerfFixtures(pw.test.extend({}));\n',
    );
    expect(wrapTestObject('export const test = base.extend({}).extend({});\n')).toBeNull();
    expect(wrapTestObject('export const adminTest = base.extend({});\n')).toBeNull();
  });

  test('04-AC-46 test files are never changed; only a fixtures module is wrapped', () => {
    const config = 'export default defineConfig({});\n';
    const module =
      "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n";
    const spec = `${module}test('checkout', async () => {});\n`;
    const wrapped = planInitChanges(
      detectProject(files({ 'playwright.config.ts': config, 'tests/fixtures.ts': module })),
      ANSWERS,
    );
    expect(wrapped.changes.map((c) => c.path)).toContain('tests/fixtures.ts');
    expect(wrapped.testObject).toBeNull();
    const inSpec = planInitChanges(
      detectProject(files({ 'playwright.config.ts': config, 'tests/a.spec.ts': spec })),
      ANSWERS,
    );
    expect(inSpec.changes.map((c) => c.path)).not.toContain('tests/a.spec.ts');
    expect(inSpec.testObject).toEqual({
      extendFiles: ['tests/a.spec.ts'],
      importedBy: { 'tests/a.spec.ts': 0 },
      workspace: {},
      importingFiles: 1,
      stepsMeasured: false,
    });
    const imports = planInitChanges(
      detectProject(
        files({
          'playwright.config.ts': config,
          'tests/a.spec.ts': "import { test } from '@playwright/test';\ntest('a', () => {});\n",
          'tests/b.spec.ts': "import { test, expect } from '@playwright/test';\n",
        }),
      ),
      ANSWERS,
    );
    // 04-D-49: without a fixtures module the import changes (04-AC-57); the box applies when
    // a change is declined.
    expect(imports.changes.map((c) => c.path).filter((p) => p.startsWith('tests/'))).toEqual([
      'tests/a.spec.ts',
      'tests/b.spec.ts',
    ]);
    expect(imports.testObject).toBeNull();
    expect(imports.importSwap?.box).toEqual({
      extendFiles: [],
      importedBy: {},
      workspace: {},
      importingFiles: 2,
      stepsMeasured: false,
    });
  });

  test('04-AC-54 04-AC-58 detection reads fixtures and page objects outside testDir; the box puts the imported module first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-perf-ac54-'));
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    try {
      write('package.json', '{}');
      write(
        'tsconfig.json',
        '{\n  // aliases\n  "compilerOptions": { "paths": { "@fixtures": ["./tests/fixtures/index.ts"], }, },\n}\n',
      );
      write(
        'playwright.config.ts',
        "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests/specs' });\n",
      );
      write(
        'tests/fixtures/pages.fixture.ts',
        "import { test as base } from '@playwright/test';\nexport const test = base.extend<{ a: number }>({ a: async ({}, use) => use(1) });\n",
      );
      write(
        'tests/fixtures/api.fixture.ts',
        "import { type APIRequestContext } from '@playwright/test';\nimport { test as pagesTest } from './pages.fixture';\nexport const test = pagesTest.extend<{ b: number }>({ b: async ({ a }, use) => use(a) });\n",
      );
      write(
        'tests/fixtures/index.ts',
        "import { test as apiTest } from './api.fixture';\nexport const test = apiTest.extend<{ c: string }>({ c: ['x', { option: true }] });\n",
      );
      write(
        'tests/pages/CartPage.ts',
        "import { type Locator, test } from '@playwright/test';\nexport class CartPage { async open() { await test.step('open', async () => {}); } }\n",
      );
      write('src/schema.ts', 'export const user = base.extend({ name: z.string() });\n');
      write(
        'tests/specs/cart.spec.ts',
        "import { test, expect } from '@fixtures';\ntest('cart', async ({ c }) => { expect(c).toBe('x'); });\n",
      );
      const info = await detectDir(dir);
      expect(info.filesWithExtend).toEqual([
        'tests/fixtures/api.fixture.ts',
        'tests/fixtures/index.ts',
        'tests/fixtures/pages.fixture.ts',
      ]);
      expect(info.stepFiles).toBe(1);
      expect(planInitChanges(info, ANSWERS).testObject).toEqual({
        // 04-AC-58: the module the spec imports through the tsconfig alias first.
        extendFiles: [
          'tests/fixtures/index.ts',
          'tests/fixtures/api.fixture.ts',
          'tests/fixtures/pages.fixture.ts',
        ],
        importedBy: {
          'tests/fixtures/api.fixture.ts': 0,
          'tests/fixtures/index.ts': 1,
          'tests/fixtures/pages.fixture.ts': 0,
        },
        workspace: {},
        importingFiles: 0,
        // 04-D-47: answer all with a test.step found: steps are measured without the fixture.
        stepsMeasured: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('04-AC-57 the import changes to <pkg>/test without a fixtures module; another layout keeps the box', () => {
    expect(
      swapTestImport("import { expect, test, type Page } from '@playwright/test';\nx();\n"),
    ).toBe(
      "import { type Page } from '@playwright/test';\nimport { expect, test } from 'playwright-performance-regression/test';\nx();\n",
    );
    expect(swapTestImport('import { test as it } from "@playwright/test"\n')).toBe(
      'import { test as it } from "playwright-performance-regression/test"\n',
    );
    expect(swapTestImport("const { test, expect, devices } = require('@playwright/test');\n")).toBe(
      "const { devices } = require('@playwright/test');\nconst { test, expect } = require('playwright-performance-regression/test');\n",
    );
    expect(swapTestImport("import * as pw from '@playwright/test';\n")).toBeNull();
    expect(swapTestImport("import { type Page } from '@playwright/test';\n")).toBeNull();
    const config = 'export default defineConfig({});\n';
    const plan = (spec: string): InitPlan =>
      planInitChanges(
        detectProject(
          files({
            'playwright.config.ts': config,
            'tests/a.spec.ts':
              "const { test } = require('@playwright/test');\ntest('a', () => {});\n",
            'tests/b.spec.ts': spec,
            'tests/auth.setup.ts':
              "import { test as setup } from '@playwright/test';\nsetup('x', () => {});\n",
          }),
        ),
        ANSWERS,
      );
    const swapped = plan("import { test } from '@playwright/test';\ntest('b', () => {});\n");
    expect(swapped.importSwap?.paths).toEqual(['tests/a.spec.ts', 'tests/b.spec.ts']);
    expect(swapped.changes.find((c) => c.path === 'tests/a.spec.ts')?.after).toBe(
      "const { test } = require('playwright-performance-regression/test');\ntest('a', () => {});\n",
    );
    expect(swapped.changes.map((c) => c.path)).not.toContain('tests/auth.setup.ts');
    expect(swapped.testObject).toBeNull();
    const other = plan(
      "import * as pw from '@playwright/test';\nconst { test } = pw;\ntest('b', () => {});\n",
    );
    expect(other.importSwap).toBeNull();
    expect(other.changes.map((c) => c.path).filter((p) => p.startsWith('tests/'))).toEqual([]);
    expect(other.testObject).not.toBeNull();
  });

  test('04-AC-58 the box names a fixtures module of a workspace package and never changes it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pw-perf-ac58-'));
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    try {
      write('packages/kit/package.json', '{ "name": "@acme/kit", "main": "src/index.ts" }');
      write(
        'packages/kit/src/index.ts',
        "import { test as base } from '@playwright/test';\nexport const test = base.extend({ a: async ({}, use) => use(1) });\n",
      );
      write('apps/web/package.json', '{}');
      write('apps/web/playwright.config.ts', 'export default defineConfig({});\n');
      write(
        'apps/web/tests/a.spec.ts',
        "import { test } from '@acme/kit';\ntest('a', async () => {});\n",
      );
      write(
        'apps/web/tests/b.spec.ts',
        "import { test } from '@acme/kit';\ntest('b', async () => {});\n",
      );
      mkdirSync(join(root, 'apps/web/node_modules/@acme'), { recursive: true });
      symlinkSync(
        join(root, 'packages/kit'),
        join(root, 'apps/web/node_modules/@acme/kit'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const info = await detectDir(join(root, 'apps/web'));
      const plan = planInitChanges(info, ANSWERS);
      const entry = '../../packages/kit/src/index.ts';
      expect(plan.changes.map((c) => c.path)).not.toContain(entry);
      expect(plan.testObject).toEqual({
        extendFiles: [entry],
        importedBy: { [entry]: 2 },
        workspace: { [entry]: '@acme/kit' },
        importingFiles: 0,
        stepsMeasured: false,
      });
      expect(info.filesWithExtend).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('04-AC-59 after the fixtures module is wrapped, tests importing @playwright/test give a warning', () => {
    const plan = planInitChanges(
      detectProject(
        files({
          'playwright.config.ts': 'export default defineConfig({});\n',
          'tests/fixtures.ts':
            "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n",
          'tests/a.spec.ts': "import { test } from './fixtures';\ntest('a', () => {});\n",
          'tests/b.spec.ts': "import { test } from '@playwright/test';\ntest('b', () => {});\n",
          'tests/auth.setup.ts':
            "import { test as setup } from '@playwright/test';\nsetup('x', () => {});\n",
        }),
      ),
      ANSWERS,
    );
    expect(plan.changes.map((c) => c.path)).toContain('tests/fixtures.ts');
    expect(plan.changes.map((c) => c.path)).not.toContain('tests/b.spec.ts');
    expect(plan.testObject).toBeNull();
    expect(plan.manualSteps).toEqual([
      {
        code: 'INIT_MANUAL_STEP',
        message:
          'Test files that import test straight from @playwright/test are not measured (1): tests/b.spec.ts.',
        hint: "Import test from tests/fixtures.ts in them, or change the import in each of them:\n  import { test, expect } from 'playwright-performance-regression/test';",
      },
    ]);
  });

  test('04-AC-60 a nested repository is skipped unless a source imports from it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-perf-ac60-'));
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    try {
      write('package.json', '{}');
      write('playwright.config.ts', 'export default defineConfig({});\n');
      write('vendor/lib/.git', 'gitdir: ../../.git/modules/lib\n');
      write(
        'vendor/lib/src/fixture.ts',
        "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n",
      );
      write('tests/a.spec.ts', "import { test } from 'x';\ntest('a', () => {});\n");
      expect((await detectDir(dir)).filesWithExtend).toEqual([]);
      write(
        'tests/a.spec.ts',
        "import { test } from '../vendor/lib/src/fixture';\ntest('a', () => {});\n",
      );
      expect((await detectDir(dir)).filesWithExtend).toEqual(['vendor/lib/src/fixture.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('04-AC-53 only steps measured: no red box, the fixtures module is still wrapped', () => {
    const config = 'export default defineConfig({});\n';
    const imports = files({
      'playwright.config.ts': config,
      'tests/a.spec.ts': "import { test } from '@playwright/test';\ntest('a', () => {});\n",
    });
    const box = (answers: InitAnswers): unknown => {
      const plan = planInitChanges(detectProject(imports), answers);
      return plan.testObject ?? plan.importSwap?.box ?? null;
    };
    expect(box(ANSWERS)).not.toBeNull();
    expect(box({ ...ANSWERS, measure: 'api' })).not.toBeNull();
    expect(box({ ...ANSWERS, measure: 'steps' })).toBeNull();
    const module =
      "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n";
    const wrapped = planInitChanges(
      detectProject(files({ 'playwright.config.ts': config, 'tests/fixtures.ts': module })),
      { ...ANSWERS, measure: 'steps' },
    );
    expect(wrapped.changes.map((c) => c.path)).toContain('tests/fixtures.ts');
  });

  test('scanning skips strings, comments, templates and regular expressions', () => {
    const text = "f(')', \"(\", `${g(')')}`, /\\)/u, // )\n/* ) */ x)";
    expect(matchBracket(text, 1)).toBe(text.length);
    expect(matchBracket('f(a]', 1)).toBe(-1);
    expect(
      addImports("import a from 'a';\nimport {\n  b,\n} from 'b';\n\nrun();\n", ['import c;']),
    ).toBe("import a from 'a';\nimport {\n  b,\n} from 'b';\nimport c;\n\nrun();\n");
    expect(addImports('/**\n * doc\n */\nrun();', ['import c;'])).toBe(
      '/**\n * doc\n */\nimport c;\nrun();',
    );
    expect(addImports('run();', ['import c;'])).toBe('import c;\nrun();');
  });

  test('unified diff with context and hunk headers', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n';
    const after = before.replace('b\n', 'B\n').replace('j\n', '');
    expect(unifiedDiff({ path: 'x', kind: 'modify', before, after })).toBe(
      '--- a/x\n+++ b/x\n@@ -1,5 +1,5 @@\n a\n-b\n+B\n c\n d\n e\n@@ -7,5 +7,4 @@\n g\n h\n i\n-j\n k\n',
    );
    // Changes 6 lines apart share one hunk.
    expect(
      unifiedDiff({ path: 'x', kind: 'modify', before, after: before.replace('i\n', '') }).split(
        '@@',
      ).length,
    ).toBe(3);
    expect(unifiedDiff({ path: 'n', kind: 'create', before: null, after: 'x\n' })).toBe(
      '--- /dev/null\n+++ b/n\n@@ -0,0 +1,1 @@\n+x\n',
    );
    expect(unifiedDiff({ path: 'n', kind: 'modify', before: 'x\n', after: 'x\n' })).toBe('');
  });

  test('D-47 .gitignore gets reports/pw-perf/ unless it or reports/ is already ignored', () => {
    const dir = DEFAULT_CONFIG.report.dir;
    expect(dir).toBe('reports/pw-perf');
    expect(addIgnore(null, dir)).toBe('reports/pw-perf/\n');
    expect(addIgnore('node_modules', dir)).toBe('node_modules\nreports/pw-perf/\n');
    for (const line of ['reports/pw-perf/', '/reports/pw-perf', 'reports/', '/reports'])
      expect(ignores(`node_modules\n${line}\n`, dir), line).toBe(true);
    for (const line of ['reports/pw', 'reports/pw-perf-old/', 'pw-perf/', ''])
      expect(ignores(`node_modules\n${line}\n`, dir), line).toBe(false);
  });

  test('04-AC-55 a glob that covers reports/ already ignores the report folder', () => {
    const dir = DEFAULT_CONFIG.report.dir;
    const covered = ['reports/pw-perf', '/reports/', 'reports', 'reports/*', '/reports/**'];
    for (const line of [...covered, '/reports/**/*'])
      expect(ignores(`node_modules\n${line}\n`, dir), line).toBe(true);
    for (const text of ['/reports/**/*\n!reports/keep.txt\n', 'reports-old/\n', '# reports/\n'])
      expect(ignores(`node_modules\n${text}`, dir), text).toBe(false);
    // A negation cannot re-include a file under an excluded folder (no glob).
    expect(ignores('reports/\n!reports/keep.txt\n', dir)).toBe(true);
  });
});

describe('CI templates', () => {
  const RECIPES = {
    github: 'github-actions.yml',
    gitlab: 'gitlab-ci.yml',
    jenkins: 'Jenkinsfile',
    azure: 'azure-pipelines.yml',
  } as const;

  test('13-AC-11 the templates of the wizard are byte for byte the files in examples/ci', () => {
    expect(Object.keys(CI_TEMPLATES).sort()).toEqual(Object.keys(RECIPES).sort());
    for (const [platform, file] of Object.entries(RECIPES)) {
      const recipe = readFileSync(join(ROOT, 'examples/ci', file), 'utf8').replaceAll('\r\n', '\n');
      expect(CI_TEMPLATES[platform as keyof typeof RECIPES], file).toBe(recipe);
    }
    expect(readdirSync(join(ROOT, 'examples/ci')).sort()).toEqual(Object.values(RECIPES).sort());
  });

  test('04-AC-49 every recipe has a manual thresholds job and a weekly measurement job', () => {
    for (const [platform, file] of Object.entries(RECIPES)) {
      const recipe = CI_TEMPLATES[platform as keyof typeof RECIPES];
      expect(recipe, file).toContain(CI_COMMAND);
      expect(recipe, file).toMatch(/thresholds/u);
      expect(recipe, file).toContain('pw-perf-thresholds');
      // GitLab schedules live in the project settings; the others have a weekly cron.
      expect(recipe, file).toMatch(platform === 'gitlab' ? /"schedule"/u : /\* \* 1'/u);
      expect(recipe, file).toContain('outcome.json');
      expect(recipe, file).not.toMatch(/npx pw-perf|pw-perf (test|thresholds)/u);
    }
    expect(CI_TEMPLATES.github).toContain('PW_PERF_MODE: thresholds');
    expect(CI_TEMPLATES.github).toContain('PW_PERF_MODE: test');
    expect(CI_TEMPLATES.github).toContain('workflow_dispatch');
    expect(CI_TEMPLATES.gitlab).toContain('PW_PERF_MODE: thresholds');
    expect(CI_TEMPLATES.gitlab).toContain('when: manual');
    expect(CI_TEMPLATES.jenkins).toContain("choices: ['test', 'thresholds']");
    expect(CI_TEMPLATES.azure).toContain('PW_PERF_MODE: ${{ parameters.mode }}');
  });

  test('04-AC-30 04-AC-49 the wizard writes the recipe with the project command only', async () => {
    for (const platform of Object.keys(RECIPES) as (keyof typeof RECIPES)[]) {
      expect(ciFile(platform, CI_COMMAND)).toEqual({
        path: CI_PATHS[platform],
        text: CI_TEMPLATES[platform],
      });
      const qa = ciFile(platform, 'npm run e2e:qa');
      expect(qa.text).toBe(CI_TEMPLATES[platform].replaceAll(CI_COMMAND, 'npm run e2e:qa'));
    }
    const info = await detectDir(join(PROJECTS, 'init-esm-ts'));
    const plan = planInitChanges(info, defaultAnswers(info));
    expect(plan.changes.find((c) => c.path === '.github/workflows/perf.yml')?.after).toBe(
      CI_TEMPLATES.github.replaceAll(CI_COMMAND, 'npx playwright test'),
    );
  });
});

describe('04-REQ-55 test command of step 6 in the CI files', () => {
  test('04-AC-52 GitHub and Azure take the command literally, GitLab and Jenkins quote it', () => {
    const cmd = `npm run e2e -- --grep "@smoke" --project 'a: b' \\x`;
    expect(ciFile('github', cmd).text).toContain(`          ${cmd} || true\n`);
    expect(ciFile('azure', cmd).text).toContain(`          ${cmd} || true\n`);
    expect(ciFile('gitlab', cmd).text).toContain(
      `    - 'npm run e2e -- --grep "@smoke" --project ''a: b'' \\x || true'\n`,
    );
    expect(ciFile('jenkins', cmd).text).toContain(
      `sh(script: 'npm run e2e -- --grep "@smoke" --project \\'a: b\\' \\\\x', returnStatus: true)`,
    );
    // Plain commands stay plain; a command containing the placeholder is replaced once.
    expect(ciFile('gitlab', 'npm run e2e:qa').text).toContain('    - npm run e2e:qa || true\n');
    expect(ciFile('jenkins', 'npm run e2e:qa').text).toContain("sh(script: 'npm run e2e:qa',");
    expect(yamlScalar('# x')).toBe("'# x'");
    expect(yamlScalar('npx playwright test || true')).toBe('npx playwright test || true');
    expect(groovySingleQuoted("a'b\\c")).toBe("a\\'b\\\\c");
  });
});

describe('04-REQ-47 step 4', () => {
  test('04-REQ-47 the api lesson mentions request calls of API tests in every language', () => {
    for (const lang of LANGUAGES) {
      const text = MESSAGES[lang].measureApi;
      expect(text, lang).toMatch(/\brequest\b/u);
      expect(text, lang).toMatch(/\bAPI\b/u);
      expect(text, lang).toContain('"GET /api/users/:id"');
    }
  });

  test('04-AC-28 counts the source files with test.step( and measures all by default', () => {
    const files = new Map([
      ['playwright.config.ts', "export default defineConfig({ testDir: 'tests' });"],
      [
        'tests/a.spec.ts',
        "import { test } from '@playwright/test';\ntest('a', async () => { await test.step('x', async () => {}); });",
      ],
      ['pages/login.page.ts', "await test.step('login', async () => {});"],
      ['tests/b.spec.ts', "import { test } from '@playwright/test';"],
    ]);
    const info = detectProject(files);
    expect(info.stepFiles).toBe(2);
    expect(defaultAnswers(info).measure).toBe('all');
    expect(defaultAnswers(detectProject(new Map([['playwright.config.ts', '']]))).measure).toBe(
      'all',
    );
  });

  test('04-AC-28 all keeps the defaults, api writes measure.steps: false and steps measure.api: false', () => {
    const header = [
      "import { definePerfConfig } from 'playwright-performance-regression';",
      'export default definePerfConfig({',
    ];
    expect(activeLines(renderPerfConfig({ ...ANSWERS, measure: 'all' }))).toEqual([
      ...header,
      '});',
    ]);
    expect(activeLines(renderPerfConfig({ ...ANSWERS, measure: 'api' }))).toEqual([
      ...header,
      '  measure: {',
      '    steps: false,',
      '  },',
      '});',
    ]);
    expect(activeLines(renderPerfConfig({ ...ANSWERS, measure: 'steps' }))).toEqual([
      ...header,
      '  measure: {',
      '    api: false,',
      '  },',
      '});',
    ]);
    // Every answer gives a valid config (never both kinds off, 03-REQ-28).
    for (const measure of ['all', 'api', 'steps'] as const) {
      const values = activeValues({ ...ANSWERS, measure });
      const config = { measure: Object.fromEntries([...values].map(([k, v]) => [k.slice(8), v])) };
      expect(resolveConfig(config, {}).ok).toBe(true);
    }
  });
});
