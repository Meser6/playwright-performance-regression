#!/usr/bin/env node
// @ts-check
// Checks the package.json of both published packages (13-REQ-11, 13-AC-12): the package and
// create-<pkg> (create/, 01-REQ-39). No runtime dependencies, no install scripts (NF-06,
// 01-REQ-35), peer dependency only @playwright/test (none in create-<pkg>), the same version in
// both, and create-<pkg> publishes one executable file.
//
// Usage: node scripts/check-packages.mjs
// No dependencies; Node built-ins only.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (/** @type {string} */ path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const problems = checkPackages(
    read('package.json'),
    read('create/package.json'),
    join(root, 'create'),
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exit(1);
  }
  console.log('package.json and create/package.json are fine.');
}
