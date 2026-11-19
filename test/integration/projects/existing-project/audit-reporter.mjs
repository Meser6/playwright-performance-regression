// A custom reporter (like a TestRail or Slack reporter): writes audit.txt at the end of a run.
import { writeFileSync } from 'node:fs';

export default class AuditReporter {
  onEnd(result) {
    writeFileSync('audit.txt', `${result.status}\n`);
  }

  printsToStdio() {
    return false;
  }
}
