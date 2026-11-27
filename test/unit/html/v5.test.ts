// The HTML report of 1.1.0 (11-REQ-61 – 11-REQ-63): cold vs warm, unsuccessful responses, the
// comparison with the thresholds run, the Slowest first calls ranking and the nonSuccess check.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseRunReport } from '../../../src/core/schema/index.ts';
import { renderHtmlReport } from '../../../src/html/index.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';
import { RUN_REPORTS, readCase } from './fixtures.ts';

function page(name: string): string {
  return renderHtmlReport(readCase(join(RUN_REPORTS, `${name}.json`)).input);
}

/** The details block of an endpoint key: from its header to the end of its <details>. */
function details(markup: string, key: string): string {
  const [method = '', path = ''] = key.split(' ');
  const header = `<code class="fk"><b class="m ${method}">${method}</b> <span class="key">${path}</span></code>`;
  const at = markup.lastIndexOf('<div class="kd">', markup.indexOf(header));
  if (markup.indexOf(header) === -1 || at === -1) throw new Error(`no details of ${key}`);
  return markup.slice(at, markup.indexOf('</details>', at));
}

/**
 * The page without what 1.1.0 changes in every report: the head (the stylesheet and its hash),
 * the config snapshot (it shows the new options) and the embedded data (11-REQ-63).
 */
function visible(markup: string): string {
  return markup
    .replace(/<head>.*?<\/head>/su, '<head/>')
    .replace(/<pre><code>.*?<\/code><\/pre>/su, '<pre/>')
    .replace(/<script type="application\/json" id="report-data">.*?<\/script>/su, '<data/>');
}

describe('key details of 1.1.0 (11-REQ-61, 11-REQ-62)', () => {
  test('11-AC-44 cold: Cold vs warm with the ratio and the Slowest first calls ranking', () => {
    const markup = page('cold');
    const tickets = details(markup, 'GET /api/tickets');
    expect(tickets).toContain('<h4>Cold vs warm');
    expect(tickets).toContain('<span class="sub">first calls in each pass</span>');
    expect(tickets).toContain(
      'First 5 calls 1840 ms, 1780 ms, 1720 ms, 1660 ms, 1600 ms · max 1840 ms · warm p50 120 ms · <b class="wv">×15.3</b>',
    );
    expect(tickets).toContain('Cold samples are not evaluated.');
    expect(details(markup, 'GET /api/users')).toContain(
      'Too few warm samples to set the first calls apart: they are included in the statistics.',
    );
    // A first call close to the warm median is not highlighted.
    expect(details(markup, 'POST /api/orders')).toContain('· <b>×1.1</b>');
    expect(markup).toContain('<h4 id="rank-cold">Slowest first calls</h4>');
    expect(markup).toMatch(/data-rank="cold">.*\/api\/tickets.*\/api\/users/su);
  });

  test('11-AC-44 fast-failure: Unsuccessful responses and the nonSuccess check', () => {
    const markup = page('fast-failure');
    const me = details(markup, 'GET /api/me');
    expect(me).toContain('<h4>Unsuccessful responses <span class="sub">20 responses</span>');
    expect(me).toContain('<th scope="row" class="wv">401</th><td>20</td><td>8.0 ms</td>');
    expect(me).toContain('Not part of the time statistics; the nonSuccess and errors rules count');
    expect(me).toMatch(/<th scope="row">non-success share<\/th>.*83\.9%/su);
    // A 500 is an error status: red.
    expect(details(markup, 'POST /api/orders')).toContain('<th scope="row" class="ev">500</th>');
    expect(markup).not.toContain('rank-cold');
  });

  test('11-AC-44 workload-shift: the comparison with the thresholds run, shifted row highlighted', () => {
    const markup = page('workload-shift');
    const search = details(markup, 'GET /api/search');
    expect(search).toContain('<h4>Compared with the thresholds run');
    expect(search).toContain(
      '<tr class="wv"><th scope="row">Per pass</th><td>4.0</td><td>1.2</td></tr>',
    );
    expect(details(markup, 'GET /api/tickets')).toContain(
      '<tr><th scope="row">Per pass</th><td>4.0</td><td>2.6</td></tr>',
    );
  });

  test('11-AC-45 a v4 report after migration renders as in 1.0.x', () => {
    const text = readFileSync(join(GOLDEN_DIR, 'run-report', 'v4', 'full-run.json'), 'utf8');
    const parsed = parseRunReport(text, 'v4.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const before = readFileSync(join(GOLDEN_DIR, 'html', 'v4', 'full-run.html'), 'utf8');
    const now = renderHtmlReport(parsed.value);
    expect(visible(now)).toBe(visible(before));
    for (const text of ['Cold vs warm', 'Unsuccessful responses', 'Compared with the thresholds']) {
      expect(now).not.toContain(text);
    }
  });
});
