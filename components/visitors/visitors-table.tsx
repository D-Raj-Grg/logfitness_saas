'use client'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { VISITOR_KIND_LABELS } from '@/components/visitors/visitor-form'
import { VisitorRowActions } from '@/components/visitors/visitor-row-actions'
import type { VisitorRow, VisitorStatus } from '@/lib/db/visitors'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<VisitorStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Joined',
  lost: 'Not joining',
}

const STATUS_VARIANTS: Record<VisitorStatus, 'default' | 'secondary' | 'outline'> = {
  new: 'default',
  contacted: 'outline',
  converted: 'secondary',
  lost: 'secondary',
}

const KIND_LABELS: Record<VisitorRow['kind'], string> = {
  enquiry: 'Enquiry',
  guest: 'Guest',
}

export function VisitorsTable({
  rows,
  branchNames,
  planNames,
  canDelete,
  canMessage,
}: {
  rows: VisitorRow[]
  branchNames: Record<string, string>
  planNames: Record<string, string>
  /** Owner-only, mirroring the RLS delete policy. */
  canDelete: boolean
  canMessage: boolean
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nobody logged yet. The next person who walks in asking about joining goes
        here, and the callback stops living on a paper pad.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Mobile</TableHead>
          <TableHead>Visited</TableHead>
          <TableHead>Why</TableHead>
          <TableHead>Branch</TableHead>
          <TableHead>Interested in</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((visitor) => (
            <TableRow key={visitor.id}>
              <TableCell>
                <span className="block font-medium">{visitor.full_name}</span>
                {visitor.note ? (
                  <span className="block max-w-xs truncate text-xs text-muted-foreground">
                    {visitor.note}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="tabular-nums">
                <a className="hover:underline" href={`tel:${visitor.phone}`}>
                  {visitor.phone}
                </a>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDate(visitor.visited_on)}
              </TableCell>
              <TableCell>
                <span title={VISITOR_KIND_LABELS[visitor.kind]}>
                  {KIND_LABELS[visitor.kind]}
                </span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {branchNames[visitor.branch_id] ?? 'Unknown'}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {visitor.interested_plan_id
                  ? (planNames[visitor.interested_plan_id] ?? 'A plan since removed')
                  : '--'}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANTS[visitor.status]}>
                  {STATUS_LABELS[visitor.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <VisitorRowActions
                  visitor={visitor}
                  canDelete={canDelete}
                  canMessage={canMessage}
                />
              </TableCell>
            </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
