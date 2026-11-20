import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import type { PerfConfigInput, ResolvedConfig } from '../../../src/core/config/index.ts';
import {
  collectSteps,
  createStepTitleSanitizer,
  detectStepKeyExplosion,
  noStepsIssue,
  secretRedactedIssue,
  stepNormalizationFingerprint,
  stepTestPrefix,
} from '../../../src/core/steps/index.ts';
import type { CollectStepsOptions, StepNode } from '../../../src/core/steps/index.ts';

function config(
  steps: PerfConfigInput['measure'] extends infer M
    ? M extends { steps?: infer S }
      ? S
      : never
    : never = true,
  keys: PerfConfigInput['keys'] = {},
): ResolvedConfig {
  const result = resolveConfig({ measure: { steps }, keys }, {});
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value.config;
}

function options(
  steps: Parameters<typeof config>[0] = true,
  testPrefix = 'tests/a.spec.ts › checkout',
): CollectStepsOptions {
  const c = config(steps);
  return {
    ...c.measure.steps,
    idPatterns: c.keys.idPatterns,
    extraIdPatterns: c.keys.extraIdPatterns,
    testPrefix,
  };
}

let clock = 1_000;
function step(title: string, children: StepNode[] = [], extra: Partial<StepNode> = {}): StepNode {
  clock += 10;
  return {
    category: 'test.step',
    title,
    startTime: clock,
    duration: 100,
    hasError: false,
    skipped: false,
    location: { file: 'tests/a.spec.ts', line: 10 },
    steps: children,
    ...extra,
  };
}

const keys = (nodes: StepNode[], opts = options()) =>
  collectSteps(nodes, opts).samples.map((s) => s.key);

describe('06-AC-11 categories and depth', () => {
  const tree = (): StepNode[] => [
    step('hook', [step('login from hook')], { category: 'hook' }),
    step('fixture', [step('seed', [step('inner')])], { category: 'fixture' }),
    step('checkout', [
      step('expect toBeVisible', [], { category: 'expect' }),
      step('page.click', [step('nested in api')], { category: 'pw:api' }),
      step('pay'),
    ]),
  ];

  test('default categories give only test.step samples; hooks and fixtures are transparent', () => {
    expect(keys(tree())).toEqual([
      'login from hook',
      'seed',
      'seed › inner',
      'checkout',
      'checkout › nested in api',
      'checkout › pay',
    ]);
  });

  test('a test.step under a hook has the same key as in the test body', () => {
    const inHook = keys([step('hook', [step('login')], { category: 'hook' })]);
    expect(inHook).toEqual(keys([step('login')]));
  });

  test('categories with expect also give expect keys', () => {
    expect(keys(tree(), options({ categories: ['test.step', 'expect'] }))).toContain(
      'checkout › expect toBeVisible',
    );
  });

  test('maxDepth 1 gives only top-level steps', () => {
    expect(keys(tree(), options({ maxDepth: 1 }))).toEqual(['login from hook', 'seed', 'checkout']);
  });
});

describe('06-AC-12 outcomes', () => {
  test('error, unfinished and skipped steps', () => {
    const { samples } = collectSteps(
      [
        step('fails', [], { hasError: true, startTime: 5_000 }),
        step('open', [], { duration: -1 }),
        step('skipped', [step('child of skipped')], { skipped: true }),
      ],
      options(),
    );
    expect(samples.map((s) => [s.key, s.outcome, s.duration])).toEqual([
      ['fails', 'error', 100],
      ['open', 'unfinished', null],
    ]);
    expect(samples[1]?.endTime).toBeNull();
    expect(samples[0]?.endTime).toBe(5_100);
  });
});

describe('06-AC-13 keys across repetitions and tests', () => {
  test('the same title twice in one test gives two samples of one key', () => {
    expect(keys([step('add item'), step('add item')])).toEqual(['add item', 'add item']);
  });

  test('groupBy test prefixes the key with file and sanitized test title', () => {
    const sanitize = createStepTitleSanitizer({ ...options(), normalizeTitles: true });
    const prefix = stepTestPrefix(
      'tests/a.spec.ts',
      ['checkout', 'pays as jan@example.com'],
      sanitize,
    );
    expect(prefix).toBe('tests/a.spec.ts › checkout › pays as :email');
    expect(keys([step('login', [step('submit')])], options({ groupBy: 'test' }, prefix))).toEqual([
      `${prefix} » login`,
      `${prefix} » login › submit`,
    ]);
  });
});

