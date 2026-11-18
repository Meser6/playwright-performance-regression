// Package entry point "playwright-performance-regression": config helpers and public types
// (01, chapter 9).
export { definePerfConfig, perfDefaults } from '../core/config/index.ts';
export type {
  KeyBuilder,
  KeyBuilderInput,
  PerfConfigInput,
  PerfConfigJson,
  ResolvedConfig,
  UrlPattern,
} from '../core/config/index.ts';
