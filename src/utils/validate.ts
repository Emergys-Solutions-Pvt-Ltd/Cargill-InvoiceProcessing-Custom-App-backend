import { z } from 'zod';
import { HttpError } from './httpError.js';

/** Parses request input with a zod schema, throwing a 400 with field errors on failure. */
export const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw HttpError.badRequest('Validation failed', z.flattenError(result.error));
  }
  return result.data;
};
