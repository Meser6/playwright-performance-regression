// Records what the main process sees: the effective config and the registry.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default class RecordReporter {
  onBegin(config) {
    const state = globalThis[Symbol.for('pw-perf.registry')]?.state;
    const record = {
      sameObject: globalThis.integrationSameObject,
      workers: config.workers,
      reporters: config.reporter.map(([name, options]) => [name, options?.open]),
      projects: config.projects.map((p) => ({
        name: p.name,
        repeatEach: p.repeatEach,
        retries: p.retries,
        trace: p.use.trace,
      })),
      registry: state && {
        mode: state.mode,
        measuredProjects: state.measuredProjects,
        runConditions: state.runConditions,
        repeat: state.config.run.repeat.test,
        origins: state.config.keys.origins,
      },
    };
    writeFileSync(join(process.env.INTEGRATION_OUT, 'main.json'), JSON.stringify(record));
  }

  printsToStdio() {
    return false;
  }
}
