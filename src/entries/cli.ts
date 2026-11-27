#!/usr/bin/env node
// Binaries "playwright-performance-regression" and "pw-perf" (01, chapter 9; 04). The shard merge
// of PW_PERF_MODE=merge comes from the reporter module (17-REQ-12, ADR-0013).
import { main, nodeHost } from '../cli/index.ts';
import { runMerge } from '../reporter/merge.ts';
import { processHost } from '../reporter/process-host.ts';
import { version } from '../../package.json';

process.exitCode = await main(
  process.argv.slice(2),
  nodeHost(() => runMerge(processHost(), version)),
);
