// Validators for schemas/common.schema.json#/$defs.
import { bool, enumOf, int, nullable, num, obj, str } from './dsl.ts';

export const ms = num({ minimum: 0 });
export const msOrNull = nullable(ms);
export const msLimit = int({ minimum: 0 });
export const ratio = num({ minimum: 0, maximum: 1 });
export const count = int({ minimum: 0 });
export const timestamp = str({ pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u });
export const epochMs = int({ minimum: 0 });
export const runId = str({ minLength: 1, maxLength: 128 });
export const mode = enumOf(['test', 'thresholds']);
export const envLabel = str({
  pattern: /^[a-z0-9-]+$/u,
  maxLength: 32,
  format: 'a label of lowercase letters, digits and "-", like "staging"',
});
export const envLabelOrNull = nullable(envLabel);
export const kind = enumOf(['api', 'custom']);
export const percentileName = str({
  pattern: /^p(?:[1-9][0-9]?)(?:\.[0-9])?$/u,
  format: 'a percentile name like "p95" or "p99.9"',
});
export const key = str({ minLength: 1, maxLength: 2000 });
export const tool = obj(
  { name: str({ minLength: 1 }), version: str({ minLength: 1 }) },
  { required: ['name', 'version'] },
);
export const issue = obj(
  {
    code: str({ pattern: /^[A-Z][A-Z0-9_]*$/u }),
    message: str({ minLength: 1 }),
    hint: str({ minLength: 1 }),
    count: int({ minimum: 1 }),
  },
  { required: ['code', 'message'] },
);
export const testsStatus = enumOf(['passed', 'failed', 'timedout', 'interrupted']);
export const evaluationStatus = enumOf(['passed', 'warned', 'failed', 'error']);
export const fingerprint = str({ pattern: /^[0-9a-f]{14}$/u });
export const hostFingerprint = obj(
  {
    platform: str(),
    arch: str(),
    ci: bool,
    cpuCount: int({ minimum: 1 }),
    cpuModel: str(),
  },
  { required: ['platform', 'arch', 'ci', 'cpuCount', 'cpuModel'] },
);
/** Date YYYY-MM-DD as the schema checks it (format only, no calendar check). */
export const isoDate = str({ pattern: /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/u });
