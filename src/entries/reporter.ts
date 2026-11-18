// Package entry point "playwright-performance-regression/reporter" (01, chapter 9). withPerf()
// adds it to the reporters in perf mode, so it is a valid Playwright reporter already; it does
// nothing until the reporter is implemented (01, chapter 4.6). The named export keeps the CJS
// build an exports object with `default`, matching its declarations.
import type { Reporter } from '@playwright/test/reporter';

export class PerfReporter implements Reporter {
  printsToStdio(): boolean {
    return false;
  }
}

export default PerfReporter;