describe('06-AC-15 include and exclude', () => {
  test('a filtered step stays a segment of its nested steps', () => {
    const nodes = [step('Open order 4711', [step('submit')])];
    expect(keys(nodes, options({ include: ['submit'] }))).toEqual(['Open order :id › submit']);
  });

  test('exclude wins over include', () => {
    expect(keys([step('submit')], options({ include: ['submit'], exclude: ['sub'] }))).toEqual([]);
  });

  test('include matches the sanitized title, not the raw one', () => {
    const nodes = [step('Open order 4711')];
    expect(keys(nodes, options({ include: ['Open order 4711'] }))).toEqual([]);
    expect(keys(nodes, options({ include: ['Open order :id'] }))).toEqual(['Open order :id']);
  });
});

describe('06-AC-17 key explosion and no steps', () => {
  test('12 keys that differ in one unrecognized word give one STEPS_HIGH_CARDINALITY', () => {
    const words = [
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echo',
      'foxtrot',
      'golf',
      'hotel',
      'india',
      'juliett',
      'kilo',
      'lima',
    ];
    const issues = detectStepKeyExplosion(words.map((w) => `Open report ${w}`));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('STEPS_HIGH_CARDINALITY');
    expect(issues[0]?.message).toContain('Open report *');
    expect(issues[0]?.message).toContain(
      'e.g. Open report alpha, Open report bravo, Open report charlie',
    );
  });

  test('quoted words point to redactQuotedValues', () => {
    const words = Array.from({ length: 10 }, (_, i) => `"word${String.fromCharCode(97 + i)}"`);
    const [issue] = detectStepKeyExplosion(words.map((w) => `Fill ${w}`));
    expect(issue?.hint).toContain('redactQuotedValues');
  });

  test('STEPS_NONE_FOUND', () => {
    expect(noStepsIssue().code).toBe('STEPS_NONE_FOUND');
  });
});

describe('06-AC-18 step normalization fingerprint', () => {
  const fp = (steps: Parameters<typeof config>[0], keysInput: PerfConfigInput['keys'] = {}) => {
    const c = config(steps, keysInput);
    return stepNormalizationFingerprint(c.measure.steps, c.keys);
  };
  const base = fp(true);

  test.each([
    ['maxDepth', { maxDepth: 2 }],
    ['categories', { categories: ['test.step', 'hook'] as const }],
    ['groupBy', { groupBy: 'test' as const }],
    ['normalizeTitles', { normalizeTitles: false }],
    ['redactQuotedValues', { redactQuotedValues: true }],
  ])('changes with %s', (_name, steps) => {
    expect(fp(steps as Parameters<typeof config>[0])).not.toBe(base);
  });

  test('changes with keys.idPatterns', () => {
    expect(fp(true, { idPatterns: { number: false } })).not.toBe(base);
  });

  test('does not change with include and exclude', () => {
    expect(fp({ include: ['a'], exclude: ['b'] })).toBe(base);
  });
});

describe('06-AC-21 STEPS_SECRET_REDACTED', () => {
  test('three titles with T06, T09 and T11', () => {
    const { redactions } = collectSteps(
      [
        step('Open https://app.example/orders/42?token=abc', [], {
          location: { file: 'tests/b.spec.ts', line: 3 },
        }),
        step('Use eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', [], {
          location: { file: 'tests/a.spec.ts', line: 20 },
        }),
        step('Login with password=Secr3t!', [], { location: { file: 'tests/a.spec.ts', line: 9 } }),
      ],
      options(),
    );
    const issue = secretRedactedIssue(redactions);
    expect(issue?.message).toBe(
      '3 step titles contain a URL or a secret (rules: jwt, secret-pair, url) at tests/a.spec.ts:9, tests/a.spec.ts:20, tests/b.spec.ts:3; the keys show placeholders instead.',
    );
    expect(issue?.message).not.toContain('Secr3t');
  });

  test('T01–T05 give no warning', () => {
    const titles = [
      'Open order 4711',
      'Open order #4711:',
      'Login as jan.kowalski@example.com',
      'Fill email "jan@example.com"',
      'Click "Save"',
    ];
    const { redactions } = collectSteps(
      titles.map((t) => step(t)),
      options(),
    );
    expect(secretRedactedIssue(redactions)).toBeNull();
  });
});
