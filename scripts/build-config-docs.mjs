#!/usr/bin/env node
// @ts-check
// Generates docs/configuration.md from schemas/config.schema.json (13-REQ-15): every option with
// its type, allowed values, default and description. The schema is the single source of the
// options and defaults; the output is committed and CI runs this script with --check (13-AC-04).
//
// The schema descriptions refer to specification items, which stay out of the public docs:
// sanitize() removes them, and the generator fails when a reference is left over.
//
// Usage: node scripts/build-config-docs.mjs [--check]
//   --check  do not write; exit 1 when the committed file differs from the generated one
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = join(root, 'schemas');
const outFile = join(root, 'docs/configuration.md');

/** @param {string} name @returns {any} */
const readSchema = (name) => JSON.parse(readFileSync(join(schemaDir, name), 'utf8'));

// --- Spec references ------------------------------------------------------------------------

const SPEC_ID = String.raw`(?:\d{2}-(?:REQ|AC|D|PERF|STAT)-\d+[a-z]?|(?:D|ADR|NF|P|R|S|V)-\d{2,4})`;
/** One part of a parenthesised group that is only a reference. */
const STRONG_PART = new RegExp(
  String.raw`^(?:behaviou?r:\s*)?(?:${SPEC_ID}|\d{2}|\d{2},?\s*chapters?\s+\d+(?:\.\d+)?|chapters?\s+\d+(?:\.\d+)?)$`,
);
/** A section number, a reference only next to other references, e.g. "(00, 4.5)". */
const WEAK_PART = /^\d+(?:\.\d+)*$/;
/** Anything that still looks like a reference after sanitizing. */
const LEFTOVER = new RegExp(
  String.raw`\b${SPEC_ID}\b|<pkg>|<PKG>|\bchapters?\s+\d|\(\s*\d{2}\s*[,)]`,
  'i',
);

/**
 * Removes specification references from a schema description and replaces the package
 * placeholders. A parenthesised group made only of references goes away entirely; references
 * inside a group that also has text are dropped from it. Throws when a reference is left.
 * @param {string} text
 * @returns {string}
 */
export function sanitize(text) {
  let out = text.replaceAll('<PKG>_', 'PW_PERF_').replaceAll('<pkg>', 'pw-perf');
  out = out.replace(/\s*\(([^()]*)\)/g, (group, /** @type {string} */ inner) => {
    const parts = inner.split(/[,;]/).map((part) => part.trim());
    const strong = parts.map((part) => STRONG_PART.test(part));
    if (parts.every((part, i) => strong[i] || WEAK_PART.test(part))) return '';
    if (!strong.some(Boolean)) return group;
    const kept = parts.filter((_, i) => !strong[i]);
    const space = /^\s/.test(group) ? ' ' : '';
    return `${space}(${kept.join(', ')})`;
  });
  out = out.replace(/\s+([.,;:])/g, '$1').trim();
  const leftover = LEFTOVER.exec(out);
  if (leftover !== null) {
    throw new Error(
      `a specification reference is left in a config description: "${leftover[0]}" in "${out}"`,
    );
  }
  return out;
}

// --- Schema walking ---------------------------------------------------------------------------

/**
 * Resolves "$ref" (local "#/$defs/..." and "common.schema.json#/$defs/...") recursively. The
 * annotations next to a "$ref" win over those of the target.
 * @param {any} node
 * @param {any} schema the document the node belongs to
 * @returns {any}
 */
function resolve(node, schema) {
  if (node === null || typeof node !== 'object' || typeof node.$ref !== 'string') return node;
  const [file, pointer = ''] = node.$ref.split('#');
  const doc = file === '' ? schema : readSchema(file);
  /** @type {any} */
  let target = doc;
  for (const segment of pointer.split('/').filter(Boolean)) target = target[segment];
  const { $ref: _ref, ...siblings } = node;
  return { ...resolve(target, doc), ...siblings, $doc: doc };
}

/**
 * Puts placeholders and wildcards such as `<prefix>.<kind>[.<env>].json` or
 * `checks.*.margin` in code spans, so Markdown shows them as written.
 * @param {string} text
 * @returns {string}
 */
export function markdown(text) {
  return text.replace(/[^\s()]*[<*][^\s(),;]*/g, (token) => {
    const end = /[.:]$/.test(token) ? token.slice(-1) : '';
    return `\`${token.slice(0, token.length - end.length)}\`${end}`;
  });
}

/** @param {unknown} value */
const code = (value) => `\`${JSON.stringify(value)}\``;

/**
 * Human-readable type of a schema node.
 * @param {any} raw
 * @param {any} schema
 * @returns {string}
 */
