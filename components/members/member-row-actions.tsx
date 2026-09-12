'use client'

import Link from 'next/link'
import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

import {
  MemberRecordDialogs,
  MemberRecordMenuItems,
  type MemberRecordDialog,
} from '@/components/members/member-record-actions'
import { MemberMessageDialog } from '@/components/members/member-message-dialog'
import {
  MemberQuickEdit,
  type QuickEditBranch,
} from '@/components/members/member-quick-edit'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MemberOverviewRow } from '@/lib/db/members'

/**
 * Everything the desk does to a member without opening their profile.
 *
 * The membership forms are links rather than dialogs on purpose: renewing,
 * taking a payment or freezing needs that member's memberships, invoices,
 * payments and the branch's plans, which is four queries per row and twenty
 * five rows a page. The profile already loads them, so the menu sends the
 * request there with `?action=` and the panel opens the same dialog on
 * arrival.
 */
export function MemberRowActions({
  row,
  branches,
  isOwner,
}: {
  row: MemberOverviewRow
  /** Branches this staff member may move someone into, plus the member's own. */
  branches: QuickEditBranch[]
  isOwner: boolean
}) {
  const [quickEdit, setQuickEdit] = useState(false)
  const [message, setMessage] = useState(false)
  const [recordDialog, setRecordDialog] = useState<MemberRecordDialog>(null)

  const archived = Boolean(row.archived_at)
  const hasLeft = row.status === 'left'
  const profile = `/members/${row.id}`

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" aria-label={`Actions for ${row.full_name}`} />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem render={<Link href={profile} />}>View profile</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setQuickEdit(true)}>Quick edit</DropdownMenuItem>
          <DropdownMenuItem render={<Link href={`${profile}/edit`} />}>
            Full edit
          </DropdownMenuItem>

          {/* An archived member is off the floor: nothing to sell, take or
              freeze until someone restores them. */}
          {archived ? null : (
            <>
              <DropdownMenuSeparator />
              {hasLeft ? null : (
                <DropdownMenuItem render={<Link href={`${profile}?action=renew`} />}>
                  {row.current_plan_name ? 'Renew plan' : 'Sell plan'}
                </DropdownMenuItem>
              )}
              {row.due_paisa > 0 ? (
                <DropdownMenuItem render={<Link href={`${profile}?action=pay`} />}>
                  Record payment
                </DropdownMenuItem>
              ) : null}
              {row.membership_status === 'active' ? (
                <DropdownMenuItem render={<Link href={`${profile}?action=freeze`} />}>
                  Freeze membership
                </DropdownMenuItem>
              ) : null}
              {row.membership_status === 'frozen' ? (
                <DropdownMenuItem render={<Link href={`${profile}?action=unfreeze`} />}>
                  Unfreeze membership
                </DropdownMenuItem>
              ) : null}
              {/* A dialog rather than a link, unlike the membership forms
                  above: the wording costs one query when it opens, not four
                  per row while the list is being drawn. */}
              <DropdownMenuItem onClick={() => setMessage(true)}>Send SMS</DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link href={`/check-in?q=${encodeURIComponent(row.member_code)}`} />
                }
              >
                Check in
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <MemberRecordMenuItems
            archived={archived}
            isOwner={isOwner}
            onSelect={setRecordDialog}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <MemberQuickEdit
        member={{
          id: row.id,
          member_code: row.member_code,
          full_name: row.full_name,
          phone: row.phone,
          email: row.email,
          home_branch_id: row.home_branch_id,
        }}
        branches={branches}
        open={quickEdit}
        onOpenChange={setQuickEdit}
      />

      <MemberMessageDialog
        memberId={row.id}
        fullName={row.full_name}
        open={message}
        onOpenChange={setMessage}
      />

      <MemberRecordDialogs
        memberId={row.id}
        fullName={row.full_name}
        dialog={recordDialog}
        onDialogChange={setRecordDialog}
      />
    </>
  )
}
