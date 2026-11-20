// Locating and reading the thresholds files of a run (09-REQ-01 – 09-REQ-03; 02, chapter 8.1).
// The reporter and `thresholds --from` read them the same way (10, chapter 3).
import type { LoadedThresholds, LoadedThresholdsFile } from '../core/evaluate/index.ts';
import { parseThresholdsFile } from '../core/schema/index.ts';
import type { Kind } from '../core/types/index.ts';
import { fileExists, readTextFile, relativeSlashPath, resolvePath } from './files.ts';

export interface ThresholdsLocation {
  /** Absolute directory of the Playwright config file; base of thresholds.dir (01-REQ-21). */
  configDir: string;
  /** thresholds.dir of the config. */
  dir: string;
  /** thresholds.filePrefix of the config. */
  filePrefix: string;
  /** Environment label of the run, or null. */
  env: string | null;
}

const KINDS: readonly Kind[] = ['api'];

/** `<prefix>.<kind>[.<env>].json` (02, chapter 8.1). */
export function thresholdsFileName(prefix: string, kind: Kind, env: string | null): string {
  return `${prefix}.${kind}${env === null ? '' : `.${env}`}.json`;
}

/** Absolute paths of the thresholds files of every kind for the label of the run. */
export function thresholdsFilePaths(location: ThresholdsLocation): Record<Kind, string> {
  const dir = resolvePath(location.configDir, location.dir);
  const path = (kind: Kind): string =>
    resolvePath(dir, thresholdsFileName(location.filePrefix, kind, location.env));
  return Object.fromEntries(KINDS.map((kind) => [kind, path(kind)])) as Record<Kind, string>;
}

async function loadFile(location: ThresholdsLocation, kind: Kind): Promise<LoadedThresholdsFile> {
  const absolute = thresholdsFilePaths(location)[kind];
  const path = relativeSlashPath(location.configDir, absolute);
  let text: string | null;
  try {
    text = await readTextFile(absolute);
  } catch (error) {
    // The file is there but cannot be read: never fall back to default thresholds (09-REQ-02).
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: 'invalid',
      kind,
      path,
      issues: [
        {
          code: 'SCHEMA_INVALID_JSON',
          source: path,
          message: `${path}: the file cannot be read (${reason})`,
          problems: [],
        },
      ],
    };
  }
  if (text === null) {
    // Only the file for the label of the run is used (09-REQ-03); the one without the label is
    // mentioned in the hint.
    const envless =
      location.env !== null &&
      (await fileExists(
        resolvePath(
          resolvePath(location.configDir, location.dir),
          thresholdsFileName(location.filePrefix, kind, null),
        ),
      ));
    return { status: 'missing', kind, path, envlessFileExists: envless };
  }
  const parsed = parseThresholdsFile(text, path, kind);
  if (!parsed.ok) return { status: 'invalid', kind, path, issues: parsed.issues };
  const { file, migratedFrom } = parsed.value;
  return {
    status: 'loaded',
    kind,
    path,
    file,
    ...(migratedFrom === null ? {} : { migratedFrom }),
  };
}

/**
 * Reads the thresholds files of every kind (09-REQ-01, 09-REQ-02): `loaded`, `missing` or
 * `invalid`. Paths in the result are relative to configDir with forward slashes. Files of
 * removed kinds (pw-perf-thresholds.custom…, D-32) are not looked for.
 */
export async function loadThresholds(location: ThresholdsLocation): Promise<LoadedThresholds> {
  const files = await Promise.all(KINDS.map((kind) => loadFile(location, kind)));
  return Object.fromEntries(KINDS.map((kind, i) => [kind, files[i]])) as Record<
    Kind,
    LoadedThresholdsFile
  >;
}
