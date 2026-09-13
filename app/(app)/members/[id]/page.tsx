import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Printer } from 'lucide-react'

import { MemberAppAccess } from '@/components/members/member-app-access'
import { MemberHistoryTabs } from '@/components/members/member-history-tabs'
import { MemberMessageActions } from '@/components/members/member-message-actions'
import { MemberRecordActions } from '@/components/members/member-record-actions'
import { MemberStatusActions } from '@/components/members/member-status-actions'
import { MemberPhoto } from '@/components/members/member-photo'
import { MemberStatusBadge } from '@/components/members/member-status-badge'
import { MemberActionPanel } from '@/components/memberships/member-action-panel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireStaff } from '@/lib/auth'
import { listAttendanceForMember } from '@/lib/db/attendance'
import { listBranches } from '@/lib/db/branches'
import { getMember, getMemberOverview } from '@/lib/db/members'
import { listInvoicesForMember, listMembershipsForMember } from '@/lib/db/memberships'
import { listNotificationsForMember } from '@/lib/db/notifications'
import { listPaymentsForMember } from '@/lib/db/payments'
import { memberPhotoUrl } from '@/lib/db/photos'
import { formatDate, formatMoney } from '@/lib/format'
import { GENDER_LABELS } from '@/lib/members'

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {/* An email or a pasted address has no spaces to wrap at, and one of
          those is enough to widen the card past the screen. */}
      <dd className="text-sm break-words">
        {value ?? <span className="text-muted-foreground">--</span>}
      </dd>
    </div>
  )
}

