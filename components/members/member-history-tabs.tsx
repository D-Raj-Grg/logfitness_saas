import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ATTENDANCE_METHOD_LABELS, formatMinutesIn } from '@/lib/attendance'
import type { AttendanceDetailRow } from '@/lib/db/attendance'
import type { listInvoicesForMember, listMembershipsForMember } from '@/lib/db/memberships'
import type { listPaymentsForMember } from '@/lib/db/payments'
import { formatDate, formatDateTime, formatMoney, formatTime } from '@/lib/format'
import {
  INVOICE_STATUS_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type InvoiceStatus,
  type MembershipStatus,
} from '@/lib/members'
import { cn } from '@/lib/utils'

type Memberships = Awaited<ReturnType<typeof listMembershipsForMember>>
type Invoices = Awaited<ReturnType<typeof listInvoicesForMember>>
type Payments = Awaited<ReturnType<typeof listPaymentsForMember>>

const MEMBERSHIP_TONE: Record<MembershipStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  upcoming: 'outline',
  frozen: 'secondary',
  expired: 'destructive',
  cancelled: 'destructive',
}

const INVOICE_TONE: Record<InvoiceStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  paid: 'default',
  partial: 'outline',
  unpaid: 'destructive',
  void: 'secondary',
}

/** Minutes between check-in and check-out; null while the visit is still open. */
function minutesIn(row: AttendanceDetailRow) {
  if (!row.checked_out_at) return null

  const ms = new Date(row.checked_out_at).getTime() - new Date(row.checked_in_at).getTime()
  if (!Number.isFinite(ms)) return null

  return ms / 60_000
}

function EmptyTab({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  )
}

export function MemberHistoryTabs({
  memberships,
  invoices,
  payments,
  attendance,
  branchNames,
}: {
  memberships: Memberships
  invoices: Invoices
  payments: Payments
  attendance: AttendanceDetailRow[]
  branchNames: Record<string, string>
}) {
  return (
    <Tabs defaultValue="memberships">
      <TabsList>
        <TabsTrigger value="memberships">Memberships ({memberships.length})</TabsTrigger>
        <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
        <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
        <TabsTrigger value="attendance">Attendance ({attendance.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="memberships">
        {memberships.length === 0 ? (
          <EmptyTab>No memberships yet. Assign a plan from the panel on the right.</EmptyTab>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Sold at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.plan_name}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(row.start_date)}
                      {' – '}
                      {row.end_date ? formatDate(row.end_date) : 'open'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={MEMBERSHIP_TONE[row.status]}>
                        {MEMBERSHIP_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.plan_type === 'session_pack'
                        ? `${row.sessions_remaining ?? 0} / ${row.sessions_total ?? 0}`
                        : '--'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.price_paisa)}
                      {row.discount_paisa > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          -{formatMoney(row.discount_paisa)} off
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {branchNames[row.branch_id] ?? '--'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="payments">
        {payments.length === 0 ? (
          <EmptyTab>No payments recorded.</EmptyTab>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Collected by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((row) => {
                  const refund = row.kind === 'refund'
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(row.paid_at)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          refund ? 'font-medium text-destructive' : ''
                        )}
                      >
                        {refund ? '-' : ''}
                        {formatMoney(Math.abs(row.amount_paisa))}
                        {refund ? (
                          <span className="block text-xs font-normal text-muted-foreground">
                            Refund{row.reason ? `: ${row.reason}` : ''}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{PAYMENT_METHOD_LABELS[row.method]}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.reference_no ?? '--'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.collector?.full_name ?? '--'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="invoices">
        {invoices.length === 0 ? (
          <EmptyTab>No invoices. One is raised when a plan is assigned.</EmptyTab>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((row) => {
                  const due = row.due_paisa ?? Math.max(0, row.total_paisa - row.paid_paisa)
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.invoice_no}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(row.issued_on)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.total_paisa)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.paid_paisa)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          due > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'
                        )}
                      >
                        {due > 0 ? formatMoney(due) : '--'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={INVOICE_TONE[row.status]}>
                          {INVOICE_STATUS_LABELS[row.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="attendance">
        {attendance.length === 0 ? (
          <EmptyTab>No check-ins recorded yet.</EmptyTab>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Checked in by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.map((row) => {
                  const minutes = minutesIn(row)
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(row.attended_on)}
                        {row.is_override ? (
                          <span className="mt-1 block">
                            <Badge variant="secondary">Override</Badge>
                            {row.override_reason ? (
                              <span className="block text-xs text-muted-foreground">
                                {row.override_reason}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatTime(row.checked_in_at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {row.checked_out_at ? formatTime(row.checked_out_at) : '--'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {minutes === null ? (
                          <span className="text-muted-foreground">In the gym</span>
                        ) : (
                          formatMinutesIn(minutes)
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.branch_name}</TableCell>
                      <TableCell>{ATTENDANCE_METHOD_LABELS[row.method]}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.checked_in_by_name ?? '--'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}
