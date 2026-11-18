import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';

export const SCHEMA_DIR = join(import.meta.dirname, '../../schemas');
export const ID_PREFIX = 'https://pkg.invalid/schemas/';
export const SCHEMA_FILES = readdirSync(SCHEMA_DIR)
  .filter((f) => f.endsWith('.schema.json'))
  .sort();

export function readSchema(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')) as Record<string, unknown>;
}

/**
 * Ajv for draft 2020-12 in strict mode with all schemas registered by their $id.
 * strictRequired is off: the schemas list properties in `required` inside if/then and anyOf
 * branches while the properties themselves are declared in the parent schema, which is valid
 * JSON Schema that Ajv's strictRequired heuristic does not follow.
 */
export function createAjv(options: { useDefaults?: boolean } = {}): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    strictRequired: false,
    allErrors: true,
    useDefaults: options.useDefaults ?? false,
  });
  for (const file of SCHEMA_FILES) ajv.addSchema(readSchema(file));
  return ajv;
}

export function validator(ajv: Ajv2020, file: string): ValidateFunction {
  const validate = ajv.getSchema(`${ID_PREFIX}${file}`);
  if (!validate) throw new Error(`schema ${file} is not registered`);
  return validate;
}
