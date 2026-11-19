// Package config in the commands without tests (01, chapter 7.3; 04-REQ-25): --config, a file
// found by name, the snapshot in the run report, the defaults. TypeScript files are loaded by
// Node's own type stripping (V-07); no extra dependency.
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveConfig } from '../core/config/index.ts';
import type { ResolvedConfig, ResolvedConfigJson } from '../core/config/index.ts';
import {
  CONFIG_FILE_BASENAME,
  CONFIG_FILE_EXTENSIONS,
  DOCS_CONFIG_URL,
} from '../core/types/index.ts';
import type { Issue, Result, RunReport } from '../core/types/index.ts';

export type ConfigSource =
  { kind: 'file'; path: string; explicit: boolean } | { kind: 'snapshot' } | { kind: 'defaults' };

export interface CliConfig {
  config: ResolvedConfig;
  snapshot: ResolvedConfigJson;
  source: ConfigSource;
  warnings: Issue[];
  /** Informational lines, e.g. Node warnings printed while the file loaded (01-REQ-41). */
  notes: string[];
}

export interface CliConfigInput {
  /** --config, resolved to an absolute path. */
  explicit?: string;
  /** Directories searched for pw-perf.config.* in order (cwd, then configDir of the report). */
  searchDirs: string[];
  /** Run report whose snapshot is source 3. */
  report?: RunReport;
  mode: 'test' | 'thresholds';
  /** Environment label override (--env, or env of the report). */
  env?: string | null;
}

export interface ConfigLoaderHost {
  exists: (path: string) => Promise<boolean>;
  /** Imports a module by file URL; default: Node's dynamic import. */
  importModule?: (url: string) => Promise<unknown>;
}

interface NodeError {
  code?: unknown;
  message?: unknown;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? message;
}

/** Fix hint for a file that Node could not load (01-REQ-41, V-07). */
export function loadFailureHint(error: unknown): string {
  const e = (typeof error === 'object' && error !== null ? error : {}) as NodeError;
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
    return 'Node loads the file by stripping the types: replace enums, namespaces with code and constructor parameter properties with erasable syntax.';
  }
  if (e.code === 'ERR_MODULE_NOT_FOUND' && message.startsWith('Cannot find module')) {
    return 'Add the extension to relative imports, e.g. "./helpers.ts" instead of "./helpers".';
  }
  if (e.code === 'ERR_MODULE_NOT_FOUND' && message.startsWith('Cannot find package')) {
    return 'Path aliases from tsconfig do not work when Node loads the file: use a relative import.';
  }
  return 'Fix the error in the file, or pass another package config with --config.';
}

function loadFailed(path: string, reason: string, hint: string): Issue {
  return {
    code: 'CONFIG_FILE_LOAD_FAILED',
    message: `The package config ${path} cannot be loaded: ${reason}`,
    hint,
  };
}

/** Node warnings expected while a TypeScript file loads; printed as one note (01-REQ-41). */
function isLoadingWarning(warning: Error & { code?: string }): boolean {
  return (
    (warning.name === 'ExperimentalWarning' && /type stripping/iu.test(warning.message)) ||
    warning.code === 'MODULE_TYPELESS_PACKAGE_JSON'
  );
}

/**
 * Imports `path` and catches the Node warnings it causes: loading warnings become notes, other
 * warnings go to Node's own listeners unchanged.
 */
async function importCapturingWarnings(
  path: string,
  importModule: (url: string) => Promise<unknown>,
  notes: string[],
): Promise<unknown> {
  const listeners = process.listeners('warning');
  const captured: (Error & { code?: string })[] = [];
  const capture = (warning: Error): void => {
    captured.push(warning);
  };
  process.removeAllListeners('warning');
  process.on('warning', capture);
  try {
    return await importModule(pathToFileURL(path).href);
  } finally {
    // Warnings are emitted on the next tick.
    await new Promise((resolve) => setImmediate(resolve));
    process.off('warning', capture);
    for (const listener of listeners) process.on('warning', listener);
    const loading = captured.filter(isLoadingWarning);
    if (loading.length > 0) {
      notes.push(
        `note: Node printed ${loading.length === 1 ? 'a warning' : `${loading.length} warnings`} while loading ${basename(path)}: ${loading.map((w) => w.message.split('\n')[0]).join('; ')}`,
      );
    }
    for (const warning of captured.filter((w) => !isLoadingWarning(w))) {
      for (const listener of listeners) listener(warning);
    }
  }
}

/** The config value of a loaded module: the default export (also `{ default }` from CJS, V-02). */
function defaultExport(module: unknown): unknown {
  if (typeof module !== 'object' || module === null || !('default' in module)) return undefined;
  const value = (module as { default: unknown }).default;
  if (typeof value === 'object' && value !== null && 'default' in value) {
    const keys = Object.keys(value).filter((k) => k !== '__esModule');
    if (keys.length === 1) return (value as { default: unknown }).default;
  }
  return value;
}

async function loadFile(
  path: string,
  host: ConfigLoaderHost,
  notes: string[],
): Promise<Result<{ value: unknown; json: boolean }, Issue>> {
  const json = extname(path) === '.json';
  try {
    if (json) {
      return { ok: true, value: { value: JSON.parse(await readFile(path, 'utf8')), json } };
    }
    const module = await importCapturingWarnings(
      path,
      host.importModule ?? ((url) => import(url)),
      notes,
    );
    const value = defaultExport(module);
    if (value === undefined) {
      return {
        ok: false,
        issues: [
          loadFailed(
            path,
            'the file has no default export.',
            'Export the config as default: export default definePerfConfig({ ... }).',
          ),
        ],
      };
    }
    return { ok: true, value: { value, json } };
  } catch (error) {
    return {
      ok: false,
      issues: [
        loadFailed(
          path,
          errorText(error),
          json ? 'Fix the JSON syntax of the file.' : loadFailureHint(error),
        ),
      ],
    };
  }
}

