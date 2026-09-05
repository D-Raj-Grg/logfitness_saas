'use client'

import { useCallback, useState } from 'react'

import { AuthFormMessage } from '@/components/auth/auth-form-message'
import {
  CancelForm,
  FreezeForm,
  UnfreezeForm,
} from '@/components/memberships/membership-status-forms'
import { RecordPaymentForm } from '@/components/memberships/record-payment-form'
import { RefundForm } from '@/components/memberships/refund-form'
import { RenewForm } from '@/components/memberships/renew-form'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import type { CurrentStaff } from '@/lib/auth'
import type { listBranches } from '@/lib/db/branches'
import type { MemberOverviewRow } from '@/lib/db/members'
import type {
  listInvoicesForMember,
  listMembershipsForMember,
} from '@/lib/db/memberships'
import type { listPaymentsForMember } from '@/lib/db/payments'
import { daysUntil, formatDate, formatDateTime, formatMoney } from '@/lib/format'
import {
  MEMBERSHIP_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  membershipStatusTone,
} from '@/lib/members'

type OpenDialog =
  | { kind: 'renew' }
  | { kind: 'pay' }
  | { kind: 'freeze' }
  | { kind: 'unfreeze' }
  | { kind: 'cancel' }
  | { kind: 'refund'; paymentId: string }
  | null

