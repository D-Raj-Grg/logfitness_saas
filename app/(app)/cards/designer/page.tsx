import Link from 'next/link'

import { CardStudio, type StudioBatch, type StudioDesign } from '@/components/cards/card-studio'
import { requireRole } from '@/lib/auth'
import { resolveBalanceBase } from '@/lib/cards/balance-link'
import { DEFAULT_PLACEMENT, placementFrom } from '@/lib/cards/card-design'
import { listCardBatches, listCardDesigns, nextFreeCardNo, signedTemplateUrls } from '@/lib/db/card-designs'
import { getOrgProfile } from '@/lib/db/orgs'
import { siteOrigin } from '@/lib/site-origin'

/** How long a signed template URL stays valid; the page re-signs on every load. */
const TEMPLATE_URL_TTL_SECONDS = 60 * 60

/**
 * Card designer: lay a run of printed numbers and QR codes onto the gym's
 * card picture and download a PDF for the print shop. Numbering the run is
 * a purchasing decision, so the page is owner/manager; the RPCs repeat the
 * check.
 */
export default async function CardDesignerPage() {
  const staff = await requireRole('owner', 'manager')

  const [designRows, batchRows, nextNo, org] = await Promise.all([
    listCardDesigns(),
    listCardBatches(),
    nextFreeCardNo(),
    getOrgProfile(staff.orgId),
  ])

  const urls = await signedTemplateUrls(
    designRows.map((d) => d.image_path),
    TEMPLATE_URL_TTL_SECONDS
  )
  const designs: StudioDesign[] = designRows.flatMap((d) => {
    const url = urls[d.image_path]
    if (!url) return []
    return [
      {
        id: d.id,
        name: d.name,
        imagePath: d.image_path,
        url,
        width: d.width,
        height: d.height,
        placement: placementFrom(d.placement) ?? DEFAULT_PLACEMENT,
        labelPrefix: d.label_prefix,
      },
    ]
  })

  const batches: StudioBatch[] = batchRows.map((b) => ({
    id: b.id,
    fromNo: b.from_no,
    toNo: b.to_no,
    designId: b.design_id,
    createdAt: b.created_at,
  }))

  // balance_url is being added to the settings bag by another step; until the
  // generated types carry it, it is read loosely.
  const settings = org?.settings
  const balanceUrl =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? ((settings as Record<string, unknown>).balance_url as string | null | undefined) ?? null
      : null
  const linkBase = resolveBalanceBase({
    balanceUrl,
    siteOrigin: siteOrigin(),
    orgSlug: org?.slug ?? '',
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Card designer</h1>
        <p className="text-sm text-muted-foreground">
          Lay numbers and QR codes onto your card picture and download a PDF for the
          print shop. Each number becomes a card in{' '}
          <Link href="/cards" className="underline underline-offset-4">
            your card stock
          </Link>
          .
        </p>
      </div>

      <CardStudio
        orgId={staff.orgId}
        designs={designs}
        batches={batches}
        nextFreeCardNo={nextNo}
        linkBase={linkBase}
      />
    </div>
  )
}
