import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { firstSentence, generate } from '../../scripts/build-config-template.mjs';

const root = join(import.meta.dirname, '../..');
const outFile = join(root, 'src/cli/init/generated/config-options.ts');

describe('build-config-template', () => {
  test('04-REQ-46 the option list of the wizard matches the generator output', async () => {
    expect(readFileSync(outFile, 'utf8')).toBe(await generate());
    expect(
      execFileSync(process.execPath, [join(root, 'scripts/build-config-template.mjs'), '--check'], {
        encoding: 'utf8',
      }),
    ).toContain('up to date');
  });

  test('firstSentence keeps abbreviations and drops code spans', () => {
    expect(firstSentence('Environment label. Overridden by PW_PERF_ENV / --env.')).toBe(
      'Environment label.',
    );
    expect(firstSentence('Relative headroom, e.g. 0.4 = +40%. More.')).toBe(
      'Relative headroom, e.g. 0.4 = +40%.',
    );
    expect(firstSentence("Which projects. 'auto': Chromium projects.")).toBe('Which projects.');
    expect(firstSentence('Builds the key `yourself`')).toBe('Builds the key yourself.');
    expect(firstSentence('A ratio: 0.5 means half.\nNext line.')).toBe('A ratio: 0.5 means half.');
  });
});
