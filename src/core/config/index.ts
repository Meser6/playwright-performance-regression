// Package config: defaults, resolution and validation (03).
export { definePerfConfig, perfDefaults } from './define.ts';
export { DEFAULT_CONFIG } from './generated/defaults.ts';
export { resolveConfig } from './resolve.ts';
export type { ConfigIssueCode } from './validate.ts';
export type {
  ConfigOverrides,
  KeyBuilder,
  KeyBuilderInput,
  PerfConfigInput,
  PerfConfigJson,
  ResolvedConfig,
  ResolvedConfigJson,
  ResolvedConfigResult,
  ResolvedUrlPattern,
  UrlPattern,
} from './types.ts';
