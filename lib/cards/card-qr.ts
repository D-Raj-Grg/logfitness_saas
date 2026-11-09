import QRCode from 'qrcode'

/**
 * QR geometry for the card editor and the PDF. Kept apart from
 * lib/cards/card-design.ts so the server page, which only needs the placement
 * types and defaults, does not bundle the qrcode library: import this from
 * "use client" modules only.
 */

export type QrMatrix = { size: number; dark: (row: number, col: number) => boolean }

/**
 * The QR as a module grid. Error correction M: a card in a wallet gets
 * scuffed, and M survives that without making the square dense enough to need
 * more room than a card has.
 */
export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const { size, data } = qr.modules
  return { size, dark: (r, c) => data[r * size + c] === 1 }
}

/**
 * Horizontal runs of dark modules, as `[row, startCol, length]`. One
 * rectangle per run rather than per module keeps a 500-page PDF light.
 */
export function qrRuns(m: QrMatrix): [row: number, col: number, len: number][] {
  const runs: [number, number, number][] = []
  for (let r = 0; r < m.size; r++) {
    let start = -1
    for (let c = 0; c <= m.size; c++) {
      const on = c < m.size && m.dark(r, c)
      if (on && start < 0) start = c
      if (!on && start >= 0) {
        runs.push([r, start, c - start])
        start = -1
      }
    }
  }
  return runs
}
