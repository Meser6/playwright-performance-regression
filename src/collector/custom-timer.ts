// Custom measurements (06): named time spans measured with the worker's clock.
import type { Diagnostics, RawCustomSample } from '../core/types/index.ts';
import { roundMs } from './timing.ts';

const MAX_NAME_LENGTH = 200;
// No leading or trailing whitespace, no control characters (06-REQ-03); same rule as the
// customSample name in schemas/samples.schema.json.
// eslint-disable-next-line no-control-regex
const NAME = /^[^\s\u0000-\u001F\u007F](?:[^\u0000-\u001F\u007F]*[^\s\u0000-\u001F\u007F])?$/u;

/** Throws TypeError with CUSTOM_INVALID_NAME when `name` breaks 06-REQ-03. */
export function validateMeasurementName(name: unknown): asserts name is string {
  let problem: string | undefined;
  if (typeof name !== 'string') problem = `expected a string, got ${typeof name}`;
  else if ([...name].length > MAX_NAME_LENGTH) {
    problem = `the name has more than ${MAX_NAME_LENGTH} characters`;
  } else if (!NAME.test(name)) {
    problem =
      name.trim() === ''
        ? 'the name is empty'
        : 'the name starts or ends with whitespace or contains a control character';
  }
  if (problem !== undefined) {
    throw new TypeError(
      `CUSTOM_INVALID_NAME: invalid custom measurement name ${JSON.stringify(String(name))}: ${problem}. Use 1-${MAX_NAME_LENGTH} characters without control characters and without leading or trailing whitespace, e.g. "checkout:load-cart".`,
    );
  }
}

export interface CustomTimerOptions {
  /** Monotonic clock in ms (performance.now()). */
  now: () => number;
  /** Wall clock in ms (Date.now()). */
  wallNow: () => number;
  /** false outside perf mode and in projects that are not measured (06-REQ-10). */
  record: boolean;
}

interface Running {
  name: string;
  startedAt: number;
}

export class CustomTimer {
  readonly #opts: CustomTimerOptions;
  readonly #diag: Diagnostics;
  readonly #samples: RawCustomSample[] = [];
  /** Open start() measurements by name (06-REQ-06). */
  readonly #started = new Map<string, Running>();
  /** measure() calls in progress, each with its own start (06-REQ-05). */
  readonly #measuring = new Set<Running>();
  #finished = false;

  constructor(opts: CustomTimerOptions, diag: Diagnostics) {
    this.#opts = opts;
    this.#diag = diag;
  }

  /** Measures `fn` (06-REQ-05): returns its result; on an exception records 'error' and rethrows. */
  async measure<R>(name: string, fn: () => R | Promise<R>): Promise<R> {
    validateMeasurementName(name);
    const running: Running = { name, startedAt: this.#opts.now() };
    this.#measuring.add(running);
    let result: R;
    try {
      result = await fn();
    } catch (error) {
      this.#close(running, 'error');
      throw error;
    }
    this.#close(running, 'ok');
    return result;
  }

  start(name: string): void {
    validateMeasurementName(name);
    const previous = this.#started.get(name);
    if (previous !== undefined) {
      this.#unfinished(previous);
      this.#issue(
        'CUSTOM_ALREADY_STARTED',
        `custom: perf.start(${JSON.stringify(name)}) was called while this measurement was running; the earlier one is recorded as unfinished`,
        'Call perf.end() before starting the same measurement again, or use perf.measure().',
      );
    }
    this.#started.set(name, { name, startedAt: this.#opts.now() });
  }

  /** Ends a measurement; returns its duration in ms, or undefined without a start (06-REQ-07). */
  end(name: string): number | undefined {
    validateMeasurementName(name);
    const running = this.#started.get(name);
    if (running === undefined) {
      this.#issue(
        'CUSTOM_END_WITHOUT_START',
        `custom: perf.end(${JSON.stringify(name)}) was called without a matching perf.start()`,
        'Call perf.start() with the same name in the same test before perf.end().',
      );
      return undefined;
    }
    this.#started.delete(name);
    return this.#close(running, 'ok');
  }

  /** Closes open measurements as 'unfinished' (06-REQ-09) and returns all samples. */
  finish(): RawCustomSample[] {
    if (!this.#finished) {
      this.#finished = true;
      const open = [...this.#started.values(), ...this.#measuring];
      this.#started.clear();
      this.#measuring.clear();
      for (const running of open) this.#unfinished(running);
      if (open.length > 0) {
        this.#issue(
          'CUSTOM_UNFINISHED',
          `custom: measurements still running when the test ended: ${[...new Set(open.map((r) => JSON.stringify(r.name)))].join(', ')}`,
          'End every perf.start() with perf.end(), or check whether the test timed out during the measurement.',
          open.length,
        );
      }
    }
    return [...this.#samples];
  }

  #close(running: Running, outcome: 'ok' | 'error'): number {
    const duration = roundMs(Math.max(0, this.#opts.now() - running.startedAt));
    this.#measuring.delete(running);
    // A measure() that settles after finish() was already recorded as unfinished.
    if (this.#opts.record && !this.#finished) {
      this.#samples.push({
        name: running.name,
        outcome,
        duration,
        endTime: Math.round(this.#opts.wallNow()),
      });
    }
    return duration;
  }

  #unfinished(running: Running): void {
    if (!this.#opts.record) return;
    this.#samples.push({
      name: running.name,
      outcome: 'unfinished',
      duration: null,
      endTime: null,
    });
  }

  #issue(code: string, message: string, hint: string, count?: number): void {
    if (!this.#opts.record) return;
    this.#diag.add({ code, message, hint, ...(count === undefined ? {} : { count }) });
  }
}
