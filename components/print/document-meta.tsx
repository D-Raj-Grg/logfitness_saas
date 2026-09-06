import type { InvoiceForPrint } from '@/lib/db/documents'

type Member = InvoiceForPrint['member']
type Branch = InvoiceForPrint['branch']

export type MetaEntry = { label: string; value: string }

/**
 * Who the document is for, and which outlet issued it. The branch block is not
 * decoration: a chain's member can pay at any branch, and the receipt has to
 * say which gym took the money.
 */
export function DocumentMeta({
  member,
  branch,
  entries,
}: {
  member: Member
  branch: Branch
  entries: MetaEntry[]
}) {
  return (
    <section className="avoid-break mt-6 flex items-start justify-between gap-10">
      <div className="space-y-0.5">
        <p className="text-[8.5pt] font-medium uppercase tracking-wide text-[#6b7280]">
          Billed to
        </p>
        <p className="text-[11pt] font-medium text-[#111827]">{member.full_name}</p>
        <p className="text-[9pt] text-[#4b5563]">
          {member.member_code} · {member.phone}
        </p>
        {member.email ? (
          <p className="text-[9pt] text-[#4b5563]">{member.email}</p>
        ) : null}
        {member.address ? (
          <p className="whitespace-pre-line text-[9pt] text-[#4b5563]">{member.address}</p>
        ) : null}
      </div>

      <div className="min-w-[62mm] space-y-1">
        {entries.map((entry) => (
          <div key={entry.label} className="flex justify-between gap-6 text-[9.5pt]">
            <span className="text-[#6b7280]">{entry.label}</span>
            <span className="text-right font-medium text-[#111827]">{entry.value}</span>
          </div>
        ))}

        <div className="mt-2 border-t border-[#e5e5e5] pt-2">
          <p className="text-[8.5pt] font-medium uppercase tracking-wide text-[#6b7280]">
            Issued at
          </p>
          <p className="text-[9.5pt] font-medium text-[#111827]">{branch.name}</p>
          {branch.address ? (
            <p className="whitespace-pre-line text-[9pt] text-[#4b5563]">{branch.address}</p>
          ) : null}
          {branch.phone ? <p className="text-[9pt] text-[#4b5563]">{branch.phone}</p> : null}
        </div>
      </div>
    </section>
  )
}
