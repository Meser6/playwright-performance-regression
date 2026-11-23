// How a key looks in tables, lists and rankings (11-REQ-53): an endpoint as a method badge and a
// monospace path with the origin label as a small token and path parameters in the accent colour;
// a step in the proportional font with the parent titles muted and the last title bold. Long keys
// are shortened in the middle with the full key in `title` (11, chapter 6.4).
import { REQUEST_KEY_PREFIX, isRequestKey } from '../core/types/index.ts';
import type { RunReport } from '../core/types/index.ts';
import type { LinkKind } from './context.ts';
import { html } from './escape.ts';
import type { SafeHtml } from './escape.ts';
import { truncateMiddle } from './format.ts';

/** Methods with their own colour (11-REQ-48); other methods get a neutral badge. */
const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** Separator of the titles in a step key (06). */
export const STEP_SEPARATOR = ' › ';

/** Where an endpoint key was measured (15-REQ-01): `request …` keys are APIRequestContext calls. */
export function endpointSource(key: string): 'browser' | 'request' {
  return isRequestKey(key) ? 'request' : 'browser';
}

/**
 * Method, origin label and path of an endpoint key `METHOD [label]/path` (07); `request` is true
 * for the key of an APIRequestContext call, whose prefix is left out of the parts (15-REQ-15).
 */
export function splitEndpoint(key: string): {
  method: string;
  origin: string;
  path: string;
  request: boolean;
} {
  const request = isRequestKey(key);
  const text = request ? key.slice(REQUEST_KEY_PREFIX.length) : key;
  const space = text.indexOf(' ');
  if (space <= 0) return { method: '', origin: '', path: text, request };
  const method = text.slice(0, space);
  const rest = text.slice(space + 1);
  const slash = rest.indexOf('/');
  if (slash <= 0) return { method, origin: '', path: rest, request };
  return { method, origin: rest.slice(0, slash), path: rest.slice(slash), request };
}

/** Path parameters (`:id`, `:email`, …) in the accent colour. */
function pathView(path: string): SafeHtml {
  const parts = path.split(/(?<=\/)(:[A-Za-z][\w-]*)/u);
  return html`${parts.map((part, i) => (i % 2 === 1 ? html`<i>${part}</i>` : part))}`;
}

/** The method badge of an endpoint (`m` plus the method class when it has a colour). */
export function methodBadge(method: string): SafeHtml {
  return METHODS.has(method)
    ? html`<b class="m ${method}">${method}</b>`
    : html`<b class="m">${method}</b>`;
}

/** The origin label token, with the origin address in `title` when the report has it. */
function originToken(label: string, origins: RunReport['origins'] | undefined): SafeHtml {
  const address = origins?.find((o) => o.label === label)?.origin;
  return html`<span class="o" title="${address === undefined ? 'origin label' : `origin label: ${address}`}">${label}</span>`;
}

/** Key text of an endpoint: origin token and path, shortened to `max` code points. */
function endpointView(
  key: string,
  max: number,
  full: boolean,
  origins?: RunReport['origins'],
): SafeHtml {
  const { method, origin, path, request } = splitEndpoint(key);
  const room = Math.max(8, max - method.length - 1 - origin.length - (request ? 8 : 0));
  const short = truncateMiddle(path, room);
  return html`${request ? html`<span class="rq">request</span> ` : null}${method === '' ? null : html`${methodBadge(method)} `}<span class="key"${short === path && !full ? null : html` title="${key}"`}>${origin === '' ? null : originToken(origin, origins)}${pathView(short)}</span>`;
}

/** Key text of a step: parent titles muted, the last title bold. */
function stepView(key: string, max: number, full: boolean): SafeHtml {
  const short = truncateMiddle(key, max);
  const titles = short.split(STEP_SEPARATOR);
  const last = titles.pop() ?? '';
  return html`<span class="key st"${short === key && !full ? null : html` title="${key}"`}>${titles.map((t) => html`<s>${t}${STEP_SEPARATOR}</s>`)}<b>${last}</b></span>`;
}

/**
 * The view of a key of a kind (11-REQ-53). The full key goes to `title` when it is shortened, and
 * always with `full` (cards, where the line itself is cut with an ellipsis).
 */
export function keyView(
  kind: LinkKind,
  key: string,
  max: number,
  full = false,
  origins?: RunReport['origins'],
): SafeHtml {
  return kind === 'step' ? stepView(key, max, full) : endpointView(key, max, full, origins);
}

/** Depth marker of a step key in the Steps table: up to 3 dots filled to the depth. */
export function stepDepth(key: string): SafeHtml {
  const depth = Math.min(3, key.split(STEP_SEPARATOR).length);
  return html`<span class="dep d${depth}" aria-hidden="true"></span>`;
}
