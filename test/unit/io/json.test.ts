import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { writeJsonStable, writeTextAtomic } from '../../../src/io/json.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-perf-io-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeJsonStable (01-REQ-20)', () => {
  test('02-AC-07 writes sorted JSON with 2-space indent and a final newline; rewriting is a no-op', async () => {
    const path = join(dir, 'report.json');
    await writeJsonStable(path, { b: [2, 1], a: { y: 1, x: null } });
    const first = readFileSync(path, 'utf8');
    expect(first).toBe(
      '{\n  "a": {\n    "x": null,\n    "y": 1\n  },\n  "b": [\n    2,\n    1\n  ]\n}\n',
    );

    await writeJsonStable(path, JSON.parse(first));
    expect(readFileSync(path, 'utf8')).toBe(first);
    expect(readdirSync(dir)).toEqual(['report.json']);
  });

  test('writes UTF-8 without BOM and creates missing directories', async () => {
    const path = join(dir, 'nested', 'deeper', 'out.json');
    await writeJsonStable(path, { key: 'ż' });
    const bytes = readFileSync(path);
    expect(bytes[0]).toBe(0x7b);
    expect(bytes.toString('utf8')).toBe('{\n  "key": "ż"\n}\n');
  });

  test('a value that cannot be serialised leaves the existing file untouched', async () => {
    const path = join(dir, 'out.json');
    writeFileSync(path, 'old\n');
    await expect(writeJsonStable(path, { a: Number.NaN })).rejects.toThrow(/NaN/);
    expect(readFileSync(path, 'utf8')).toBe('old\n');
    expect(readdirSync(dir)).toEqual(['out.json']);
  });
});

describe('writeTextAtomic', () => {
  test('replaces the file through a temporary file in the same directory', async () => {
    const path = join(dir, 'out.txt');
    writeFileSync(path, 'old');
    await writeTextAtomic(path, 'new');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['out.txt']);
  });

  test('removes the temporary file when the rename fails', async () => {
    const target = join(dir, 'is-a-dir');
    await writeTextAtomic(join(target, 'x'), 'x');
    await expect(writeTextAtomic(target, 'text')).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(['is-a-dir']);
  });
});
