/**
 * Rows to CSV text.
 *
 * A leading =, +, - or @ is prefixed with a single quote. A gym's report is
 * opened in Excel by whoever asked for it, and a member called "=cmd|..." is
 * a formula there unless something stops it being one. The quote is visible in
 * the cell and harmless in every other reader.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = String(value)
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${guarded.replace(/"/g, '""')}"`
}

export function toCsv(
  rows: Record<string, unknown>[],
  columns: { key: string; header: string }[]
): string {
  const head = columns.map((column) => escapeCell(column.header)).join(',')
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(row[column.key])).join(',')
  )
  // \r\n, because the audience is Excel.
  return [head, ...body].join('\r\n')
}
