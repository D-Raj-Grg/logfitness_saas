import Link from 'next/link'
import { Printer } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import type { listNotificationsForMember, NotificationStatus } from '@/lib/db/notifications'
import type { listPaymentsForMember } from '@/lib/db/payments'
import { formatDate, formatDateTime, formatMoney, formatTime } from '@/lib/format'
import {
  INVOICE_STATUS_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  PAYMENT_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  type InvoiceStatus,
  type MembershipStatus,
} from '@/lib/members'
import { NOTIFICATION_EVENTS, NOTIFICATION_STATUS_SHORT } from '@/lib/notifications/labels'
import { cn } from '@/lib/utils'

type Memberships = Awaited<ReturnType<typeof listMembershipsForMember>>
type Invoices = Awaited<ReturnType<typeof listInvoicesForMember>>
type Payments = Awaited<ReturnType<typeof listPaymentsForMember>>
type Messages = Awaited<ReturnType<typeof listNotificationsForMember>>

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

/**
 * `skipped` is the gym deciding not to send, or a number nobody can deliver to.
 * It must not read as a failure, so it stays grey with `cancelled` -- the same
 * rule the notification log follows.
 */
const MESSAGE_TONE: Record<NotificationStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  sent: 'default',
  queued: 'outline',
  sending: 'outline',
  failed: 'destructive',
  cancelled: 'secondary',
  skipped: 'secondary',
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
  messages,
  branchNames,
}: {
  memberships: Memberships
  invoices: Invoices
  payments: Payments
  attendance: AttendanceDetailRow[]
  /** What this member has been told, by a sweep or by the desk. */
  messages: Messages
  branchNames: Record<string, string>
}) {
  return (
    <Tabs defaultValue="memberships">
      {/* Five labels with counts do not fit a phone. They scroll sideways
          rather than wrapping into a second row of pills, which would push the
          table down and read as two separate rows of controls. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList className="w-max">
          <TabsTrigger value="memberships">Memberships ({memberships.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="attendance">Attendance ({attendance.length})</TabsTrigger>
          <TabsTrigger value="messages">Messages ({messages.length})</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="memberships">
        {memberships.length === 0 ? (
          <EmptyTab>No memberships yet. Assign a plan from the Current plan panel.</EmptyTab>
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
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((row) => {
                  // Refunds and reversals are both negative; the label says
                  // which, because "given back" and "never arrived" are not the
                  // same event to anyone counting the drawer.
                  const refund = row.kind !== 'payment'
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
                            {PAYMENT_KIND_LABELS[row.kind]}
                            {row.reason ? `: ${row.reason}` : ''}
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
                      <TableCell className="text-right">
                        <PrintLink
                          href={`/receipts/${row.id}/print`}
                          label={
                            row.kind === 'refund'
                              ? 'Print refund receipt'
                              : row.kind === 'reversal'
                                ? 'Print reversal note'
                                : 'Print receipt'
                          }
                        />
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
                  <TableHead className="w-0" />
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
                      <TableCell className="text-right">
                        {row.status === 'void' ? null : (
                          <PrintLink
                            href={`/invoices/${row.id}/print`}
                            label="Print invoice"
                          />
                        )}
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
      <TabsContent value="messages">
        {messages.length === 0 ? (
          <EmptyTab>
            Nothing has been sent to this member yet. Reminders go out on their
            own once a gateway is set up; Send SMS texts them now.
          </EmptyTab>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            {/*
              * A real min-width rather than a max-width on the message cell.
              * The table is `w-full`, and a max-width on a `td` in an
              * auto-layout table is ignored -- which is why 160 characters of
              * SMS ran straight through the To column and pushed Status off the
              * card. Stating a width the table cannot go below makes the
              * container scroll instead, and the message wraps inside its own
              * column.
              */}
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">When</TableHead>
                  <TableHead className="whitespace-nowrap">Reason</TableHead>
                  <TableHead className="w-[420px]">Message</TableHead>
                  <TableHead className="whitespace-nowrap">To</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="align-top text-sm whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.created_at)}
                    </TableCell>
                    <TableCell className="align-top text-sm whitespace-nowrap">
                      {NOTIFICATION_EVENTS[row.event]}
                    </TableCell>
                    <TableCell className="w-[420px] align-top text-sm break-words whitespace-normal text-muted-foreground">
                      {row.body}
                    </TableCell>
                    <TableCell className="align-top text-sm whitespace-nowrap tabular-nums">
                      {row.to_address}
                    </TableCell>
                    <TableCell className="align-top whitespace-nowrap">
                      <Badge variant={MESSAGE_TONE[row.status]}>
                        {NOTIFICATION_STATUS_SHORT[row.status]}
                      </Badge>
                      {/* The gateway's own words. Without them a failed row is
                          just a badge nobody can act on. */}
                      {row.last_error ? (
                        <div className="mt-1 max-w-56 text-xs break-words whitespace-normal text-muted-foreground">
                          {row.last_error}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}

/**
 * Opens in a new tab so the profile stays where it was behind the print view.
 */
function PrintLink({ href, label }: { href: string; label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      render={<Link href={href} target="_blank" />}
    >
      <Printer />
    </Button>
  )
}
