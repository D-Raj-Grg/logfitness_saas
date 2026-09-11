import { orgLogoUrl } from '@/lib/org-logo'
import type { InvoiceForPrint } from '@/lib/db/documents'

export type LetterheadOrg = InvoiceForPrint['org']

/**
 * The masthead of every printed document. Every field is optional and every
 * field starts null -- an org that has never opened Settings still has to print
 * a usable invoice -- so nothing here may assume a value is present.
 *
 * Colours come from the .doc-a4 palette, and the rule is a border rather than a
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
    <header className="flex items-end justify-between gap-8 border-b-2 border-[color:var(--ink)] pb-[3mm]">
      <div className="flex items-center gap-[4mm]">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- public storage URL; next/image has no remotePatterns for this host
          <img
            src={logo}
            alt=""
            className="h-[16mm] w-auto max-w-[42mm] shrink-0 object-contain"
          />
        ) : null}

        <div>
          <p className="text-[14pt] font-semibold leading-tight tracking-[-0.01em]">
            {name}
          </p>

          <div className="mt-[1mm] space-y-[0.4mm] text-[9pt] leading-snug text-[color:var(--muted)]">
            {org.address ? <p className="whitespace-pre-line">{org.address}</p> : null}
            {org.phone || org.email ? (
              <p>{[org.phone, org.email].filter(Boolean).join(' · ')}</p>
            ) : null}
            {org.pan_no ? <p>PAN / VAT: {org.pan_no}</p> : null}
          </div>
        </div>
      </div>

      {/* The one place the sheet shouts. Wide tracking rather than a bigger
          size: it has to sit level with the org name, not tower over it. */}
      <p className="shrink-0 pb-[0.5mm] text-[12pt] font-semibold uppercase tracking-[0.22em]">
        {documentTitle}
      </p>
    </header>
  )
}
