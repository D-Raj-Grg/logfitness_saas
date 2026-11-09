import { Suspense } from 'react'
import Link from 'next/link'
import { Palette } from 'lucide-react'

import { Pagination } from '@/components/app/pagination'
import { StatTile } from '@/components/app/stat-tile'
import { StatusTilesSkeleton, TableSkeleton } from '@/components/app/skeletons'
import { CardStockSearch } from '@/components/cards/card-stock-search'
import { CardStockTable } from '@/components/cards/card-stock-table'
import { CreateRangeDialog } from '@/components/cards/create-range-dialog'
import { Button } from '@/components/ui/button'
import { requireRole, type CurrentStaff } from '@/lib/auth'
import { cardStockSummary, listCardStock, nextFreeCardNo } from '@/lib/db/card-stock'
import { listUnassignedCardScans } from '@/lib/db/member-cards'
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination'
import { cardStockListQuerySchema, type CardStockListQuery } from '@/lib/validation/cards'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

async function CardCounts() {
  const summary = await cardStockSummary()
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatTile label="Printed" value={String(summary.total)} href="/cards" />
      <StatTile label="Assigned" value={String(summary.assigned)} href="/cards?status=assigned" />
      <StatTile label="Free" value={String(summary.free)} href="/cards?status=free" />
      <StatTile
        label="No chip yet"
        value={String(summary.unlinked)}
        href="/cards?status=unlinked"
        hint="Tap each on a reader to link it"
      />
      <StatTile label="Lost" value={String(summary.lost)} href="/cards?status=lost" />
    </div>
  )
}

async function CardList({
  query,
  staff,
  listParams,
}: {
  query: CardStockListQuery
  staff: CurrentStaff
  listParams: Record<string, string | undefined>
}) {
  const [result, scans] = await Promise.all([
    listCardStock({ ...query, pageSize: DEFAULT_PAGE_SIZE }),
    // The enrollment inbox feeds every Link chip dialog on the page. A failed
    // read is an empty picker; typing the UID still works.
    listUnassignedCardScans(staff.role === 'owner' ? null : staff.branchIds).catch(() => []),
  ])

  return (
    <>
      <CardStockTable
        rows={result.rows}
        filtered={Boolean(query.q || query.status !== 'all')}
        scans={scans}
        canNumber={staff.role === 'owner' || staff.role === 'manager'}
      />
      <Pagination
        basePath="/cards"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        params={listParams}
      />
    </>
  )
}

/**
 * The gym's printed cards: numbered, chip-linked, handed out, lost, retired.
 * The desk finds a card by the number on it; a manager numbers the next run.
 */
export default async function CardsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireRole('owner', 'manager', 'front_desk')
  const canNumber = staff.role === 'owner' || staff.role === 'manager'

  const raw = await searchParams
  const parsed = cardStockListQuerySchema.safeParse({
    q: first(raw.q),
    status: first(raw.status) || undefined,
    page: first(raw.page),
  })
  // A hand-edited URL should not 500 the front desk; fall back to defaults.
  const query = parsed.success ? parsed.data : cardStockListQuerySchema.parse({})

  const listParams = {
    q: query.q || undefined,
    status: query.status === 'all' ? undefined : query.status,
  }

  // Only the numbering dialog needs the next free number, and only a manager
  // sees that dialog.
  const nextFree = canNumber ? await nextFreeCardNo().catch(() => 1) : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cards</h1>
          <p className="text-sm text-muted-foreground">
            Every printed card at {staff.orgName}, by the number on it. Link a new card&apos;s
            chip with a tap, then hand it to a member.
          </p>
        </div>
        {canNumber ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" render={<Link href="/cards/designer" />}>
              <Palette />
              Design and print cards
            </Button>
            <CreateRangeDialog nextFreeNo={nextFree ?? 1} />
          </div>
        ) : null}
      </div>

      <Suspense fallback={<StatusTilesSkeleton count={5} />}>
        <CardCounts />
      </Suspense>

      <CardStockSearch q={query.q} status={query.status} />

      <Suspense
        key={JSON.stringify({ ...listParams, page: query.page })}
        fallback={<TableSkeleton rows={10} columns={6} />}
      >
        <CardList query={query} staff={staff} listParams={listParams} />
      </Suspense>
    </div>
  )
}