export function MemberActionPanel({
  member,
  memberships,
  invoices,
  payments,
  staff,
  branches,
}: {
  member: MemberOverviewRow
  memberships: Awaited<ReturnType<typeof listMembershipsForMember>>
  invoices: Awaited<ReturnType<typeof listInvoicesForMember>>
  payments: Awaited<ReturnType<typeof listPaymentsForMember>>
  staff: CurrentStaff
  branches: Awaited<ReturnType<typeof listBranches>>
}) {
  const [open, setOpen] = useState<OpenDialog>(null)
  const [message, setMessage] = useState<string | null>(null)

  const closeWith = useCallback((text: string) => {
    setMessage(text)
    setOpen(null)
  }, [])

  const canAct = staff.role !== 'trainer'
  const hasLeft = member.status === 'left'

  const current =
    memberships.find((row) => row.id === member.current_membership_id) ?? null

  const openInvoices = invoices
    .filter((invoice) => invoice.status !== 'void' && (invoice.due_paisa ?? 0) > 0)
    .map((invoice) => ({
      id: invoice.id,
      invoice_no: invoice.invoice_no,
      issued_on: invoice.issued_on,
      due_paisa: invoice.due_paisa ?? 0,
    }))

  const recentPayments = payments.slice(0, 5)

  // Owners sell anywhere; everyone else only where they work. Either way the
  // dialog opens on the most likely branch so a cash sale is not slowed down.
  const sellableBranches =
    staff.role === 'owner'
      ? branches
      : branches.filter((branch) => staff.branchIds.includes(branch.id))
  const defaultBranchId =
    staff.role === 'owner'
      ? member.home_branch_id
      : (sellableBranches[0]?.id ?? member.home_branch_id)

  const pausedDays = current?.frozen_on ? Math.max(-daysUntil(current.frozen_on), 0) : 0

  const refundTarget =
    open?.kind === 'refund'
      ? (payments.find((payment) => payment.id === open.paymentId) ?? null)
      : null

  function dialogChange(isOpen: boolean) {
    if (!isOpen) setOpen(null)
  }

  return (
    <div className="flex flex-col gap-4">
      {message ? <AuthFormMessage notice={message} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
          <CardDescription>
            {hasLeft
              ? 'This member has left.'
              : current
                ? `Sold at ${branches.find((b) => b.id === current.branch_id)?.name ?? 'a branch'}`
                : 'No plan on the books yet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {current ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{current.plan_name}</span>
                <Badge variant={membershipStatusTone(current.status)}>
                  {MEMBERSHIP_STATUS_LABELS[current.status]}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Starts</dt>
                <dd>{formatDate(current.start_date)}</dd>
                <dt className="text-muted-foreground">Ends</dt>
                <dd>{current.end_date ? formatDate(current.end_date) : 'Until sessions run out'}</dd>
                {current.plan_type === 'session_pack' ? (
                  <>
                    <dt className="text-muted-foreground">Sessions left</dt>
                    <dd>
                      {current.sessions_remaining ?? 0} of {current.sessions_total ?? 0}
                    </dd>
                  </>
                ) : (
                  <>
                    <dt className="text-muted-foreground">Days left</dt>
                    <dd>
                      {current.status === 'frozen'
                        ? `Frozen ${pausedDays} day${pausedDays === 1 ? '' : 's'}`
                        : member.days_to_expiry === null
                          ? '--'
                          : member.days_to_expiry < 0
                            ? `Expired ${-member.days_to_expiry} day${member.days_to_expiry === -1 ? '' : 's'} ago`
                            : member.days_to_expiry}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">Dues</dt>
                <dd className={member.due_paisa > 0 ? 'font-semibold text-destructive' : ''}>
                  {formatMoney(member.due_paisa)}
                </dd>
              </dl>
            </>
          ) : (
            <p className="text-muted-foreground">
              {hasLeft
                ? 'Reactivate the member before selling a membership.'
                : 'Sell a plan to get them started.'}
            </p>
          )}

          {canAct ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {!hasLeft ? (
                <Button size="sm" onClick={() => setOpen({ kind: 'renew' })}>
                  {current ? 'Renew' : 'Sell plan'}
                </Button>
              ) : null}
              {openInvoices.length > 0 ? (
                <Button size="sm" variant="outline" onClick={() => setOpen({ kind: 'pay' })}>
                  Record payment
                </Button>
              ) : null}
              {current?.status === 'active' ? (
                <Button size="sm" variant="outline" onClick={() => setOpen({ kind: 'freeze' })}>
                  Freeze
                </Button>
              ) : null}
              {current?.status === 'frozen' ? (
                <Button size="sm" variant="outline" onClick={() => setOpen({ kind: 'unfreeze' })}>
                  Unfreeze
                </Button>
              ) : null}
              {current && (current.status === 'active' || current.status === 'frozen') ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setOpen({ kind: 'cancel' })}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {openInvoices.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Open invoices</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {openInvoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{invoice.invoice_no}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(invoice.issued_on)}
                  </span>
                </span>
                <span className="font-semibold text-destructive">
                  {formatMoney(invoice.due_paisa)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent payments</CardTitle>
          <CardDescription>Last {recentPayments.length} of {payments.length}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col text-sm">
          {recentPayments.length === 0 ? (
            <p className="text-muted-foreground">Nothing collected yet.</p>
          ) : (
            recentPayments.map((payment, index) => (
              <div key={payment.id}>
                {index > 0 ? <Separator className="my-2" /> : null}
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span
                      className={
                        payment.kind === 'refund' ? 'font-medium text-destructive' : 'font-medium'
                      }
                    >
                      {formatMoney(payment.amount_paisa)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[payment.method]}
                      {payment.reference_no ? ` · ${payment.reference_no}` : ''}
                      {' · '}
                      {formatDateTime(payment.paid_at)}
                      {payment.collector?.full_name ? ` · ${payment.collector.full_name}` : ''}
                    </span>
                    {payment.kind === 'refund' && payment.reason ? (
                      <span className="block text-xs text-muted-foreground">
                        Refund: {payment.reason}
                      </span>
                    ) : null}
                  </span>
                  {canAct && payment.kind === 'payment' && payment.amount_paisa > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpen({ kind: 'refund', paymentId: payment.id })}
                    >
                      Refund
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {canAct ? (
        <>
          <Dialog open={open?.kind === 'renew'} onOpenChange={dialogChange}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{current ? 'Renew membership' : 'Sell a membership'}</DialogTitle>
                <DialogDescription>
                  {member.full_name} · {member.member_code}
                </DialogDescription>
              </DialogHeader>
              {open?.kind === 'renew' ? (
                <RenewForm
                  memberId={member.id}
                  branches={sellableBranches}
                  defaultBranchId={defaultBranchId}
                  isFirstMembership={memberships.length === 0}
                  currentEndDate={
                    current && current.status !== 'cancelled' && current.status !== 'expired'
                      ? current.end_date
                      : null
                  }
                  onSuccess={closeWith}
                />
              ) : null}
            </DialogContent>
          </Dialog>

          <Dialog open={open?.kind === 'pay'} onOpenChange={dialogChange}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record a payment</DialogTitle>
                <DialogDescription>
                  Against an open invoice for {member.full_name}.
                </DialogDescription>
              </DialogHeader>
              {open?.kind === 'pay' ? (
                <RecordPaymentForm
                  memberId={member.id}
                  invoices={openInvoices}
                  onSuccess={closeWith}
                />
              ) : null}
            </DialogContent>
          </Dialog>

          <Dialog open={open?.kind === 'freeze'} onOpenChange={dialogChange}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Freeze membership</DialogTitle>
                <DialogDescription>
                  The end date stops moving until it is unfrozen. Days paused are
                  added back at the end.
                </DialogDescription>
              </DialogHeader>
              {open?.kind === 'freeze' && current ? (
                <FreezeForm
                  memberId={member.id}
                  membershipId={current.id}
                  onSuccess={closeWith}
                />
              ) : null}
            </DialogContent>
          </Dialog>

          <AlertDialog open={open?.kind === 'unfreeze'} onOpenChange={dialogChange}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unfreeze membership?</AlertDialogTitle>
                <AlertDialogDescription>
                  {current?.end_date
                    ? `It has been frozen ${pausedDays} day${pausedDays === 1 ? '' : 's'}, so the end date will move from ${formatDate(current.end_date)} to ${formatDate(addDays(current.end_date, pausedDays))}.`
                    : 'The membership becomes active again immediately.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {open?.kind === 'unfreeze' && current ? (
                <UnfreezeForm
                  memberId={member.id}
                  membershipId={current.id}
                  onSuccess={closeWith}
                  cancelButton={<AlertDialogCancel>Keep frozen</AlertDialogCancel>}
                />
              ) : null}
            </AlertDialogContent>
          </AlertDialog>

          <Dialog open={open?.kind === 'cancel'} onOpenChange={dialogChange}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel membership</DialogTitle>
                <DialogDescription>
                  This closes the current plan. Money already taken stays on the
                  invoice; record a refund separately if any goes back.
                </DialogDescription>
              </DialogHeader>
              {open?.kind === 'cancel' && current ? (
                <CancelForm
                  memberId={member.id}
                  membershipId={current.id}
                  onSuccess={closeWith}
                />
              ) : null}
            </DialogContent>
          </Dialog>

          <Dialog open={open?.kind === 'refund'} onOpenChange={dialogChange}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Refund payment</DialogTitle>
                <DialogDescription>
                  Never more than is still held against the invoice.
                </DialogDescription>
              </DialogHeader>
              {refundTarget ? (
                <RefundForm
                  memberId={member.id}
                  payment={{
                    id: refundTarget.id,
                    amount_paisa: refundTarget.amount_paisa,
                    method: refundTarget.method,
                    paid_at: refundTarget.paid_at,
                  }}
                  onSuccess={closeWith}
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  )
}

/** Calendar arithmetic on a YYYY-MM-DD string, free of timezone drift. */
function addDays(isoDate: string, days: number) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}
