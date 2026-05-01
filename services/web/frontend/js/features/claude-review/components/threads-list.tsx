import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { useConnectionContext } from '@/features/ide-react/context/connection-context'
import {
  deleteJSON,
  getJSON,
  postJSON,
} from '@/infrastructure/fetch-json'
import { ClaudeBadge } from './claude-badge'

type User = {
  id?: string
  first_name?: string
  last_name?: string
  email?: string
}
type Message = {
  id: string
  user_id: string
  user?: User
  content: string
  timestamp?: number
}
type Thread = {
  messages: Message[]
  resolved?: boolean
  resolved_at?: string
  resolved_by_user_id?: string
}
type ThreadsResponse = Record<string, Thread>

type Status = 'idle' | 'reviewing' | 'reviewed' | 'error'

type Props = {
  onActiveChange?: (count: number) => void
}

function formatAuthor(u?: User, isClaude?: boolean): string {
  if (isClaude) return 'claude'
  if (!u) return 'unknown'
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || u.email || 'user'
}

function isClaudeContent(content?: string): boolean {
  return typeof content === 'string' && content.startsWith('🤖 **Claude Review**')
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
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const [busyThread, setBusyThread] = useState<string | null>(null)

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
    socket.on('delete-message', handler)
    socket.on('edit-message', handler)
    socket.on('claude-edits-updated', handler)
    return () => {
      socket.removeListener('new-comment', handler)
      socket.removeListener('resolve-thread', handler)
      socket.removeListener('reopen-thread', handler)
      socket.removeListener('delete-thread', handler)
      socket.removeListener('delete-message', handler)
      socket.removeListener('edit-message', handler)
      socket.removeListener('claude-edits-updated', handler)
    }
  }, [socket, refresh])

  // Auto-trigger Claude review for unresolved threads whose latest message
  // isn't already a Claude reply.
  useEffect(() => {
    const candidates = Object.entries(threads).filter(
      ([, t]) => !t.resolved && t.messages?.length > 0
    )
    for (const [threadId, t] of candidates) {
      const last = t.messages[t.messages.length - 1]
      if (isClaudeContent(last?.content)) {
        if (statuses[threadId] !== 'reviewed') {
          setStatuses(s => ({ ...s, [threadId]: 'reviewed' }))
        }
        continue
      }
      if (statuses[threadId]) continue
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
          const ta = a.messages[0]?.timestamp || 0
          const tb = b.messages[0]?.timestamp || 0
          return tb - ta
        }),
    [threads]
  )

  useEffect(() => {
    onActiveChange?.(visible.length)
  }, [visible.length, onActiveChange])

  const reply = async (threadId: string) => {
    const text = (replyDraft[threadId] || '').trim()
    if (!text) return
    setBusyThread(threadId)
    try {
      await postJSON(`/project/${projectId}/thread/${threadId}/messages`, {
        body: { content: text },
      })
      setReplyDraft(d => ({ ...d, [threadId]: '' }))
      // Reset auto-review status so Claude considers the new message.
      setStatuses(s => {
        const next = { ...s }
        delete next[threadId]
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reply failed')
    } finally {
      setBusyThread(null)
    }
  }

  const resolveThread = async (threadId: string) => {
    setBusyThread(threadId)
    try {
      await postJSON(
        `/project/${projectId}/thread/${threadId}/resolve`,
        { body: {} }
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve failed')
    } finally {
      setBusyThread(null)
    }
  }

  const deleteThread = async (threadId: string) => {
    if (!window.confirm('Delete this comment thread?')) return
    setBusyThread(threadId)
    try {
      await deleteJSON(`/project/${projectId}/thread/${threadId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyThread(null)
    }
  }

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
          No open comments. Add one in the editor or directly on the PDF —
          Claude will review it automatically.
        </p>
      )}

      {visible.map(([threadId, t]) => {
        const status = statuses[threadId] || 'idle'
        const isBusy = busyThread === threadId
        return (
          <div key={threadId} className="claude-thread">
            <div className="claude-thread__header">
              <span>
                <code style={{ fontSize: 10 }}>{threadId.slice(-6)}</code>
                {' · '}
                {t.messages.length} message{t.messages.length > 1 ? 's' : ''}
              </span>
              <span
                className={`claude-thread__status claude-thread__status--${status}`}
              >
                {status === 'reviewing' && (
                  <>
                    <span className="claude-chat__thinking">
                      <span />
                      <span />
                      <span />
                    </span>
                    Reviewing
                  </>
                )}
                {status === 'reviewed' && '✓ Reviewed'}
                {status === 'idle' && 'Idle'}
                {status === 'error' && '⚠ Error'}
              </span>
            </div>

            <div className="claude-thread__messages">
              {t.messages.map(m => {
                const claudeMsg = isClaudeContent(m.content)
                const display = claudeMsg
                  ? m.content.replace(/^🤖 \*\*Claude Review\*\*\n+/, '')
                  : m.content
                return (
                  <div
                    key={m.id}
                    className={`claude-thread__message ${
                      claudeMsg ? 'claude-thread__message--claude' : ''
                    }`}
                  >
                    <div className="claude-thread__author">
                      {claudeMsg ? (
                        <>
                          <ClaudeBadge size={12} /> Claude Review
                        </>
                      ) : (
                        formatAuthor(m.user)
                      )}
                    </div>
                    <div className="claude-thread__body">{display}</div>
                  </div>
                )
              })}
            </div>

            <div className="claude-thread__reply">
              <textarea
                rows={2}
                className="claude-thread__reply-input"
                placeholder="Reply…  (⌘/Ctrl + Enter)"
                value={replyDraft[threadId] || ''}
                onChange={e =>
                  setReplyDraft(d => ({
                    ...d,
                    [threadId]: e.currentTarget.value,
                  }))
                }
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    reply(threadId)
                  }
                }}
                disabled={isBusy}
              />
              <div className="claude-thread__reply-actions">
                <button
                  type="button"
                  className="claude-btn claude-btn--ghost"
                  onClick={() => deleteThread(threadId)}
                  disabled={isBusy}
                  title="Delete thread"
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="claude-btn claude-btn--ghost"
                  onClick={() => resolveThread(threadId)}
                  disabled={isBusy}
                  title="Mark resolved"
                >
                  Resolve
                </button>
                <button
                  type="button"
                  className="claude-btn claude-btn--primary"
                  onClick={() => reply(threadId)}
                  disabled={isBusy || !(replyDraft[threadId] || '').trim()}
                >
                  {isBusy ? '…' : 'Reply'}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
