import type { LetterheadOrg } from '@/components/print/letterhead'

export function DocumentFooter({
  org,
  signatureLabel = 'Authorised signature',
}: {
  org: LetterheadOrg
  signatureLabel?: string
}) {
  return (
    <footer className="avoid-break mt-10 border-t border-[#d4d4d4] pt-4 text-[9pt] text-[#4b5563]">
      {org.tax_note ? <p>{org.tax_note}</p> : null}

      {org.invoice_terms ? (
        <p className="mt-2 whitespace-pre-line leading-snug">{org.invoice_terms}</p>
      ) : null}

      <div className="mt-10 flex items-end justify-between gap-10">
        <p className="text-[8.5pt] text-[#6b7280]">
          Computer generated. Valid without a stamp.
        </p>
        <div className="w-[60mm] border-t border-[#9ca3af] pt-1 text-center text-[8.5pt] text-[#6b7280]">
          {signatureLabel}
        </div>
      </div>
    </footer>
  )
}
