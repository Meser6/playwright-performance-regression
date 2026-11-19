// Script of the HTML report (11, chapter 7): sorting, filters and the download of the embedded
// data. It only changes the order and visibility of existing elements and their attributes
// (11-REQ-14); the content is rendered statically (11-REQ-03). No dependencies (11-REQ-25).

interface Stats {
  max: number;
  percentiles: Record<string, number>;
}

interface AggregateData {
  count: number;
  successCount: number;
  errorCount: number;
  testCount: number;
  stats: Stats | null;
  ttfb: { p50: number } | null;
}

interface ReportData {
  endpoints: Record<string, AggregateData>;
  custom: Record<string, AggregateData>;
}

type Direction = 'ascending' | 'descending';

const dataElement = document.getElementById('report-data');
const dataText = dataElement?.textContent ?? '{"endpoints":{},"custom":{}}';
const data = JSON.parse(dataText) as ReportData;

document.documentElement.classList.add('js');

function sortValue(
  agg: AggregateData | undefined,
  column: string,
  level: string,
  group: number,
): number | null {
  if (agg === undefined) return null;
  switch (column) {
    case 'result':
      return group;
    case 'samples':
      return agg.successCount;
    case 'errors':
      return agg.errorCount;
    case 'p50':
      return agg.stats?.percentiles['p50'] ?? null;
    case 'percentile':
      return agg.stats?.percentiles[level] ?? null;
    case 'p99':
      return agg.stats?.percentiles['p99'] ?? null;
    case 'max':
      return agg.stats?.max ?? null;
    case 'ttfb':
      return agg.ttfb?.p50 ?? null;
    case 'tests':
      return agg.testCount;
    default:
      return null;
  }
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function setUpTable(table: HTMLTableElement): void {
  const kind = table.dataset['kind'] === 'custom' ? 'custom' : 'endpoints';
  const level = table.dataset['percentile'] ?? 'p95';
  const aggregates = data[kind];
  const groups = Array.from(table.tBodies);
  const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>('th[data-sort]'));
  let current: { column: string; direction: Direction } | null = null;

  function sortBy(column: string, direction: Direction): void {
    const sign = direction === 'ascending' ? 1 : -1;
    const rows = groups.map((body) => {
      const key = body.dataset['key'] ?? '';
      const group = Number(body.dataset['group'] ?? '3');
      return { body, key, value: sortValue(aggregates[key], column, level, group) };
    });
    rows.sort((a, b) => {
      if (column !== 'key') {
        // Missing values stay last in both directions.
        if (a.value === null || b.value === null) {
          if (a.value !== b.value) return a.value === null ? 1 : -1;
        } else if (a.value !== b.value) {
          return (a.value - b.value) * sign;
        }
        return compareKeys(a.key, b.key);
      }
      return compareKeys(a.key, b.key) * sign;
    });
    for (const row of rows) table.appendChild(row.body);
    for (const th of headers) {
      if (th.dataset['sort'] === column) th.setAttribute('aria-sort', direction);
      else th.removeAttribute('aria-sort');
    }
  }

  for (const th of headers) {
    const column = th.dataset['sort'] ?? 'key';
    th.querySelector('button')?.addEventListener('click', () => {
      const first: Direction = column === 'key' || column === 'result' ? 'ascending' : 'descending';
      const direction: Direction =
        current !== null && current.column === column
          ? current.direction === 'ascending'
            ? 'descending'
            : 'ascending'
          : first;
      current = { column, direction };
      sortBy(column, direction);
    });
  }

  const filters = document.querySelector<HTMLElement>(`[data-filters-for="${table.id}"]`);
  if (filters === null) return;
  const search = filters.querySelector<HTMLInputElement>('[data-filter="text"]');
  const violations = filters.querySelector<HTMLInputElement>('[data-filter="violations"]');
  const notEvaluated = filters.querySelector<HTMLInputElement>('[data-filter="not-evaluated"]');
  const counter = filters.querySelector<HTMLElement>('[data-count]');
  function apply(): void {
    const text = (search?.value ?? '').toLowerCase();
    let shown = 0;
    for (const body of groups) {
      const key = (body.dataset['key'] ?? '').toLowerCase();
      const result = body.dataset['result'] ?? '';
      const visible =
        key.includes(text) &&
        !(violations?.checked === true && result !== 'fail') &&
        !(notEvaluated?.checked === true && result === 'not-evaluated');
      body.hidden = !visible;
      if (visible) shown++;
    }
    if (counter !== null) counter.textContent = `showing ${shown} of ${groups.length}`;
  }
  for (const input of [search, violations, notEvaluated]) {
    input?.addEventListener('input', apply);
    input?.addEventListener('change', apply);
  }
  filters.hidden = false;
}

for (const table of Array.from(document.querySelectorAll<HTMLTableElement>('table.keys'))) {
  setUpTable(table);
}

// Download of the embedded data (11-REQ-07): a Blob URL, no network.
const download = document.getElementById('download');
const link = document.getElementById('download-link');
if (download instanceof HTMLButtonElement && link instanceof HTMLAnchorElement) {
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([dataText], { type: 'application/json' }));
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  download.hidden = false;
}

// Printing: open the details of keys with violations, and restore them afterwards (11-REQ-17).
let opened: HTMLDetailsElement[] = [];
window.addEventListener('beforeprint', () => {
  opened = Array.from(
    document.querySelectorAll<HTMLDetailsElement>('details[data-violation]:not([open])'),
  );
  for (const details of opened) details.open = true;
});
window.addEventListener('afterprint', () => {
  for (const details of opened) details.open = false;
  opened = [];
});
