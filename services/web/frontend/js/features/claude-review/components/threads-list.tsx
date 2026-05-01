import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { useConnectionContext } from '@/features/ide-react/context/connection-context'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'

type Message = { id: string; user_id: string; content: string }
type Thread = {
  messages: Message[]
  resolved?: boolean
  resolved_at?: string
  resolved_by_user_id?: string
}
type ThreadsResponse = Record<string, Thread>

type Status = 'idle' | 'reviewing' | 'reviewed' | 'error'

type Props = {
  // Notify parent (e.g. tab counter) when the active reviewing set changes.
  onActiveChange?: (count: number) => void
}

export const ThreadsList: FC<Props> = ({ onActiveChange }) => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const { socket } = useConnectionContext() as {
    socket?: {
      on: (e: string, h: (...a: unknown[]) => void) => void
      removeListener: (e: string, h: (...a: unknown[]) => void) => void
    }
  }
  const [threads, setThreads] = useState<ThreadsResponse>({})
  const [statuses, setStatuses] = useState<Record<string, Status>>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = (await getJSON(
        `/project/${projectId}/threads`
      )) as ThreadsResponse
      setThreads(res || {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load threads')
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
    socket.on('claude-edits-updated', handler)
    return () => {
      socket.removeListener('new-comment', handler)
      socket.removeListener('resolve-thread', handler)
      socket.removeListener('reopen-thread', handler)
      socket.removeListener('delete-thread', handler)
      socket.removeListener('claude-edits-updated', handler)
    }
  }, [socket, refresh])

  // Auto-trigger Claude review for threads that are unresolved AND have at
  // least one human message AND have not yet been reviewed in this session.
  useEffect(() => {
    const candidates = Object.entries(threads).filter(
      ([, t]) => !t.resolved && t.messages?.length > 0
    )
    for (const [threadId, t] of candidates) {
      // Skip if last message is from Claude (already replied)
      const last = t.messages[t.messages.length - 1]
      const lastIsClaude = last?.content?.startsWith('🤖 **Claude Review**')
      if (lastIsClaude) {
        if (statuses[threadId] !== 'reviewed') {
          setStatuses(s => ({ ...s, [threadId]: 'reviewed' }))
        }
        continue
      }
      if (statuses[threadId]) continue // already reviewing/error
      setStatuses(s => ({ ...s, [threadId]: 'reviewing' }))
      ;(async () => {
        try {
          await postJSON(`/project/${projectId}/claude/review`, {
            body: { threadIds: [threadId] },
          })
          setStatuses(s => ({ ...s, [threadId]: 'reviewed' }))
        } catch (e) {
          setStatuses(s => ({ ...s, [threadId]: 'error' }))
          setError(e instanceof Error ? e.message : 'review failed')
        }
      })()
    }
  }, [threads, projectId, statuses])

  const visible = useMemo(
    () =>
      Object.entries(threads)
        .filter(([, t]) => !t.resolved && t.messages?.length > 0)
        .sort(([, a], [, b]) => {
          const ta = new Date(a.messages[0]?.id || 0).getTime()
          const tb = new Date(b.messages[0]?.id || 0).getTime()
          return tb - ta
        }),
    [threads]
  )

  useEffect(() => {
    onActiveChange?.(visible.length)
  }, [visible.length, onActiveChange])

  return (
    <>
      <div className="claude-panel__section-title">
        <span>Comment threads ({visible.length})</span>
        <button
          type="button"
          className="claude-panel__refresh"
          onClick={refresh}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="alert alert-danger py-1 px-2 small">{error}</div>
      )}

      {visible.length === 0 && (
        <p className="claude-panel__empty">
          No open comments. Add one in the editor — Claude will review it
          automatically.
        </p>
      )}

      {visible.map(([threadId, t]) => {
        const first = t.messages[0]
        const status = statuses[threadId] || 'idle'
        const claudeReply = t.messages.find(m =>
          m.content?.startsWith('🤖 **Claude Review**')
        )
        return (
          <div key={threadId} className="claude-thread">
            <div className="claude-thread__header">
              <span>
                <code style={{ fontSize: 10 }}>
                  {threadId.slice(-6)}
                </code>{' '}
                · {t.messages.length} message
                {t.messages.length > 1 ? 's' : ''}
              </span>
              <span className={`claude-thread__status claude-thread__status--${status}`}>
                {status === 'reviewing' && (
                  <>
                    <span className="claude-chat__thinking">
                      <span /><span /><span />
                    </span>
                    Reviewing
                  </>
                )}
                {status === 'reviewed' && '✓ Reviewed'}
                {status === 'idle' && 'Idle'}
                {status === 'error' && '⚠ Error'}
              </span>
            </div>
            {first?.content && (
              <div className="claude-thread__comment">{first.content}</div>
            )}
            {claudeReply && (
              <details>
                <summary className="claude-thread__header" style={{ cursor: 'pointer' }}>
                  Claude's reply
                </summary>
                <div
                  className="claude-thread__anchor"
                  style={{ borderLeftColor: '#2e7d32' }}
                >
                  {claudeReply.content.replace(
                    /^🤖 \*\*Claude Review\*\*\n+/,
                    ''
                  )}
                </div>
              </details>
            )}
          </div>
        )
      })}
    </>
  )
}
