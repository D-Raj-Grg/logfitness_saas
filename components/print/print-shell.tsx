import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { AutoPrint } from '@/components/print/auto-print'
import { PrintButton } from '@/components/print/print-button'
import { Button } from '@/components/ui/button'

/**
 * The page furniture around a document sheet. Everything here is print:hidden,
 * so what stays on paper is exactly what is inside .doc-a4 -- which is also
 * what the user sees on screen, since these routes render outside the console
 * shell.
 */
export function PrintShell({
  backHref,
  backLabel = 'Back to member',
  auto = false,
  children,
}: {
  backHref: string
  backLabel?: string
  auto?: boolean
  children: React.ReactNode
}) {
  return (
    <>
      {auto ? <AutoPrint /> : null}

      <div className="mx-auto mb-4 flex w-[210mm] max-w-full items-center justify-between gap-4 px-2 print:hidden">
        <Button variant="ghost" size="sm" render={<Link href={backHref} />}>
          <ArrowLeft className="size-4" />
          {backLabel}
        </Button>

        <PrintButton />
      </div>

      <article className="doc-a4 shadow-sm print:shadow-none">{children}</article>
    </>
  )
}
