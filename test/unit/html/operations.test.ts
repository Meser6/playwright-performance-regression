// The keys.operations hint of the HTML report (18-REQ-13) and operation keys in the key view.
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { RunReport } from '../../../src/core/types/index.ts';
import { renderHtmlReport } from '../../../src/html/index.ts';
import { OPERATIONS_HINT_MIN_SAMPLES, operationsHint } from '../../../src/html/keys.ts';
import { RUN_REPORTS, readCase } from './fixtures.ts';

const GRAPHQL_HINT =
  'This looks like GraphQL: one key mixes all operations. Set keys.operations to get a key per operation (docs/configuration.md#operations).';

function reportWith(operations: unknown[]): Pick<RunReport, 'config'> {
  return { config: { keys: { operations } } } as unknown as Pick<RunReport, 'config'>;
}

describe('keys.operations hint (18-REQ-13)', () => {
  const none = { report: reportWith([]) as RunReport };

  test('a POST key ending with /graphql or with a trpc segment, from 20 samples', () => {
    expect(OPERATIONS_HINT_MIN_SAMPLES).toBe(20);
    expect(operationsHint(none, 'api', 'POST /graphql', 20)).toBe(GRAPHQL_HINT);
    expect(operationsHint(none, 'api', 'POST api/v1/graphql?x', 25)).toBe(GRAPHQL_HINT);
    expect(operationsHint(none, 'api', 'request POST /graphql', 20)).toBe(GRAPHQL_HINT);
    expect(operationsHint(none, 'api', 'POST /api/trpc/post.byId,user.me', 30)).toContain(
      'This looks like tRPC',
    );
  });

  test('no hint below 20 samples, for other methods, paths and kinds, or with keys.operations set', () => {
    expect(operationsHint(none, 'api', 'POST /graphql', 19)).toBeNull();
    expect(operationsHint(none, 'api', 'GET /graphql', 50)).toBeNull();
    expect(operationsHint(none, 'api', 'POST /graphql/v2', 50)).toBeNull();
    expect(operationsHint(none, 'api', 'POST /api/trpcx/a', 50)).toBeNull();
    expect(operationsHint(none, 'step', 'POST /graphql', 50)).toBeNull();
    const set = { report: reportWith([{ type: 'graphql', match: '/graphql' }]) as RunReport };
    expect(operationsHint(set, 'api', 'POST /graphql', 50)).toBeNull();
    // A migrated 1.0.x snapshot has keys.operations []; an older sparse one may have no keys.
    const sparse = { report: { config: {} } as RunReport };
    expect(operationsHint(sparse, 'api', 'POST /graphql', 50)).toBe(GRAPHQL_HINT);
  });

  test('the hint is in the details of the key, after the stored hints', () => {
    const report = structuredClone(readCase(join(RUN_REPORTS, 'full-run.json')).input);
    const aggregate = report.endpoints['GET /api/tickets/:id'];
    if (aggregate === undefined) throw new Error('no key');
    delete report.endpoints['GET /api/tickets/:id'];
    report.endpoints['POST /graphql'] = { ...aggregate, count: 20 };
    const markup = renderHtmlReport(report);
    expect(markup).toContain(GRAPHQL_HINT);
    expect(renderHtmlReport(readCase(join(RUN_REPORTS, 'full-run.json')).input)).not.toContain(
      'This looks like',
    );
  });

  test('the operations golden report shows the operation keys and no hint', () => {
    const markup = renderHtmlReport(readCase(join(RUN_REPORTS, 'operations.json')).input);
    expect(markup).toContain('/graphql#CreateOrder');
    expect(markup).toContain('/api/trpc#a.get+b.list');
    expect(markup).not.toContain('This looks like');
  });
});
