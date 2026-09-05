'use client'

import { useActionState } from 'react'

import { setStaffStatus, type StaffFormState } from '@/app/(app)/staff/actions'
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
import { ROLE_LABELS, type StaffRole } from '@/lib/roles'

export type StaffListRow = {
  id: string
  full_name: string
  email: string
  phone: string | null
  role: StaffRole
  branch_ids: string[]
  status: 'invited' | 'active' | 'inactive'
  accepted_at: string | null
}

const STATUS_LABELS: Record<StaffListRow['status'], string> = {
  invited: 'Awaiting signup',
  active: 'Active',
  inactive: 'Deactivated',
}

function StatusToggle({ row }: { row: StaffListRow }) {
  const [state, formAction, pending] = useActionState<StaffFormState, FormData>(
    setStaffStatus,
    {}
  )

  const nextStatus = row.status === 'inactive' ? 'active' : 'inactive'

  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="staffId" value={row.id} />
      <input type="hidden" name="status" value={nextStatus} />
      {state.error ? (
        <span className="text-xs text-destructive">{state.error}</span>
      ) : null}
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {row.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
      </Button>
    </form>
  )
}

export function StaffTable({
  rows,
  branchNames,
  currentStaffId,
}: {
  rows: StaffListRow[]
  branchNames: Record<string, string>
  currentStaffId: string
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No staff yet.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Branches</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <span className="block font-medium">{row.full_name}</span>
              <span className="block text-xs text-muted-foreground">{row.email}</span>
            </TableCell>
            <TableCell>{ROLE_LABELS[row.role]}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {row.role === 'owner'
                ? 'All branches'
                : row.branch_ids
                    .map((id) => branchNames[id] ?? 'Unknown')
                    .join(', ') || '--'}
            </TableCell>
            <TableCell>
              <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>
                {STATUS_LABELS[row.status]}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              {row.id === currentStaffId ? (
                <span className="text-xs text-muted-foreground">You</span>
              ) : (
                <StatusToggle row={row} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
