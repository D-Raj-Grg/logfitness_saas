import type { LetterheadOrg } from '@/components/print/letterhead'
import { documentStrings } from '@/lib/print/strings'

/** The tax note, the gym's terms, and somewhere to sign. */
export function DocumentFooter({
  org,
  signatureLabel,
}: {
  org: LetterheadOrg
  signatureLabel?: string
}) {
  const t = documentStrings()

  return (
    <footer className="avoid-break mt-[12mm] border-t border-[color:var(--rule)] pt-[3mm] text-[9pt] text-[color:var(--muted)]">
      {org.tax_note ? <p>{org.tax_note}</p> : null}
      {org.invoice_terms ? (
        <p className="mt-[2mm] whitespace-pre-line leading-snug">{org.invoice_terms}</p>
      ) : null}

      <div className="mt-[14mm] flex items-end justify-between gap-10">
        <p className="text-[8pt]">{t.computerGenerated}</p>
        <div className="w-[55mm] border-t border-[color:var(--ink)] pt-[1mm] text-center text-[8pt]">
          {signatureLabel ?? t.authorisedSignature}
        </div>
      </div>
    </footer>
  )
}
