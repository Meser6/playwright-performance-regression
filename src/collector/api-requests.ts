// APIRequestContext calls (15, chapter 4): wrapping the methods of one context and describing
// one call. The samples themselves are made by the collector of the running test.
import type { RawApiRequestSample } from '../core/types/index.ts';
import { wrappedRequestContexts } from '../registry/index.ts';

export type ApiSource = RawApiRequestSample['source'];

/** Methods that send a request (15, chapter 2). */
export const API_METHODS = ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head'] as const;

/** One call as seen when the method was called. */
export interface ApiCall {
  /** HTTP method, uppercase. */
  method: string;
  /** The URL or Request given to the method, as text. */
  rawUrl: string;
  /** Absolute URL, or a relative one resolved against baseURL; null when neither works. */
  url: string | null;
}

/** The collector side of a wrapped method: records the call and returns the promise to give back. */
export interface ApiRecorder {
  observeApiCall(call: ApiCall, source: ApiSource, result: Promise<unknown>): Promise<unknown>;
}

const METHOD = /^[A-Z]+$/u;

/** Synchronous nesting of wrapped calls: get() calling fetch() inside Playwright (15-REQ-04). */
let depth = 0;

function call(target: unknown, name: string): string | undefined {
  if (typeof target !== 'object' || target === null) return undefined;
  const fn = (target as Record<string, unknown>)[name];
  if (typeof fn !== 'function') return undefined;
  const value: unknown = (fn as () => unknown).call(target);
  return typeof value === 'string' ? value : undefined;
}

/** Absolute URL, else resolved against baseURL, else null (15-REQ-05). */
export function resolveUrl(raw: string, baseURL: string | undefined): string | null {
  try {
    return new URL(raw).toString();
  } catch {
    // relative: below
  }
  if (baseURL === undefined || baseURL === '') return null;
  try {
    return new URL(raw, baseURL).toString();
  } catch {
    return null;
  }
}

/**
 * The call of method `name` with `args` (15-REQ-05): fetch takes options.method, then the
 * method of a Request object, then GET. Undefined for a method that is not a plain HTTP token.
 */
export function describeCall(
  name: string,
  args: readonly unknown[],
  baseURL: string | undefined,
): ApiCall | undefined {
  const [target, options] = args;
  const rawUrl = typeof target === 'string' ? target : (call(target, 'url') ?? String(target));
  let method = name;
  if (name === 'fetch') {
    const fromOptions =
      typeof options === 'object' && options !== null
        ? (options as Record<string, unknown>).method
        : undefined;
    method =
      (typeof fromOptions === 'string' ? fromOptions : undefined) ??
      call(target, 'method') ??
      'GET';
  }
  method = method.toUpperCase();
  if (!METHOD.test(method)) return undefined;
  return { method, rawUrl, url: resolveUrl(rawUrl, baseURL) };
}

/** True for an object that looks like an APIRequestContext (15-AC-07). */
export function isApiRequestContext(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const target = value as Record<string, unknown>;
  return ['fetch', 'get', 'post', 'dispose', 'storageState'].every(
    (name) => typeof target[name] === 'function',
  );
}

function isPromise(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Wraps the request methods of `context` once (15-REQ-03, 15-REQ-04): each call is recorded by
 * the recorder of the running test, if any, and otherwise passes through. The wrapped method
 * returns a promise with the same value or error as the original (15-REQ-09). Returns false when
 * the context was already wrapped.
 */
export function wrapRequestContext(
  context: object,
  source: ApiSource,
  baseURL: string | undefined,
  recorder: () => ApiRecorder | undefined,
): boolean {
  const wrapped = wrappedRequestContexts();
  if (wrapped.has(context)) return false;
  wrapped.add(context);
  const target = context as Record<string, unknown>;
  for (const name of API_METHODS) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    const fn = original as (...args: unknown[]) => unknown;
    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      const active = depth === 0 ? recorder() : undefined;
      if (active === undefined) return fn.apply(this, args);
      let described: ApiCall | undefined;
      try {
        described = describeCall(name, args, baseURL);
      } catch {
        described = undefined;
      }
      depth += 1;
      let result: unknown;
      try {
        result = fn.apply(this, args);
      } finally {
        depth -= 1;
      }
      if (described === undefined || !isPromise(result)) return result;
      return active.observeApiCall(described, source, result);
    };
    Object.defineProperty(target, name, {
      value: wrapper,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }
  return true;
}
