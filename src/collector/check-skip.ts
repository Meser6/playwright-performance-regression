// Test selection of a check (04-REQ-49): the first test of each file of the measured projects
// runs, up to PW_PERF_MAX_TESTS tests; the others are skipped before their body. The counters
// live in a state file in the temporary directory (one worker, written synchronously, survives a
// worker restart); without a run id they live in the memory of the worker.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStateFileName } from '../mode/index.ts';

interface CheckState {
  /** project + NUL + file of every file with a test that ran. */
  files: string[];
  ran: number;
}

let memory: CheckState = { files: [], ran: 0 };

/** `<tmpdir>/playwright-performance-regression-<runId>.check.json` (04-REQ-49). */
export function checkStatePath(runId: string): string {
  return join(tmpdir(), checkStateFileName(runId));
}

function load(path: string | null): CheckState {
  if (path === null) return memory;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<CheckState>;
    return { files: Array.isArray(parsed.files) ? parsed.files : [], ran: Number(parsed.ran ?? 0) };
  } catch {
    return { files: [], ran: 0 };
  }
}

function save(path: string | null, state: CheckState): void {
  if (path === null) memory = state;
  else writeFileSync(path, JSON.stringify(state));
}

/**
 * Whether the test runs in the check: the first one of its file, while fewer than `maxTests`
 * tests ran. Records the decision.
 */
export function checkRunsTest(
  runId: string | undefined,
  maxTests: number,
  project: string,
  file: string,
): boolean {
  const path = runId === undefined ? null : checkStatePath(runId);
  const state = load(path);
  const id = `${project}\u0000${file}`;
  if (state.ran >= maxTests || state.files.includes(id)) return false;
  save(path, { files: [...state.files, id], ran: state.ran + 1 });
  return true;
}

/** Removes the state file after the run (04-REQ-49). */
export function removeCheckState(runId: string): void {
  rmSync(checkStatePath(runId), { force: true });
}
