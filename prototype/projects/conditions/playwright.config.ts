import { defineConfig } from '@playwright/test';
import { withPerf } from '../_shared/with-perf.cjs';

const scenario = process.env.PROTO_SCENARIO;

const projects = {
  // V-12 b: a project with its own workers setting
  workers: [{ name: 'measured', workers: 4, fullyParallel: true, testMatch: 'parallel.spec.ts' }],
  // V-12 c: fixture teardown and the test timeout
  timeout: [{ name: 'measured', testMatch: 'timeout.spec.ts' }],
  // V-12 d: removing projects that are neither measured nor (indirect) dependencies/teardowns
  deps: [
    { name: 'auth', testMatch: 'auth.setup.ts' },
    { name: 'setup', testMatch: 'data.setup.ts', dependencies: ['auth'] },
    { name: 'measured', testMatch: 'measured.spec.ts', dependencies: ['setup'], teardown: 'cleanup' },
    { name: 'cleanup', testMatch: 'cleanup.teardown.ts' },
    { name: 'other', testMatch: 'other.spec.ts', dependencies: ['setup'] },
    { name: 'other-teardown-owner', testMatch: 'other.spec.ts', teardown: 'other-cleanup' },
    { name: 'other-cleanup', testMatch: 'cleanup.teardown.ts' },
  ],
}[scenario ?? ''];

export default withPerf(
  defineConfig({
    testDir: 'tests',
    workers: 4,
    reporter: [['list'], ['../_shared/reporter.mjs']],
    use: { baseURL: process.env.PROTO_BASE },
    projects,
  }),
  { marker: 'conditions' },
);
