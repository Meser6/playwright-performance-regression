// Package entry point "playwright-performance-regression/reporter" (01, chapter 9). withPerf()
// adds it to the reporters in perf mode. The named export keeps the CJS build an exports object
// with `default`, matching its declarations.
import { PerfReporter } from '../reporter/index.ts';

export { PerfReporter };
export default PerfReporter;
