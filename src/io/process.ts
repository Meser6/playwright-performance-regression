// Processes for the reporter (01-REQ-43, 04-REQ-64): the reporter session stays free of node:*
// imports, so starting a pass lives here.
import { spawn, spawnSync } from 'node:child_process';

export interface PassExit {
  /** Exit code, or null when the process ended by a signal or did not start. */
  code: number | null;
  signal: string | null;
  /** The process could not be started (04-REQ-64, RUN_PASS_SPAWN_FAILED). */
  error?: string;
}

/**
 * Runs a pass and waits for it (04-REQ-63): no shell, inherited stdio, the given environment and
 * working directory.
 */
export function runPass(
  command: { file: string; args: readonly string[] },
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): Promise<PassExit> {
  return new Promise((resolveExit) => {
    let settled = false;
    const settle = (exit: PassExit): void => {
      if (settled) return;
      settled = true;
      resolveExit(exit);
    };
    try {
      const child = spawn(command.file, [...command.args], {
        cwd,
        env: env as NodeJS.ProcessEnv,
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
      });
      // A signal sent to this process alone (not to the whole process group, as Ctrl+C in a
      // terminal does) reaches the running pass too, e.g. a signal sent to this process only (01-REQ-43).
      const forward = (signal: NodeJS.Signals): void => {
        child.kill(signal);
      };
      const onInt = (): void => forward('SIGINT');
      const onTerm = (): void => forward('SIGTERM');
      process.on('SIGINT', onInt);
      process.on('SIGTERM', onTerm);
      const done = (exit: PassExit): void => {
        process.off('SIGINT', onInt);
        process.off('SIGTERM', onTerm);
        settle(exit);
      };
      child.once('error', (error) => done({ code: null, signal: null, error: error.message }));
      child.once('exit', (code, signal) => done({ code, signal }));
    } catch (error) {
      settle({
        code: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * The process table, `ps -A -o pid=,ppid=,args=` (04-REQ-63 point 2): no shell, 2 s limit. Null on
 * Windows and when `ps` fails, so the next pass falls back to the Playwright command line.
 */
export function readProcessTable(): string | null {
  if (process.platform === 'win32') return null;
  try {
    const out = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,args='], {
      encoding: 'utf8',
      timeout: 2000,
      shell: false,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return out.status === 0 && typeof out.stdout === 'string' ? out.stdout : null;
  } catch {
    return null;
  }
}
