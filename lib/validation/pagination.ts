import { z } from 'zod'

import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/components/app/page-size-select'

/**
 * How many rows a list returns. Clamped to the sizes the control offers rather
 * than to a range: a hand-edited `?pageSize=9999` is a query the server should
 * refuse to run, not one it should honour up to some quiet ceiling.
 */
export const pageSizeSchema = z.coerce
  .number()
  .int()
  .refine((value) => PAGE_SIZES.includes(value as (typeof PAGE_SIZES)[number]))
  .catch(DEFAULT_PAGE_SIZE)
  .default(DEFAULT_PAGE_SIZE)

export const pageSchema = z.coerce.number().int().min(1).catch(1).default(1)
