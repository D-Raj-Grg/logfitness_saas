import { notFound } from 'next/navigation'

/**
 * A development-only harness for the printed documents.
 *
 * The real print routes sit behind requireStaff() and read one invoice from
 * the database, which makes "does the redesign hold up when the fee was
 * charged rather than taken off, and the invoice is part paid, and the org has
 * no logo?" a matter of hunting for a row that happens to be in that state.
 * This renders every state side by side from fixtures instead.
 *
 * It 404s outside development. It is a design tool, not a feature.
 */
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()

  return <div className="min-h-full bg-neutral-200 py-6 print:bg-white print:py-0">{children}</div>
}
