import type { InvoiceForPrint } from '@/lib/db/documents'
import { documentStrings } from '@/lib/print/strings'

type Member = InvoiceForPrint['member']
type Branch = InvoiceForPrint['branch']

export type MetaEntry = { label: string; value: string }

/**
 * Who the document is for, which outlet issued it, and the document's own
 * facts -- as one band across the sheet rather than two columns.
 *
 * The two-column version left a hole: the member block is three short lines
 * and the facts column is five, so the left half of the page under "Billed to"
 * printed empty. Three cells of roughly equal weight fill the band whatever
 * the content, and the branch block stops being an afterthought hanging off
 * the bottom of the right column.
 *
 * The branch is not decoration: a chain's member can pay at any branch, and
 * the document has to say which gym took the money.
 */
export function DocumentMeta({
  member,
  branch,
  entries,
  factsLabel,
}: {
  member: Member
  branch: Branch
  entries: MetaEntry[]
  /** "Invoice" / "Receipt" -- the eyebrow over the third cell. */
  factsLabel: string
}) {
  const t = documentStrings()

  return (
    <section className="avoid-break mt-[7mm] grid grid-cols-[1.25fr_1fr_1.1fr] gap-[8mm] border-y border-[color:var(--hairline)] py-[4mm]">
      <div>
        <Eyebrow>{t.billedTo}</Eyebrow>
        <p className="mt-[1.5mm] text-[11.5pt] font-semibold leading-tight">
          {member.full_name}
        </p>
        <div className="mt-[1mm] space-y-[0.4mm] text-[9pt] text-[color:var(--muted)]">
          <p>
            {member.member_code} · {member.phone}
          </p>
          {member.email ? <p>{member.email}</p> : null}
          {member.address ? <p className="whitespace-pre-line">{member.address}</p> : null}
        </div>
      </div>

      <div>
        <Eyebrow>{t.issuedAt}</Eyebrow>
        <p className="mt-[1.5mm] text-[10pt] font-medium leading-tight">{branch.name}</p>
        <div className="mt-[1mm] space-y-[0.4mm] text-[9pt] text-[color:var(--muted)]">
          {branch.address ? <p className="whitespace-pre-line">{branch.address}</p> : null}
          {branch.phone ? <p>{branch.phone}</p> : null}
        </div>
      </div>

      <div>
        <Eyebrow>{factsLabel}</Eyebrow>
        <dl className="mt-[1.5mm] space-y-[0.8mm]">
          {entries.map((entry) => (
            <div key={entry.label} className="flex justify-between gap-4 text-[9.5pt]">
              <dt className="text-[color:var(--muted)]">{entry.label}</dt>
              <dd className="text-right font-medium">{entry.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[8pt] font-medium uppercase tracking-[0.12em] text-[color:var(--muted)]">
      {children}
    </p>
  )
}
