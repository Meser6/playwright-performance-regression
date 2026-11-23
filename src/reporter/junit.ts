// Writing junit.xml (16): one function for the reporter of pass 1 and, later, the shard merge
// (16-REQ-04): build the XML from the run report, write it atomically, map failures to the
// REPORT_JUNIT_WRITE_FAILED tool error (16-REQ-16).
import { JUNIT_FILE, buildJunitXml } from '../core/report/index.ts';
import type { Issue, RunReport } from '../core/types/index.ts';
import type { ReporterIo } from './types.ts';

export type JunitBuilder = (report: RunReport) => string;

/**
 * Writes `<dir>/junit.xml` of the report. Returns the written path, or the tool error when the
 * XML could not be built or written.
 */
export async function writeJunitFile(
  io: Pick<ReporterIo, 'resolvePath' | 'writeTextAtomic'>,
  report: RunReport,
  dir: string,
  build: JunitBuilder = buildJunitXml,
): Promise<{ path: string } | { issue: Issue }> {
  const path = io.resolvePath(dir, JUNIT_FILE);
  const hint =
    'Check that report.dir is writable, then run again; set report.junit to false to skip the file.';
  let xml: string;
  try {
    xml = build(report);
  } catch (error) {
    return {
      issue: {
        code: 'REPORT_JUNIT_WRITE_FAILED',
        message: `junit.xml could not be built: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        hint: 'This is a bug in the package; please report it with the message above. report.json is complete.',
      },
    };
  }
  try {
    await io.writeTextAtomic(path, xml);
    return { path };
  } catch (error) {
    return {
      issue: {
        code: 'REPORT_JUNIT_WRITE_FAILED',
        message: `junit.xml could not be written to ${path}: ${error instanceof Error ? error.message : String(error)}`,
        hint,
      },
    };
  }
}
