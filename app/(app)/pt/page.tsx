import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireStaff } from '@/lib/auth'
import { listPtSessions, listPtTrainers } from '@/lib/db/pt'
import { formatDateTime } from '@/lib/format'

import { bookPtAction, cancelPtAction, completePtAction } from './actions'

const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

export default async function PtPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const staff = await requireStaff()
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null

  const branchIds = staff.role === 'owner' ? null : staff.branchIds
  const canComplete = staff.role !== 'front_desk'

  const [sessions, trainers] = await Promise.all([
    listPtSessions({
      branchIds,
      trainerId: staff.role === 'trainer' ? staff.staffId : null,
      since: daysAgoIso(7),
    }),
    listPtTrainers(branchIds),
  ])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Personal training</h1>
        <p className="text-sm text-muted-foreground">
          Schedule one-to-one sessions. Completing a session uses one from the member&apos;s
          session pack.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form action={bookPtAction} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-sm">
          Member code
          <Input name="memberCode" required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Trainer
          <select
            name="trainerId"
            required
            defaultValue={staff.role === 'trainer' ? staff.staffId : ''}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="" disabled>
              Choose
            </option>
            {trainers.map((trainer) => (
              <option key={trainer.id} value={trainer.id}>
                {trainer.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          When
          <Input type="datetime-local" name="scheduledAt" required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Minutes
          <Input type="number" name="durationMinutes" defaultValue={60} min={5} max={480} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Notes
          <Input name="notes" maxLength={500} />
        </label>
        <div className="flex items-end">
          <Button type="submit">Schedule</Button>
        </div>
      </form>

      {sessions.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No sessions in the last week or upcoming.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Trainer</TableHead>
              <TableHead className="text-right">Sessions left</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>{formatDateTime(session.scheduled_at)}</TableCell>
                <TableCell>
                  {session.members?.full_name}
                  <span className="ml-2 text-xs text-muted-foreground">{session.members?.member_code}</span>
                </TableCell>
                <TableCell>{session.staff?.full_name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {session.memberships?.plan_type === 'session_pack'
                    ? (session.memberships.sessions_remaining ?? 0)
                    : '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={session.status === 'scheduled' ? 'outline' : session.status === 'completed' ? 'default' : 'secondary'}>
                    {session.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {session.status === 'scheduled' ? (
                    <div className="flex justify-end gap-2">
                      {canComplete ? (
                        <form action={completePtAction}>
                          <input type="hidden" name="id" value={session.id} />
                          <Button type="submit" size="sm">Complete</Button>
                        </form>
                      ) : null}
                      <form action={cancelPtAction}>
                        <input type="hidden" name="id" value={session.id} />
                        <Button type="submit" size="sm" variant="outline">Cancel</Button>
                      </form>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
