#!/usr/bin/env node
// @ts-check
// Checks both published packages (13-REQ-11, 13-AC-02, 13-AC-12): the package and create-<pkg>
// (create/, 01-REQ-39).
// - package.json: no runtime dependencies, no install scripts (NF-06, 01-REQ-35), peer
//   dependency only @playwright/test (none in create-<pkg>), the same version in both, and
//   create-<pkg> publishes one executable file;
// - contents (`npm pack --dry-run`): only the files of the "files" field, nothing from test/ or
//   prototype/, no spec-ids.json, no source maps with absolute paths, the packed size below
//   MAX_PACKED_BYTES and the unpacked size below MAX_UNPACKED_BYTES. Needs `pnpm build` first.
//
// Usage: node scripts/check-packages.mjs
// No dependencies; Node built-ins only (and the npm CLI for `npm pack`).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Size limits (13-REQ-11, 13-D-19). They are an alarm for mistakes such as bundled tests, source
 * maps or a bundled dependency, not a budget for features. The packed size is what
 * `npm install` downloads; the unpacked limit is a looser second check. Every entry point has an
 * ESM and a CJS build (01-REQ-34), so the code ships twice; the wizard texts in seven languages
 * add about 70 kB.
 */
export const MAX_PACKED_BYTES = 500_000;
export const MAX_UNPACKED_BYTES = 2_000_000;

/** Paths that must never be published, whatever "files" says. */
const FORBIDDEN = [/^test\//u, /^prototype\//u, /^spec-ids\.json$/u];
/** Files npm always publishes. */
const ALWAYS = /^(package\.json|README(\..*)?|LICEN[CS]E(\..*)?)$/iu;
/** An absolute path in a source map: POSIX, Windows drive or UNC, or a file: URL. */
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\|file:)/u;

/** Lifecycle scripts that run when the package is installed. */
export const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'bundleDependencies',
  'bundledDependencies',
];

/**
 * @param {Record<string, any>} pkg
 * @param {string} label
 * @param {string[]} peers allowed peer dependencies
 * @returns {string[]}
 */
function checkManifest(pkg, label, peers) {
  const problems = [];
  for (const field of DEPENDENCY_FIELDS) {
    const value = pkg[field];
    if (value !== undefined && (typeof value !== 'object' || Object.keys(value).length > 0)) {
      problems.push(`${label}: "${field}" must be absent or empty (no runtime dependencies).`);
    }
  }
  const extraPeers = Object.keys(pkg.peerDependencies ?? {}).filter(
    (name) => !peers.includes(name),
  );
  if (extraPeers.length > 0) {
    problems.push(`${label}: unexpected peerDependencies: ${extraPeers.join(', ')}.`);
  }
  for (const script of INSTALL_SCRIPTS) {
    if (pkg.scripts?.[script] !== undefined) {
      problems.push(`${label}: the install script "${script}" is not allowed.`);
    }
  }
  return problems;
}

/**
 * Problems of the two manifests; `createDir` is the directory of create-<pkg> (for its files).
 * @param {Record<string, any>} main
 * @param {Record<string, any>} create
 * @param {string} [createDir]
 * @returns {string[]}
 */
