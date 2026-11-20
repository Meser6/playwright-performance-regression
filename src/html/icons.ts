// Icons of the page as inline SVG from the template (11-REQ-41): decorative, never the only
// carrier of a status (the text next to them says it).
import { trustedHtml } from './escape.ts';
import type { SafeHtml } from './escape.ts';

const PATHS = {
  pass: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  fail: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m5 13.6L15.6 17 12 13.4 8.4 17 7 15.6 10.6 12 7 8.4 8.4 7l3.6 3.6L15.6 7 17 8.4 13.4 12z',
  warn: 'M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z',
  error: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 15h-2v-2h2zm0-4h-2V7h2z',
  logo: 'M3 13h2v8H3zm4-5h2v13H7zm4 3h2v10h-2zm4-7h2v17h-2zm4 9h2v8h-2z',
} as const;

export type IconName = keyof typeof PATHS;

/** A 24×24 icon hidden from assistive technology. */
export function icon(name: IconName): SafeHtml {
  return trustedHtml(
    `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${PATHS[name]}"/></svg>`,
  );
}
