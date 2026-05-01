import { FC, useCallback, useEffect, useState } from 'react'
import PDFJSWrapper from '../util/pdf-js-wrapper'

// Watches text selection inside a PDF.js text-layer and renders a floating
// "Comment here" button anchored above the selection. On click it asks
// pdfJsWrapper for the proper PDF-coordinate offset (same path the dblclick
// handler uses) and dispatches `synctex:sync-to-position`. Then, after the
// in-editor selection is in place, it dispatches `add-new-review-comment`
// which the existing review-tooltip-menu listens for, so the comment popup
// opens automatically.

type ButtonPos = { left: number; top: number } | null

function findPageElement(node: Node | null): HTMLElement | null {
  let el =
    node instanceof Element ? node : node?.parentElement || null
  while (el) {
    if (el.classList && el.classList.contains('page')) return el
    el = el.parentElement
  }
  return null
}

function isWithinPdfTextLayer(node: Node | null): boolean {
  let el = node instanceof Element ? node : node?.parentElement || null
  while (el) {
    if (
      el.classList &&
      (el.classList.contains('textLayer') ||
        el.classList.contains('textLayerDiv'))
    ) {
      return true
    }
    el = el.parentElement
  }
  return false
}

export const PdfSelectionComment: FC<{
  pdfJsWrapper: PDFJSWrapper | null
}> = ({ pdfJsWrapper }) => {
  const [pos, setPos] = useState<ButtonPos>(null)
  const [pending, setPending] = useState<{
    selectedText: string
    pageNumber: number
    canvas: HTMLCanvasElement | null
    rect: DOMRect
  } | null>(null)

  const update = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPos(null)
      setPending(null)
      return
    }
    const range = sel.getRangeAt(0)
    if (!isWithinPdfTextLayer(range.startContainer)) {
      setPos(null)
      setPending(null)
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      setPos(null)
      setPending(null)
      return
    }
    const pageEl = findPageElement(range.startContainer)
    if (!pageEl) {
      setPos(null)
      setPending(null)
      return
    }
    const pageNumberAttr = pageEl.getAttribute('data-page-number')
    const pageNumber = parseInt(pageNumberAttr || '1', 10)
    const canvas = pageEl.querySelector(
      'canvas'
    ) as HTMLCanvasElement | null
    const rect = range.getBoundingClientRect()
    setPending({ selectedText: text, pageNumber, canvas, rect })
    setPos({
      left: rect.left + rect.width / 2,
      top: rect.top - 8 + window.scrollY,
    })
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', update, true)
    return () => {
      document.removeEventListener('selectionchange', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [update])

  const fire = useCallback(() => {
    if (!pending || !pdfJsWrapper) return
    const { selectedText, pageNumber, canvas, rect } = pending
    if (!canvas) return

    // Use the wrapper's own click-to-PDF-point conversion. We synthesise a
    // MouseEvent at the centre of the selection rectangle so the SyncTeX
    // coordinates match what a real dblclick at the same place would
    // produce.
    const synthetic = {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    } as MouseEvent

    const clickPosition = pdfJsWrapper.clickPosition(
      synthetic,
      canvas,
      pageNumber - 1
    )
    if (!clickPosition) return

    window.dispatchEvent(
      new CustomEvent('synctex:sync-to-position', {
        detail: {
          position: clickPosition,
          selectText: selectedText,
        },
      })
    )
    // Trigger the in-editor "Add comment" popup once the doc + selection
    // are in place. 700ms is enough to absorb the SyncTeX HTTP roundtrip
    // and the doc switch on a local install.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('add-new-review-comment'))
    }, 700)

    setPos(null)
    setPending(null)
    window.getSelection()?.removeAllRanges()
  }, [pending, pdfJsWrapper])

  if (!pos) return null

  return (
    <button
      type="button"
      onMouseDown={e => {
        // Prevent the selection from being cleared before our click handler
        // fires.
        e.preventDefault()
      }}
      onClick={fire}
      className="claude-pdf-comment-button"
      style={{ left: pos.left, top: pos.top }}
    >
      💬 Comment here
    </button>
  )
}
