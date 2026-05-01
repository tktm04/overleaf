import { FC, useCallback, useEffect, useRef, useState } from 'react'
import PDFJSWrapper from '../util/pdf-js-wrapper'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { postJSON } from '@/infrastructure/fetch-json'
import { v4 as uuid } from 'uuid'

// PDF text-selection commenting:
//   1. Watches selection inside a PDF.js text-layer.
//   2. Renders a floating "Comment here" button above the selection.
//   3. Clicking the button swaps it for an inline modal with a textarea
//      so the user can type the comment without leaving the PDF view.
//   4. Submit creates a thread + posts the first message via the standard
//      /project/:p/thread/:t/messages endpoint. The Claude rail Comments
//      tab picks it up via socket events and auto-reviews it.
//   5. An optional "Jump to source" link triggers SyncTeX so the user can
//      switch to the editor at the corresponding position.

type ButtonPos = { left: number; top: number } | null

function findPageElement(node: Node | null): HTMLElement | null {
  let el = node instanceof Element ? node : node?.parentElement || null
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

type Pending = {
  selectedText: string
  pageNumber: number
  canvas: HTMLCanvasElement | null
  rect: DOMRect
}

export const PdfSelectionComment: FC<{
  pdfJsWrapper: PDFJSWrapper | null
}> = ({ pdfJsWrapper }) => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const [pos, setPos] = useState<ButtonPos>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [mode, setMode] = useState<'button' | 'modal'>('button')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const reset = useCallback(() => {
    setPos(null)
    setPending(null)
    setMode('button')
    setComment('')
    setError(null)
    setSubmitting(false)
  }, [])

  const update = useCallback(() => {
    // Don't recompute while the modal is open — the user is typing in the
    // textarea, which itself fires selectionchange events.
    if (mode === 'modal') return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      reset()
      return
    }
    const range = sel.getRangeAt(0)
    if (!isWithinPdfTextLayer(range.startContainer)) {
      reset()
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      reset()
      return
    }
    const pageEl = findPageElement(range.startContainer)
    if (!pageEl) {
      reset()
      return
    }
    const pageNumber = parseInt(
      pageEl.getAttribute('data-page-number') || '1',
      10
    )
    const canvas = pageEl.querySelector(
      'canvas'
    ) as HTMLCanvasElement | null
    const rect = range.getBoundingClientRect()
    setPending({ selectedText: text, pageNumber, canvas, rect })
    setPos({
      left: rect.left + rect.width / 2,
      top: rect.top - 8 + window.scrollY,
    })
  }, [mode, reset])

  useEffect(() => {
    document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', update, true)
    return () => {
      document.removeEventListener('selectionchange', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [update])

  const openModal = useCallback(() => {
    setMode('modal')
    setError(null)
    requestAnimationFrame(() => taRef.current?.focus())
  }, [])

  const jumpToSource = useCallback(() => {
    if (!pending || !pdfJsWrapper) return
    const { selectedText, pageNumber, canvas, rect } = pending
    if (!canvas) return
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
        detail: { position: clickPosition, selectText: selectedText },
      })
    )
  }, [pending, pdfJsWrapper])

  const submit = useCallback(async () => {
    if (!pending) return
    const text = comment.trim()
    if (!text) return
    setSubmitting(true)
    setError(null)
    const { selectedText, pageNumber } = pending
    const body = `📄 *PDF p.${pageNumber} — selected:* "${selectedText}"\n\n${text}`
    const threadId = uuid()
    try {
      await postJSON(
        `/project/${projectId}/thread/${threadId}/messages`,
        { body: { content: body } }
      )
      // Clear PDF selection on success so the floating button doesn't
      // immediately reappear.
      window.getSelection()?.removeAllRanges()
      reset()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to post comment')
      setSubmitting(false)
    }
  }, [comment, pending, projectId, reset])

  if (!pos) return null

  if (mode === 'modal') {
    return (
      <div
        className="claude-pdf-comment-modal"
        style={{
          left: pos.left,
          top: pos.top,
        }}
      >
        <div className="claude-pdf-comment-modal__quote">
          📄 p.{pending?.pageNumber} — "{pending?.selectedText}"
        </div>
        <textarea
          ref={taRef}
          rows={3}
          className="claude-pdf-comment-modal__textarea"
          placeholder="Add comment…  (⌘/Ctrl + Enter to send)"
          value={comment}
          onChange={e => setComment(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              reset()
            }
          }}
          disabled={submitting}
        />
        {error && (
          <div className="claude-pdf-comment-modal__error">{error}</div>
        )}
        <div className="claude-pdf-comment-modal__actions">
          <button
            type="button"
            className="claude-btn claude-btn--link"
            onClick={jumpToSource}
            disabled={submitting}
          >
            Jump to source
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="claude-btn claude-btn--ghost"
            onClick={reset}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="claude-btn claude-btn--primary"
            onClick={submit}
            disabled={submitting || !comment.trim()}
          >
            {submitting ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onMouseDown={e => {
        e.preventDefault()
      }}
      onClick={openModal}
      className="claude-pdf-comment-button"
      style={{ left: pos.left, top: pos.top }}
    >
      💬 Comment here
    </button>
  )
}
