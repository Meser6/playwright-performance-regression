// The nearest package.json of the Playwright config and its lock files, for the commands of the
// Next: hint (09-REQ-32). Missing or broken files give empty results, never an error.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export interface PackageInfo {
  /** `scripts` of the nearest package.json at `dir` or above ({} without the field), or null when
   * there is none or it cannot be read. */
  scripts: Record<string, string> | null;
  lockFiles: { pnpm: boolean; yarn: boolean };
}

export function readPackageInfo(dir: string): PackageInfo {
  for (let current = dir; ; current = dirname(current)) {
    const file = join(current, 'package.json');
    if (existsSync(file)) {
      let scripts: Record<string, string> | null = {};
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

/**
 * What a report is about (02-REQ-42): the `name` of the package.json directly in the config
 * directory (not above: in a monorepo the root package is shared), else the config path relative
 * to the nearest directory with `.git`; null when neither is known.
 */
export function readSuite(
  configDir: string,
  configFile: string | undefined,
): { name: string; source: 'package' | 'config' } | null {
  try {
    const parsed = JSON.parse(readFileSync(join(configDir, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    if (typeof parsed.name === 'string' && parsed.name.trim() !== '') {
      return { name: parsed.name.trim(), source: 'package' };
    }
  } catch {
    // No or a broken package.json: the config path below.
  }
  for (let current = configDir; ; current = dirname(current)) {
    if (existsSync(join(current, '.git'))) {
      const path = relative(current, configFile ?? configDir)
        .split(sep)
        .join('/');
      return path === '' ? null : { name: path, source: 'config' };
    }
    if (dirname(current) === current) return null;
  }
}
