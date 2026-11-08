import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import { balanceLink } from '@/lib/cards/balance-link'
import {
  CARD_PAGES,
  parseHex,
  qrMatrix,
  qrRuns,
  type CardPageKey,
  type CardPlacement,
} from '@/lib/cards/card-design'
import { cardLabel } from '@/lib/cards/card-no'

export type CardTemplate = {
  bytes: ArrayBuffer
  /** `image/jpeg` or `image/png`; anything else is refused before this point. */
  type: string
  /** Pixel size, to turn the placement fractions into page coordinates. */
  width: number
  height: number
}

const PAGES_PER_TICK = 8

/**
 * One page per card, at the chosen card size: the template stretched to the
 * page, the number in its box and the QR in its square. The template is
 * embedded **once** and every page references it, and the QR is vector
 * rectangles -- so 500 cards stay a few MB and print sharp at any size.
 *
 * Yields to the browser every few pages so the progress bar can move.
 */
export async function buildCardPdf(opts: {
  template: CardTemplate
  placement: CardPlacement
  cardNos: number[]
  labelPrefix: string
  /** Where the QR sends a phone; the card number is appended per card. */
  linkBase: string
  page: CardPageKey
  onProgress?: (done: number, total: number) => void
}): Promise<Uint8Array> {
  const { template, placement, cardNos, labelPrefix, linkBase, page, onProgress } = opts
  const size = CARD_PAGES[page]
  const W = size.widthPt
  const H = size.heightPt

  const doc = await PDFDocument.create()
  const image =
    template.type === 'image/png'
      ? await doc.embedPng(template.bytes)
      : await doc.embedJpg(template.bytes)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)

  const codeColor = parseHex(placement.codeColor) ?? [0, 0, 0]
  const qrColor = parseHex(placement.qrColor) ?? [0, 0, 0]

  // Placement fractions -> page points. The picture fills the page.
  const box = placement.code
  const boxX = box.x * W
  const boxW = box.w * W
  const boxH = box.h * H
  const boxY = H - (box.y + box.h) * H

  const side = placement.qr.s * W
  const qrX = placement.qr.x * W
  const qrY = H - placement.qr.y * H - side

  for (let i = 0; i < cardNos.length; i++) {
    const n = cardNos[i]
    const text = cardLabel(n, labelPrefix)
    const pdfPage = doc.addPage([W, H])
    pdfPage.drawImage(image, { x: 0, y: 0, width: W, height: H })

    // Number: as tall as the box allows, shrunk only if it would overflow the width.
    let fontSize = boxH * placement.codeScale
    const widthAt = (s: number) => font.widthOfTextAtSize(text, s)
    if (widthAt(fontSize) > boxW) fontSize = (fontSize * boxW) / widthAt(fontSize)
    pdfPage.drawText(text, {
      x: boxX + (boxW - widthAt(fontSize)) / 2,
      y: boxY + (boxH - font.heightAtSize(fontSize, { descender: false })) / 2,
      size: fontSize,
      font,
      color: rgb(...codeColor),
    })

    // QR: modules fill the square less the inset.
    const m = qrMatrix(balanceLink(linkBase, n))
    const inner = side * (1 - 2 * placement.qrInset)
    const cell = inner / m.size
    const ox = qrX + side * placement.qrInset
    const oy = qrY + side * placement.qrInset + inner // top edge of the grid
    for (const [row, col, len] of qrRuns(m)) {
      pdfPage.drawRectangle({
        x: ox + col * cell,
        y: oy - (row + 1) * cell,
        width: len * cell,
        height: cell,
        color: rgb(...qrColor),
        borderWidth: 0,
      })
    }

    if ((i + 1) % PAGES_PER_TICK === 0 || i === cardNos.length - 1) {
      onProgress?.(i + 1, cardNos.length)
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  return doc.save()
}
