// Key explosion of step keys after aggregation (06-REQ-26); samples are never dropped (07-D-11).
import { CARDINALITY_MIN_KEYS, MAX_KEYS_WARNING } from '../normalize/constants.ts';
import type { Issue } from '../types/index.ts';
import type { Redaction } from './collect.ts';

const EXAMPLES = 3;
const QUOTE_CHARS = new Set([...'"\'`“”„‘’«']);

export type StepsIssueCode =
  'STEPS_NONE_FOUND' | 'STEPS_HIGH_CARDINALITY' | 'STEPS_TOO_MANY_KEYS' | 'STEPS_SECRET_REDACTED';

export type StepsIssue = Issue & { code: StepsIssueCode };

const LOCATIONS = 5;

/**
 * STEPS_HIGH_CARDINALITY for every group of at least CARDINALITY_MIN_KEYS keys that differ only
 * in the word at one position (the same segment and word counts), and STEPS_TOO_MANY_KEYS for
 * more than MAX_KEYS_WARNING keys. Groups and examples are sorted (P-06).
 */
export function detectStepKeyExplosion(stepKeys: readonly string[]): StepsIssue[] {
  const unique = [...new Set(stepKeys)].sort();
  const groups = new Map<string, { keys: string[]; quoted: boolean }>();
  for (const key of unique) {
    const words = key.split(' ');
    words.forEach((word, i) => {
      const template = words.map((w, j) => (j === i ? '*' : w)).join(' ');
      const quoted = QUOTE_CHARS.has(word[0] ?? '') || QUOTE_CHARS.has(word.at(-1) ?? '');
      const group = groups.get(template);
      if (group === undefined) groups.set(template, { keys: [key], quoted });
      else {
        group.keys.push(key);
        group.quoted ||= quoted;
      }
    });
  }
  const issues: StepsIssue[] = [];
  for (const template of [...groups.keys()].sort()) {
    const group = groups.get(template);
    if (group === undefined || group.keys.length < CARDINALITY_MIN_KEYS) continue;
    const examples = group.keys.slice(0, EXAMPLES).join(', ');
    issues.push({
      code: 'STEPS_HIGH_CARDINALITY',
      message: `${group.keys.length} step keys differ only in one word: ${template} (e.g. ${examples}).`,
      hint: `If the word is test data, keep it out of the step title, add a pattern to keys.extraIdPatterns or exclude the step with measure.steps.exclude${
        group.quoted ? '; for quoted values set measure.steps.redactQuotedValues to true' : ''
      }.`,
    });
  }
  if (unique.length > MAX_KEYS_WARNING) {
    issues.push({
      code: 'STEPS_TOO_MANY_KEYS',
      message: `The run has ${unique.length} step keys, more than ${MAX_KEYS_WARNING}.`,
      hint: 'Measure fewer steps: keep measure.steps.categories at ["test.step"] or lower measure.steps.maxDepth.',
    });
  }
  return issues;
}

/**
 * One STEPS_SECRET_REDACTED for the run when privacy rules P1–P4 fired: the number of titles,
 * the rule names and up to five sorted locations, never the titles (06-REQ-38, 06-REQ-37).
 */
export function secretRedactedIssue(redactions: readonly Redaction[]): StepsIssue | null {
  if (redactions.length === 0) return null;
  const rules = new Set(redactions.flatMap((r) => r.rules));
  const names = [...rules].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const locations = [
    ...new Set(
      redactions.flatMap((r) =>
        r.location === null ? [] : [`${r.location.file}:${r.location.line}`],
      ),
    ),
  ].sort((a, b) => {
    const [fa = '', la = '0'] = a.split(/:(?=[0-9]+$)/u);
    const [fb = '', lb = '0'] = b.split(/:(?=[0-9]+$)/u);
    return fa < fb ? -1 : fa > fb ? 1 : Number(la) - Number(lb);
  });
  const shown = locations.slice(0, LOCATIONS).join(', ');
  const n = redactions.length;
  return {
    code: 'STEPS_SECRET_REDACTED',
    message: `${n} step ${n === 1 ? 'title contains' : 'titles contain'} a URL or a secret (rules: ${names.join(', ')})${shown === '' ? '' : ` at ${shown}`}${locations.length > LOCATIONS ? ', …' : ''}; the keys show placeholders instead.`,
    hint: 'Sensitive data in a step title also reaches Playwright reports and traces; remove it from the title.',
  };
}

/** STEPS_NONE_FOUND when measure.steps is on and the run gave no step sample (06-REQ-29). */
export function noStepsIssue(): StepsIssue {
  return {
    code: 'STEPS_NONE_FOUND',
    message: 'measure.steps is enabled, but the measured tests gave no step samples.',
    hint: 'Check that the tests use test.step, and the measure.steps include, exclude and categories settings.',
  };
}
