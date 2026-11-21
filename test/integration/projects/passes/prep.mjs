// A setup step of the test script (D-39): runs before Playwright in every pass. It appends one
// line to prep.log and fails in the run given by PREP_FAIL_AT (1-based), like a seed script that
// cannot reach its database.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const log = 'prep.log';
const runs = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
appendFileSync(log, `run ${String(runs + 1)}\n`);
if (process.env.PREP_FAIL_AT === String(runs + 1)) {
  console.error('prep: seeding failed');
  process.exit(1);
}
