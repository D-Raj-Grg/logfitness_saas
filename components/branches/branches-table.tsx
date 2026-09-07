'use client'

import { useActionState, useState } from 'react'

import { setBranchStatusAction, type BranchFormState } from '@/app/(app)/branches/actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { BranchForm } from '@/components/branches/branch-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type BranchListRow = {
  id: string
  name: string
  status: 'active' | 'inactive'
  address: string | null
  phone: string | null
}

const STATUS_LABELS: Record<BranchListRow['status'], string> = {
  active: 'Active',
  inactive: 'Deactivated',
}

function EditBranchDialog({ branch }: { branch: BranchListRow }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Edit</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {branch.name}</DialogTitle>
          <DialogDescription>
            Changes apply immediately across the app.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so a reopened dialog starts from the branch, not stale state. */}
        {open ? (
          <BranchForm key={branch.id} branch={branch} onSaved={() => setOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function StatusToggle({ branch }: { branch: BranchListRow }) {
  const [open, setOpen] = useState(false)
  const nextStatus = branch.status === 'inactive' ? 'active' : 'inactive'
  const deactivating = nextStatus === 'inactive'

  const [state, formAction, pending] = useActionState<BranchFormState, FormData>(
    async (prev, formData) => {
      const result = await setBranchStatusAction(prev, formData)
      if (result.success) setOpen(false)
      return result
    },
    {}
  )

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant={deactivating ? 'destructive' : 'outline'} size="sm" />}
      >
        {deactivating ? 'Deactivate' : 'Reactivate'}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="branchId" value={branch.id} />
          <input type="hidden" name="status" value={nextStatus} />
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deactivating ? `Deactivate ${branch.name}?` : `Reactivate ${branch.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deactivating
                ? 'It keeps every member and every row of its history. This does not currently remove it from the registration branch picker or staff assignment.'
                : 'It becomes available again wherever branches are shown.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              variant={deactivating ? 'destructive' : 'default'}
              disabled={pending}
            >
              {pending ? 'Working...' : deactivating ? 'Deactivate' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function BranchesTable({ rows }: { rows: BranchListRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No branches yet.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Address</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {row.address || '--'}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {row.phone || '--'}
            </TableCell>
            <TableCell>
              <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>
                {STATUS_LABELS[row.status]}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <EditBranchDialog branch={row} />
                <StatusToggle branch={row} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
