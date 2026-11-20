import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { formatThresholdsDiff } from '../../../src/console/thresholds-diff.ts';
import {
  deriveThresholds,
  diffThresholds,
  formatThresholdsDiffMarkdown,
} from '../../../src/core/thresholds/index.ts';
import { compactJson } from './evaluate-helpers.ts';
import {
  DERIVE_GOLDEN_DIR,
  DIFF_GOLDEN_DIR,
  cfg,
  deriveOptions,
  goldenExisting,
  loadThresholdsCases,
  runReport,
} from './thresholds-helpers.ts';
import type { ThresholdsGoldenCase } from './thresholds-helpers.ts';

// Golden cases of the thresholds derivation and diff (12-REQ-14): report + config + existing
// files → derived files and warnings (derive/), and → diff, console text and thresholds-diff.md
// (diff/). GOLDEN_UPDATE=1 rewrites the expected output (12-REQ-16); the diff must be reviewed.
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

function compareText(path: string, actual: string): void {
  if (update) {
    writeFileSync(path, actual);
    return;
  }
  expect(existsSync(path), `${path} exists`).toBe(true);
  expect(actual).toBe(readFileSync(path, 'utf8'));
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

describe('diff golden cases', () => {
  for (const c of loadThresholdsCases(DIFF_GOLDEN_DIR)) {
    test(c.name, () => {
      const { report, config, files, result } = derive(c);
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      const diffs = result.value.files.map((f) => diffThresholds(files[f.kind], f, report, config));
      const paths = diffs.map((d) => files[d.kind].path);
      if (update) write(DIFF_GOLDEN_DIR, c, diffs);
      else expect(diffs).toEqual(c.expected);
      const base = join(DIFF_GOLDEN_DIR, c.file.replace(/\.json$/u, ''));
      compareText(
        `${base}.console.txt`,
        formatThresholdsDiff(diffs, {
          paths,
          width: 120,
          color: false,
          prune: c.input.options.prune ?? false,
          diffPath: 'pw-perf-results/thresholds-diff.md',
        }),
      );
      compareText(`${base}.md`, formatThresholdsDiffMarkdown(diffs, paths));
    });
  }
});
