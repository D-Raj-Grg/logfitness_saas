'use client'

import { useActionState, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

import {
  archiveMember,
  deleteMember,
  restoreMember,
  type MemberFormState,
} from '@/app/(app)/members/actions'
import { FieldError } from '@/components/auth/auth-form-message'
import { ReasonField } from '@/components/forms/reason-field'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The record itself, as opposed to the membership: archive, restore, and the
 * owner's delete.
 *
 * Archiving is the answer to "get this off my list" -- a duplicate entry, a
 * walk-in who never came back. It hides the member everywhere the desk works
 * and changes nothing else, so the money and the audit trail survive it.
 *
 * Deleting is the other thing, and it is owner-only three times over: the
 * Server Action checks the role, the RLS policy refuses the row, and this
 * dialog makes the owner type the member's name. It takes their invoices and
 * payments with it.
 */
export type MemberRecordDialog = 'archive' | 'restore' | 'delete' | null

export function MemberRecordActions({
  memberId,
  fullName,
  archived,
  isOwner,
}: {
  memberId: string
  fullName: string
  archived: boolean
  isOwner: boolean
}) {
  const [dialog, setDialog] = useState<MemberRecordDialog>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" aria-label="More actions" />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <MemberRecordMenuItems
            archived={archived}
            isOwner={isOwner}
            onSelect={setDialog}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <MemberRecordDialogs
        memberId={memberId}
        fullName={fullName}
        dialog={dialog}
        onDialogChange={setDialog}
      />
    </>
  )
}

/**
 * The menu entries on their own, so the list row's action menu can offer the
 * same three choices inside its own dropdown rather than nesting a second one.
 */
export function MemberRecordMenuItems({
  archived,
  isOwner,
  onSelect,
}: {
  archived: boolean
  isOwner: boolean
  onSelect: (dialog: MemberRecordDialog) => void
}) {
  return (
    <>
      {archived ? (
        <DropdownMenuItem onClick={() => onSelect('restore')}>
          Restore member
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onClick={() => onSelect('archive')}>
          Archive member
        </DropdownMenuItem>
      )}
      {isOwner ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => onSelect('delete')}
          >
            Delete permanently
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )
}

/**
 * The three confirmations, controlled from outside. Shared by the profile
 * page's action menu and the member list's per-row menu: the wording of an
 * irreversible delete should not exist in two places.
 */
export function MemberRecordDialogs({
  memberId,
  fullName,
  dialog,
  onDialogChange,
}: {
  memberId: string
  fullName: string
  dialog: MemberRecordDialog
  onDialogChange: (dialog: MemberRecordDialog) => void
}) {
  const [archiveState, archiveAction, archivePending] = useActionState<
    MemberFormState,
    FormData
  >(async (prev, formData) => {
    const result = await archiveMember(prev, formData)
    if (result.success) onDialogChange(null)
    return result
  }, {})

  const [restoreState, restoreAction, restorePending] = useActionState<
    MemberFormState,
    FormData
  >(async (prev, formData) => {
    const result = await restoreMember(prev, formData)
    if (result.success) onDialogChange(null)
    return result
  }, {})

  // No success branch: a delete redirects to /members, so this dialog is gone
  // with the page that held it.
  const [deleteState, deleteAction, deletePending] = useActionState<
    MemberFormState,
    FormData
  >(deleteMember, {})

  function close(open: boolean) {
    if (!open) onDialogChange(null)
  }

  return (
    <>
      <AlertDialog open={dialog === 'archive'} onOpenChange={close}>
        <AlertDialogContent>
          <form action={archiveAction} className="flex flex-col gap-4">
            <input type="hidden" name="memberId" value={memberId} />
            <AlertDialogHeader>
              <AlertDialogTitle>Archive {fullName}?</AlertDialogTitle>
              <AlertDialogDescription>
                They drop out of the member list, search, and the absent-members
                report. Memberships, invoices and payments are untouched, and you
                can restore them from the Archived filter.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <ReasonField
              id="archive-reason"
              presets={[
                'Duplicate entry',
                'Never turned up',
                'Entered by mistake',
                'Test record',
              ]}
            />

            {archiveState.error ? (
              <p className="text-sm text-destructive">{archiveState.error}</p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={archivePending}>Keep them</AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={archivePending}>
                {archivePending ? 'Working...' : 'Archive'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === 'restore'} onOpenChange={close}>
        <AlertDialogContent>
          <form action={restoreAction} className="flex flex-col gap-4">
            <input type="hidden" name="memberId" value={memberId} />
            <AlertDialogHeader>
              <AlertDialogTitle>Restore {fullName}?</AlertDialogTitle>
              <AlertDialogDescription>
                They go back into the member list and search exactly as they were.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {restoreState.error ? (
              <p className="text-sm text-destructive">{restoreState.error}</p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={restorePending}>Cancel</AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={restorePending}>
                {restorePending ? 'Working...' : 'Restore'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === 'delete'} onOpenChange={close}>
        <AlertDialogContent>
          <form action={deleteAction} className="flex flex-col gap-4">
            <input type="hidden" name="memberId" value={memberId} />
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {fullName} permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone. Their memberships, invoices and payments go
                with them, and the collection figures for those days change.
                Archive instead unless the record should never have existed.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="flex flex-col gap-2">
              <Label htmlFor="delete-confirm">
                Type <span className="font-medium">{fullName}</span> to confirm
              </Label>
              <Input id="delete-confirm" name="confirmName" autoComplete="off" required />
              <FieldError messages={deleteState.fieldErrors?.confirmName} />
            </div>

            {deleteState.error ? (
              <p className="text-sm text-destructive">{deleteState.error}</p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
              <AlertDialogAction type="submit" variant="destructive" disabled={deletePending}>
                {deletePending ? 'Deleting...' : 'Delete permanently'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
