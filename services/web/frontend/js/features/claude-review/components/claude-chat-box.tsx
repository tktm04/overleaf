import { FC, useEffect, useRef, useState } from 'react'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { postJSON } from '@/infrastructure/fetch-json'

type Turn = { role: 'user' | 'assistant'; content: string }

type ChatResponse = { reply: string }

export const ClaudeChatBox: FC = () => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const [history, setHistory] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)

  // Keep scrolled to bottom as new messages arrive.
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
  }, [history, busy])

  const send = async () => {
    const message = input.trim()
    if (!message || busy) return
    setBusy(true)
    setError(null)
    setHistory(h => [...h, { role: 'user', content: message }])
    setInput('')
    try {
      const res = (await postJSON(`/project/${projectId}/claude/chat`, {
        body: { userMessage: message },
      })) as ChatResponse
      setHistory(h => [
        ...h,
        { role: 'assistant', content: res.reply || '(empty reply)' },
      ])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Chat failed')
    } finally {
      setBusy(false)
      requestAnimationFrame(() => taRef.current?.focus())
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="claude-chat">
      <div className="claude-panel__section-title">
        <span>Chat with Claude</span>
        <button
          type="button"
          className="claude-panel__refresh"
          onClick={() => setHistory([])}
          disabled={busy || history.length === 0}
        >
          Clear
        </button>
      </div>
      <div ref={historyRef} className="claude-chat__history">
        {history.length === 0 && !busy && (
          <p className="claude-panel__empty" style={{ marginBottom: 0 }}>
            Free-form chat about this project — independent of comment threads.
          </p>
        )}
        {history.map((t, i) => (
          <div
            key={i}
            className={`claude-chat__bubble claude-chat__bubble--${t.role}`}
          >
            <div className="claude-chat__bubble-author">
              {t.role === 'user' ? 'you' : 'claude'}
            </div>
            <div className="claude-chat__bubble-body">{t.content}</div>
          </div>
        ))}
        {busy && (
          <div className="claude-chat__thinking" aria-label="Claude is thinking">
            <span />
            <span />
            <span />
            <em style={{ marginLeft: 4, fontStyle: 'normal' }}>
              claude is thinking…
            </em>
          </div>
        )}
      </div>
      {error && (
        <div className="alert alert-danger py-1 px-2 small">{error}</div>
      )}
      <textarea
        ref={taRef}
        rows={2}
        className="claude-chat__textarea"
        placeholder="Ask Claude…  (⌘/Ctrl + Enter to send)"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
      />
      <div className="claude-chat__send-row">
        <button
          type="button"
          className="claude-btn claude-btn--primary"
          onClick={send}
          disabled={busy || !input.trim()}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