function typeOf(raw, schema) {
  if (raw?.$ref === '#/$defs/urlPattern') return '[URL pattern](#url-patterns)';
  const node = resolve(raw, schema);
  const doc = node.$doc ?? schema;
  if (Array.isArray(node.oneOf))
    return node.oneOf.map((/** @type {any} */ n) => typeOf(n, doc)).join(' or ');
  if (Object.hasOwn(node, 'const')) return code(node.const);
  if (Array.isArray(node.enum)) return `one of ${node.enum.map(code).join(', ')}`;
  /** @type {string[]} */
  const limits = [];
  switch (node.type) {
    case 'integer':
    case 'number': {
      if (node.minimum !== undefined && node.maximum !== undefined) {
        limits.push(`${node.minimum} to ${node.maximum}`);
      } else if (node.minimum !== undefined) {
        limits.push(`at least ${node.minimum}`);
      } else if (node.maximum !== undefined) {
        limits.push(`at most ${node.maximum}`);
      }
      return limits.length === 0 ? node.type : `${node.type} (${limits.join(', ')})`;
    }
    case 'string': {
      if (node.pattern !== undefined) limits.push(`matching \`${node.pattern}\``);
      if (node.minLength !== undefined && node.minLength > 0) {
        limits.push(`at least ${node.minLength} character${node.minLength === 1 ? '' : 's'}`);
      }
      if (node.maxLength !== undefined) limits.push(`at most ${node.maxLength} characters`);
      return limits.length === 0 ? 'string' : `string (${limits.join(', ')})`;
    }
    case 'array': {
      if (node.minItems !== undefined && node.minItems > 0) {
        limits.push(`at least ${node.minItems} item${node.minItems === 1 ? '' : 's'}`);
      }
      if (node.uniqueItems === true) limits.push('no duplicates');
      const items = typeOf(node.items ?? {}, doc);
      return `array of ${items}${limits.length === 0 ? '' : `; ${limits.join(', ')}`}`;
    }
    case 'object': {
      if (node.properties === undefined && typeof node.additionalProperties === 'object') {
        const names = node.propertyNames?.pattern;
        const keys = names === undefined ? 'string' : `keys matching \`${names}\``;
        return `object with ${keys} and values of type ${typeOf(node.additionalProperties, doc)}`;
      }
      return 'object';
    }
    case 'boolean':
      return 'boolean';
    case 'null':
      return '`null`';
    default:
      return 'any';
  }
}

/** Options whose generated text needs more than the schema gives. */
export const NOTES = {
  'keys.keyBuilder': {
    type: 'function `({ method, url, resourceType, operation }) => string | undefined` (TypeScript or JavaScript config only)',
    description:
      'Builds the endpoint key of a request yourself. Return a string to use it as the key, or `undefined` to fall back to the built-in rules. For calls of the `request` fixture, `page.request` and `context.request` it gets `resourceType: "request"`, and the key gets the prefix `request ` after it. `operation` holds the operation names read by [`keys.operations`](#keysoperations), or `null`; the request body is never passed. Not allowed in a JSON config file; the run report records it as `"[function]"`.',
  },
  'keys.operations': {
    type: 'array of `{ type: "graphql" | "trpc", match: URL pattern }`',
    description:
      'Endpoints that get a key per operation, such as `POST /graphql#GetTickets` instead of one `POST /graphql` for every GraphQL call. `match` is tested against the URL path without the query; the first matching entry wins. See [Operations](#operations).',
  },
  'keys.idPatterns.number': { description: 'Path segments made only of digits.' },
  'keys.idPatterns.uuid': { description: 'UUIDs in any letter case.' },
  $schema: {
    description:
      'Optional, for editor support in a JSON config file: `"./node_modules/playwright-performance-regression/schemas/config.schema.json"`.',
  },
};

/**
 * @typedef {{ path: string, depth: number, node: any, raw: any, leaf: boolean }} Option
 */

/**
 * Every option of the schema in document order, objects with properties before their children.
 * @param {any} schema
 * @returns {Option[]}
 */
export function listOptions(schema) {
  /** @type {Option[]} */
  const out = [];
  /** @param {any} node @param {string} prefix @param {number} depth */
  const visit = (node, prefix, depth) => {
    for (const [name, raw] of Object.entries(node.properties ?? {})) {
      const path = prefix === '' ? name : `${prefix}.${name}`;
      const resolved = resolve(raw, schema);
      const leaf = resolved.properties === undefined;
      out.push({ path, depth, node: resolved, raw, leaf });
      if (!leaf) visit(resolved, path, depth + 1);
    }
  };
  visit(schema, '', 0);
  return out;
}

