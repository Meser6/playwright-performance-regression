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
export const SAMPLES_ATTACHMENT_NAME = 'pw-perf-samples';

/** The pw-perf runner; only for its own messages (04). Hints never show it (04-REQ-70). */
export const CLI_COMMAND = 'npx pw-perf';

/** A thresholds run in hints: the user's own test command with the variable (D-35, 04-REQ-70). */
export const THRESHOLDS_COMMAND = 'PW_PERF_MODE=thresholds <your test command>';

/** A thresholds run that removes unseen entries, in hints (10-REQ-10, 04-REQ-70). */
export const PRUNE_COMMAND = 'PW_PERF_MODE=thresholds PW_PERF_PRUNE=1 <your test command>';

/** The guided setup in hints; it also runs in a project with the package installed (04-REQ-70). */
export const INIT_COMMAND = 'npm init playwright-performance-regression';

/** Project page (repository), linked from the footer of the HTML report (11-REQ-20). */
export const REPOSITORY_URL = 'https://github.com/Meser6/playwright-performance-regression';

/** Documentation of every config option, linked from config errors (03-REQ-12, 13-REQ-15). */
export const DOCS_CONFIG_URL = `${REPOSITORY_URL}/blob/main/docs/configuration.md`;

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
