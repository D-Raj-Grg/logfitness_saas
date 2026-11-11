'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, ImageUp, Save, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import {
  createCardStockRangeForPrint,
  deleteCardDesign,
  getBatchPrintCards,
  saveCardDesign,
} from '@/app/(app)/cards/designer/actions'
import { CardEditor } from '@/components/cards/card-editor'
import { DesignGallery } from '@/components/cards/design-gallery'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { balanceLink } from '@/lib/cards/balance-link'
import {
  CARD_PAGES,
  CARD_PAGE_KEYS,
  DEFAULT_PLACEMENT,
  templateAspectWarning,
  type CardPageKey,
  type CardPlacement,
} from '@/lib/cards/card-design'
import { CARD_NO_MAX, CARD_NO_MIN, cardLabel, formatCardNo } from '@/lib/cards/card-no'
import { buildCardPdf, type CardTemplate } from '@/lib/cards/card-pdf'
import { sampleCardToken, type PrintCard } from '@/lib/cards/card-token'
import { ALLOWED_TEMPLATE_TYPES, MAX_TEMPLATE_BYTES, removeUploadedTemplate, uploadCardTemplate } from '@/lib/cards/template-upload'
import { formatDate } from '@/lib/format'
import { MAX_CARDS_PER_RUN } from '@/lib/validation/card-designs'

/** A saved design, with a signed link to its picture. */
export type StudioDesign = {
  id: string
  name: string
  imagePath: string
  /** Signed link to the picture; null when signing failed on this load. */
  url: string | null
  width: number
  height: number
  placement: CardPlacement
  labelPrefix: string
}

/** A past print run. */
export type StudioBatch = {
  id: string
  fromNo: number
  toNo: number
  designId: string | null
  createdAt: string
}

type Template = CardTemplate & { name: string; url: string }

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30'

function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/** Read a picture into bytes + pixel size; null (and a toast) when it isn't usable. */
async function loadTemplate(file: File): Promise<Template | null> {
  if (!ALLOWED_TEMPLATE_TYPES.includes(file.type)) {
    toast.error('Use a JPEG or PNG picture.')
    return null
  }
  if (file.size > MAX_TEMPLATE_BYTES) {
    toast.error('The picture must be under 5 MB.')
    return null
  }
  const url = URL.createObjectURL(file)
  const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
  if (!size) {
    URL.revokeObjectURL(url)
    toast.error("That picture couldn't be read.")
    return null
  }
  return { bytes: await file.arrayBuffer(), type: file.type, width: size.w, height: size.h, name: file.name, url }
}

