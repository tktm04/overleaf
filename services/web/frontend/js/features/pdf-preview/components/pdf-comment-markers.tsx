import { FC, useCallback, useEffect, useRef, useState } from 'react'
import PDFJSWrapper from '../util/pdf-js-wrapper'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { useConnectionContext } from '@/features/ide-react/context/connection-context'
import { getJSON } from '@/infrastructure/fetch-json'

// Renders simple highlight overlays on PDF pages for every unresolved
// comment thread whose first message contains a quotable phrase. The
// overlay is just a span absolutely positioned over the matching text in
// the PDF.js text layer — clicking it navigates to the corresponding
// source line via SyncTeX.

type Message = {
  id: string
  user_id: string
  content: string
}
type Thread = {
  messages: Message[]
  resolved?: boolean
}
type ThreadsResponse = Record<string, Thread>

function deriveAnchorText(thread: Thread): string | null {
  // 1) Look for a "PDF p.X — selected: \"...\"" header that the inline
  //    PDF comment modal embeds — it captures the original selection.
  for (const m of thread.messages || []) {
    const c = m?.content || ''
    const sel = c.match(
      /^📄[^\n]*selected:[^\n]*"([^"]+)"/i
    )
    if (sel) return sel[1]
  }
  // 2) Fall back to the first non-Claude, non-empty user message body
  //    if it's short enough to match unambiguously.
  for (const m of thread.messages || []) {
    const c = (m?.content || '').replace(/^🤖[\s\S]+$/, '').trim()
    if (!c) continue
    if (c.startsWith('🤖')) continue
    // Very short snippets are too ambiguous; very long ones won't match.
    if (c.length < 8 || c.length > 120) continue
    return c
  }
  return null
}

type Marker = {
  threadId: string
  range: Range
}

function findMatchesInTextLayer(
  textLayer: HTMLElement,
  anchor: string
): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(
    textLayer,
    NodeFilter.SHOW_TEXT
  )
  let node = walker.nextNode() as Text | null
  while (node) {
    const text = node.nodeValue || ''
    let from = 0
    while (true) {
      const idx = text.indexOf(anchor, from)
      if (idx === -1) break
      const range = document.createRange()
      try {
        range.setStart(node, idx)
        range.setEnd(node, Math.min(idx + anchor.length, text.length))
        ranges.push(range)
      } catch {
        // ignore degenerate ranges
      }
      from = idx + anchor.length
    }
    node = walker.nextNode() as Text | null
  }
  return ranges
}

export const PdfCommentMarkers: FC<{
  pdfJsWrapper: PDFJSWrapper | null
}> = ({ pdfJsWrapper }) => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const { socket } = useConnectionContext() as {
    socket?: {
      on: (e: string, h: (...a: unknown[]) => void) => void
      removeListener: (e: string, h: (...a: unknown[]) => void) => void
    }
  }
  const [threads, setThreads] = useState<ThreadsResponse>({})
  const layerRefs = useRef<Map<HTMLElement, () => void>>(new Map())

  const refresh = useCallback(async () => {
    try {
      const res = (await getJSON(
        `/project/${projectId}/threads`
      )) as ThreadsResponse
      setThreads(res || {})
    } catch {
      // ignore — Claude rail handles errors prominently
    }
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!socket) return
    const handler = () => refresh()
    socket.on('new-comment', handler)
    socket.on('resolve-thread', handler)
    socket.on('reopen-thread', handler)
    socket.on('delete-thread', handler)
    return () => {
      socket.removeListener('new-comment', handler)
      socket.removeListener('resolve-thread', handler)
      socket.removeListener('reopen-thread', handler)
      socket.removeListener('delete-thread', handler)
    }
  }, [socket, refresh])

  // Re-render markers whenever threads or pdf wrapper change. We hook into
  // textlayerrendered so each page is decorated as it becomes available;
  // pages also re-render on zoom, which clears and re-emits the event.
  useEffect(() => {
    if (!pdfJsWrapper) return

    const cleanupAll = () => {
      for (const cleanup of layerRefs.current.values()) cleanup()
      layerRefs.current.clear()
    }

    const decorate = (textLayerDiv: HTMLElement) => {
      // Remove our previous markers on this layer if any.
      const prior = layerRefs.current.get(textLayerDiv)
      if (prior) prior()
      const overlays: HTMLElement[] = []

      const pageEl = textLayerDiv.closest('.page') as HTMLElement | null
      if (!pageEl) {
        layerRefs.current.set(textLayerDiv, () => {})
        return
      }
      // Place markers on the page itself so they don't break text selection.
      let host = pageEl.querySelector(
        '.claude-pdf-marker-layer'
      ) as HTMLElement | null
      if (!host) {
        host = document.createElement('div')
        host.className = 'claude-pdf-marker-layer'
        pageEl.appendChild(host)
      } else {
        host.innerHTML = ''
      }

      const pageRect = pageEl.getBoundingClientRect()
      const markers: Marker[] = []
      for (const [threadId, t] of Object.entries(threads)) {
        if (t.resolved) continue
        const anchor = deriveAnchorText(t)
        if (!anchor) continue
        const ranges = findMatchesInTextLayer(textLayerDiv, anchor)
        for (const r of ranges) markers.push({ threadId, range: r })
      }

      for (const { threadId, range } of markers) {
        const rects = Array.from(range.getClientRects())
        for (const rect of rects) {
          const el = document.createElement('div')
          el.className = 'claude-pdf-marker'
          el.style.left = `${rect.left - pageRect.left}px`
          el.style.top = `${rect.top - pageRect.top}px`
          el.style.width = `${rect.width}px`
          el.style.height = `${rect.height}px`
          el.title = `Comment thread ${threadId.slice(-6)} — click to open`
          el.addEventListener('click', () => {
            window.dispatchEvent(
              new CustomEvent('claude:focus-thread', {
                detail: { threadId },
              })
            )
          })
          host.appendChild(el)
          overlays.push(el)
        }
      }

      layerRefs.current.set(textLayerDiv, () => {
        for (const el of overlays) el.remove()
      })
    }

    const handle = (textLayer: any) => {
      const div = textLayer.source.textLayerDiv ?? textLayer.source.textLayer.div
      decorate(div)
    }

    // Decorate any text layers already in the DOM.
    const existingLayers = pdfJsWrapper.container.querySelectorAll(
      '.textLayer'
    )
    existingLayers.forEach(layer => decorate(layer as HTMLElement))

    pdfJsWrapper.eventBus.on('textlayerrendered', handle)
    return () => {
      pdfJsWrapper.eventBus.off('textlayerrendered', handle)
      cleanupAll()
    }
  }, [pdfJsWrapper, threads])

  return null
}
