'use client'

import { useEffect, useRef, useState } from 'react'

import { lookupCardStock, type CardStockLookup } from '@/app/(app)/cards/actions'
import { parseCardNo } from '@/lib/cards/card-no'

const DEBOUNCE_MS = 250

/**
 * The printed-number field and what the database says about it, a moment
 * after the desk stops typing. `lookup` is null while the text is not a
 * number at all, else the answer for the last text that was. A stale answer
 * never lands on newer text.
 */
export function useCardStockLookup() {
  const [text, setTextState] = useState('')
  const [lookup, setLookup] = useState<CardStockLookup | null>(null)
  const [pending, setPending] = useState(false)
  const requestId = useRef(0)

  // The synchronous part of a change lives here, not in the effect: a field
  // that stops being a number drops its old answer at once.
  function setText(next: string) {
    setTextState(next)
    requestId.current += 1
    const isNumber = parseCardNo(next) !== null
    setPending(isNumber)
    if (!isNumber) setLookup(null)
  }

  function reset() {
    setText('')
  }

  useEffect(() => {
    if (parseCardNo(text) === null) return
    const id = requestId.current
    const timer = setTimeout(async () => {
      try {
        const result = await lookupCardStock(text)
        if (id === requestId.current) setLookup(result)
      } catch {
        if (id === requestId.current) setLookup(null)
      } finally {
        if (id === requestId.current) setPending(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  return { text, setText, lookup, pending, reset }
}
