import { documentStrings } from '@/lib/print/strings'

export type SavingsItem = { label: string; amountPaisa: number }

/**
 * One figure for everything the member did not pay.
 *
 * The two credits sit in different parts of the arithmetic -- the registration
 * fee comes off inside the subtotal, the discount comes off after it -- and
 * that split is correct, because it is what the invoice constraints say. It is
 * also not something a member should have to reconstruct. So the table keeps
 * the accounting and this keeps the story.
 *
 * Outlined, not filled: the balance-due chip is the only fill on the sheet,
 * and a second one beside it would compete with the number that matters. It
 * also means the banner reads identically whether or not backgrounds print.
 *
 * Renders nothing at all when there is nothing to say -- never "You saved 0".
 */
export function SavingsBanner({
  items,
  formatAmount,
}: {
  items: SavingsItem[]
  formatAmount: (paisa: number) => string
}) {
  const t = documentStrings()
  const real = items.filter((item) => item.amountPaisa > 0)
  const total = real.reduce((sum, item) => sum + item.amountPaisa, 0)

  if (total <= 0) return null

  return (
    <section className="avoid-break mt-[6mm] flex items-baseline justify-between gap-6 border border-[color:var(--ink)] px-[4mm] py-[2.5mm]">
      <p className="text-[8pt] font-medium uppercase tracking-[0.14em]">{t.youSaved}</p>

      <div className="flex items-baseline gap-[4mm]">
        {/* With one credit the total already states the amount, so repeating
            it beside the label reads as a stutter -- name it and stop. Two or
            more have to be itemised or the total looks unexplained. */}
        <p className="text-[9pt] text-[color:var(--muted)]">
          {real.length === 1
            ? real[0].label
            : real
                .map((item) => `${item.label} ${formatAmount(item.amountPaisa)}`)
                .join('  ·  ')}
        </p>
        <p className="text-[13pt] font-semibold tabular-nums">{formatAmount(total)}</p>
      </div>
    </section>
  )
}
