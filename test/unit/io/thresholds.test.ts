import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readTextFile, relativeSlashPath } from '../../../src/io/files.ts';
import {
  loadThresholds,
  thresholdsFileName,
  thresholdsFilePaths,
} from '../../../src/io/thresholds.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-perf-thresholds-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const file = (kind: string, entries: object = {}): string =>
  JSON.stringify({ schemaVersion: 2, kind, generated: null, entries });

describe('thresholds files (09-REQ-01 – 09-REQ-03)', () => {
  test('file names follow 02 chapter 8.1 and thresholds.dir is relative to configDir', () => {
    expect(thresholdsFileName('pw-perf-thresholds', 'api', null)).toBe(
      'pw-perf-thresholds.api.json',
    );
    expect(thresholdsFileName('p', 'api', 'qa')).toBe('p.api.qa.json');
    const paths = thresholdsFilePaths({ configDir: dir, dir: 'perf', filePrefix: 'p', env: 'qa' });
    expect(paths).toEqual({ api: join(dir, 'perf', 'p.api.qa.json') });
  });

  test('loaded, missing and invalid files with paths relative to configDir', async () => {
    mkdirSync(join(dir, 'perf'));
    writeFileSync(join(dir, 'perf', 'p.api.json'), file('api'));
    const loaded = await loadThresholds({
      configDir: dir,
      dir: 'perf',
      filePrefix: 'p',
      env: null,
    });
    expect(loaded.api).toMatchObject({ status: 'loaded', kind: 'api', path: 'perf/p.api.json' });

    writeFileSync(join(dir, 'perf', 'p.api.json'), '{');
    const invalid = await loadThresholds({
      configDir: dir,
      dir: 'perf',
      filePrefix: 'p',
      env: null,
    });
    expect(invalid.api).toMatchObject({ status: 'invalid', path: 'perf/p.api.json' });
    if (invalid.api.status !== 'invalid') throw new Error('unreachable');
    expect(invalid.api.issues[0]?.code).toBe('SCHEMA_INVALID_JSON');

    rmSync(join(dir, 'perf', 'p.api.json'));
    const missing = await loadThresholds({
      configDir: dir,
      dir: 'perf',
      filePrefix: 'p',
      env: null,
    });
    expect(missing).toEqual({
      api: { status: 'missing', kind: 'api', path: 'perf/p.api.json', envlessFileExists: false },
    });
  });

  test('09-AC-23 an existing file of the removed custom kind is not read (D-32)', async () => {
    writeFileSync(join(dir, 'pw-perf-thresholds.custom.json'), file('custom', { flow: {} }));
    const loaded = await loadThresholds({
      configDir: dir,
      dir: '.',
      filePrefix: 'pw-perf-thresholds',
      env: null,
    });
    expect(Object.keys(loaded)).toEqual(['api']);
    expect(loaded.api.status).toBe('missing');
  });

  test('09-AC-16 with an environment label the file without the label is not used', async () => {
    writeFileSync(join(dir, 'pw-perf-thresholds.api.json'), file('api'));
    const loaded = await loadThresholds({
      configDir: dir,
      dir: '.',
      filePrefix: 'pw-perf-thresholds',
      env: 'qa',
    });
    expect(loaded.api).toEqual({
      status: 'missing',
      kind: 'api',
      path: 'pw-perf-thresholds.api.qa.json',
      envlessFileExists: true,
    });
  });

  test('a path that cannot be read is invalid, never a fallback to defaults', async () => {
    mkdirSync(join(dir, 'pw-perf-thresholds.api.json'));
    const loaded = await loadThresholds({
      configDir: dir,
      dir: '.',
      filePrefix: 'pw-perf-thresholds',
      env: null,
    });
    expect(loaded.api.status).toBe('invalid');
  });

  test('readTextFile gives null for a missing file; relativeSlashPath uses forward slashes', async () => {
    expect(await readTextFile(join(dir, 'none.json'))).toBeNull();
    expect(relativeSlashPath(dir, join(dir, 'a', 'b.json'))).toBe('a/b.json');
    expect(relativeSlashPath(dir, dir)).toBe('.');
  });
});
