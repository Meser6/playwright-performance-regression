// Step normalization fingerprint (06-REQ-25).
import type { ResolvedConfig, ResolvedStepsSettings } from '../config/index.ts';
import { stringifyStable } from '../format/index.ts';
import { hashHex } from '../random/index.ts';

/** Version of the step key rules; grows when a golden case gets another key (06-REQ-25, P-13). */
export const STEP_RULES_VERSION = 1;

/**
 * hash53 with FIXED_HASH_SEED of the stable JSON text of the settings that change step keys;
 * include and exclude do not change keys and are left out (06-REQ-25).
 */
export function stepNormalizationFingerprint(
  steps: ResolvedStepsSettings,
  keys: Pick<ResolvedConfig['keys'], 'idPatterns' | 'extraIdPatterns'>,
): string {
  return hashHex(
    stringifyStable({
      rulesVersion: STEP_RULES_VERSION,
      idPatterns: keys.idPatterns,
      extraIdPatterns: keys.extraIdPatterns.map((p) =>
        typeof p === 'string' ? p : { regex: p.source, flags: p.flags },
      ),
      categories: steps.categories,
      maxDepth: steps.maxDepth,
      groupBy: steps.groupBy,
      normalizeTitles: steps.normalizeTitles,
      redactQuotedValues: steps.redactQuotedValues,
    }),
  );
}
