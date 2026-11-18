// Normalization fingerprint and base origins (07-REQ-20, 07-REQ-21).
import type { ResolvedConfig } from '../config/index.ts';
import { stringifyStable } from '../format/index.ts';
import { hashHex } from '../random/index.ts';
import { NORMALIZE_RULES_VERSION } from './constants.ts';
import { canonicalOrigin, canonicalOrigins } from './key-builder.ts';
import type { KeyBuilderContext } from './key-builder.ts';

export interface ProjectBaseUrl {
  role: string;
  /** use.baseURL of the project, if set. */
  baseURL?: string | null | undefined;
}

/**
 * Origins of use.baseURL of measured projects only: unique, canonical, sorted (07-REQ-20).
 * Dependency and teardown projects do not change labels or the fingerprint.
 */
export function measuredBaseOrigins(projects: readonly ProjectBaseUrl[]): string[] {
  const origins: string[] = [];
  for (const project of projects) {
    if (project.role !== 'measured' || project.baseURL == null) continue;
    const origin = canonicalOrigin(project.baseURL);
    if (origin !== null) origins.push(origin);
  }
  return canonicalOrigins(origins);
}

/**
 * hash53 with FIXED_HASH_SEED of the stable JSON text of { rulesVersion, keys, baseOrigins },
 * as 14 lowercase hex digits (07-REQ-21). `keys` is the effective config section in its JSON
 * form: regexes as { regex, flags }, keyBuilder as "[function]" when set. The body of the
 * keyBuilder function does not change the fingerprint.
 */
export function normalizationFingerprint(
  cfg: ResolvedConfig['keys'],
  ctx: KeyBuilderContext,
): string {
  const { keyBuilder, extraIdPatterns, ...rest } = cfg;
  const keys = {
    ...rest,
    extraIdPatterns: extraIdPatterns.map((p) =>
      typeof p === 'string' ? p : { regex: p.source, flags: p.flags },
    ),
    keyBuilder: keyBuilder === undefined ? undefined : '[function]',
  };
  return hashHex(
    stringifyStable({
      rulesVersion: NORMALIZE_RULES_VERSION,
      keys,
      baseOrigins: canonicalOrigins(ctx.baseOrigins),
    }),
  );
}
