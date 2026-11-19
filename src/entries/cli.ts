// Binaries "playwright-performance-regression" and "pw-perf" (01, chapter 9; 04).
import { main, nodeHost } from '../cli/index.ts';

process.exitCode = await main(process.argv.slice(2), nodeHost());
