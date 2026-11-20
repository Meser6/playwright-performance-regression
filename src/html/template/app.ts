// Script of the HTML report (11, chapter 7): tabs, the key drawer, deep links, search, filters,
// sorting, copy link and the download of the embedded data. The content is rendered statically
// (11-REQ-03); the script only changes the order, visibility, parent and attributes of existing
// elements and the text of counters, the status region and the drawer title (11-REQ-14). It
// never builds elements from report data. No dependencies (11-REQ-25).

interface CheckData {
  rule: string;
  passed: boolean;
  usage: number | null;
}

interface AggregateData {
  count: number;
  successCount: number;
  errorCount: number;
  testCount: number;
  stats: { max: number; percentiles: Record<string, number> } | null;
  ttfb: { p50: number } | null;
  evaluation: { checks: CheckData[] };
}

interface TestData {
  title: string;
  file: string;
  executions: number;
  requestCount: number;
  errorCount: number;
  totalMs: number;
  maxRequestMs: number | null;
  keyCount: number;
  violatedKeyCount: number;
}

interface ReportData {
  endpoints: Record<string, AggregateData>;
  testBreakdown: { tests: TestData[] } | null;
}

type Kind = 'api';
type Direction = 'ascending' | 'descending';

const doc = document;
const dataText = doc.getElementById('report-data')?.textContent ?? '{}';
const data = JSON.parse(dataText) as Partial<ReportData>;
const aggregates: Record<Kind, Record<string, AggregateData>> = {
  api: data.endpoints ?? {},
};
const testData: TestData[] = data.testBreakdown?.tests ?? [];
const KIND_TAB: Record<Kind, string> = { api: 'endpoints' };

doc.documentElement.classList.add('js');

function all<T extends Element>(selector: string, root: ParentNode = doc): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function own(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

const statusRegion = doc.getElementById('status');
function announce(text: string): void {
  if (statusRegion !== null) statusRegion.textContent = text;
}

function setHash(hash: string): void {
  history.replaceState(null, '', hash);
}

// ---------------------------------------------------------------------------------------------
// Tabs (11-REQ-40): ARIA tabs over the static navigation and panels

const tabList = doc.querySelector<HTMLElement>('[data-tabs]');
const tabLinks = tabList === null ? [] : all<HTMLAnchorElement>('a[data-tab]', tabList);
const panels = new Map<string, HTMLElement>();
for (const panel of all<HTMLElement>('[data-panel]')) {
  panels.set(panel.dataset['panel'] ?? '', panel);
}
let currentTab = 'overview';

function selectTab(id: string, focus = false): void {
  if (!panels.has(id)) return;
  currentTab = id;
  for (const link of tabLinks) {
    const selected = link.dataset['tab'] === id;
    link.setAttribute('aria-selected', String(selected));
    link.tabIndex = selected ? 0 : -1;
    if (selected && focus) link.focus();
  }
  for (const [name, panel] of panels) panel.hidden = name !== id;
}

if (tabList !== null) {
  tabList.setAttribute('role', 'tablist');
  for (const link of tabLinks) {
    const id = link.dataset['tab'] ?? '';
    link.setAttribute('role', 'tab');
    link.setAttribute('aria-controls', `tab-${id}`);
    const panel = panels.get(id);
    panel?.setAttribute('role', 'tabpanel');
    panel?.setAttribute('aria-labelledby', link.id);
  }
  tabList.addEventListener('keydown', (event) => {
    const index = tabLinks.findIndex((l) => l.dataset['tab'] === currentTab);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabLinks.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabLinks.length) % tabLinks.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabLinks.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const id = tabLinks[next]?.dataset['tab'] ?? 'overview';
    selectTab(id, true);
    setHash(`#tab=${id}`);
  });
}

// ---------------------------------------------------------------------------------------------
// Key rows: exact lookup by key in a Map of the embedded data (11-REQ-38)

const rows: Record<Kind, Map<string, HTMLTableSectionElement>> = {
  api: new Map(),
};

/** Kind of a key table from its data-kind attribute. */
function tableKind(table: HTMLTableElement | null | undefined): Kind {
  const kind = table?.dataset['kind'] ?? 'api';
  return own(KIND_TAB, kind) ? (kind as Kind) : 'api';
}
/** The full key of a row: the text of its details header (`.fk`), compared exactly. */
const keyOfRow = new Map<HTMLTableSectionElement, string>();
for (const table of all<HTMLTableElement>('table.keys')) {
  const kind = tableKind(table);
  for (const body of Array.from(table.tBodies)) {
    const key = body.querySelector('.fk')?.textContent ?? '';
    keyOfRow.set(body, key);
    if (own(aggregates[kind], key)) rows[kind].set(key, body);
  }
}

