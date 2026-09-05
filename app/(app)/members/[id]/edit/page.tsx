import Link from 'next/link'
import { notFound } from 'next/navigation'

import { MemberForm } from '@/components/members/member-form'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { getMember } from '@/lib/db/members'

export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const staff = await requireRole('owner', 'manager', 'front_desk')
  const { id } = await params

  const [member, allBranches] = await Promise.all([getMember(id), listBranches()])

  if (!member) notFound()

  // The member's current branch stays selectable even if the editor cannot
  // register into it, so an unrelated edit does not force a branch move.
  const branches =
    staff.role === 'owner'
      ? allBranches
      : allBranches.filter(
          (branch) =>
            staff.branchIds.includes(branch.id) || branch.id === member.home_branch_id
        )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit {member.full_name}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{member.member_code}</span>
          {' · '}
          <Link href={`/members/${member.id}`} className="underline-offset-4 hover:underline">
            Back to profile
          </Link>
        </p>
      </div>

      <MemberForm member={member} branches={branches} />
    </div>
  )
}
