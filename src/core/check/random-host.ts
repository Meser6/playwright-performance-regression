// CHECK_RANDOM_HOST (04-REQ-52): origins whose host looks generated per environment, with a
// ready keys.origins object of host patterns. A package constant heuristic (P-13); it never
// changes keys or the evaluation.
import { ID_PATTERNS } from '../normalize/patterns.ts';
import type { Issue } from '../types/index.ts';

export interface OriginCandidate {
  origin: string;
  /** The origin of use.baseURL of a measured project. */
  base: boolean;
}

const SHOWN = 5;

function generatedLabel(label: string): boolean {
  if (/[0-9]{3,}/u.test(label)) return true;
  const alnum = /^[a-z0-9]{8,}$/u.test(label);
  const digits = (label.match(/[0-9]/gu) ?? []).length;
  const letters = (label.match(/[a-z]/gu) ?? []).length;
  if (alnum && digits >= 2 && letters >= 2) return true;
  return ID_PATTERNS.uuid.test(label) || ID_PATTERNS.hex.test(label);
}

function isIp(host: string): boolean {
  return /^[0-9.]+$/u.test(host) || host.startsWith('[');
}

/** The proposed pattern and label for one origin, or null when the host does not look generated. */
export function proposePattern(
  candidate: OriginCandidate,
): { pattern: string; label: string } | null {
  let url: URL;
  try {
    url = new URL(candidate.origin);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || isIp(host)) return null;
  const labels = host.split('.');
  // Labels other than the last two; with a two-label host, the first one.
  const last = labels.length <= 2 ? 1 : labels.length - 2;
  const at = labels.slice(0, last).findIndex(generatedLabel);
  if (at < 0) return null;
  const label = labels[at] ?? '';
  const digit = label.search(/[0-9]/u);
  const prefix = digit < 0 ? '' : label.slice(0, digit);
  const star = prefix.length >= 2 && /^[a-z-]+$/u.test(prefix) ? `${prefix}*` : '*';
  const parts = labels.map((part, i) => (i === at ? star : part));
  const port = url.port === '' ? '' : `:${url.port}`;
  const pattern = `${url.protocol}//${parts.join('.')}${port}`;
  const name = candidate.base ? '' : (/[a-z]{2,}/u.exec(host)?.[0] ?? 'backend');
  return { pattern, label: name };
}

/** One CHECK_RANDOM_HOST for the run, or null (04-REQ-52). */
export function randomHostIssue(candidates: readonly OriginCandidate[]): Issue | null {
  const proposals = new Map<string, { label: string; origins: string[] }>();
  for (const candidate of candidates) {
    const proposed = proposePattern(candidate);
    if (proposed === null) continue;
    const entry = proposals.get(proposed.pattern);
    if (entry === undefined) {
      proposals.set(proposed.pattern, { label: proposed.label, origins: [candidate.origin] });
    } else if (!entry.origins.includes(candidate.origin)) {
      entry.origins.push(candidate.origin);
    }
  }
  if (proposals.size === 0) return null;
  const origins = [...new Set([...proposals.values()].flatMap((p) => p.origins))].sort();
  const shown = origins.slice(0, SHOWN).join(', ') + (origins.length > SHOWN ? ', …' : '');
  const object = [...proposals.keys()]
    .sort()
    .map((pattern) => `'${pattern}': '${proposals.get(pattern)?.label ?? ''}'`)
    .join(', ');
  return {
    code: 'CHECK_RANDOM_HOST',
    message: `${String(origins.length)} ${origins.length === 1 ? 'origin looks' : 'origins look'} generated per environment: ${shown}; their keys or the normalization fingerprint change on every instance.`,
    hint: `Add host patterns to keys.origins, e.g. { ${object} } (docs/dynamic-environments.md).`,
  };
}
