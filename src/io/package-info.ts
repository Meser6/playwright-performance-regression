// The nearest package.json of the Playwright config and its lock files, for the commands of the
// Next: hint (09-REQ-32). Missing or broken files give empty results, never an error.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface PackageInfo {
  /** `scripts` of the nearest package.json at `dir` or above, or null. */
  scripts: Record<string, string> | null;
  lockFiles: { pnpm: boolean; yarn: boolean };
}

export function readPackageInfo(dir: string): PackageInfo {
  for (let current = dir; ; current = dirname(current)) {
    const file = join(current, 'package.json');
    if (existsSync(file)) {
      let scripts: Record<string, string> | null = null;
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { scripts?: unknown };
        if (typeof parsed.scripts === 'object' && parsed.scripts !== null) {
          scripts = Object.fromEntries(
            Object.entries(parsed.scripts).filter(([, v]) => typeof v === 'string'),
          ) as Record<string, string>;
        }
      } catch {
        scripts = null;
      }
      return {
        scripts,
        lockFiles: {
          pnpm: existsSync(join(current, 'pnpm-lock.yaml')),
          yarn: existsSync(join(current, 'yarn.lock')),
        },
      };
    }
    if (dirname(current) === current)
      return { scripts: null, lockFiles: { pnpm: false, yarn: false } };
  }
}
