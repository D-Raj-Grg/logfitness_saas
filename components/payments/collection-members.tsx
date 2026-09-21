import Link from 'next/link'

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { dailyCollectionDetail } from '@/lib/db/payments'
import { formatMoney, formatTime } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/members'

type Detail = Awaited<ReturnType<typeof dailyCollectionDetail>>[number]

type Payer = {
  memberId: string
  memberCode: string
  memberName: string
  phone: string | null
  duePaisa: number
  methods: string[]
  /** Reference numbers and invoice numbers, whichever the payment carried. */
  papers: string[]
  firstPaidAt: string
  lastPaidAt: string
  totalPaisa: number
  txnCount: number
}

/**
 * Who paid today, one row per person rather than per transaction.
 *
 * Always visible, never behind an expand. The owner asked to see which members
 * paid, and burying that under a click per collector would make his question
 * cost six clicks on a day with six collectors. The grouped tables above answer
 * "how much"; this answers "from whom".
 *
 * It carries a phone number and a balance because those are the two questions
 * this list provokes -- how do I reach them, and are they square now -- and
 * answering either used to mean opening the member, one at a time.
 *
 * A refund-only member is not a payer and is left out: they appear in the
 * detail lines above, under the collector who gave the money back.
 */
function groupPayers(detail: Detail[]): Payer[] {
  const payers = new Map<string, Payer>()

  for (const row of detail) {
    if (row.kind !== 'payment') continue

    let payer = payers.get(row.member_id)
    if (!payer) {
      payer = {
        memberId: row.member_id,
        memberCode: row.member_code,
        memberName: row.member_name,
        phone: row.member_phone,
        duePaisa: row.member_due_paisa,
        methods: [],
        papers: [],
        firstPaidAt: row.paid_at,
        lastPaidAt: row.paid_at,
        totalPaisa: 0,
        txnCount: 0,
      }
      payers.set(row.member_id, payer)
    }

    const method = PAYMENT_METHOD_LABELS[row.method]
    if (!payer.methods.includes(method)) payer.methods.push(method)

    const paper = row.invoice_no ?? row.reference_no
    if (paper && !payer.papers.includes(paper)) payer.papers.push(paper)

    // The detail arrives ordered by method then time, not time alone, so the
    // window has to be widened rather than assumed from the first row.
    if (row.paid_at < payer.firstPaidAt) payer.firstPaidAt = row.paid_at
    if (row.paid_at > payer.lastPaidAt) payer.lastPaidAt = row.paid_at

    payer.totalPaisa += row.amount_paisa
    payer.txnCount += 1
  }

  return [...payers.values()].sort((a, b) => b.totalPaisa - a.totalPaisa)
}

export function CollectionMembers({ detail }: { detail: Detail[] }) {
  const payers = groupPayers(detail)

  if (payers.length === 0) return null

  const total = payers.reduce((sum, payer) => sum + payer.totalPaisa, 0)
  const owed = payers.reduce((sum, payer) => sum + payer.duePaisa, 0)

  return (
    <section className="flex flex-col gap-2 print:break-before-page">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Members who paid ({payers.length})</h2>
        <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Still owed</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {payers.map((payer) => (
            <TableRow key={payer.memberId} className="avoid-break">
              <TableCell>
                <Link
                  href={`/members/${payer.memberId}`}
                  className="font-medium hover:underline"
                >
                  {payer.memberName}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {payer.memberCode}
                </span>
              </TableCell>

              <TableCell className="text-sm tabular-nums">
                {payer.phone ?? <span className="text-muted-foreground">--</span>}
              </TableCell>

              <TableCell className="text-sm tabular-nums">
                {formatTime(payer.firstPaidAt)}
                {payer.txnCount > 1 ? (
                  <span className="block text-xs text-muted-foreground">
                    {payer.txnCount} payments to {formatTime(payer.lastPaidAt)}
                  </span>
                ) : null}
              </TableCell>

              <TableCell className="text-sm">{payer.methods.join(', ')}</TableCell>

              <TableCell className="text-xs text-muted-foreground">
                {payer.papers.length > 0 ? payer.papers.join(', ') : '--'}
              </TableCell>

              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(payer.totalPaisa)}
              </TableCell>

              {/* Everything they still owe, not just what this invoice left --
                  a member who cleared one bill while another runs is not square. */}
              <TableCell className="text-right tabular-nums">
                {payer.duePaisa > 0 ? (
                  <span className="font-medium text-destructive">
                    {formatMoney(payer.duePaisa)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>

        <TableFooter className="print:table-footer-group">
          <TableRow>
            <TableCell colSpan={5}>
              {payers.length} member{payers.length === 1 ? '' : 's'}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {formatMoney(total)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {owed > 0 ? (
                <span className="font-semibold text-destructive">{formatMoney(owed)}</span>
              ) : (
                <span className="text-muted-foreground">--</span>
              )}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </section>
  )
}
