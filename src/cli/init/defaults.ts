// Default answers of the init wizard (04-REQ-38): what --yes and a run without a terminal use.
// Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import type { ProjectInfo } from './detect.ts';
import type { InitAnswers } from './perf-config.ts';

/** Default of step 5: the default of run.repeat.test. */
export const DEFAULT_ANSWERS_REPEAT: number = DEFAULT_CONFIG.run.repeat.test;

/** Proposed label of an origin: the first part of its host name (api.example.com → api). */
export function defaultLabel(origin: string, used: ReadonlySet<string>): string {
  const host = new URL(origin).hostname;
  const first = host.split('.')[0] ?? '';
  const base =
    /^[a-z][a-z0-9-]{0,63}$/u.test(first) &&
    first !== 'www' &&
    first !== 'localhost' &&
    host.includes('.')
      ? first
      : 'app';
  let label = base;
  for (let n = 2; used.has(label); n += 1) label = `${base}${n}`;
  return label;
}

export function defaultAnswers(info: ProjectInfo): InitAnswers {
  const used = new Set<string>();
  const originLabels: Record<string, string> = {};
  for (const origin of info.baseUrls) {
    const label = defaultLabel(origin, used);
    used.add(label);
    originLabels[origin] = label;
  }
  return {
    originLabels,
    scope: info.taggedPerfTestFiles > 0 ? 'tagged' : 'all',
    repeatTest: DEFAULT_ANSWERS_REPEAT,
    warnOnly: true,
    envLabels: [],
    addCi: info.ciPlatform !== null,
  };
}
