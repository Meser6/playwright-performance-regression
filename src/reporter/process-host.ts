// The ReporterHost of a real process (01, chapter 4.6): files, clock, terminal and the pass
// processes. Used by the reporter in the Playwright process and by the shard merge of the binary
// (17-REQ-12).
import {
  directoryOf,
  emptyDirSync,
  homeDir,
  isDirectorySync,
  listDirSync,
  readCiInfo,
  readHostInfo,
  readPackageInfo,
  readSuite,
  readTextFile,
  readTextFileSync,
  realPathSync,
  relativeSlashPath,
  removeFileSync,
  resolvePath,
  readProcessTable,
  runPass,
  scanDirSync,
  tempPath,
  writeJsonStable,
  writeTextAtomic,
} from '../io/index.ts';
import { loadThresholds, thresholdsFilePaths } from '../io/index.ts';
import type { ReporterHost } from './types.ts';

/** The host of this process. */
export function processHost(): ReporterHost {
  const env = process.env;
  return {
    env,
    io: {
      loadThresholds,
      thresholdsFilePaths,
      writeJsonStable,
      writeTextAtomic,
      resolvePath,
      directoryOf,
      relativeSlashPath,
      removeFileSync,
      readPackageInfo,
      readSuite,
      tempPath,
      readTextFile,
      readTextFileSync,
      listDirSync,
      isDirectorySync,
      realPathSync,
      homeDir,
      scanDirSync,
      emptyDirSync,
    },
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    argv: process.argv,
    now: () => new Date(),
    random: Math.random,
    ci: readCiInfo(env),
    host: readHostInfo(env),
    execPath: process.execPath,
    pid: process.pid,
    processTable: readProcessTable,
    runPass: (command, passEnv) => runPass(command, passEnv, process.cwd()),
  };
}