export function checkPackages(main, create, createDir) {
  const problems = [
    ...checkManifest(main, 'package.json', ['@playwright/test']),
    ...checkManifest(create, 'create/package.json', []),
  ];
  if (create.name !== `create-${main.name}`) {
    problems.push(`create/package.json: the name must be "create-${main.name}".`);
  }
  if (create.version !== main.version) {
    problems.push(
      `create/package.json: version ${create.version} differs from ${main.version} of package.json; both packages are released together.`,
    );
  }
  const bin = create.bin?.[create.name];
  if (typeof bin !== 'string' || Object.keys(create.bin ?? {}).length !== 1) {
    problems.push(`create/package.json: "bin" must have the one command "${create.name}".`);
  } else if (JSON.stringify(create.files) !== JSON.stringify([bin.replace(/^\.\//u, '')])) {
    problems.push(`create/package.json: "files" must list only the executable ${bin}.`);
  } else if (createDir !== undefined) {
    const path = join(createDir, bin);
    if (!existsSync(path) || !readFileSync(path, 'utf8').startsWith('#!/usr/bin/env node\n')) {
      problems.push(`create/${bin} must exist and start with "#!/usr/bin/env node".`);
    }
  }
  return problems;
}

/** @typedef {{ files: { path: string, size: number }[], unpackedSize: number, size?: number }} Pack */

/**
 * Problems of the contents of one package as `npm pack` lists them.
 * @param {Pack} pack
 * @param {Record<string, any>} manifest the package.json of the package
 * @param {string} label
 * @param {{ maxUnpackedBytes?: number, maxPackedBytes?: number, readFile?: (path: string) => string }} [options]
 *   readFile reads a packed file (path relative to the package) for the source map check
 * @returns {string[]}
 */
export function checkPackContents(pack, manifest, label, options = {}) {
  const problems = [];
  /** @type {string[]} */
  const listed = (manifest.files ?? []).map((/** @type {string} */ entry) =>
    entry.replace(/^\.\//u, '').replace(/\/$/u, ''),
  );
  const inFiles = (/** @type {string} */ path) =>
    listed.some((entry) => path === entry || path.startsWith(`${entry}/`));
  const paths = pack.files.map((file) => file.path.replaceAll('\\', '/')).sort();
  for (const path of paths) {
    if (FORBIDDEN.some((pattern) => pattern.test(path))) {
      problems.push(`${label}: the package contains ${path}, which is not allowed.`);
    } else if (!inFiles(path) && !ALWAYS.test(path)) {
      problems.push(`${label}: the package contains ${path}, which is not listed in "files".`);
    } else if (path.endsWith('.map') && options.readFile !== undefined) {
      const absolute = sourceMapPaths(options.readFile(path)).find((source) =>
        ABSOLUTE.test(source),
      );
      if (absolute !== undefined) {
        problems.push(`${label}: the source map ${path} has an absolute path (${absolute}).`);
      }
    }
  }
  for (const entry of listed) {
    if (!paths.some((path) => path === entry || path.startsWith(`${entry}/`))) {
      problems.push(`${label}: "files" lists ${entry}, but the package has no such file.`);
    }
  }
  const max = options.maxUnpackedBytes;
  if (max !== undefined && pack.unpackedSize > max) {
    problems.push(
      `${label}: the unpacked package has ${pack.unpackedSize} bytes, above the limit of ${max} bytes (scripts/check-packages.mjs).`,
    );
  }
  const maxPacked = options.maxPackedBytes;
  if (maxPacked !== undefined && pack.size !== undefined && pack.size > maxPacked) {
    problems.push(
      `${label}: the packed package has ${pack.size} bytes, above the limit of ${maxPacked} bytes (scripts/check-packages.mjs).`,
    );
  }
  return problems;
}

/**
 * `sources` and `sourceRoot` of a source map; none when the text is not JSON.
 * @param {string} text
 * @returns {string[]}
 */
function sourceMapPaths(text) {
  try {
    const map = JSON.parse(text);
    return [map.sourceRoot, ...(Array.isArray(map.sources) ? map.sources : [])].filter(
      (value) => typeof value === 'string' && value !== '',
    );
  } catch {
    return [];
  }
}

/**
 * `npm pack --dry-run` of the package in `dir`.
 * @param {string} dir
 * @returns {Pack}
 */
export function npmPack(dir) {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const [pack] = JSON.parse(output);
  return { files: pack.files, unpackedSize: pack.unpackedSize, size: pack.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (/** @type {string} */ path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const main = read('package.json');
  const create = read('create/package.json');
  const mainPack = npmPack(root);
  const createPack = npmPack(join(root, 'create'));
  const problems = [
    ...checkPackages(main, create, join(root, 'create')),
    ...checkPackContents(mainPack, main, main.name, {
      maxUnpackedBytes: MAX_UNPACKED_BYTES,
      maxPackedBytes: MAX_PACKED_BYTES,
      readFile: (path) => readFileSync(join(root, path), 'utf8'),
    }),
    ...checkPackContents(createPack, create, create.name, {
      maxUnpackedBytes: MAX_UNPACKED_BYTES,
      maxPackedBytes: MAX_PACKED_BYTES,
      readFile: (path) => readFileSync(join(root, 'create', path), 'utf8'),
    }),
  ];
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exit(1);
  }
  console.log(
    `package.json and create/package.json are fine; sizes: ${main.name} ${mainPack.size} bytes packed (limit ${MAX_PACKED_BYTES}), ${mainPack.unpackedSize} unpacked (limit ${MAX_UNPACKED_BYTES}); ${create.name} ${createPack.size} packed, ${createPack.unpackedSize} unpacked.`,
  );
}