export function CardStudio({
  orgId,
  designs,
  batches,
  nextFreeCardNo,
  linkBase,
}: {
  orgId: string
  designs: StudioDesign[]
  batches: StudioBatch[]
  nextFreeCardNo: number
  /** Where the QR sends a phone; the card number is appended. */
  linkBase: string
}) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)

  const [template, setTemplate] = useState<Template | null>(null)
  const [placement, setPlacement] = useState<CardPlacement>(DEFAULT_PLACEMENT)
  const [labelPrefix, setLabelPrefix] = useState('NO.')
  const [page, setPage] = useState<CardPageKey>('cr80')
  // The saved design in use, its name, whether it differs from what is saved,
  // and the picture picked this session (only that is uploaded on Save).
  const [designId, setDesignId] = useState<string | null>(null)
  const [designName, setDesignName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [loadingDesign, setLoadingDesign] = useState(false)
  const [saving, startSaving] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [from, setFrom] = useState(String(nextFreeCardNo))
  const [to, setTo] = useState(String(Math.min(nextFreeCardNo + 99, CARD_NO_MAX)))
  const [numbering, startNumbering] = useTransition()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const fromNo = Number(from)
  const toNo = Number(to)
  const rangeProblem: string | null =
    !Number.isInteger(fromNo) || !Number.isInteger(toNo)
      ? 'Enter whole numbers.'
      : fromNo < CARD_NO_MIN || toNo > CARD_NO_MAX
        ? `Card numbers run from ${CARD_NO_MIN} to ${CARD_NO_MAX}.`
        : toNo < fromNo
          ? 'From must not be after To.'
          : toNo - fromNo + 1 > MAX_CARDS_PER_RUN
            ? `Number at most ${MAX_CARDS_PER_RUN} cards at a time.`
            : null
  const count = rangeProblem ? 0 : toNo - fromNo + 1

  const sample = cardLabel(4, labelPrefix)
  // Each real card gets its own random token from the database; the preview
  // shows a token-shaped placeholder so the sample QR has the printed density.
  const sampleLink = balanceLink(
    linkBase,
    sampleCardToken(fromNo >= CARD_NO_MIN && fromNo <= CARD_NO_MAX ? fromNo : 1)
  )
  const aspectWarning = template ? templateAspectWarning(template.width, template.height, page) : null
  const exporting = progress !== null
  const busy = saving || numbering || exporting || loadingDesign
  const canSave = template !== null && designName.trim().length > 0 && !busy
  // Numbering writes the run against the design, so the design must exist as
  // saved: a later "Download again" has to reproduce exactly what was printed.
  const designReady = template !== null && designId !== null && !dirty
  const canNumber = designReady && !rangeProblem && !busy

  /** Bring a saved design back: its picture, placement and prefix. */
  async function loadDesign(d: StudioDesign) {
    if (!d.url) {
      toast.error("This design's picture couldn't be loaded. Reload the page and try again.")
      return
    }
    setLoadingDesign(true)
    try {
      const res = await fetch(d.url)
      if (!res.ok) throw new Error("The saved picture couldn't be loaded.")
      const blob = await res.blob()
      const t = await loadTemplate(new File([blob], d.name, { type: blob.type || 'image/jpeg' }))
      if (!t) return
      setTemplate((old) => {
        if (old) URL.revokeObjectURL(old.url)
        return t
      })
      setPlacement(d.placement)
      setLabelPrefix(d.labelPrefix)
      setDesignId(d.id)
      setDesignName(d.name)
      setPendingFile(null)
      setDirty(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The saved picture couldn't be loaded.")
    } finally {
      setLoadingDesign(false)
    }
  }

  /** Back to the gallery: drop the loaded picture so another design or a new upload can be chosen. */
  function leaveDesign() {
    if (template) URL.revokeObjectURL(template.url)
    setTemplate(null)
    setDesignId(null)
    setDesignName('')
    setPendingFile(null)
    setDirty(false)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    const t = await loadTemplate(file)
    if (!t) return
    if (template) URL.revokeObjectURL(template.url)
    setTemplate(t)
    setPendingFile(file)
    setDirty(true)
    if (!designName) setDesignName(file.name.replace(/\.[^.]+$/, ''))
    if (!designId) setPlacement(DEFAULT_PLACEMENT)
  }

  function update(next: CardPlacement) {
    setPlacement(next)
    setDirty(true)
  }

  /**
   * Upload the picture from the browser when a new one was picked, then save
   * the row. A refused save removes the fresh upload; the action removes the
   * previous picture once the row points at the new one.
   */
  function save() {
    if (!template) return
    startSaving(async () => {
      let imagePath = designs.find((d) => d.id === designId)?.imagePath ?? null
      if (pendingFile || !imagePath) {
        try {
          imagePath = await uploadCardTemplate(pendingFile ?? new File([template.bytes], template.name, { type: template.type }), orgId)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "The picture didn't upload.")
          return
        }
      }
      const res = await saveCardDesign({
        id: designId,
        name: designName,
        imagePath,
        width: template.width,
        height: template.height,
        placement,
        labelPrefix,
      })
      if ('error' in res) {
        if (pendingFile) await removeUploadedTemplate(imagePath)
        toast.error(res.error)
        return
      }
      setDesignId(res.id)
      setPendingFile(null)
      setDirty(false)
      toast.success('Design saved.')
      router.refresh()
    })
  }

  function remove() {
    if (!designId) return
    startSaving(async () => {
      const res = await deleteCardDesign({ id: designId })
      if ('error' in res) toast.error(res.error)
      else {
        toast.success('Design deleted. Cards already numbered are untouched.')
        leaveDesign()
        router.refresh()
      }
      setDeleteOpen(false)
    })
  }

  /**
   * Build the PDF for `cards` (number + the random token each QR carries) in
   * the browser and save it. `reserved` is set right after numbering: the
   * database already holds those cards, so a build failure must say so rather
   * than invite a second run of the same numbers.
   */
  async function exportPdf(cards: PrintCard[], reserved = false) {
    if (!template || cards.length === 0) return
    setProgress({ done: 0, total: cards.length })
    try {
      const bytes = await buildCardPdf({
        template,
        placement,
        cards,
        labelPrefix,
        linkBase,
        page,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const first = cards[0].cardNo
      const last = cards[cards.length - 1].cardNo
      download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `cards-${formatCardNo(first)}-${formatCardNo(last)}.pdf`)
      toast.success(`${cards.length} card${cards.length === 1 ? '' : 's'} ready.`)
    } catch (e) {
      const why = e instanceof Error ? e.message : "The PDF couldn't be built."
      if (reserved) {
        const a = cards[0].cardNo
        const b = cards[cards.length - 1].cardNo
        toast.error(
          `${why} Cards ${cardLabel(a, labelPrefix)}–${cardLabel(b, labelPrefix)} are now reserved; use Download again below to get the PDF.`
        )
      } else {
        toast.error(why)
      }
    } finally {
      setProgress(null)
    }
  }

  /** Number the run in the database first, then render the PDF for exactly those numbers. */
  function numberAndDownload() {
    if (!canNumber) return
    startNumbering(async () => {
      const res = await createCardStockRangeForPrint({ from: fromNo, to: toNo, designId })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      router.refresh()
      const next = res.cards[res.cards.length - 1].cardNo + 1
      setFrom(String(next))
      setTo(String(Math.min(next + 99, CARD_NO_MAX)))
      await exportPdf(res.cards, true)
    })
  }

  /** "Download again": fetch the run's tokens (immutable), then rebuild the same PDF. */
  async function downloadBatch(batchId: string, count: number) {
    setProgress({ done: 0, total: count })
    const res = await getBatchPrintCards({ batchId })
    if ('error' in res) {
      setProgress(null)
      toast.error(res.error)
      return
    }
    await exportPdf(res.cards)
  }

  return (
    <div className="flex flex-col gap-6">
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Card design</CardTitle>
          <CardDescription>
            A picture of your card with a box for the number and a box for the QR. Drag a box to
            move it, drag its corner to resize.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!template ? (
            <DesignGallery
              designs={designs}
              activeId={designId}
              loading={loadingDesign}
              onPick={(d) => void loadDesign(d)}
              onUpload={() => fileInput.current?.click()}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={leaveDesign} disabled={busy}>
                  Choose a different design
                </Button>
                <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
                  <ImageUp />
                  Replace picture
                </Button>
                <span className="text-sm text-muted-foreground">
                  {template.name} · {template.width}×{template.height}px
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,32rem)_1fr]">
                <CardEditor
                  imageUrl={template.url}
                  imageW={template.width}
                  imageH={template.height}
                  placement={placement}
                  onChange={update}
                  sampleLabel={sample}
                  payload={sampleLink}
                />

                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="card-code-color">Number colour</Label>
                      <Input
                        id="card-code-color"
                        type="color"
                        value={placement.codeColor}
                        onChange={(e) => update({ ...placement, codeColor: e.target.value })}
                        className="p-1"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="card-qr-color">QR colour</Label>
                      <Input
                        id="card-qr-color"
                        type="color"
                        value={placement.qrColor}
                        onChange={(e) => update({ ...placement, qrColor: e.target.value })}
                        className="p-1"
                      />
                      <p className="text-xs text-muted-foreground">Keep it dark on a light square so phones read it.</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="card-code-size">Number size</Label>
                      <input
                        id="card-code-size"
                        type="range"
                        min={0.3}
                        max={1}
                        step={0.05}
                        value={placement.codeScale}
                        aria-valuetext={`${Math.round(placement.codeScale * 100)}% of the box height`}
                        onChange={(e) => update({ ...placement, codeScale: Number(e.target.value) })}
                        className="h-9 w-full"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="card-qr-inset">QR margin</Label>
                      <input
                        id="card-qr-inset"
                        type="range"
                        min={0}
                        max={0.15}
                        step={0.01}
                        value={placement.qrInset}
                        aria-valuetext={`${Math.round(placement.qrInset * 100)}% of the QR side`}
                        onChange={(e) => update({ ...placement, qrInset: Number(e.target.value) })}
                        className="h-9 w-full"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="card-prefix">Label prefix</Label>
                      <Input
                        id="card-prefix"
                        value={labelPrefix}
                        maxLength={8}
                        placeholder="NO."
                        onChange={(e) => {
                          setLabelPrefix(e.target.value)
                          setDirty(true)
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Printed as <span className="font-mono">{sample}</span>. Leave it empty for the bare number.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="card-page">Page size</Label>
                      <select
                        id="card-page"
                        className={selectClass}
                        value={page}
                        onChange={(e) => setPage(e.target.value as CardPageKey)}
                      >
                        {CARD_PAGE_KEYS.map((key) => (
                          <option key={key} value={key}>
                            {CARD_PAGES[key].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {aspectWarning ? (
                    <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>{aspectWarning}</span>
                    </p>
                  ) : null}

                  <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    Cards link to: <span className="font-mono break-all">{sampleLink}</span>
                    <br />
                    Each card gets its own random code after the <code>c=</code>, so a card number
                    on its own opens nothing.
                    <br />
                    <Link href="/settings" className="underline underline-offset-4">
                      Change in Settings
                    </Link>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="card-design-name">Design name</Label>
                    <Input
                      id="card-design-name"
                      value={designName}
                      onChange={(e) => {
                        setDesignName(e.target.value)
                        setDirty(true)
                      }}
                      maxLength={80}
                      placeholder="Blue front"
                    />
                    <p className="text-xs text-muted-foreground">
                      {designId && !dirty
                        ? 'Saved. Any device or login can use it.'
                        : designId
                          ? 'Unsaved changes.'
                          : "Not saved yet. Save it so you don't have to upload again."}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={!canSave} onClick={save}>
                      <Save />
                      {saving ? 'Saving…' : 'Save design'}
                    </Button>
                    {designId ? (
                      <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteOpen(true)}>
                        <Trash2 />
                        Delete design
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Number cards and print</CardTitle>
          <CardDescription>
            Each number becomes a card in your stock the moment the PDF is made, so no two runs
            can share a number. Up to {MAX_CARDS_PER_RUN} cards at a time.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid max-w-md grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="card-from">From</Label>
              <Input
                id="card-from"
                type="number"
                inputMode="numeric"
                min={CARD_NO_MIN}
                max={CARD_NO_MAX}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="card-to">To</Label>
              <Input
                id="card-to"
                type="number"
                inputMode="numeric"
                min={CARD_NO_MIN}
                max={CARD_NO_MAX}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {rangeProblem ??
              `${count} card${count === 1 ? '' : 's'}: ${cardLabel(fromNo, labelPrefix)} to ${cardLabel(toNo, labelPrefix)}.`}
            {!template
              ? ' Pick or upload a design first.'
              : !designReady
                ? ' Save the design first.'
                : ''}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!canNumber} onClick={numberAndDownload}>
              <Download />
              {numbering ? 'Numbering…' : 'Number cards and download PDF'}
            </Button>
            {exporting ? (
              <div role="status" aria-live="polite" className="flex min-w-48 flex-1 flex-col gap-1">
                <progress className="h-2 w-full" value={progress.done} max={progress.total} />
                <span className="text-sm text-muted-foreground tabular-nums">
                  Building card {progress.done} of {progress.total}…
                </span>
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Print one card and scan its QR before printing the whole run.
          </p>

          {batches.length > 0 ? (
            <div className="flex flex-col gap-2 border-t pt-4">
              <h3 className="text-sm font-semibold">Download again</h3>
              <p className="text-xs text-muted-foreground">
                Re-renders a past run with the design and page size loaded above.
              </p>
              <ul className="divide-y rounded-lg border text-sm">
                {batches.map((b) => {
                  const design = b.designId ? designs.find((d) => d.id === b.designId) : undefined
                  const designLabel = !b.designId
                    ? 'No saved design for this run'
                    : (design?.name ?? 'deleted design')
                  // Only the run's own design reproduces what was printed.
                  const loaded = template !== null && designId !== null && designId === b.designId
                  const why = !b.designId
                    ? 'No saved design for this run'
                    : !design
                      ? 'The design this run used was deleted'
                      : !loaded
                        ? `Load design ${design.name} first`
                        : undefined
                  return (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        <span className="font-medium tabular-nums">
                          {formatCardNo(b.fromNo)}–{formatCardNo(b.toNo)}
                        </span>
                        <span className="text-muted-foreground">
                          {' '}· {b.toNo - b.fromNo + 1} cards · {formatDate(b.createdAt)} · {designLabel}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!loaded || busy}
                        title={why}
                        onClick={() => void downloadBatch(b.id, b.toNo - b.fromNo + 1)}
                      >
                        <Download />
                        PDF
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {designName || 'this design'}?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved picture and its placement are removed. Cards already numbered with it stay
              in your stock, but you will need a design again to print more.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete design</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
