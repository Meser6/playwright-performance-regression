// Absolute path of the reporter entry point that withPerf() adds (01, chapter 4.4). The config
// and reporter entry points are siblings in dist/ (config.js/reporter.js for ESM,
// config.cjs/reporter.cjs for CJS). Plain string handling: no I/O and no Node modules.

/** Path of the running module file: __filename in the CJS build, import.meta.filename in ESM. */
function currentFile(): string {
  return typeof __filename === 'string' ? __filename : import.meta.filename;
}

/** The reporter entry point next to `file`, with the same extension. */
export function reporterPathNextTo(file: string): string {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1;
  const name = file.slice(cut);
  const dot = name.lastIndexOf('.');
  return `${file.slice(0, cut)}reporter${dot === -1 ? '' : name.slice(dot)}`;
}

export function reporterEntryPath(): string {
  return reporterPathNextTo(currentFile());
}
