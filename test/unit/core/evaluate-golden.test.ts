import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  EVALUATE_GOLDEN_DIR,
  compactJson,
  loadEvaluateCases,
  runGoldenCase,
  summarize,
} from './evaluate-helpers.ts';

// Golden cases of the evaluation (12-REQ-14): compact aggregates + thresholds + config → the
// gate result, counters, violations and issue codes. GOLDEN_UPDATE=1 rewrites `expected`
// (12-REQ-16); the diff must be reviewed.
const update = process.env['GOLDEN_UPDATE'] === '1';

describe('evaluate golden cases', () => {
  for (const c of loadEvaluateCases()) {
    test(`${c.name}`, () => {
      const actual = summarize(runGoldenCase(c).evaluation);
      if (update) {
        const { file, ...rest } = c;
        writeFileSync(
          join(EVALUATE_GOLDEN_DIR, file),
          `${compactJson({ ...rest, expected: actual })}\n`,
        );
        return;
      }
      expect(actual).toEqual(c.expected);
    });
  }
});
