// Constants shared by the collector and the core (P-13).

/**
 * failureText of requests still in flight when the test closed their page or context
 * (05-REQ-30). Defined here so the collector (which may not import core/stats) and the
 * classification in core/stats (08-REQ-05) use one value.
 */
export const CONTEXT_CLOSED_FAILURE_TEXT = 'pw-perf: context closed';

/** Name of the npm package (00). */
export const PACKAGE_NAME = 'playwright-performance-regression';

/**
 * Name of the test attachment that carries the sample batch of one test (02-REQ-14,
 * 05-REQ-15); written by the collector, read by the reporter.
 */
export const SAMPLES_ATTACHMENT_NAME = `${PACKAGE_NAME}-samples`;

/** Command used in hints of issues, e.g. "npx pw-perf thresholds" (04). */
export const CLI_COMMAND = 'npx pw-perf';

/** Documentation of every config option, linked from config errors (03-REQ-12, 13-REQ-15). */
export const DOCS_CONFIG_URL =
  'https://github.com/Meser6/playwright-performance-regression/blob/main/docs/configuration.md';

/** Package config file name without extension (00, chapter 14.1; 03, chapter 4). */
export const CONFIG_FILE_BASENAME = 'pw-perf.config';

/** Extensions of the package config file, in the order the CLI looks for them (01, chapter 7.3). */
export const CONFIG_FILE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.mts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
];
