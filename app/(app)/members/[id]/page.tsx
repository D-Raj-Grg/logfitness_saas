import Link from 'next/link'
import { notFound } from 'next/navigation'

import { MemberHistoryTabs } from '@/components/members/member-history-tabs'
import { MemberStatusActions } from '@/components/members/member-status-actions'
import { MemberStatusBadge } from '@/components/members/member-status-badge'
import { MemberActionPanel } from '@/components/memberships/member-action-panel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireStaff } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { getMember, getMemberOverview } from '@/lib/db/members'
import { listInvoicesForMember, listMembershipsForMember } from '@/lib/db/memberships'
import { listPaymentsForMember } from '@/lib/db/payments'
import { formatDate, formatMoney } from '@/lib/format'
import { GENDER_LABELS } from '@/lib/members'

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? <span className="text-muted-foreground">--</span>}</dd>
    </div>
  )
}

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const staff = await requireStaff()
  const { id } = await params

  const [overview, member, memberships, invoices, payments, branches] = await Promise.all([
    getMemberOverview(id),
    getMember(id),
    listMembershipsForMember(id),
    listInvoicesForMember(id),
    listPaymentsForMember(id),
    listBranches(),
  ])

  if (!overview || !member) notFound()

  const branchNames = Object.fromEntries(branches.map((branch) => [branch.id, branch.name]))
  const canManage = staff.role !== 'trainer'
  const left = overview.status === 'left'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{overview.full_name}</h1>
            <MemberStatusBadge
              status={overview.status}
              daysToExpiry={overview.days_to_expiry}
            />
          </div>
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <span className="font-mono">{overview.member_code}</span>
            <span className="tabular-nums">{overview.phone}</span>
            <span>{overview.home_branch_name}</span>
            <span>Joined {formatDate(overview.joined_on)}</span>
            {left && overview.left_on ? <span>Left {formatDate(overview.left_on)}</span> : null}
          </p>
        </div>

        {canManage ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" render={<Link href={`/members/${id}/edit`} />}>
              Edit
            </Button>
            <MemberStatusActions memberId={id} fullName={overview.full_name} left={left} />
          </div>
        ) : null}
      </div>

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
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-3">
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
                  <div className="sm:col-span-3">
                    <Detail
                      label="Notes"
                      value={<span className="whitespace-pre-wrap">{member.notes}</span>}
                    />
                  </div>
                ) : null}
                {left && member.left_reason ? (
                  <div className="sm:col-span-3">
                    <Detail label="Reason for leaving" value={member.left_reason} />
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <MemberHistoryTabs
            memberships={memberships}
            invoices={invoices}
            payments={payments}
            branchNames={branchNames}
          />
        </div>

        <div className="lg:col-span-1">
          <MemberActionPanel
            member={overview}
            memberships={memberships}
            invoices={invoices}
            payments={payments}
            staff={staff}
            branches={branches}
          />
        </div>
      </div>
    </div>
  )
}