/** GitHub heading anchor of an option heading such as "### `run.env`". */
export const anchor = (/** @type {string} */ path) =>
  path
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-');

const INTRO = `# Configuration

<!-- Generated by scripts/build-config-docs.mjs from schemas/config.schema.json.
     Do not edit by hand: change the schema and run \`pnpm gen:docs\`. -->

Every option is optional. Without a config, the defaults below apply.

## Where the config lives

Put the config in \`pw-perf.config.ts\` next to \`playwright.config.ts\` (\`.mts\`, \`.js\`, \`.mjs\`,
\`.cjs\` and \`.json\` work too) and pass it to \`withPerf()\`:

\`\`\`ts
// pw-perf.config.ts
import { definePerfConfig, perfDefaults } from 'playwright-performance-regression';

export default definePerfConfig({
  keys: { origins: { 'https://api.example.com': 'api' } },
  measure: { exclude: [...perfDefaults.measure.exclude, 'intercom.io'] },
});
\`\`\`

\`\`\`ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';
import perfConfig from './pw-perf.config';

export default withPerf(defineConfig({ /* your config */ }), perfConfig);
\`\`\`

- \`definePerfConfig()\` returns its argument unchanged; it only adds type checking. Passing the
  object inline as the second argument of \`withPerf()\` works the same way.
- In a CommonJS \`playwright.config.js\`, a TypeScript config file loaded with \`require()\` arrives
  as \`.default\`: \`withPerf(config, require('./pw-perf.config').default)\`.
- A JSON config can point to the schema for editor completion:
  \`"$schema": "./node_modules/playwright-performance-regression/schemas/config.schema.json"\`.
- Objects are merged with the defaults; an array you set replaces the default array. To extend a
  default list, spread \`perfDefaults\` as in the example above.
- URL patterns may be \`RegExp\` objects and \`keys.keyBuilder\` may be a function only in a
  TypeScript or JavaScript config; a JSON config uses \`{ "regex": "...", "flags": "..." }\`.
- \`PW_PERF_ENV\` overrides \`run.env\`, and \`PW_PERF_PASSES\` overrides \`run.passes.test\` or
  \`run.passes.thresholds\` for the current mode (see [Running](cli.md)).
- An invalid config stops the run before any test with a list of all problems; see
  [Troubleshooting](troubleshooting.md).
`;

const URL_PATTERNS = `## URL patterns

\`measure.include\`, \`measure.exclude\` and \`keys.extraIdPatterns\` take a list of patterns:

- a string matches as a case-sensitive substring of the full URL (for \`keys.extraIdPatterns\`:
  a whole path segment, literally);
- \`{ "regex": "...", "flags": "..." }\` is a JavaScript regular expression;
- in a TypeScript or JavaScript config, a \`RegExp\` works as well.

The \`g\` and \`y\` flags are ignored, so a pattern matches the same way on every call.

Example: ids that the built-in \`keys.idPatterns\` miss, such as \`ord.1000\`, \`2026-Q4-17\` or the
fixed id \`demo-tenant\`, split one endpoint into many keys (the run warns with
\`NORMALIZE_HIGH_CARDINALITY\`). Each pattern is tested against one whole path segment:

\`\`\`ts
keys: {
  extraIdPatterns: [
    /^ord\\.[0-9]+$/, // GET /orders/ord.1000 → GET /orders/:id
    /^[0-9]{4}-Q[1-4]-[0-9]+$/, // GET /reports/2026-Q4-17 → GET /reports/:id
    'demo-tenant', // GET /t/demo-tenant/users → GET /t/:id/users
  ],
}
\`\`\`

In a JSON config: \`"extraIdPatterns": [{ "regex": "^ord\\\\.[0-9]+$" }, "demo-tenant"]\`.
`;

