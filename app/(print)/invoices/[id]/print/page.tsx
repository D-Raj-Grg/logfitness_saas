import { notFound } from 'next/navigation'

import { InvoiceDocument } from '@/components/print/invoice-document'
import { PrintShell } from '@/components/print/print-shell'
import { getInvoiceForPrint } from '@/lib/db/documents'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ auto?: string }>
}

/**
 * Chrome offers document.title as the Save-as-PDF filename, so the invoice
 * number is what lands on disk.
 */
export async function generateMetadata({ params }: Props) {
  const { id } = await params
  const invoice = await getInvoiceForPrint(id)

  return { title: invoice ? invoice.invoice_no : 'Invoice' }
}

export default async function InvoicePrintPage({ params, searchParams }: Props) {
  const { id } = await params
  const { auto } = await searchParams

  // RLS makes another org's invoice invisible, so a miss is a 404 either way.
  const invoice = await getInvoiceForPrint(id)
  if (!invoice) notFound()

  return (
    <PrintShell backHref={`/members/${invoice.member_id}`} auto={auto === '1'}>
      <InvoiceDocument invoice={invoice} />
    </PrintShell>
  )
}
