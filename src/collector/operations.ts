// Operation names of keys.operations (18, chapter 5), read in the worker (18-D-01). Pure: the
// trackers pass plain request data and the body only through a callback, which is called for
// POST requests matching a graphql entry (18-REQ-07, P-07). The key is built by the reporter.
import { matchOperationEntry } from '../core/config/index.ts';
import type { ResolvedOperationEntry } from '../core/config/index.ts';
import { OPERATION_BODY_LIMIT } from './constants.ts';

/** GraphQL names (18-REQ-04): the name grammar, at most 100 characters. */
const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]{0,99}$/u;
/** tRPC procedure names (18-REQ-05). */
const PROCEDURE_NAME = /^[A-Za-z0-9_.-]{1,100}$/u;
const NAMED_OPERATION = /\b(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/u;
const OPERATION_NAME_FIELD = /"operationName"\s*:\s*"([^"\\]*)"/u;

/** Name of a GraphQL operation without a name, and of a persisted query without one (18-REQ-06). */
export const ANONYMOUS_OPERATION = 'anonymous';
export const PERSISTED_OPERATION = 'persisted';

/** What the collector hands over for a POST body: raw text, or the data of an API call (15-REQ-20). */
export type OperationBody =
  | { text: string }
  | { value: unknown }
  /** options.multipart.operations of an API call. */
  | { multipartOperations: unknown }
  | null;

export interface OperationRequest {
  /** Uppercase HTTP method. */
  method: string;
  /** Absolute URL; for API calls with options.params, with those parameters added. */
  url: string;
  /** Called only for POST requests matching a graphql entry (18-REQ-07). */
  body: () => OperationBody;
}

export type OperationResult =
  | { matched: false }
  /** names: null when the request matched an entry but no name could be read (18-REQ-08). */
  | { matched: true; entry: ResolvedOperationEntry; names: OperationNames | null };