const OPERATIONS = `## Operations

GraphQL and tRPC send every call to one URL, so by default all of them share one key, such as
\`POST /graphql\`: a fast and a slow operation mix in one distribution, and a regression of one
operation hides in the median. \`keys.operations\` gives such endpoints a key per operation:

\`\`\`ts
keys: {
  operations: [
    { type: 'graphql', match: '/graphql' }, // Apollo, urql, Relay; Hasury: '/v1/graphql'
    { type: 'trpc', match: /^\\/api\\/trpc\\// }, // Next.js with tRPC
  ],
}
\`\`\`

In a JSON config: \`"operations": [{ "type": "trpc", "match": { "regex": "^/api/trpc/" } }]\`.
\`match\` is a [URL pattern](#url-patterns) tested against the path without the query (a string is
a substring of the path); the first matching entry wins.

| Request | Key |
|---|---|
| \`POST /graphql\` with \`operationName: "GetTickets"\` (or \`query GetTickets { … }\`) | \`POST /graphql#GetTickets\` |
| \`GET /graphql?query=…&operationName=GetTickets\` | \`GET /graphql#GetTickets\` |
| a batch of \`GetUser\` and \`GetTickets\` (Apollo \`BatchHttpLink\`) | \`POST /graphql#GetTickets+GetUser\` |
| a batch of more than 10 operations | the first 10 sorted names, then \`+…(N)\` with the number of names |
| a query without a name (\`{ tickets { id } }\`) | \`POST /graphql#anonymous\` |
| an automatic persisted query without \`operationName\` | \`POST /graphql#persisted\` |
| \`GET /api/trpc/post.byId?input=…\` | \`GET /api/trpc#post.byId\` |
| \`GET /api/trpc/user.me,post.list?batch=1\` | \`GET /api/trpc#post.list+user.me\` |
| no name can be read | \`POST /graphql\`, as without the option (\`COLLECTOR_OPERATION_UNKNOWN\`) |

- **GraphQL** names come from \`operationName\`, else from the first named operation of
  \`query\`; uploads (\`multipart/form-data\`) from the \`operations\` field. Names must follow the
  GraphQL name rules (at most 100 characters).
- **tRPC** names are the procedure names in the path, comma-separated in a batch; the request
  body is never read for tRPC.
- **Batches** are timed as one request: the key of a batch is the time of the whole request, not
  of a single operation. Names are sorted, so the same batch in another order gets the same key.
- A key with an operation has no query part.
- **Privacy:** the request body is read only for \`POST\` requests matching a \`graphql\` entry (and
  the \`data\` or \`multipart\` option of \`request.post()\` calls), up to 64 KB, in the test
  worker. Only the operation names are kept; the body is never written to the sample batch, the
  report or the thresholds files.
- **Thresholds:** enabling or changing \`keys.operations\` changes the keys and the normalization
  fingerprint (\`THRESHOLDS_SOURCE_MISMATCH\`). The old \`POST /graphql\` entry is no longer seen
  (\`THRESHOLDS_UNSEEN_ENTRIES\`) and the operation keys get the default thresholds
  (\`THRESHOLDS_KEYS_ON_DEFAULTS\`) until you derive thresholds again: run
  \`PW_PERF_MODE=thresholds PW_PERF_PRUNE=1 <your test command>\`, review the diff and commit the
  files.
- **\`keys.keyBuilder\`** still comes first: it gets the names as \`operation\`; when it returns
  \`undefined\`, the built-in key with the operation part is used.
- GraphQL subscriptions over WebSocket are not measured.
`;

/** @returns {Promise<string>} */
export async function generate() {
  const schema = readSchema('config.schema.json');
  const options = listOptions(schema);
  /** @type {string[]} */
  const lines = [INTRO, '## Options', ''];
  for (const option of options) {
    const indent = '  '.repeat(option.depth);
    lines.push(`${indent}- [\`${option.path}\`](#${anchor(option.path)})`);
  }
  lines.push('');
  for (const option of options) {
    const note = /** @type {Record<string, { type?: string, description?: string }>} */ (NOTES)[
      option.path
    ];
    const level = option.depth === 0 ? '##' : '###';
    lines.push(`${level} \`${option.path}\``, '');
    const description = note?.description ?? option.raw.description ?? option.node.description;
    if (description !== undefined) lines.push(markdown(sanitize(description)), '');
    if (option.leaf) {
      lines.push(`- Type: ${note?.type ?? typeOf(option.raw, schema)}`);
      if (Object.hasOwn(option.node, 'default')) {
        lines.push(`- Default: ${code(option.node.default)}`);
      } else {
        lines.push('- Default: none');
      }
      lines.push('');
    } else {
      const children = Object.keys(option.node.properties).map(
        (name) => `[\`${name}\`](#${anchor(`${option.path}.${name}`)})`,
      );
      lines.push(`Options: ${children.join(', ')}.`, '');
    }
  }
  lines.push(URL_PATTERNS, OPERATIONS);
  const options_ = (await prettier.resolveConfig(outFile)) ?? {};
  return prettier.format(lines.join('\n'), { ...options_, filepath: outFile });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const text = await generate();
  /** @type {string | null} */
  let current;
  try {
    current = readFileSync(outFile, 'utf8');
  } catch {
    current = null;
  }
  const name = relative(root, outFile);
  if (check) {
    if (current !== text) {
      console.error(`${name} is out of date: run \`pnpm gen:docs\` and commit the result.`);
      process.exit(1);
    }
    console.log(`${name} is up to date.`);
  } else {
    writeFileSync(outFile, text);
    console.log(`wrote ${name}`);
  }
}
