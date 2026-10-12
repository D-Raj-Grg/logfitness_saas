'use client'

import { useState } from 'react'

import { ClassForm, DAYS, type ClassFormContext } from '@/components/classes/class-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { recurrenceOf, type ClassRow } from '@/lib/db/classes'

function ClassDialog({
  open,
  onOpenChange,
  cls,
  context,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  cls?: ClassRow
  context: ClassFormContext
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{cls ? `Edit ${cls.name}` : 'New class'}</DialogTitle>
          <DialogDescription>
            Changes apply to sessions created from now on. Sessions already on the
            timetable keep their trainer and capacity.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ClassForm
            key={cls?.id ?? 'new'}
            cls={cls}
            {...context}
            onSaved={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function NewClassButton({ context }: { context: ClassFormContext }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>New class</Button>
      <ClassDialog open={open} onOpenChange={setOpen} context={context} />
    </>
  )
}

export function ClassesTable({
  rows,
  branchNames,
  trainerNames,
  context,
  canEdit,
}: {
  rows: ClassRow[]
  branchNames: Record<string, string>
  trainerNames: Record<string, string>
  context: ClassFormContext
  canEdit: boolean
}) {
  const [editing, setEditing] = useState<ClassRow | null>(null)

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No classes yet.{canEdit ? ' Add the first one to build the timetable.' : ''}
      </p>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Trainer</TableHead>
            <TableHead className="text-right">Capacity</TableHead>
            <TableHead>Room</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Status</TableHead>
            {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>{branchNames[row.branch_id] ?? '-'}</TableCell>
              <TableCell>{row.trainer_id ? (trainerNames[row.trainer_id] ?? '-') : '-'}</TableCell>
              <TableCell className="text-right">{row.capacity}</TableCell>
              <TableCell>{row.room ?? '-'}</TableCell>
              <TableCell className="text-xs">
                {recurrenceOf(row)
                  .map((s) => `${DAYS[s.day_of_week].slice(0, 3)} ${s.start_time}-${s.end_time}`)
                  .join(', ') || '-'}
              </TableCell>
              <TableCell>
                <Badge variant={row.is_active ? 'secondary' : 'outline'}>
                  {row.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              {canEdit ? (
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                    Edit
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ClassDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        cls={editing ?? undefined}
        context={context}
      />
    </>
  )
}
