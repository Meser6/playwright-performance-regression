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
  ResolvedStepsSettings,
  ResolvedUrlPattern,
  UrlPattern,
} from './types.ts';
export { STEP_DEFAULTS, expandSteps } from './steps.ts';
export type { StepCategory, StepsSettingsJson } from './steps.ts';
