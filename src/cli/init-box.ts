// The box of `npx pw-perf` without arguments in a project without config (04-REQ-68, note #31):
// the environment mode does not load the package before withPerf() is in place, so the CLI is
// the place to point at the wizard.
import { asciiTerminal, box } from '../console/box.ts';
import { colorEnabled } from '../console/color.ts';
import { CLI_COMMAND, CONFIG_FILE_BASENAME, CONFIG_FILE_EXTENSIONS } from '../core/types/index.ts';
import type { CliHost } from './host.ts';

const PLAYWRIGHT_CONFIGS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map(
  (ext) => `playwright.config.${ext}`,
);

/** A pw-perf.config.* exists in the working directory, or a playwright.config uses withPerf(). */
export async function hasPerfSetup(host: CliHost): Promise<boolean> {
  for (const ext of CONFIG_FILE_EXTENSIONS) {
    if (await host.exists(host.paths.join(host.cwd, `${CONFIG_FILE_BASENAME}${ext}`))) return true;
  }
  for (const name of PLAYWRIGHT_CONFIGS) {
    const text = await host.readText(host.paths.join(host.cwd, name));
    if (text !== null && /\bwithPerf\s*\(/u.test(text)) return true;
  }
  return false;
}

/** The yellow box with the init command (04-REQ-68). */
export function initBox(host: CliHost): string {
  const command = `${CLI_COMMAND} init`;
  return `${box(
    [
      { text: 'No pw-perf config found in this project', style: 'bold' },
      { text: `Run: ${command}`, style: 'cyan' },
      { text: 'The wizard sets up the project step by step and changes nothing without asking.' },
    ],
    {
      width: Math.min(100, host.stdout.columns ?? 100),
      color: colorEnabled(host.stdout, host.env),
      ascii: asciiTerminal(host.env),
      border: 'yellow',
    },
  )}\n`;
}
