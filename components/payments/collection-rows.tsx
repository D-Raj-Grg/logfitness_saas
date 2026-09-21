'use client'

import { useId, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * One collector's block of the drawer sheet, with the payments behind it
 * foldable.
 *
 * It carries no data and touches none of the rows it is given. The sheet stays
 * a server component and renders every row -- the per-method lines, the detail
 * lines, the member links, the receipt links -- on the server, handing them
 * here as already-rendered nodes. Nothing crosses the boundary but JSX, so no
 * payment detail is serialised into the client bundle and no formatting helper
 * is pulled client-side.
 *
 * Folding is a single data attribute on the <tbody>, with the actual hiding
 * done in CSS against `tr[data-detail]` (see app/globals.css). The obvious
 * alternative -- Children.map + cloneElement to add a class to each row -- was
 * tried first and rejected: it rebuilds the child elements on every toggle,
 * which React DevTools flags ("The children should not have changed if we pass
 * in the same set"), and the rows here never need to change at all. Only their
 * visibility does, and that is CSS's job.
 *
 * The rows stay mounted rather than being unmounted, so expanding is instant
 * and the print rule can reveal them all regardless of what anybody clicked.
 * The paper is the complete record; the screen is the interactive one.
 *
 * Not shadcn's Collapsible: CollapsibleContent renders a <div>, which is not a
 * legal child of <tbody>. Every accordion primitive has the same problem.
 */
export function ExpandableCollector({
  label,
  methodRows,
  detailRows,
  subtotalCells,
  detailCount,
}: {
  label: string
  methodRows: React.ReactNode
  /** Each row must carry `data-detail` for the fold rule to find it. */
  detailRows: React.ReactNode
  /** The three right-hand cells of the subtotal row; the first is the toggle. */
  subtotalCells: React.ReactNode
  detailCount: number
}) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <tbody id={id} data-open={open}>
      {methodRows}
      {detailRows}
      <tr className="border-b bg-muted/30">
        <td className="p-2 align-middle text-sm font-medium">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={id}
            className="flex items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-ring"
          >
            {open ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground print:hidden" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground print:hidden" />
            )}
            <span>{label} subtotal</span>
            <span className="sr-only">
              {open
                ? `Hide the ${detailCount} payments behind this`
                : `Show the ${detailCount} payments behind this`}
            </span>
          </button>
        </td>
        {subtotalCells}
      </tr>
    </tbody>
  )
}