/** First pw-perf.config.* in the directories, in extension order (01, chapter 7.3). */
export async function findConfigFile(
  dirs: readonly string[],
  exists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  for (const dir of dirs) {
    for (const ext of CONFIG_FILE_EXTENSIONS) {
      const path = join(dir, `${CONFIG_FILE_BASENAME}${ext}`);
      if (await exists(path)) return path;
    }
  }
  return null;
}

/**
 * Options that do not change the derivation or the evaluation (01-REQ-31): how the run is
 * executed, the report and where the thresholds files are.
 */
const IGNORED_OPTIONS: ReadonlySet<string> = new Set([
  '$schema',
  'run',
  'report',
  'thresholds.dir',
  'thresholds.filePrefix',
]);

/** Option paths whose values differ between two config snapshots (01-REQ-31). */
export function snapshotDifferences(a: unknown, b: unknown, path: string[] = []): string[] {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys
      .filter((k) => !IGNORED_OPTIONS.has([...path, k].join('.')))
      .flatMap((k) => snapshotDifferences(a[k], b[k], [...path, k]));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [path.join('.')];
}

/** At most this many option paths are listed in CONFIG_SNAPSHOT_DIFFERS. */
const MAX_LISTED_DIFFERENCES = 10;

function differsWarning(paths: string[]): Issue {
  const listed = paths.slice(0, MAX_LISTED_DIFFERENCES).join(', ');
  const more =
    paths.length > MAX_LISTED_DIFFERENCES
      ? ` and ${paths.length - MAX_LISTED_DIFFERENCES} more`
      : '';
  return {
    code: 'CONFIG_SNAPSHOT_DIFFERS',
    message: `The package config file differs from the config the report was recorded with: ${listed}${more}.`,
    hint: 'The file is used. If the run used other settings on purpose, check the result, or run the measurement again with the current config.',
  };
}

function configErrors(issues: Issue[], where: string): Issue[] {
  return issues.map((issue) => ({
    ...issue,
    message: `${where}: ${issue.message}`,
    hint: issue.hint ?? `See ${DOCS_CONFIG_URL} for all options.`,
  }));
}

/** Resolves the package config from the sources of 01, chapter 7.3, in their order. */
export async function resolveCliConfig(
  input: CliConfigInput,
  host: ConfigLoaderHost,
): Promise<Result<CliConfig, Issue>> {
  const warnings: Issue[] = [];
  const notes: string[] = [];
  const overrides = {
    mode: input.mode,
    ...(input.env === undefined ? {} : { env: input.env }),
  };

  let file: { path: string; explicit: boolean } | null = null;
  if (input.explicit !== undefined) {
    if (!(await host.exists(input.explicit))) {
      return {
        ok: false,
        issues: [
          {
            code: 'CONFIG_FILE_NOT_FOUND',
            message: `The package config file given with --config does not exist: ${input.explicit}`,
            hint: 'Check the path; it is resolved against the current directory.',
          },
        ],
      };
    }
    file = { path: input.explicit, explicit: true };
  } else {
    const found = await findConfigFile(input.searchDirs, host.exists);
    if (found !== null) file = { path: found, explicit: false };
  }

  if (file !== null) {
    const loaded = await loadFile(file.path, host, notes);
    if (loaded.ok) {
      const resolved = resolveConfig(loaded.value.value as never, {
        ...overrides,
        source: loaded.value.json ? 'json' : 'code',
      });
      if (!resolved.ok) return { ok: false, issues: configErrors(resolved.issues, file.path) };
      warnings.push(...resolved.value.warnings);
      if (input.report !== undefined) {
        const differences = snapshotDifferences(resolved.value.snapshot, input.report.config);
        if (differences.length > 0) warnings.push(differsWarning(differences));
      }
      return {
        ok: true,
        value: {
          config: resolved.value.config,
          snapshot: resolved.value.snapshot,
          source: { kind: 'file', ...file },
          warnings,
          notes,
        },
      };
    }
    // A file given with --config must load; a file found by name falls back (01-REQ-38).
    if (file.explicit) return { ok: false, issues: loaded.issues };
    warnings.push(
      ...loaded.issues.map((issue) => ({
        ...issue,
        message: `${issue.message} The ${input.report === undefined ? 'default config' : 'config snapshot of the report'} is used instead.`,
      })),
    );
  }

  const fromSnapshot = input.report !== undefined;
  const resolved = resolveConfig(fromSnapshot ? (input.report?.config as never) : undefined, {
    ...overrides,
    source: fromSnapshot ? 'snapshot' : 'code',
  });
  if (!resolved.ok) {
    return {
      ok: false,
      issues: configErrors(
        resolved.issues,
        fromSnapshot ? 'config snapshot of the report' : 'default config',
      ),
    };
  }
  warnings.push(...resolved.value.warnings);
  return {
    ok: true,
    value: {
      config: resolved.value.config,
      snapshot: resolved.value.snapshot,
      source: fromSnapshot ? { kind: 'snapshot' } : { kind: 'defaults' },
      warnings,
      notes,
    },
  };
}

/** The line that names the config source (01-REQ-30). */
export function configSourceLine(source: ConfigSource): string {
  switch (source.kind) {
    case 'file':
      return `config: ${source.path}${source.explicit ? ' (--config)' : ''}`;
    case 'snapshot':
      return 'config: the config snapshot in the report';
    case 'defaults':
      return 'config: the defaults';
  }
}
