import { requireStaff } from '@/lib/auth'

/**
 * Documents render outside the console shell on purpose. Under app/(app) the
 * sidebar and header would still mount and hydrate, and -- the part that
 * matters -- the on-screen preview would show app chrome, so nobody could check
 * the A4 sheet before printing it. Here, what you see is what prints.
 *
 * The middleware only proves a session exists, so this layout does the staff
 * check that app/(app)/layout.tsx does for the rest of the console.
 */
export default async function PrintLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireStaff()

  return (
    <div className="min-h-full bg-neutral-200 py-6 print:bg-white print:py-0">
      {children}
    </div>
  )
}
