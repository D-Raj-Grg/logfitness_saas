import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Printer } from 'lucide-react'

import { MemberAppAccess } from '@/components/members/member-app-access'
import { MemberCardAccess } from '@/components/members/member-card-access'
import { MemberHistoryTabs } from '@/components/members/member-history-tabs'
import { MemberMessageActions } from '@/components/members/member-message-actions'
import { MemberRecordActions } from '@/components/members/member-record-actions'
import { MemberRenewalRequests } from '@/components/members/member-renewal-requests'
import { MemberStatusActions } from '@/components/members/member-status-actions'
import { MemberPinControls } from '@/components/members/member-pin-controls'
import { MemberPhoto } from '@/components/members/member-photo'
import { MemberStatusBadge } from '@/components/members/member-status-badge'
import { MemberActionPanel } from '@/components/memberships/member-action-panel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { requireStaff } from '@/lib/auth'
import { listAttendance, listAttendanceForMember } from '@/lib/db/attendance'
import { listBranches } from '@/lib/db/branches'
import { countAttendanceForMember } from '@/lib/db/member-attendance'
import { listMemberCards, listUnassignedCardScans } from '@/lib/db/member-cards'
import { getMember, getMemberOverview } from '@/lib/db/members'
import { getMemberPinStatus } from '@/lib/db/member-pin'
import { listInvoicesForMember, listMembershipsForMember } from '@/lib/db/memberships'
import { listNotificationsForMember } from '@/lib/db/notifications'
import { listPaymentsForMember } from '@/lib/db/payments'
import { listRenewalRequestsForMember } from '@/lib/db/renewal-requests'
import { memberPhotoUrl } from '@/lib/db/photos'
import { getTrackCheckOut } from '@/lib/db/orgs'
import { formatDate, formatMoney, isRealIsoDate, todayInTimezone } from '@/lib/format'
import { lastVisitLabel } from '@/lib/last-visit'
import { GENDER_LABELS } from '@/lib/members'

const ATTENDANCE_PAGE_SIZE = 25

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

function Dot() {
  return (
    <span aria-hidden className="text-muted-foreground/50">
      ·
    </span>
  )
}

/**
 * One cell of the at-a-glance strip under the header. Three of these share one
 * card, divided by hairlines, so the strip reads as a single instrument panel
 * instead of one lone tile with two thirds of the row empty beside it.
 */
