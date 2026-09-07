import Link from 'next/link'

import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { requireRole } from '@/lib/auth'

/**
 * Deliberately thin: an index so the existing `/reports` nav item resolves, and
 * one place to find the reports that exist today. Phase 3 fills this page out
 * with the chain-layer reports (revenue by branch, churn, attendance trend,
 * plan mix, CSV export) and this list becomes the report catalogue.
 */
const REPORTS = [
  {
    title: 'Absent members',
    href: '/reports/absent',
    description:
      'Active members who have stopped coming, banded by how long they have been away. The churn early warning.',
  },
  {
    title: 'Daily collection',
    href: '/payments?view=collection',
    description: 'The drawer sheet: what each person took, by method, net of refunds.',
  },
  {
    title: 'Arrears',
    href: '/payments?view=arrears',
    description: 'Who owes money, and for how long. Oldest debts first.',
  },
  {
    title: 'Revenue',
    href: '/reports/revenue',
    description: 'Gross, refunds, reversals and net, by period, branch and method.',
  },
  {
    title: 'Membership movement',
    href: '/reports/movement',
    description: 'New, renewed, expired and churned members, by period and branch.',
  },
  {
    title: 'Attendance trend',
    href: '/reports/attendance',
    description: 'Check-ins and distinct members over time, across branches.',
  },
  {
    title: 'Plan mix',
    href: '/reports/plans',
    description: 'Active memberships and revenue by plan, per branch.',
  },
]

export default async function ReportsPage() {
  await requireRole('owner', 'manager')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground print:hidden">
          The sheets a branch actually prints and works through.
        </p>
      </div>

      <div className="grid gap-3 break-inside-avoid sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <Link key={report.href} href={report.href} className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="flex flex-col gap-2 py-4">
                <CardTitle>{report.title}</CardTitle>
                <CardDescription>{report.description}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
