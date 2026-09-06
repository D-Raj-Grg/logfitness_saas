import { notFound } from 'next/navigation'

import { PrintShell } from '@/components/print/print-shell'
import { ReceiptDocument } from '@/components/print/receipt-document'
import { getPaymentForPrint } from '@/lib/db/documents'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ auto?: string }>
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params
  const payment = await getPaymentForPrint(id)

  if (!payment) return { title: 'Receipt' }

  const prefix = payment.kind === 'refund' ? 'Refund' : 'Receipt'
  return { title: `${prefix} ${payment.id.slice(0, 8).toUpperCase()}` }
}

export default async function ReceiptPrintPage({ params, searchParams }: Props) {
  const { id } = await params
  const { auto } = await searchParams

  // payments is branch-scoped by RLS, so a payment taken at a branch the caller
  // does not cover is simply not there -- a 404, not a blank document.
  const payment = await getPaymentForPrint(id)
  if (!payment) notFound()

  return (
    <PrintShell backHref={`/members/${payment.member_id}`} auto={auto === '1'}>
      <ReceiptDocument payment={payment} />
    </PrintShell>
  )
}
