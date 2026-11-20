// Settings of the step timings (03-REQ-18, 06). measure.steps accepts false, true or an object;
// the resolved config and the report snapshot always hold the full object.
import type { PackageConfig } from '../types/generated/formats.ts';

type StepsInput = NonNullable<NonNullable<PackageConfig['measure']>['steps']>;

export type StepCategory = 'test.step' | 'expect' | 'pw:api' | 'fixture' | 'hook';

type JsonPattern = string | { regex: string; flags?: string };

/** measure.steps after resolution, in JSON form (snapshot in the run report). */
export interface StepsSettingsJson {
  enabled: boolean;
  include: JsonPattern[];
  exclude: JsonPattern[];
  maxDepth: number;
  categories: StepCategory[];
  groupBy: 'step' | 'test';
  normalizeTitles: boolean;
  redactQuotedValues: boolean;
}

/** Option names of the object form of measure.steps, in documentation order. */
export const STEP_OPTION_NAMES: readonly (keyof StepsSettingsJson)[] = [
  'enabled',
  'include',
  'exclude',
  'maxDepth',
  'categories',
  'groupBy',
  'normalizeTitles',
  'redactQuotedValues',
];

/** Defaults of the object form (03-REQ-18); `enabled` is true when an object is given. */
export const STEP_DEFAULTS: Readonly<Omit<StepsSettingsJson, 'enabled'>> = {
  include: [],
  exclude: [],
  maxDepth: 3,
  categories: ['test.step'],
  groupBy: 'step',
  normalizeTitles: true,
  redactQuotedValues: false,
};

/** Expands false, true or a partial object into the full settings (03-REQ-18). */
export function expandSteps(value: StepsInput | undefined): StepsSettingsJson {
  const defaults = (): Omit<StepsSettingsJson, 'enabled'> => ({
    ...STEP_DEFAULTS,
    include: [],
    exclude: [],
    categories: [...STEP_DEFAULTS.categories],
  });
  if (value === undefined || typeof value === 'boolean') {
    return { enabled: value === true, ...defaults() };
  }
  return {
    enabled: value.enabled ?? true,
    ...defaults(),
    ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)),
  } as StepsSettingsJson;
}
