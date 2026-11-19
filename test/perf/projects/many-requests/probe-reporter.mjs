// Records the time of onTestEnd and onEnd and the size of each attachment to
// $INTEGRATION_OUT/probe.json. Listed before the package reporter, so the time between this
// onTestEnd and the next event includes the package reporter's onTestEnd.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default class ProbeReporter {
  tests = [];

  onTestEnd(test, result) {
    this.tests.push({
      title: test.title,
      status: result.status,
      durationMs: result.duration,
      testEndAt: performance.now(),
      attachments: result.attachments.map((a) => ({
        name: a.name,
        bytes: a.body?.length ?? null,
      })),
    });
  }

  onEnd() {
    const out = process.env.INTEGRATION_OUT ?? 'out';
    writeFileSync(
      join(out, 'probe.json'),
      JSON.stringify({ endAt: performance.now(), tests: this.tests }),
    );
  }

  printsToStdio() {
    return false;
  }
}
