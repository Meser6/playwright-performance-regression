// Margin presets of thresholds.preset (D-41, 10-REQ-23): the defaults of checks.*.margin that
// sit between the schema defaults and the user's config (03-REQ-04, 03-REQ-24). `normal` equals
// the schema defaults, so it changes nothing. Pure.
import { isRecord } from '../schema/dsl.ts';

export type MarginPreset = 'strict' | 'normal' | 'loose';

export const MARGIN_PRESETS: readonly MarginPreset[] = ['strict', 'normal', 'loose'];

interface PresetValues {
  relative: number;
  minMs: number;
  smallSampleRelative: number;
  p99Relative: number;
  apdexAbsolute: number;
  apdexSmallSampleAbsolute: number;
  factor: number;
}

const VALUES: Readonly<Record<MarginPreset, PresetValues>> = {
  strict: {
    relative: 0.25,
    minMs: 50,
    smallSampleRelative: 0.5,
    p99Relative: 0.1,
    apdexAbsolute: 0.03,
    apdexSmallSampleAbsolute: 0.06,
    factor: 1.25,
  },
  normal: {
    relative: 0.4,
    minMs: 100,
    smallSampleRelative: 0.8,
    p99Relative: 0.2,
    apdexAbsolute: 0.05,
    apdexSmallSampleAbsolute: 0.1,
    factor: 1.5,
  },
  loose: {
    relative: 0.6,
    minMs: 200,
    smallSampleRelative: 1.2,
    p99Relative: 0.35,
    apdexAbsolute: 0.08,
    apdexSmallSampleAbsolute: 0.15,
    factor: 2,
  },
};

/** The preset named in a config input, or `normal` when it is missing or not a preset name. */
export function presetOf(input: unknown): MarginPreset {
  const thresholds = isRecord(input) ? input.thresholds : undefined;
  const preset = isRecord(thresholds) ? thresholds.preset : undefined;
  return MARGIN_PRESETS.includes(preset as MarginPreset) ? (preset as MarginPreset) : 'normal';
}

/** The margin fields the preset sets, as a partial config to merge over the defaults. */
export function presetLayer(preset: MarginPreset): Record<string, unknown> {
  const v = VALUES[preset];
  const time = { relative: v.relative, minMs: v.minMs, smallSampleRelative: v.smallSampleRelative };
  return {
    checks: {
      time: {
        median: { margin: time },
        percentile: { margin: { ...time } },
        p99: { margin: { relative: v.p99Relative } },
      },
      slowShare: {
        apdex: {
          margin: { absolute: v.apdexAbsolute, smallSampleAbsolute: v.apdexSmallSampleAbsolute },
        },
        wilson: { margin: { factor: v.factor } },
      },
      errors: { margin: { factor: v.factor } },
      // The nonSuccess margin follows the errors margin (03-REQ-30).
      nonSuccess: { margin: { factor: v.factor } },
    },
  };
}
