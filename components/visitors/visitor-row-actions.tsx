'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

import {
  deleteVisitor,
  setVisitorStatus,
  type VisitorFormState,
} from '@/app/(app)/visitors/actions'
import {
  sendVisitorWelcome,
  type VisitorMessageState,
} from '@/app/(app)/visitors/message-actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { VisitorMessageDialog } from '@/components/visitors/visitor-message-dialog'
import type { VisitorRow, VisitorStatus } from '@/lib/db/visitors'

type StatusChoice = Exclude<VisitorStatus, 'converted'>

const STATUS_ACTIONS: { status: StatusChoice; label: string }[] = [
  { status: 'contacted', label: 'Mark contacted' },
  { status: 'new', label: 'Back to new' },
  { status: 'lost', label: 'Not joining' },
]

/**
 * The row's actions. Status moves are one click each -- a callback is logged
 * between two other things at the counter, so nothing here asks for a reason or
 * a confirmation. The delete does, because it is the only irreversible one.
 */
export function VisitorRowActions({
  visitor,
  canDelete,
  canMessage,
}: {
  visitor: VisitorRow
  canDelete: boolean
  /** Owner, manager and front desk. A trainer logs walk-ins but does not text them. */
  canMessage: boolean
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [messaging, setMessaging] = useState(false)

  const [statusState, statusAction, statusPending] = useActionState<
    VisitorFormState,
    FormData
  >(setVisitorStatus, {})
  const [deleteState, deleteAction, deletePending] = useActionState<
    VisitorFormState,
    FormData
  >(deleteVisitor, {})
  const [welcomeState, welcomeAction, welcomePending] = useActionState<
    VisitorMessageState,
    FormData
  >(sendVisitorWelcome, {})

  const converted = visitor.status === 'converted'

  return (
    <div className="inline-flex items-center justify-end gap-1">
      {statusState.error ?? welcomeState.error ? (
        <span className="text-xs text-destructive">
          {statusState.error ?? welcomeState.error}
        </span>
      ) : null}

      {welcomeState.success ? (
        <span className="text-xs text-muted-foreground">{welcomeState.success}</span>
      ) : null}

      {converted ? (
        visitor.converted_member_id ? (
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={`/members/${visitor.converted_member_id}`} />}
          >
            Open member
          </Button>
        ) : null
      ) : (
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/members/new?visitor=${visitor.id}`} />}
        >
          Register
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" aria-label="More actions" />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* A walk-in who has joined is a member now, with a member's history
              and a member's opt-out; the database refuses this and the menu
              points at the profile instead. */}
          {canMessage && !converted ? (
            <>
              {/* One click, no preview: the gym's own welcome, rendered in
                  Postgres, for a desk clearing a morning's walk-ins. */}
              <form action={welcomeAction}>
                <input type="hidden" name="visitorId" value={visitor.id} />
                <DropdownMenuItem
                  render={<button type="submit" disabled={welcomePending} />}
                >
                  {welcomePending ? 'Sending…' : 'Send welcome SMS'}
                </DropdownMenuItem>
              </form>
              <DropdownMenuItem onClick={() => setMessaging(true)}>
                Send message…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}

          {converted ? (
            <DropdownMenuItem disabled>Registered as a member</DropdownMenuItem>
          ) : (
            STATUS_ACTIONS.filter((action) => action.status !== visitor.status).map(
              (action) => (
                // Each item is its own form: the action takes FormData, and a
                // submit inside the menu keeps one round trip per click.
                <form key={action.status} action={statusAction}>
                  <input type="hidden" name="visitorId" value={visitor.id} />
                  <input type="hidden" name="status" value={action.status} />
                  <DropdownMenuItem
                    render={<button type="submit" disabled={statusPending} />}
                  >
                    {action.label}
                  </DropdownMenuItem>
                </form>
              )
            )
          )}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete record
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <VisitorMessageDialog
        visitorId={visitor.id}
        fullName={visitor.full_name}
        open={messaging}
        onOpenChange={setMessaging}
      />

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <form action={deleteAction} className="flex flex-col gap-4">
            <input type="hidden" name="visitorId" value={visitor.id} />
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {visitor.full_name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The visit and the note go for good. Mark them &ldquo;not
                joining&rdquo; instead if you only want them out of the callback
                list.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {deleteState.error ? (
              <p className="text-sm text-destructive">{deleteState.error}</p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletePending}>Keep it</AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={deletePending}>
                {deletePending ? 'Working...' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
