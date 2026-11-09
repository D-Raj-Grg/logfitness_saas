import Link from 'next/link'
import { Suspense } from 'react'
import { Printer } from 'lucide-react'

import { DayRangePicker } from '@/components/attendance/day-range-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ATTENDANCE_METHOD_LABELS, attendanceActorLabel, formatMinutesIn } from '@/lib/attendance'
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
  type PaymentKind,
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
 * A payment is unremarkable, so it stays quiet. Money handed back is the
 * exception a reader scans for, and a reversal is a correction rather than a
 * loss -- outline, not red.
 */
const PAYMENT_KIND_TONE: Record<PaymentKind, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  payment: 'secondary',
  refund: 'destructive',
  reversal: 'outline',
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

function AttendancePager({
  memberId,
  page,
  pages,
  from,
  to,
}: {
  memberId: string
  page: number
  pages: number
  from: string | null
  to: string | null
}) {
  function href(target: number) {
    const query = new URLSearchParams({ tab: 'attendance' })
    if (from) query.set('att_from', from)
    if (to) query.set('att_to', to)
    if (target > 1) query.set('att_page', String(target))
    return `/members/${memberId}?${query.toString()}`
  }

  return (
    <div className="flex items-center justify-between text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="underline-offset-4 hover:underline">
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="underline-offset-4 hover:underline">
          Older →
        </Link>
      ) : (
        <span />
      )}
    </div>
  )
}

export type HistoryTab = 'profile' | 'memberships' | 'payments' | 'invoices' | 'attendance' | 'messages'

