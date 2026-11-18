// Writes one JSON line per test result: status, timing, annotations, steps and attachments.
import { appendFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function flatSteps(steps) {
  return steps.flatMap((step) => [
    { title: step.title, category: step.category },
    ...flatSteps(step.steps),
  ]);
}

export default class RecordReporter {
  onTestEnd(test, result) {
    const line = {
      project: test.parent.project()?.name,
      file: basename(test.location.file),
      title: test.title,
      status: result.status,
      startTime: result.startTime.getTime(),
      duration: result.duration,
      endTime: Date.now(),
      annotations: [...(result.annotations ?? []), ...test.annotations],
      steps: flatSteps(result.steps),
      errors: result.errors.map((e) => e.message ?? ''),
      attachments: result.attachments.map((a) => ({
        name: a.name,
        contentType: a.contentType,
        body: a.body === undefined ? null : a.body.toString('utf8'),
      })),
    };
    appendFileSync(join(process.env.INTEGRATION_OUT, 'results.jsonl'), `${JSON.stringify(line)}\n`);
  }

  printsToStdio() {
    return false;
  }
}
