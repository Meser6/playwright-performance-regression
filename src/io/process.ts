// Processes and the terminal for the reporter (01-REQ-43, 04-REQ-64, 04-REQ-65): the reporter
// session stays free of node:* imports, so starting a pass and asking a question live here.
import { spawn } from 'node:child_process';
import { closeSync, openSync, readSync, writeSync } from 'node:fs';

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
 * Asks `question` on the terminal and returns the answer line, read synchronously from /dev/tty
 * (Windows: CONIN$/CONOUT$), because reading stdin of a terminal gives EAGAIN (V-15). Null when
 * the terminal cannot be opened.
 */
export function askTerminal(question: string, platform: string = process.platform): string | null {
  const input = platform === 'win32' ? 'CONIN$' : '/dev/tty';
  const output = platform === 'win32' ? 'CONOUT$' : '/dev/tty';
  let inFd: number;
  try {
    inFd = openSync(input, 'r');
  } catch {
    return null;
  }
  try {
    try {
      const outFd = openSync(output, 'w');
      try {
        writeSync(outFd, question);
      } finally {
        closeSync(outFd);
      }
    } catch {
      process.stdout.write(question);
    }
    const buffer = Buffer.alloc(256);
    let line = '';
    for (;;) {
      let n: number;
      try {
        n = readSync(inFd, buffer, 0, buffer.length, null);
      } catch (error) {
        if ((error as { code?: string }).code === 'EAGAIN') continue;
        return line === '' ? null : line;
      }
      if (n === 0) return line;
      line += buffer.toString('utf8', 0, n);
      const end = line.search(/\r?\n/u);
      if (end >= 0) return line.slice(0, end);
    }
  } finally {
    closeSync(inFd);
  }
}