/** At least one name (the sample batch, 18-REQ-09). */
export type OperationNames = [string, ...string[]];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The query text without comments and string literals (18-REQ-03). */
export function stripGraphqlNoise(query: string): string {
  let out = '';
  let i = 0;
  while (i < query.length) {
    const c = query[i];
    if (c === '#') {
      while (i < query.length && query[i] !== '\n' && query[i] !== '\r') i++;
      out += ' ';
    } else if (query.startsWith('"""', i)) {
      i += 3;
      while (i < query.length && !query.startsWith('"""', i)) {
        i += query.startsWith('\\"""', i) ? 4 : 1;
      }
      i += 3;
      out += ' ';
    } else if (c === '"') {
      i++;
      while (i < query.length && query[i] !== '"' && query[i] !== '\n') {
        i += query[i] === '\\' ? 2 : 1;
      }
      i++;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The first named operation of a query, 'anonymous' without one, null for a rejected name. */
export function firstNamedOperation(query: string): string | null {
  const found = NAMED_OPERATION.exec(stripGraphqlNoise(query));
  if (found === null) return ANONYMOUS_OPERATION;
  const name = found[1] ?? '';
  return GRAPHQL_NAME.test(name) ? name : null;
}

/** The name of one GraphQL operation object (18-REQ-03, 18-REQ-04), or null. */
function operationName(operation: unknown): string | null {
  if (!isRecord(operation)) return null;
  const given = operation.operationName;
  if (typeof given === 'string' && GRAPHQL_NAME.test(given)) return given;
  // A rejected operationName counts as no name: the query gives it (18-REQ-04).
  const rejected = typeof given === 'string' && given !== '';
  if (typeof operation.query === 'string') return firstNamedOperation(operation.query);
  const extensions = operation.extensions;
  if (isRecord(extensions) && isRecord(extensions.persistedQuery)) {
    return rejected ? null : PERSISTED_OPERATION;
  }
  return null;
}

/** Names of a parsed body: an object or a batch where every operation has a name (18-REQ-03). */
export function graphqlNamesFromValue(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const names: string[] = [];
    for (const item of value) {
      const name = operationName(item);
      if (name === null) return null;
      names.push(name);
    }
    return names;
  }
  const name = operationName(value);
  return name === null ? null : [name];
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** The `operations` part of a raw multipart/form-data body (GraphQL upload), or null. */
function multipartOperations(text: string): string | null {
  const header = /content-disposition:[^\r\n]*\bname="operations"[^\r\n]*\r?\n/iu.exec(text);
  if (header === null) return null;
  let start = header.index + header[0].length;
  // Further part headers, then an empty line.
  const blank = /\r?\n\r?\n/u.exec(text.slice(header.index));
  if (blank === null) return null;
  start = Math.max(start, header.index + blank.index + blank[0].length);
  const end = text.indexOf('\n--', start);
  if (end < 0) return null;
  return text.slice(start, text[end - 1] === '\r' ? end - 1 : end);
}

/** Names from the text of a POST body, cut at OPERATION_BODY_LIMIT (18-REQ-03, 18-REQ-07). */
export function graphqlNamesFromText(text: string): string[] | null {
  const truncated = text.length > OPERATION_BODY_LIMIT;
  const head = truncated ? text.slice(0, OPERATION_BODY_LIMIT) : text;
  if (!truncated) {
    const parsed = parseJson(head);
    if (parsed.ok) return graphqlNamesFromValue(parsed.value);
  }
  const part = multipartOperations(head);
  if (part !== null) {
    const parsed = parseJson(part);
    return parsed.ok ? graphqlNamesFromValue(parsed.value) : null;
  }
  // A cut body is not JSON: only the first operationName of an object counts (18-REQ-07).
  if (truncated && head.trimStart().startsWith('{')) {
    const name = OPERATION_NAME_FIELD.exec(head)?.[1];
    return name !== undefined && GRAPHQL_NAME.test(name) ? [name] : null;
  }
  return null;
}

/** Names from the parameters of a GET request (18-REQ-03): query, operationName, extensions. */
export function graphqlNamesFromParams(params: URLSearchParams): string[] | null {
  const query = params.get('query');
  const name = params.get('operationName');
  const extensionsText = params.get('extensions');
  if (query === null && name === null && extensionsText === null) return null;
  let extensions: unknown;
  if (extensionsText !== null) {
    const parsed = parseJson(extensionsText);
    extensions = parsed.ok ? parsed.value : undefined;
  }
  return graphqlNamesFromValue({
    ...(query === null ? {} : { query }),
    ...(name === null ? {} : { operationName: name }),
    ...(extensions === undefined ? {} : { extensions }),
  });
}

function graphqlNamesFromBody(body: OperationBody): string[] | null {
  if (body === null) return null;
  if ('text' in body) return graphqlNamesFromText(body.text);
  if ('value' in body) {
    return typeof body.value === 'string'
      ? graphqlNamesFromText(body.value)
      : graphqlNamesFromValue(body.value);
  }
  const operations = body.multipartOperations;
  if (typeof operations !== 'string') return null;
  const parsed = parseJson(operations.slice(0, OPERATION_BODY_LIMIT));
  return parsed.ok ? graphqlNamesFromValue(parsed.value) : null;
}

/** Procedure names from the path segment after the tRPC prefix (18-REQ-05). */
export function trpcNamesFromPath(path: string, end: number): string[] | null {
  let rest = path.slice(end);
  if (rest.startsWith('/')) rest = rest.slice(1);
  const segment = rest.split('/', 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const names = decoded.split(',');
  return names.every((name) => PROCEDURE_NAME.test(name)) ? names : null;
}

/**
 * Operation names of a request (18, chapter 5). The body is read only for a POST request
 * matching a graphql entry; tRPC names and GraphQL GET names come from the URL.
 */
export function readOperation(
  entries: readonly ResolvedOperationEntry[],
  request: OperationRequest,
): OperationResult {
  if (entries.length === 0) return { matched: false };
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { matched: false };
  }
  const found = matchOperationEntry(entries, url.pathname);
  if (found === null) return { matched: false };
  const { entry } = found;
  let names: string[] | null = null;
  if (entry.type === 'trpc') names = trpcNamesFromPath(url.pathname, found.end);
  else if (request.method === 'GET') names = graphqlNamesFromParams(url.searchParams);
  else if (request.method === 'POST') names = graphqlNamesFromBody(request.body());
  return { matched: true, entry, names: isNonEmpty(names) ? names : null };
}

function isNonEmpty(names: string[] | null): names is OperationNames {
  return names !== null && names.length > 0;
}
