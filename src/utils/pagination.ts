import { z } from 'zod';

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(5),
};

export interface Paginated<T> {
  data: T[];
  totalItems: number;
  totalPages: number;
  page: number;
  limit: number;
}
// Page clamping and LIKE escaping happen in the *_List stored procedures.