function kindOf(body: HTMLTableSectionElement): Kind {
  return tableKind(body.closest('table'));
}

// ---------------------------------------------------------------------------------------------
// Drawer (11-REQ-37)

const drawer = doc.getElementById('drawer');
const drawerTitle = doc.getElementById('drawer-title');
const drawerBody = drawer?.querySelector<HTMLElement>('.drawer-body') ?? null;
const copyOut = drawer?.querySelector<HTMLElement>('.copy-out') ?? null;
let current: { body: HTMLTableSectionElement; block: HTMLElement; home: HTMLElement } | null = null;
let returnFocus: HTMLElement | null = null;
/** Tab of the link that opened the drawer: closing returns to it with the focus. */
let returnTab: string | null = null;

function giveBack(): void {
  if (current === null) return;
  current.home.appendChild(current.block);
  current = null;
}

function openKey(body: HTMLTableSectionElement, from: HTMLElement | null): void {
  const home = body.querySelector<HTMLElement>('details');
  const block = home?.querySelector<HTMLElement>('.kd') ?? drawerBody?.querySelector('.kd');
  if (drawer === null || drawerBody === null || home === null || block == null) return;
  giveBack();
  if (from !== null) {
    returnFocus = from;
    returnTab = currentTab;
  }
  drawerBody.appendChild(block);
  current = { body, block, home };
  const kind = kindOf(body);
  const key = keyOfRow.get(body) ?? '';
  if (drawerTitle !== null) drawerTitle.textContent = key;
  if (copyOut !== null) copyOut.hidden = true;
  drawer.hidden = false;
  doc.documentElement.classList.add('drawer-open');
  selectTab(KIND_TAB[kind]);
  setHash(`#key=${kind}:${encodeURIComponent(key)}`);
  drawerTitle?.focus();
}

function closeDrawer(restoreFocus = true): void {
  if (drawer === null || drawer.hidden) return;
  giveBack();
  drawer.hidden = true;
  doc.documentElement.classList.remove('drawer-open');
  if (restoreFocus && returnTab !== null) selectTab(returnTab);
  setHash(`#tab=${currentTab}`);
  if (restoreFocus) returnFocus?.focus();
  returnFocus = null;
  returnTab = null;
}

function step(delta: number): void {
  if (current === null) return;
  const table = current.body.closest('table');
  if (table === null) return;
  const visible = Array.from(table.tBodies).filter((b) => !b.hidden);
  const index = visible.indexOf(current.body);
  const next = visible[index + delta];
  if (next !== undefined) openKey(next, null);
}

drawer?.addEventListener('click', (event) => {
  const action = (event.target as Element).closest<HTMLElement>('[data-act]')?.dataset['act'];
  if (action === 'close') closeDrawer();
  else if (action === 'prev') step(-1);
  else if (action === 'next') step(1);
});
doc.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drawer !== null && !drawer.hidden) closeDrawer();
});

// ---------------------------------------------------------------------------------------------
// Deep links (11-REQ-38)

function route(hash: string, from: HTMLElement | null = null): void {
  let match = /^#tab[=-]([a-z-]+)$/u.exec(hash);
  if (match !== null) {
    closeDrawer(false);
    const id = match[1] ?? '';
    if (panels.has(id)) {
      selectTab(id);
      setHash(`#tab=${id}`);
    } else {
      selectTab('overview');
      announce('Tab not found in this report');
    }
    return;
  }
  let body: HTMLTableSectionElement | undefined;
  match = /^#key=(api|request):(.*)$/su.exec(hash);
  if (match !== null) {
    let key: string | null;
    try {
      key = decodeURIComponent(match[2] ?? '');
    } catch {
      key = null;
    }
    const kind = match[1] as Kind;
    if (key !== null && own(rows, kind)) body = rows[kind].get(key);
  } else {
    match = /^#key-api-(\d+)$/u.exec(hash);
    if (match === null) return;
    body = doc.getElementById(hash.slice(1))?.closest('tbody') ?? undefined;
  }
  if (body === undefined) {
    closeDrawer(false);
    selectTab('overview');
    announce('Key not found in this report');
    return;
  }
  openKey(body, from);
}

doc.addEventListener('click', (event) => {
  const target = event.target as Element;
  const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
  if (link === null) return;
  const hash = link.getAttribute('href') ?? '';
  if (link.hasAttribute('data-show-violations')) {
    event.preventDefault();
    closeDrawer(false);
    selectTab('endpoints');
    setHash('#tab=endpoints');
    showViolations();
    return;
  }
  if (/^#(?:tab-|key-)/u.test(hash)) {
    event.preventDefault();
    route(hash, link);
  }
});
window.addEventListener('hashchange', () => route(location.hash));

