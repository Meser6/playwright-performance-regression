import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { deriveThresholds } from '../../../src/core/thresholds/index.ts';
import { compactJson } from './evaluate-helpers.ts';
import {
  DERIVE_GOLDEN_DIR,
  cfg,
  deriveOptions,
  goldenExisting,
  loadThresholdsCases,
  runReport,
} from './thresholds-helpers.ts';
import type { ThresholdsGoldenCase } from './thresholds-helpers.ts';

// Golden cases of the thresholds derivation (12-REQ-14): report + config + existing files →
// derived files and warnings (derive/). GOLDEN_UPDATE=1 rewrites the expected output (12-REQ-16); the diff must be reviewed.
const update = process.env['GOLDEN_UPDATE'] === '1';

function derive(c: ThresholdsGoldenCase) {
  const report = runReport(c.input.report);
  const config = cfg(c.input.config);
  const files = goldenExisting(c);
  const result = deriveThresholds(report, config, files, deriveOptions(c.input.options));
  return { report, config, files, result };
}

function write(dir: string, c: ThresholdsGoldenCase, expected: unknown): void {
  const { file, ...rest } = c;
  writeFileSync(join(dir, file), `${compactJson({ ...rest, expected })}\n`);
}

describe('derive golden cases', () => {
  for (const c of loadThresholdsCases(DERIVE_GOLDEN_DIR)) {
    test(c.name, () => {
      const { result } = derive(c);
      const actual = result.ok
        ? {
            ok: true,
            files: result.value.files,
            warnings: result.value.warnings.map(({ code, message }) => ({ code, message })),
          }
        : { ok: false, issues: result.issues.map(({ code, message }) => ({ code, message })) };
      if (update) {
        write(DERIVE_GOLDEN_DIR, c, actual);
        return;
      }
      expect(actual).toEqual(c.expected);
    });
  }
});