export default async function MemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ invoice?: string; action?: string }>
}) {
  const staff = await requireStaff()
  const { id } = await params
  const { invoice: soldInvoiceId, action } = await searchParams

  // The member list's row menu links here for the membership forms. Anything
  // else in the parameter is ignored, and the panel re-checks the one that is
  // left against the member's actual state.
  const initialAction =
    action === 'renew' || action === 'pay' || action === 'freeze' || action === 'unfreeze'
      ? action
      : null

  const [overview, member, memberships, invoices, payments, attendance, branches, messages] =
    await Promise.all([
      getMemberOverview(id),
      getMember(id),
      listMembershipsForMember(id),
      listInvoicesForMember(id),
      listPaymentsForMember(id),
      listAttendanceForMember(id),
      listBranches(),
      listNotificationsForMember(id),
    ])

  if (!overview || !member) notFound()

  // Rendered from the row, never from the URL: ?invoice= only picks which of
  // this member's own invoices to acknowledge after a register-and-sell, so a
  // hand-edited link cannot put words on the page.
  const soldInvoice = soldInvoiceId
    ? (invoices.find((row) => row.id === soldInvoiceId) ?? null)
    : null

  const photoUrl = await memberPhotoUrl(member.photo_path)

  const branchNames = Object.fromEntries(branches.map((branch) => [branch.id, branch.name]))
  const canManage = staff.role !== 'trainer'
  const left = overview.status === 'left'
  const archived = Boolean(member.archived_at)
  const lastSeen = attendance[0] ?? null

  return (
    <div className="flex flex-col gap-6">
      {/* On a phone the identity block owns the full width and the actions sit
          under it; side by side only once there is room for both. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <MemberPhoto
            url={photoUrl}
            name={overview.full_name}
            className="size-12 shrink-0 text-sm sm:size-14"
          />
          <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold break-words sm:text-2xl">
              {overview.full_name}
            </h1>
            <MemberStatusBadge
              status={overview.status}
              daysToExpiry={overview.days_to_expiry}
              membershipStatus={overview.membership_status}
              hasMembershipHistory={overview.has_membership_history ?? true}
            />
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            <span className="font-mono">{overview.member_code}</span>
            <span className="tabular-nums">{overview.phone}</span>
            <span>{overview.home_branch_name}</span>
            <span>Joined {formatDate(overview.joined_on)}</span>
            <span>
              {lastSeen ? `Last seen ${formatDate(lastSeen.attended_on)}` : 'Never checked in'}
            </span>
            {left && overview.left_on ? <span>Left {formatDate(overview.left_on)}</span> : null}
          </p>
          </div>
        </div>

        {canManage ? (
          // Small buttons are a desk-and-mouse size. On a touch screen the same
          // controls get the taller default height so they can be hit with a
          // thumb without a second try.
          <div className="flex flex-wrap items-center gap-2 [&_button]:h-9 sm:[&_button]:h-8">
            <Button variant="outline" size="sm" render={<Link href={`/members/${id}/edit`} />}>
              Edit
            </Button>
            <MemberMessageActions
              memberId={id}
              fullName={overview.full_name}
              initialOpen={action === 'sms'}
            />
            <MemberStatusActions memberId={id} fullName={overview.full_name} left={left} />
            <MemberRecordActions
              memberId={id}
              fullName={overview.full_name}
              archived={archived}
              isOwner={staff.role === 'owner'}
            />
          </div>
        ) : null}
      </div>

      {archived ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/60 px-4 py-3 text-sm"
        >
          <span className="font-medium">Archived</span>
          <span className="text-muted-foreground">
            {member.archived_reason
              ? `${member.archived_reason} · hidden from the member list and search.`
              : 'Hidden from the member list and search. Nothing else has changed.'}
          </span>
        </div>
      ) : null}

      {soldInvoice ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm"
        >
          <span>
            {'Registered. Invoice '}
            <span className="font-mono">{soldInvoice.invoice_no}</span>
            {' raised for '}
            <span className="tabular-nums">{formatMoney(soldInvoice.total_paisa)}</span>
            {'. '}
            {(soldInvoice.due_paisa ?? 0) > 0
              ? `${formatMoney(soldInvoice.due_paisa ?? 0)} still due.`
              : 'Paid in full.'}
          </span>

          <Button
            size="sm"
            className="h-9 w-full sm:h-8 sm:w-auto"
            render={<Link href={`/invoices/${soldInvoice.id}/print`} target="_blank" />}
          >
            <Printer />
            Print invoice
          </Button>
        </div>
      ) : null}

      {overview.due_paisa > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
        >
          <span className="text-sm font-medium text-destructive">Dues outstanding</span>
          <span className="text-2xl font-semibold tabular-nums text-destructive">
            {formatMoney(overview.due_paisa)}
          </span>
          {overview.oldest_due_on ? (
            <span className="w-full text-xs text-destructive/80">
              Oldest unpaid invoice from {formatDate(overview.oldest_due_on)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Stacked, the action panel comes first: renewing a plan or taking a
            payment is why the desk opened this record, and burying it under
            five tabs of history makes it a scroll away. On a wide screen it
            goes back to the right-hand column. */}
        <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-1 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Email" value={member.email} />
                <Detail
                  label="Date of birth"
                  value={member.date_of_birth ? formatDate(member.date_of_birth) : null}
                />
                <Detail label="Gender" value={member.gender ? GENDER_LABELS[member.gender] : null} />
                <Detail label="Address" value={member.address} />
                <Detail
                  label="Emergency contact"
                  value={
                    member.emergency_contact_name || member.emergency_contact_phone
                      ? [member.emergency_contact_name, member.emergency_contact_phone]
                          .filter(Boolean)
                          .join(' · ')
                      : null
                  }
                />
                <Detail
                  label="Current plan"
                  value={
                    overview.current_plan_name
                      ? `${overview.current_plan_name}${
                          overview.membership_end_date
                            ? ` · ends ${formatDate(overview.membership_end_date)}`
                            : ''
                        }`
                      : 'No plan'
                  }
                />
                {member.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Detail
                      label="Notes"
                      value={<span className="whitespace-pre-wrap">{member.notes}</span>}
                    />
                  </div>
                ) : null}
                {left && member.left_reason ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Detail label="Reason for leaving" value={member.left_reason} />
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          {canManage ? (
            <MemberAppAccess
              memberId={id}
              email={member.email}
              invitedAt={member.invited_at}
              acceptedAt={member.accepted_at}
              hasAuthUser={Boolean(member.auth_user_id)}
            />
          ) : null}

          <MemberHistoryTabs
            memberships={memberships}
            invoices={invoices}
            payments={payments}
            attendance={attendance}
            messages={messages}
            branchNames={branchNames}
          />
        </div>

        {/* The history beside it can run to dozens of rows; the panel follows
            the scroll on a wide screen so Renew and Record payment stay in
            reach. It is the top of the page on a phone, so nothing to pin. */}
        <div className="order-1 min-w-0 lg:order-2 lg:col-span-1 lg:sticky lg:top-6 lg:self-start">
          <MemberActionPanel
            member={overview}
            memberships={memberships}
            invoices={invoices}
            payments={payments}
            staff={staff}
            branches={branches}
            initialAction={initialAction}
            checkedInMembershipIds={[
              ...new Set(
                attendance
                  .map((visit) => visit.membership_id)
                  .filter((id): id is string => Boolean(id))
              ),
            ]}
          />
        </div>
      </div>
    </div>
  )
}
