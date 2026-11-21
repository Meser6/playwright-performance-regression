// Records each test execution and the registry seen in the worker.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestInfo } from '@playwright/test';

export function record(testInfo: TestInfo): void {
  const state = (globalThis as Record<symbol, { state?: Record<string, never> } | undefined>)[
    Symbol.for('pw-perf.registry')
  ]?.state as
    | {
        mode: unknown;
        measuredProjects: string[];
        config: { run: { passes: { test: number } }; keys: { origins: unknown } };
      }
    | undefined;
  const line = {
    project: testInfo.project.name,
    title: testInfo.title,
    repeatEachIndex: testInfo.repeatEachIndex,
    retry: testInfo.retry,
    registry: state && {
      mode: state.mode,
      measuredProjects: state.measuredProjects,
      passes: state.config.run.passes.test,
      origins: state.config.keys.origins,
    },
  };
  appendFileSync(
    join(process.env.INTEGRATION_OUT ?? '', 'events.jsonl'),
    `${JSON.stringify(line)}\n`,
  );
}
