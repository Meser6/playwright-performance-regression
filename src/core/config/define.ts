// definePerfConfig() and perfDefaults (03, chapter 5).
import { resolveConfig } from './resolve.ts';
import type { PerfConfigInput, ResolvedConfig } from './types.ts';

/** Returns `config` unchanged; it only gives editor type hints in a config file (D-15). */
export function definePerfConfig(config: PerfConfigInput): PerfConfigInput {
  return config;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function resolveDefaults(): ResolvedConfig {
  const result = resolveConfig(undefined, {});
  if (!result.ok) throw new Error('the schema defaults are not a valid config');
  return result.value.config;
}

/**
 * Fully resolved defaults, deeply frozen. Use them to extend a default list instead of
 * replacing it: `exclude: [...perfDefaults.measure.exclude, 'intercom.io']` (03-REQ-06).
 */
export const perfDefaults: ResolvedConfig = deepFreeze(resolveDefaults());
