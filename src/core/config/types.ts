// Types of the package config (03, chapters 5 and 7). The JSON form is generated from
// schemas/config.schema.json (02-REQ-02); the TypeScript input type differs from it only in URL
// patterns (RegExp allowed) and keys.keyBuilder (a function).
import type { ConfigIssue, DeepPartial, Override } from '../types/common.ts';
import type { PackageConfig } from '../types/generated/formats.ts';
import type { StepsSettingsJson } from './steps.ts';

/** JSON form of the package config: a JSON config file or the snapshot in the run report. */
export type PerfConfigJson = PackageConfig;

/** A string matches as a case-sensitive substring; RegExp and { regex, flags } are regexes. */
export type UrlPattern = string | RegExp | { regex: string; flags?: string };

export interface KeyBuilderInput {
  /** Uppercase HTTP method. */
  method: string;
  /** Raw URL. */
  url: string;
  resourceType: string;
  /** Operation names read by keys.operations, in request order, or null. Never the request body (18-REQ-10). */
  operation: readonly string[] | null;
}

/** Built-in operation extractors of keys.operations (18-REQ-02). */
export type OperationType = 'graphql' | 'trpc';

/** An entry of keys.operations (18-REQ-01): match is tested against the URL path without the query. */
export interface OperationEntryInput {
  type: OperationType;
  match: UrlPattern;
}

/** Return a key, or undefined to fall back to the built-in normalization (07). */
export type KeyBuilder = (req: KeyBuilderInput) => string | undefined;

/** Config accepted by definePerfConfig() and withPerf(); every option is optional. */
export type PerfConfigInput = DeepPartial<
  Override<
    PerfConfigJson,
    {
      measure: {
        include: UrlPattern[];
        exclude: UrlPattern[];
        steps: boolean | (Omit<StepsSettingsJson, 'include' | 'exclude'> & StepPatternsInput);
      };
      keys: {
        extraIdPatterns: UrlPattern[];
        keyBuilder: KeyBuilder;
        operations: OperationEntryInput[];
      };
    }
  >
>;

interface StepPatternsInput {
  include: UrlPattern[];
  exclude: UrlPattern[];
}

/** Every property required, recursively; arrays and tuples are kept as they are. */
type Complete<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]-?: Complete<Exclude<T[K], undefined>> }
    : T;

type CompleteJson = Complete<Omit<PerfConfigJson, '$schema'>>;

/**
 * JSON form of a fully resolved config: every option has a value. keys.keyBuilder is present
 * ("[function]") only when a key builder function was configured (02-REQ-17).
 */
export type ResolvedConfigJson = Omit<CompleteJson, 'keys' | 'measure'> & {
  measure: Omit<CompleteJson['measure'], 'steps'> & { steps: StepsSettingsJson };
  keys: Omit<CompleteJson['keys'], 'keyBuilder'> & { keyBuilder?: '[function]' };
};

/**
 * The schema defaults (03-REQ-05): like ResolvedConfigJson, but measure.steps keeps the schema
 * default `false`; resolveConfig expands it (03-REQ-18).
 */
export type DefaultConfigJson = Omit<ResolvedConfigJson, 'measure'> & {
  measure: Omit<ResolvedConfigJson['measure'], 'steps'> & { steps: boolean };
};

/** A URL pattern after resolution: a substring, or a compiled regular expression. */
export type ResolvedUrlPattern = string | RegExp;

/** Fully resolved config: all options filled in, patterns compiled (03, chapter 5). */
export type ResolvedConfig = Omit<ResolvedConfigJson, 'measure' | 'keys'> & {
  measure: Omit<ResolvedConfigJson['measure'], 'include' | 'exclude' | 'steps'> & {
    include: ResolvedUrlPattern[];
    exclude: ResolvedUrlPattern[];
    steps: ResolvedStepsSettings;
  };
  keys: Omit<ResolvedConfigJson['keys'], 'extraIdPatterns' | 'keyBuilder' | 'operations'> & {
    extraIdPatterns: ResolvedUrlPattern[];
    keyBuilder: KeyBuilder | undefined;
    operations: ResolvedOperationEntry[];
  };
};

/** keys.operations entry after resolution: the pattern compiled (18-REQ-01). */
export interface ResolvedOperationEntry {
  type: OperationType;
  match: ResolvedUrlPattern;
}

/** measure.steps after resolution: full object, patterns compiled (03-REQ-18). */
export type ResolvedStepsSettings = Omit<StepsSettingsJson, 'include' | 'exclude'> & {
  include: ResolvedUrlPattern[];
  exclude: ResolvedUrlPattern[];
};

/** Values that override the config, read from the environment by the mode module (03-REQ-04). */
export interface ConfigOverrides {
  /** From PW_PERF_ENV; replaces run.env. */
  env?: string | null;
  /** From PW_PERF_PASSES or PW_PERF_PASS; replaces run.passes.<mode> (03-REQ-07). */
  passes?: number;
  /** Mode the passes override applies to. Default 'test'. */
  mode?: 'test' | 'thresholds';
  /** From the internal PW_PERF_THRESHOLDS_DIR (the wizard's check, 04-REQ-58); replaces thresholds.dir. */
  thresholdsDir?: string;
  /** From the internal PW_PERF_MIN_SAMPLES (the wizard's check, 04-D-46): caps checks.time.median.minSamples. */
  minSamples?: number;
  /** Where the input came from; 'json' rejects keys.keyBuilder (03-REQ-10). Default 'code'. */
  source?: 'code' | 'json' | 'snapshot';
}

export interface ResolvedConfigResult {
  config: ResolvedConfig;
  /** JSON form for the run report (02-REQ-17): the full effective config. */
  snapshot: ResolvedConfigJson;
  warnings: ConfigIssue[];
}
