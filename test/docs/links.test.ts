// Relative links in README.md, docs/ and examples/ point to existing files, and anchors to
// existing headings (GitHub's heading slugs).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');

/** GitHub's anchor for a heading: lowercase, punctuation removed, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/gu, '-');
}

function anchors(file: string): Set<string> {
  const text = readFileSync(file, 'utf8').replace(/^```[\s\S]*?^```/gmu, '');
  const seen = new Map<string, number>();
  const result = new Set<string>();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gmu)) {
    const base = slug(match[1] ?? '');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${count}`);
  }
  return result;
}

const files = [
  join(ROOT, 'README.md'),
  ...readdirSync(join(ROOT, 'docs')).map((name) => join(ROOT, 'docs', name)),
  ...['basic', 'with-setup'].map((name) => join(ROOT, 'examples', name, 'README.md')),
].filter((file) => file.endsWith('.md'));

test('slug follows GitHub', () => {
  expect(slug('Situation → what to do')).toBe('situation--what-to-do');
  expect(slug('`pw-perf thresholds --from <report.json>`')).toBe(
    'pw-perf-thresholds---from-reportjson',
  );
  expect(slug('CLI_OUTCOME_MISSING')).toBe('cli_outcome_missing');
});

test('relative links and anchors of the user documentation resolve', () => {
  const broken: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8').replace(/^```[\s\S]*?^```/gmu, '');
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/gu)) {
      const link = match[1] ?? '';
      if (/^[a-z]+:/u.test(link)) continue;
      const [path = '', anchor] = link.split('#');
      const target = path === '' ? file : join(dirname(file), path);
      const where = `${relative(ROOT, file)} → ${link}`;
      if (!existsSync(target)) broken.push(`${where} (no file)`);
      else if (anchor !== undefined && target.endsWith('.md') && !anchors(target).has(anchor)) {
        broken.push(`${where} (no heading)`);
      }
    }
  }
  expect(broken).toEqual([]);
});
