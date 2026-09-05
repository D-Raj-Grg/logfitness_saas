// Kept out of the client filter component so Server Components can import the
// list without pulling in a client boundary.
export type ArrearsBucket = '0-30' | '31-60' | '61-90' | '90+'

export const ARREARS_BUCKETS: ArrearsBucket[] = ['0-30', '31-60', '61-90', '90+']

export function isArrearsBucket(value: string): value is ArrearsBucket {
  return (ARREARS_BUCKETS as string[]).includes(value)
}