// ---------------------------------------------------------------------------------------------
// Sorting (11-REQ-12) on the embedded data; ties keep the default order

function topUsage(agg: AggregateData): number | null {
  const checks = agg.evaluation.checks;
  if (checks.length === 0) return null;
  let top = -Infinity;
  for (const c of checks) top = Math.max(top, c.usage ?? Infinity);
  return top;
}

function keyValue(agg: AggregateData | undefined, column: string, level: string): number | null {
  if (agg === undefined) return null;
  switch (column) {
    case 'headroom':
      return topUsage(agg);
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

function testValue(t: TestData | undefined, column: string): number | null {
  if (t === undefined) return null;
  switch (column) {
    case 'runs':
      return t.executions;
    case 'requests':
      return t.requestCount;
    case 'errors':
      return t.errorCount;
    case 'total':
      return t.totalMs;
    case 'avg':
      return Math.round((t.totalMs / t.executions) * 10) / 10;
    case 'longest':
      return t.maxRequestMs;
    case 'keys':
      return t.keyCount;
    case 'violations':
      return t.violatedKeyCount;
    default:
      return null;
  }
}

interface SortRow {
  element: HTMLElement;
  /** Position in the default order. */
  order: number;
  text: string;
  value: (column: string) => number | null;
}

function sortable(table: HTMLTableElement, items: SortRow[], parent: HTMLElement): void {
  const headers = all<HTMLTableCellElement>('th[data-sort]', table);
  let current: { column: string; direction: Direction } | null = null;
  for (const th of headers) {
    const column = th.dataset['sort'] ?? '';
    th.querySelector('button')?.addEventListener('click', () => {
      const textual = column === 'key' || column === 'title' || column === 'result';
      const first: Direction = textual ? 'ascending' : 'descending';
      const direction: Direction =
        current?.column === column
          ? current.direction === 'ascending'
            ? 'descending'
            : 'ascending'
          : first;
      current = { column, direction };
      const sign = direction === 'ascending' ? 1 : -1;
      const sorted = [...items].sort((a, b) => {
        if (column === 'key' || column === 'title') {
          return (a.text < b.text ? -1 : a.text > b.text ? 1 : 0) * sign || a.order - b.order;
        }
        const x = a.value(column);
        const y = b.value(column);
        // Missing values stay last in both directions.
        if (x === null || y === null) return x === y ? a.order - b.order : x === null ? 1 : -1;
        return (x - y) * sign || a.order - b.order;
      });
      for (const row of sorted) parent.appendChild(row.element);
      for (const h of headers) {
        if (h === th) h.setAttribute('aria-sort', direction);
        else h.removeAttribute('aria-sort');
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Filters (11-REQ-13)

interface Filterable {
  element: HTMLElement;
  text: string;
  attributes: Record<string, string | null>;
}

const resets = new Map<string, (pressed: Record<string, string[]>) => void>();

function filterable(id: string, items: Filterable[]): void {
  const tools = doc.querySelector<HTMLElement>(`[data-for="${id}"]`);
  if (tools === null) return;
  const search = tools.querySelector<HTMLInputElement>('input[type="search"]');
  const chips = all<HTMLButtonElement>('button[data-f]', tools);
  const counter = tools.querySelector<HTMLElement>('[data-count]');
  function apply(): void {
    const text = (search?.value ?? '').toLowerCase();
    const groups = new Map<string, Set<string>>();
    for (const chip of chips) {
      if (chip.getAttribute('aria-pressed') !== 'true') continue;
      const group = chip.dataset['f'] ?? '';
      const set = groups.get(group) ?? new Set<string>();
      set.add(chip.dataset['v'] ?? '');
      groups.set(group, set);
    }
    let shown = 0;
    for (const item of items) {
      let visible = item.text.includes(text);
      for (const [group, values] of groups) {
        const value = item.attributes[group] ?? null;
        if (value === null || !values.has(value)) visible = false;
      }
      item.element.hidden = !visible;
      if (visible) shown++;
    }
    if (counter !== null) counter.textContent = `showing ${shown} of ${items.length}`;
  }
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
      apply();
    });
  }
  search?.addEventListener('input', apply);
  tools.querySelector('[data-reset]')?.addEventListener('click', () => {
    if (search !== null) search.value = '';
    for (const chip of chips) chip.setAttribute('aria-pressed', 'false');
    apply();
  });
  resets.set(id, (pressed) => {
    if (search !== null) search.value = '';
    for (const chip of chips) {
      const on = pressed[chip.dataset['f'] ?? '']?.includes(chip.dataset['v'] ?? '') === true;
      chip.setAttribute('aria-pressed', String(on));
    }
    apply();
  });
  tools.hidden = false;
}

/** "All N violations": blocking and other violations in the endpoint table (11-REQ-13). */
function showViolations(): void {
  resets.get('table-api')?.({ g: ['0', '1'] });
}

for (const table of all<HTMLTableElement>('table.keys')) {
  const kind = tableKind(table);
  const level = table.dataset['level'] ?? 'p95';
  const bodies = Array.from(table.tBodies);
  const items = bodies.map((body) => {
    const key = keyOfRow.get(body) ?? '';
    return {
      element: body as HTMLElement,
      order: Number(/\d+$/u.exec(body.querySelector('details')?.id ?? '')?.[0] ?? '0'),
      text: key,
      value: (column: string): number | null =>
        column === 'result'
          ? Number(body.dataset['g'] ?? '3')
          : keyValue(own(aggregates[kind], key) ? aggregates[kind][key] : undefined, column, level),
    };
  });
  sortable(table, items, table);
  filterable(
    table.id,
    bodies.map((body) => ({
      element: body,
      text: (keyOfRow.get(body) ?? '').toLowerCase(),
      attributes: {
        g: body.dataset['g'] ?? null,
        s: body.dataset['s'] ?? null,
        m: body.hasAttribute('data-m') ? '' : null,
      },
    })),
  );
}

const testsTable = doc.querySelector<HTMLTableElement>('#table-tests');
const testsBody = testsTable?.tBodies[0];
if (testsTable !== null && testsBody !== undefined) {
  const testRows = Array.from(testsBody.rows);
  const testOf = (row: HTMLTableRowElement): TestData | undefined =>
    testData[Number(row.dataset['i'] ?? '-1')];
  sortable(
    testsTable,
    testRows.map((row) => ({
      element: row,
      order: Number(row.dataset['i'] ?? '0'),
      text: testOf(row)?.title ?? '',
      value: (column: string) => testValue(testOf(row), column),
    })),
    testsBody,
  );
  filterable(
    'table-tests',
    testRows.map((row) => {
      const t = testOf(row);
      return {
        element: row,
        text: `${t?.title ?? ''}\u0000${t?.file ?? ''}`.toLowerCase(),
        attributes: { v: row.hasAttribute('data-v') ? '' : null },
      };
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Ranking kinds (11-REQ-31): the first 10 entries among the selected kinds

const kindChips = doc.querySelector<HTMLElement>('[data-kinds]');
if (kindChips !== null) {
  const chips = all<HTMLButtonElement>('button[data-k]', kindChips);
  const update = (): void => {
    const selected = new Set(
      chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset['k']),
    );
    for (const list of all<HTMLElement>('ol[data-rank]')) {
      let shown = 0;
      for (const item of all<HTMLElement>('li', list)) {
        const visible = selected.has(item.dataset['k']) && shown < 10;
        item.hidden = !visible;
        if (visible) shown++;
      }
    }
  };
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
      update();
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Copy link and download (11-REQ-38, 11-REQ-07)

doc.addEventListener('click', (event) => {
  if ((event.target as Element).closest('[data-copy]') === null) return;
  const url = location.href;
  const fallback = (): void => {
    const input = copyOut?.querySelector('input');
    if (copyOut === null || input == null) return;
    copyOut.hidden = false;
    input.value = url;
    input.focus();
    input.select();
  };
  if (navigator.clipboard === undefined) {
    fallback();
    return;
  }
  navigator.clipboard.writeText(url).then(() => announce('Link copied'), fallback);
});

const download = doc.getElementById('download');
const downloadLink = doc.getElementById('download-link');
if (download instanceof HTMLButtonElement && downloadLink instanceof HTMLAnchorElement) {
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([dataText], { type: 'application/json' }));
    downloadLink.href = url;
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// Controls that need the script are hidden in the static page (11-REQ-40).
for (const element of all<HTMLElement>('.js-only')) element.hidden = false;

// ---------------------------------------------------------------------------------------------
// Printing: the drawer gives its block back; details of violations open (11-REQ-17)

let opened: HTMLDetailsElement[] = [];
window.addEventListener('beforeprint', () => {
  closeDrawer(false);
  opened = all<HTMLDetailsElement>('details[data-v]:not([open])');
  for (const details of opened) details.open = true;
});
window.addEventListener('afterprint', () => {
  for (const details of opened) details.open = false;
  opened = [];
});

selectTab('overview');
route(location.hash);
