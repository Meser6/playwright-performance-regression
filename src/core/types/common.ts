// Shared core types (01, chapter 4.1). Every other module uses these definitions.
import type { Issue } from './generated/formats.ts';

export type { Issue };

/** Value or the list of problems that prevented it (01-REQ-04). */
export type Result<T, E = Issue> = { ok: true; value: T } | { ok: false; issues: E[] };

/** CONFIG_* issues; path is the option path, e.g. "measure.exclude". */
export type ConfigIssue = Issue & { path?: string };
/** MODE_* issues. */
export type ModeIssue = Issue;
/** CLI_* and INIT_* issues. */
export type CliIssue = Issue;
/** Issue about a file; path is the file the problem concerns. */
export type IoIssue = Issue & { path: string };

/** Thrown by withPerf() for an invalid package config or mode environment; lists all issues. */
export class ConfigError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(
      [
        'Invalid playwright-performance-regression configuration:',
        ...issues.map((issue) => {
          const where = issue.path === undefined ? '' : ` (${issue.path})`;
          const hint = issue.hint === undefined ? '' : ` ${issue.hint}`;
          return `- ${issue.code}${where}: ${issue.message}${hint}`;
        }),
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Sink for collector and custom-measurement diagnostics, collapsed by code. */
export interface Diagnostics {
  add(issue: Issue): void;
  list(): Issue[];
}

/**
 * Type helpers for the config input type. Functions (keys.keyBuilder) and arrays are replaced
 * as a whole, never mapped over: a mapped function type would lose its call signature.
 */
type Whole = readonly unknown[] | ((...args: never[]) => unknown);
export type DeepPartial<T> = T extends readonly (infer U)[]
  ? U[]
  : T extends Whole
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;
export type Override<T, U> = {
  [K in keyof T]: K extends keyof U
    ? U[K] extends Whole
      ? U[K]
      : U[K] extends object
        ? Override<T[K], U[K]>
        : U[K]
    : T[K];
};
