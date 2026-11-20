// Step timings in the reporter (06-REQ-16): the step tree of each TestResult becomes step
// samples of the aggregator. Raw titles stay in memory during onTestEnd only (06-REQ-37).
import type { TestStep } from '@playwright/test/reporter';
import type { ResolvedConfig } from '../core/config/index.ts';
import type { Aggregator, TestMeta } from '../core/stats/index.ts';
import {
  collectWith,
  createStepTitleSanitizer,
  detectStepKeyExplosion,
  noStepsIssue,
  secretRedactedIssue,
  stepNormalizationFingerprint,
  stepTestPrefix,
} from '../core/steps/index.ts';
import type { Redaction, SanitizedTitle, StepNode } from '../core/steps/index.ts';
import type { Issue } from '../core/types/index.ts';
import type { SuiteLike, TestLike } from './types.ts';

/** The fields of a Playwright TestStep the reporter reads (06-REQ-16). */
export type StepLike = Pick<TestStep, 'category' | 'title' | 'startTime' | 'duration'> & {
  error?: unknown;
  annotations?: readonly { type: string }[];
  location?: { file: string; line: number } | undefined;
  steps: readonly StepLike[];
};

function toNodes(steps: readonly StepLike[], relative: (file: string) => string): StepNode[] {
  return steps.map((step) => ({
    category: step.category,
    title: step.title,
    startTime: step.startTime.getTime(),
    duration: step.duration,
    hasError: step.error !== undefined && step.error !== null,
    skipped: (step.annotations ?? []).some((a) => a.type === 'skip'),
    location:
      step.location === undefined
        ? null
        : { file: relative(step.location.file), line: step.location.line },
    steps: toNodes(step.steps, relative),
  }));
}

/** Titles of the describe blocks and the test, without project and file (06-REQ-39). */
function testTitles(test: TestLike): string[] {
  const titles = [test.title];
  for (let s: SuiteLike | undefined = test.parent; s?.type === 'describe'; s = s.parent) {
    titles.unshift(s.title);
  }
  return titles;
}

export class StepRecorder {
  private readonly cfg: ResolvedConfig;
  private readonly sanitize: (title: string) => SanitizedTitle;
  private readonly redactions: Redaction[] = [];

  constructor(cfg: ResolvedConfig) {
    this.cfg = cfg;
    this.sanitize = createStepTitleSanitizer({
      normalizeTitles: cfg.measure.steps.normalizeTitles,
      redactQuotedValues: cfg.measure.steps.redactQuotedValues,
      idPatterns: cfg.keys.idPatterns,
      extraIdPatterns: cfg.keys.extraIdPatterns,
    });
  }

  get enabled(): boolean {
    return this.cfg.measure.steps.enabled;
  }

  /** Step fingerprint of the run, or null while steps are off (06-REQ-25). */
  fingerprint(): string | null {
    return this.enabled
      ? stepNormalizationFingerprint(this.cfg.measure.steps, this.cfg.keys)
      : null;
  }

  /**
   * Adds the step samples of one result, before endResult (08-REQ-40). Results of projects that
   * are not measured are counted as outside samples by the aggregator (06-REQ-19).
   */
  record(
    aggregator: Aggregator,
    test: TestLike,
    steps: readonly StepLike[] | undefined,
    meta: TestMeta,
    relative: (file: string) => string,
  ): void {
    if (!this.enabled || steps === undefined || steps.length === 0) return;
    const testPrefix =
      this.cfg.measure.steps.groupBy === 'test'
        ? stepTestPrefix(meta.file, testTitles(test), this.sanitize)
        : '';
    const { samples, redactions } = collectWith(
      toNodes(steps, relative),
      {
        ...this.cfg.measure.steps,
        idPatterns: this.cfg.keys.idPatterns,
        extraIdPatterns: this.cfg.keys.extraIdPatterns,
        testPrefix,
      },
      this.sanitize,
    );
    this.redactions.push(...redactions);
    samples.forEach((sample, ordinal) => {
      aggregator.addStep({ ...sample, test: meta, ordinal });
    });
  }

  /** STEPS_* warnings of the run (06, chapter 8), after aggregation. */
  issues(stepKeys: readonly string[]): Issue[] {
    if (!this.enabled) return [];
    const issues: Issue[] = [];
    if (stepKeys.length === 0) issues.push(noStepsIssue());
    issues.push(...detectStepKeyExplosion(stepKeys));
    const secret = secretRedactedIssue(this.redactions);
    if (secret !== null) issues.push(secret);
    return issues;
  }
}