function Vital({
  label,
  value,
  hint,
  href,
  tone = 'default',
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  href?: string
  tone?: 'default' | 'danger'
}) {
  const body = (
    <>
      <span
        className={cn(
          'text-xs font-medium tracking-wide uppercase',
          tone === 'danger' ? 'text-destructive/80' : 'text-muted-foreground'
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-xl font-semibold tabular-nums break-words',
          tone === 'danger' && 'text-destructive'
        )}
      >
        {value}
      </span>
      {hint ? (
        <span
          className={cn(
            'text-xs',
            tone === 'danger' ? 'text-destructive/80' : 'text-muted-foreground'
          )}
        >
          {hint}
        </span>
      ) : null}
    </>
  )
  const cell = cn('flex min-w-0 flex-col gap-1 px-5 py-4', tone === 'danger' && 'bg-destructive/5')

  return href ? (
    <Link
      href={href}
      className={cn(
        cell,
        'transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cell}>{body}</div>
  )
}

export default async function MemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    invoice?: string
    action?: string
    tab?: string
    att_from?: string
    att_to?: string
    att_page?: string
  }>
}) {
  const staff = await requireStaff()
  const { id } = await params
  const {
    invoice: soldInvoiceId,
    action,
    tab,
    att_from: rawFrom,
    att_to: rawTo,
    att_page: rawPage,
  } = await searchParams

  // The Attendance tab's own window and page. They live under their own names
  // so they cannot collide with ?action= or ?invoice=, and anything that is not
  // a real date or a positive page is ignored rather than trusted.
  let attFrom = isRealIsoDate(rawFrom) ? rawFrom : undefined
  let attTo = isRealIsoDate(rawTo) ? rawTo : undefined
  if (attFrom && !attTo) attTo = attFrom
  if (attTo && !attFrom) attFrom = attTo
  // A backwards range is a typo, not a question.
  if (attFrom && attTo && attFrom > attTo) [attFrom, attTo] = [attTo, attFrom]
  const attPage = Math.max(1, Math.floor(Number(rawPage)) || 1)
  const attendanceFiltered = Boolean(attFrom)

  // Opens on the tab a link asked for. Any date or page in the URL means the
  // reader is in the middle of looking at attendance, so stay there.
  const TABS = ['profile', 'memberships', 'payments', 'invoices', 'attendance', 'messages'] as const
  type HistoryTab = (typeof TABS)[number]
  const defaultTab: HistoryTab =
    TABS.find((value) => value === tab) ??
    (attendanceFiltered || rawPage ? 'attendance' : 'profile')

  // The member list's row menu links here for the membership forms. Anything
  // else in the parameter is ignored, and the panel re-checks the one that is
  // left against the member's actual state.
  const initialAction =
    action === 'renew' || action === 'pay' || action === 'freeze' || action === 'unfreeze'
      ? action
      : null

  const canManage = staff.role !== 'trainer'
  const trackCheckOut = await getTrackCheckOut(staff.orgId)

  const [
    overview,
    member,
    memberships,
    invoices,
    payments,
    recentVisits,
    attendancePage,
    attendanceTotal,
    branches,
    messages,
    cards,
    cardScans,
    renewalRequests,
    pinStatus,
  ] = await Promise.all([
    getMemberOverview(id),
    getMember(id),
    listMembershipsForMember(id),
    listInvoicesForMember(id),
    listPaymentsForMember(id),
    // Only used to tell the action panel which memberships have been checked
    // in on -- the tab below reads its own, uncapped, filtered page.
    listAttendanceForMember(id),
    listAttendance({
      memberId: id,
      on: attFrom,
      to: attTo,
      page: attPage,
      pageSize: ATTENDANCE_PAGE_SIZE,
    }),
    // The true lifetime count. With no filter the page query's total already is
    // that, so only pay for a second count when a window narrows it.
    attendanceFiltered ? countAttendanceForMember(id) : Promise.resolve(null),
    listBranches(),
    listNotificationsForMember(id),
    // A failed card read must not take the whole profile down: null renders
    // the Access card row in an error state, and a failed inbox read is just
    // an empty picker (typing the UID still works).
    canManage ? listMemberCards(id).catch(() => null) : Promise.resolve([]),
    // The enrollment inbox only matters to someone who can assign a card. An
    // owner sees taps from every branch; anyone else, their own branches'.
    canManage
      ? listUnassignedCardScans(staff.role === 'owner' ? null : staff.branchIds).catch(() => [])
      : Promise.resolve([]),
    // Asks from the balance page. A failed read is an empty panel, not a 500.
    listRenewalRequestsForMember(id).catch(() => []),
    // A trainer cannot set PINs, so they are not shown the card. A failed read
    // is a card that says so, not a 500.
    canManage ? getMemberPinStatus(id).catch(() => null) : Promise.resolve(null),
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
  const left = overview.status === 'left'
  const archived = Boolean(member.archived_at)
  const today = todayInTimezone()
  const lastVisit = lastVisitLabel(overview.last_visit_on, today)

  // Who they are and how they get in. It lives in the first tab rather than
  // above the history: it is reference, read when something needs checking, and
  // it was pushing the plan history below the fold on every visit.
  const profile = (
    <div className="flex flex-col gap-6 pt-2">
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
        // App sign-in, its PIN and the door card are all "how does this
        // person get in", so they share one card and one rhythm instead of
        // three loose boxes.
        <Card>
          <CardHeader>
            <CardTitle>App &amp; door access</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            <MemberAppAccess
              memberId={id}
              email={member.email}
              invitedAt={member.invited_at}
              acceptedAt={member.accepted_at}
              hasAuthUser={Boolean(member.auth_user_id)}
            />
            <MemberPinControls
              memberId={id}
              fullName={overview.full_name}
              initialStatus={pinStatus}
            />
            <MemberCardAccess
              memberId={id}
              cards={cards}
              scans={cardScans}
              cardNo={overview.card_no ?? null}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )

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
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
              <span className="font-mono text-foreground/80">{overview.member_code}</span>
              <Dot />
              <span className="tabular-nums">{overview.phone}</span>
              <Dot />
              <span>{overview.home_branch_name}</span>
              <Dot />
              <span>Joined {formatDate(overview.joined_on)}</span>
              {left && overview.left_on ? (
                <>
                  <Dot />
                  <span>Left {formatDate(overview.left_on)}</span>
                </>
              ) : null}
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

      <Card className="py-0 [--card-spacing:0px]">
        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Vital
            label="Last visit"
            value={lastVisit.label}
            href={`/members/${id}?tab=attendance`}
            hint={
              lastVisit.never
                ? 'Never checked in'
                : `${formatDate(overview.last_visit_on as string)} · see all visits`
            }
          />
          <Vital
            label="Plan"
            value={overview.current_plan_name ?? 'No plan'}
            hint={
              overview.current_plan_name
                ? [
                    overview.membership_end_date
                      ? `Ends ${formatDate(overview.membership_end_date)}`
                      : null,
                    overview.days_to_expiry !== null && overview.days_to_expiry >= 0
                      ? `${overview.days_to_expiry} day${overview.days_to_expiry === 1 ? '' : 's'} left`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : (overview.has_membership_history ?? true)
                  ? 'The last plan has ended'
                  : 'Nothing sold yet'
            }
          />
          <Vital
            label="Dues"
            tone={overview.due_paisa > 0 ? 'danger' : 'default'}
            value={formatMoney(overview.due_paisa)}
            hint={
              overview.due_paisa > 0
                ? overview.oldest_due_on
                  ? `Oldest unpaid invoice from ${formatDate(overview.oldest_due_on)}`
                  : 'Outstanding'
                : 'Nothing owed'
            }
          />
        </div>
      </Card>

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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Stacked, the action panel comes first: renewing a plan or taking a
            payment is why the desk opened this record, and burying it under
            five tabs of history makes it a scroll away. On a wide screen it
            goes back to the right-hand column. */}
        <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-1 lg:col-span-2">
          <MemberHistoryTabs
            memberships={memberships}
            invoices={invoices}
            payments={payments}
            attendance={attendancePage.rows}
            attendanceTotal={attendanceTotal ?? attendancePage.total}
            attendanceMatches={attendancePage.total}
            attendancePage={attendancePage.page}
            attendancePageSize={ATTENDANCE_PAGE_SIZE}
            attendanceFrom={attFrom ?? null}
            attendanceTo={attTo ?? null}
            today={today}
            memberId={id}
            trackCheckOut={trackCheckOut}
            // The tab state lives inside the component, so a link that changes
            // ?tab= or the window must remount it or the old tab stays open.
            key={`${defaultTab}:${attFrom ?? ''}:${attTo ?? ''}:${attendancePage.page}`}
            defaultTab={defaultTab}
            profile={profile}
            messages={messages}
            branchNames={branchNames}
          />
        </div>

        {/* The history beside it can run to dozens of rows; the panel follows
            the scroll on a wide screen so Renew and Record payment stay in
            reach. It is the top of the page on a phone, so nothing to pin. */}
        <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2 lg:col-span-1 lg:sticky lg:top-6 lg:self-start">
          {/* An ask from the balance page sits right above the Renew button
              that answers it. Past asks fold into one quiet line. */}
          <MemberRenewalRequests
            requests={renewalRequests}
            fullName={overview.full_name}
            canManage={canManage}
          />
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
                recentVisits
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
