// Walk of one TestResult step tree into step samples (06, chapters 4 and 5.1; 06-REQ-27).
import type { ResolvedStepsSettings, ResolvedUrlPattern } from '../config/index.ts';
import type { ResolvedConfig } from '../config/index.ts';
import { truncateKey } from '../normalize/key-builder.ts';
import { createStepTitleSanitizer } from './sanitize.ts';
import type { RedactionRule, SanitizedTitle } from './sanitize.ts';

/** Separator of step key segments (06-REQ-23): space, U+203A, space. */
export const STEP_SEPARATOR = ' › ';
/** Separator between the test prefix and the step part with groupBy 'test' (06-REQ-23). */
export const TEST_SEPARATOR = ' » ';

export interface StepLocation {
  /** Relative to configDir, with '/'. */
  file: string;
  line: number;
}

/**
 * Minimal serializable shape of a Playwright TestStep (06-REQ-27), built by the reporter so that
 * core does not depend on Playwright (ADR-0005).
 */
export interface StepNode {
  category: string;
  title: string;
  /** TestStep.startTime in epoch ms. */
  startTime: number;
  /** TestStep.duration in ms; negative for a step that did not finish (06-REQ-17). */
  duration: number;
  hasError: boolean;
  /** The step has a 'skip' annotation (06-REQ-18). */
  skipped: boolean;
  location: StepLocation | null;
  steps: readonly StepNode[];
}

export type StepOutcome = 'ok' | 'error' | 'unfinished';

export interface RawStepSample {
  /** 06-REQ-23, after sanitization (06-REQ-24). */
  key: string;
  /** TestStep.duration; null for 'unfinished'. */
  duration: number | null;
  /** startTime + duration; null for 'unfinished'. */
  endTime: number | null;
  outcome: StepOutcome;
  location: StepLocation | null;
}

/** Privacy rules that fired for one title, without the title (06-REQ-38). */
export interface Redaction {
  rules: RedactionRule[];
  location: StepLocation | null;
}

export type CollectStepsOptions = ResolvedStepsSettings & {
  idPatterns: ResolvedConfig['keys']['idPatterns'];
  extraIdPatterns: ResolvedConfig['keys']['extraIdPatterns'];
  /** Used only with groupBy 'test'; already sanitized (06-REQ-39). */
  testPrefix: string;
};

function matches(text: string, pattern: ResolvedUrlPattern): boolean {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

/** Include and exclude on the step part of the key (06-REQ-22). */
function selected(stepPart: string, opts: CollectStepsOptions): boolean {
  if (opts.include.length > 0 && !opts.include.some((p) => matches(stepPart, p))) return false;
  return !opts.exclude.some((p) => matches(stepPart, p));
}

/**
 * Walks one step tree pre-order, children in report order (06-REQ-27). Steps of other
 * categories are transparent for keys and depth (06-D-19); a skipped step gives no sample and
 * neither do its children (06-D-16); steps deeper than maxDepth and their children give none
 * (06-REQ-21); a filtered step stays a key segment (06-REQ-22).
 */
export function collectSteps(
  steps: readonly StepNode[],
  opts: CollectStepsOptions,
): { samples: RawStepSample[]; redactions: Redaction[] } {
  const sanitize = createStepTitleSanitizer(opts);
  return collectWith(steps, opts, sanitize);
}

/** Same as collectSteps with a sanitizer compiled once for many results. */
export function collectWith(
  steps: readonly StepNode[],
  opts: CollectStepsOptions,
  sanitize: (title: string) => SanitizedTitle,
): { samples: RawStepSample[]; redactions: Redaction[] } {
  const categories = new Set<string>(opts.categories);
  const samples: RawStepSample[] = [];
  const redactions: Redaction[] = [];

  const walk = (nodes: readonly StepNode[], path: readonly string[], depth: number): void => {
    for (const node of nodes) {
      if (node.skipped) continue;
      if (!categories.has(node.category)) {
        walk(node.steps, path, depth);
        continue;
      }
      const level = depth + 1;
      if (level > opts.maxDepth) continue;
      const title = sanitize(node.title);
      if (title.redacted.length > 0) {
        redactions.push({ rules: title.redacted, location: node.location });
      }
      const own = [...path, title.text];
      const stepPart = own.join(STEP_SEPARATOR);
      if (selected(stepPart, opts)) {
        const key = truncateKey(
          opts.groupBy === 'test' ? `${opts.testPrefix}${TEST_SEPARATOR}${stepPart}` : stepPart,
        );
        const unfinished = node.duration < 0;
        samples.push({
          key,
          duration: unfinished ? null : node.duration,
          endTime: unfinished ? null : node.startTime + node.duration,
          outcome: unfinished ? 'unfinished' : node.hasError ? 'error' : 'ok',
          location: node.location,
        });
      }
      walk(node.steps, own, level);
    }
  };
  walk(steps, [], 0);
  return { samples, redactions };
}

/**
 * Test prefix of keys with groupBy 'test' (06-REQ-23, 06-REQ-39): the file as given, then the
 * sanitized titles of TestCase.titlePath() without project and file.
 */
export function stepTestPrefix(
  file: string,
  titles: readonly string[],
  sanitize: (title: string) => SanitizedTitle,
): string {
  return [file, ...titles.map((t) => sanitize(t).text)].join(STEP_SEPARATOR);
}
