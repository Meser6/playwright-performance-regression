// Minimal stand-ins for Playwright's BrowserContext, Page, Request and Response: only what the
// collector calls. Events are emitted by hand.
import type { BrowserContext, Page, Request, Response } from '@playwright/test';

type Listener = (arg: unknown) => void;

class Emitter {
  readonly listeners = new Map<string, Set<Listener>>();
  on(event: string, listener: Listener): this {
    let set = this.listeners.get(event);
    if (set === undefined) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return this;
  }
  once(event: string, listener: Listener): this {
    const wrapper: Listener = (arg) => {
      this.off(event, wrapper);
      listener(arg);
    };
    return this.on(event, wrapper);
  }
  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  emit(event: string, arg?: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(arg);
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
}

export class FakePage extends Emitter {
  readonly ctx: FakeContext;
  constructor(ctx: FakeContext) {
    super();
    this.ctx = ctx;
  }
  context(): BrowserContext {
    return this.ctx.asContext();
  }
  asPage(): Page {
    return this as unknown as Page;
  }
}

export class FakeContext extends Emitter {
  readonly pageList: FakePage[] = [];
  readonly engine: string | null;
  constructor(engine: string | null = 'chromium') {
    super();
    this.engine = engine;
  }
  pages(): Page[] {
    return this.pageList.map((p) => p.asPage());
  }
  newPage(): FakePage {
    const page = new FakePage(this);
    this.pageList.push(page);
    this.emit('page', page);
    return page;
  }
  browser(): unknown {
    return this.engine === null ? null : { browserType: () => ({ name: () => this.engine }) };
  }
  asContext(): BrowserContext {
    return this as unknown as BrowserContext;
  }
  close(): void {
    for (const page of this.pageList) page.emit('close', page);
    this.emit('close', this);
  }
}

export interface Timing {
  startTime: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  secureConnectionStart: number;
  connectEnd: number;
}

export function timing(partial: Partial<Timing> = {}): Timing {
  return {
    startTime: 1_763_460_000_000,
    domainLookupStart: -1,
    domainLookupEnd: -1,
    connectStart: -1,
    secureConnectionStart: -1,
    connectEnd: -1,
    requestStart: -1,
    responseStart: -1,
    responseEnd: -1,
    ...partial,
  };
}

let nextId = 0;

export interface FakeRequestOptions {
  method?: string;
  resourceType?: string;
  serviceWorker?: boolean;
  page?: FakePage | null;
  /** Request body; postData() calls are counted in postDataReads. */
  postData?: string | null;
}

export class FakeRequest {
  readonly id = ++nextId;
  timingValue = timing();
  responseValue: FakeResponse | null = null;
  failureValue: { errorText: string } | null = null;
  readonly urlValue: string;
  readonly options: FakeRequestOptions;
  postDataReads = 0;
  constructor(urlValue: string, options: FakeRequestOptions = {}) {
    this.urlValue = urlValue;
    this.options = options;
  }
  url(): string {
    return this.urlValue;
  }
  method(): string {
    return this.options.method ?? 'GET';
  }
  resourceType(): string {
    return this.options.resourceType ?? 'fetch';
  }
  postData(): string | null {
    this.postDataReads += 1;
    return this.options.postData ?? null;
  }
  serviceWorker(): unknown {
    return this.options.serviceWorker === true ? {} : null;
  }
  timing(): Timing {
    return this.timingValue;
  }
  response(): Promise<Response | null> {
    return Promise.resolve(this.responseValue as unknown as Response | null);
  }
  failure(): { errorText: string } | null {
    return this.failureValue;
  }
  frame(): unknown {
    const page = this.options.page;
    if (page === undefined) throw new Error('no frame');
    return { page: () => page?.asPage() ?? null };
  }
  asRequest(): Request {
    return this as unknown as Request;
  }
}

export class FakeResponse {
  readonly req: FakeRequest;
  readonly statusValue: number;
  readonly sw: boolean;
  constructor(req: FakeRequest, statusValue = 200, sw = false) {
    this.req = req;
    this.statusValue = statusValue;
    this.sw = sw;
  }
  request(): Request {
    return this.req.asRequest();
  }
  status(): number {
    return this.statusValue;
  }
  fromServiceWorker(): boolean {
    return this.sw;
  }
}

/** Emits request → response → requestfinished with full browser timing. */
export function finish(
  context: FakeContext,
  request: FakeRequest,
  options: {
    status?: number;
    sw?: boolean;
    timing?: Partial<Timing>;
    responseEvent?: boolean;
  } = {},
): void {
  request.timingValue = timing({
    requestStart: 0.5,
    responseStart: 100.5,
    responseEnd: 102.25,
    ...options.timing,
  });
  request.responseValue = new FakeResponse(request, options.status ?? 200, options.sw ?? false);
  if (options.responseEvent !== false) context.emit('response', request.responseValue);
  context.emit('requestfinished', request);
}