export function MemberHistoryTabs({
  memberships,
  invoices,
  payments,
  attendance,
  attendanceTotal,
  attendanceMatches,
  trackCheckOut,
  attendancePage,
  attendancePageSize,
  attendanceFrom,
  attendanceTo,
  today,
  memberId,
  defaultTab = 'profile',
  profile,
  messages,
  branchNames,
}: {
  memberships: Memberships
  invoices: Invoices
  payments: Payments
  /** One page of the member's check-ins, newest first. */
  attendance: AttendanceDetailRow[]
  /** Every check-in they have ever had, whatever the date filter says. */
  attendanceTotal: number
  /** How many match the date filter (equals the total with no filter). */
  attendanceMatches: number
  /** Off unless the gym records check-out: hides the Out and Duration columns. */
  trackCheckOut: boolean
  attendancePage: number
  attendancePageSize: number
  /** The filter window, or null for "all time". */
  attendanceFrom: string | null
  attendanceTo: string | null
  /** The gym's today, for the quick ranges and the picker's upper limit. */
  today: string
  memberId: string
  defaultTab?: HistoryTab
  /** The Details and app/door access cards, rendered by the page. */
  profile: React.ReactNode
  /** What this member has been told, by a sweep or by the desk. */
  messages: Messages
  branchNames: Record<string, string>
}) {
  // Refunds and reversals are stored negative, so the signed sum is what the
  // drawer actually kept.
  const netPaid = payments.reduce((sum, row) => sum + row.amount_paisa, 0)

  return (
    <Tabs defaultValue={defaultTab}>
      {/* Six labels with counts do not fit a phone. They scroll sideways
          rather than wrapping into a second row of pills, which would push the
          table down and read as two separate rows of controls. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList className="w-max">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="memberships">Memberships ({memberships.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="attendance">Attendance ({attendanceTotal})</TabsTrigger>
          <TabsTrigger value="messages">Messages ({messages.length})</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="profile">{profile}</TabsContent>

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
            {/* Note text needs room to wrap, so the table states a width it
                cannot shrink below and the container scrolls on a phone. */}
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">When</TableHead>
                  <TableHead className="whitespace-nowrap">Type</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                  <TableHead className="whitespace-nowrap">Method</TableHead>
                  <TableHead className="w-[280px]">Reason / note</TableHead>
                  <TableHead className="whitespace-nowrap">Collected by</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((row) => {
                  // Refunds and reversals are both negative; the label says
                  // which, because "given back" and "never arrived" are not the
                  // same event to anyone counting the drawer.
                  const refund = row.kind !== 'payment'
                  // A refund carries its reason, a payment carries the desk's
                  // note. One column, because a reader wants the same thing
                  // from both: why this row is here.
                  const note = row.reason ?? row.notes
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="align-top whitespace-nowrap tabular-nums">
                        {formatDateTime(row.paid_at)}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant={PAYMENT_KIND_TONE[row.kind]}>
                          {PAYMENT_KIND_LABELS[row.kind]}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          'align-top text-right whitespace-nowrap tabular-nums',
                          refund ? 'font-medium text-destructive' : ''
                        )}
                      >
                        {/* A real minus sign, not a hyphen: it lines up with
                            the digits in tabular figures. */}
                        {refund ? '−' : ''}
                        {formatMoney(Math.abs(row.amount_paisa))}
                      </TableCell>
                      <TableCell className="align-top whitespace-nowrap">
                        {PAYMENT_METHOD_LABELS[row.method]}
                        {row.reference_no ? (
                          <span className="block font-mono text-xs text-muted-foreground">
                            {row.reference_no}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="w-[280px] align-top text-sm break-words whitespace-normal text-muted-foreground">
                        {note ?? '--'}
                      </TableCell>
                      <TableCell className="align-top whitespace-nowrap text-muted-foreground">
                        {row.collector?.full_name ?? '--'}
                      </TableCell>
                      <TableCell className="align-top text-right">
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
              {/* Rows that cancel each other out are the normal case here, so
                  the reader should not have to add five signed numbers to find
                  what the member actually paid. */}
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-medium">
                    Net collected
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                    {netPaid < 0 ? '−' : ''}
                    {formatMoney(Math.abs(netPaid))}
                  </TableCell>
                  <TableCell colSpan={4} className="text-xs text-muted-foreground">
                    {payments.length} {payments.length === 1 ? 'entry' : 'entries'}
                  </TableCell>
                </TableRow>
              </TableFooter>
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
        <div className="flex flex-col gap-4">
          <Suspense>
            <DayRangePicker
              on={attendanceFrom ?? today}
              to={attendanceTo ?? today}
              today={today}
              params={{
                on: 'att_from',
                to: 'att_to',
                page: 'att_page',
                fixed: { tab: 'attendance' },
              }}
            />
          </Suspense>

          <p className="text-sm text-muted-foreground">
            {attendanceFrom && attendanceTo ? (
              <>
                <span className="font-medium text-foreground tabular-nums">
                  {attendanceMatches}
                </span>{' '}
                {attendanceMatches === 1 ? 'visit' : 'visits'}{' '}
                {attendanceFrom === attendanceTo
                  ? `on ${formatDate(attendanceFrom)}`
                  : `between ${formatDate(attendanceFrom)} and ${formatDate(attendanceTo)}`}
                . {attendanceTotal} in total.{' '}
                <Link
                  href={`/members/${memberId}?tab=attendance`}
                  className="underline-offset-4 hover:underline"
                >
                  Show all
                </Link>
              </>
            ) : (
              <>
                <span className="font-medium text-foreground tabular-nums">
                  {attendanceTotal}
                </span>{' '}
                {attendanceTotal === 1 ? 'visit' : 'visits'} in total. Pick dates to narrow it
                down.
              </>
            )}
          </p>

          {attendance.length === 0 ? (
            <EmptyTab>
              {attendanceFrom
                ? 'No check-ins in these dates. Try a wider range.'
                : 'No check-ins recorded yet.'}
            </EmptyTab>
          ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>In</TableHead>
                  {trackCheckOut ? <TableHead>Out</TableHead> : null}
                  {trackCheckOut ? <TableHead>Duration</TableHead> : null}
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
                      {trackCheckOut ? (
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {row.checked_out_at ? formatTime(row.checked_out_at) : '--'}
                        </TableCell>
                      ) : null}
                      {trackCheckOut ? (
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {minutes === null ? (
                            <span className="text-muted-foreground">In the gym</span>
                          ) : (
                            formatMinutesIn(minutes)
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-muted-foreground">{row.branch_name}</TableCell>
                      <TableCell>{ATTENDANCE_METHOD_LABELS[row.method]}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {attendanceActorLabel(row)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          )}

          {attendanceMatches > attendancePageSize ? (
            <AttendancePager
              memberId={memberId}
              page={attendancePage}
              pages={Math.ceil(attendanceMatches / attendancePageSize)}
              from={attendanceFrom}
              to={attendanceTo}
            />
          ) : null}
        </div>
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
