import Link from 'next/link'

import { CheckOutButton } from '@/components/attendance/check-out-button'
import { MemberPhoto } from '@/components/members/member-photo'
import type { inGymNow } from '@/lib/db/attendance'
import { formatMinutesIn } from '@/lib/attendance'
import { formatMoney, formatTime } from '@/lib/format'

type Row = Awaited<ReturnType<typeof inGymNow>>[number]

/**
 * Who is in the building right now. Newest arrival first, because the person
 * the desk is most likely to be asked about is the one who just walked past.
 */
export function InGymNow({
  rows,
  photoUrls,
  canCheckOut,
}: {
  rows: Row[]
  /** Signed URLs keyed by storage path, minted once for the whole page. */
  photoUrls: Record<string, string>
  canCheckOut: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm font-medium">Nobody is in the gym</p>
        <p className="text-sm text-muted-foreground">
          Check someone in and they will appear here until they leave.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => (
        <li key={row.attendance_id} className="flex items-center gap-3 p-3">
          <MemberPhoto
            url={row.photo_path ? (photoUrls[row.photo_path] ?? null) : null}
            name={row.full_name}
            className="size-9 text-[10px]"
          />
          <div className="min-w-0 flex-1">
            <Link
              href={`/members/${row.member_id}`}
              className="block truncate font-medium underline-offset-4 hover:underline"
            >
              {row.full_name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{row.member_code}</span>
              {' · in for '}
              <span className="tabular-nums">{formatMinutesIn(row.minutes_in)}</span>
              {' · since '}
              <span className="whitespace-nowrap tabular-nums">
                {formatTime(row.checked_in_at)}
              </span>
            </p>
            {row.due_paisa > 0 ? (
              <p className="text-xs font-medium tabular-nums text-destructive">
                {formatMoney(row.due_paisa)} due
              </p>
            ) : null}
          </div>
          {canCheckOut ? <CheckOutButton attendanceId={row.attendance_id} /> : null}
        </li>
      ))}
    </ul>
  )
}
