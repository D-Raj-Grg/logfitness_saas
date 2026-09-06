import { orgLogoUrl } from '@/lib/org-logo'
import type { InvoiceForPrint } from '@/lib/db/documents'

export type LetterheadOrg = InvoiceForPrint['org']

/**
 * The masthead of every printed document. Every field is optional and every
 * field starts null -- an org that has never opened Settings still has to print
 * a usable invoice -- so nothing here may assume a value is present.
 *
 * Colours are literal, not theme tokens, and the rule is a border rather than a
 * filled band: browsers drop background graphics from print by default.
 */
export function Letterhead({
  org,
  documentTitle,
}: {
  org: LetterheadOrg
  documentTitle: string
}) {
  const logo = orgLogoUrl(org.logo_path)
  const name = org.legal_name?.trim() || org.name

  return (
    <header className="flex items-start justify-between gap-8 border-b border-[#d4d4d4] pb-4">
      <div className="flex items-start gap-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- public storage URL; next/image has no remotePatterns for this host
          <img
            src={logo}
            alt=""
            className="h-16 w-auto max-w-[180px] shrink-0 object-contain"
          />
        ) : null}

        <div className="space-y-0.5">
          <p className="text-[13pt] font-semibold leading-tight text-[#111827]">{name}</p>

          {org.address ? (
            <p className="whitespace-pre-line text-[9pt] leading-snug text-[#4b5563]">
              {org.address}
            </p>
          ) : null}

          {org.phone || org.email ? (
            <p className="text-[9pt] text-[#4b5563]">
              {[org.phone, org.email].filter(Boolean).join(' · ')}
            </p>
          ) : null}

          {org.pan_no ? (
            <p className="text-[9pt] text-[#4b5563]">PAN / VAT: {org.pan_no}</p>
          ) : null}
        </div>
      </div>

      <p className="shrink-0 text-[15pt] font-semibold uppercase tracking-wide text-[#111827]">
        {documentTitle}
      </p>
    </header>
  )
}
