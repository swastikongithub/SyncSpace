import { z } from 'zod';
import { badRequest, notFound } from './errors.js';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid identifier');

/** Parses untrusted input and raises a consistent 400 with per-field messages. */
export function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const { formErrors, fieldErrors } = z.flattenError(result.error);
  const first = formErrors[0] ?? Object.values(fieldErrors).flat()[0] ?? 'Invalid request.';
  throw badRequest('validation_failed', first, { fieldErrors, formErrors });
}

/**
 * Validates a route identifier. Malformed IDs get the same 404 as unknown ones, so probing
 * identifiers reveals nothing about which resources exist.
 */
export function idParam(value, code = 'not_found', message = 'Not found.') {
  if (!objectId.safeParse(value).success) throw notFound(code, message);
  return value;
}
