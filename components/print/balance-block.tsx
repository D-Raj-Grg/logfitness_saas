import { documentStrings } from '@/lib/print/strings'

/**
 * What the member still owes, set so it cannot be missed.
 *
 * The construction matters. The label is a filled black chip carrying
 * .print-exact; the amount is large black type on white over a heavy rule.
 * Chrome does honour print-color-adjust even with "Background graphics"
 * unchecked, but the number is never allowed to depend on that -- white text
 * on a dropped fill is an invisible amount owed, which is the one failure this
 * document cannot have. The fill is emphasis. The rule and the size are the
 * emphasis that survives.
 */
export function BalanceBlock({
  duePaisa,
  formatAmount,
}: {
  duePaisa: number
  formatAmount: (paisa: number) => string
}) {
  const t = documentStrings()

  if (duePaisa === 0) {
    return (
      <section className="avoid-break mt-[6mm] flex items-center justify-end">
        <p className="border border-[color:var(--ink)] px-[3mm] py-[1.2mm] text-[9pt] font-semibold uppercase tracking-[0.14em]">
          {t.paidInFull}
        </p>
      </section>
    )
  }

  const isCredit = duePaisa < 0

  return (
    <section className="avoid-break mt-[6mm] flex items-end justify-end gap-[6mm]">
      <p className="print-exact bg-[color:var(--ink)] px-[3mm] py-[1.4mm] text-[9pt] font-semibold uppercase tracking-[0.14em] text-white">
        {isCredit ? t.creditBalance : t.balanceDue}
      </p>

      <p className="min-w-[45mm] border-b-[2.5pt] border-[color:var(--ink)] pb-[1.5mm] text-right text-[20pt] font-semibold leading-none tabular-nums">
        {formatAmount(Math.abs(duePaisa))}
      </p>
    </section>
  )
}
