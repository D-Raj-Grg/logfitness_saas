'use client'

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'

import { MemberMessageDialog } from '@/components/members/member-message-dialog'
import { Button } from '@/components/ui/button'

/**
 * The profile's own Send SMS button. A button and not a menu item: chasing a
 * due or telling someone their plan ends on Tuesday is the thing the desk does
 * most often with a member on screen, and it should not be two clicks deep.
 */
export function MemberMessageActions({
  memberId,
  fullName,
  initialOpen = false,
}: {
  memberId: string
  fullName: string
  /** The members list links here with ?action=sms. */
  initialOpen?: boolean
}) {
  const [open, setOpen] = useState(initialOpen)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MessageSquare />
        Send SMS
      </Button>
      <MemberMessageDialog
        memberId={memberId}
        fullName={fullName}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
