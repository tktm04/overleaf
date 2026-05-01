import { FC, useContext, useState } from 'react'
import { v4 as uuid } from 'uuid'
import {
  CodeMirrorStateContext,
  CodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import {
  reviewTooltipStateField,
  removeNewCommentRangeEffect,
} from '@/features/source-editor/extensions/review-tooltip'
import { useProjectContext } from '@/shared/context/project-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { postJSON } from '@/infrastructure/fetch-json'

// Renders an input form for any pending "new comment" decoration that
// CodeMirror's reviewTooltipStateField currently holds. The native review
// panel's add-comment popup only renders when its rail is open; this
// mirror inside the Claude rail removes that dependency.
//
// Implementation note: the Claude rail is mounted at IDE level, OUTSIDE the
// codemirror-editor's React tree, so the CodeMirror context isn't always
// available. We read the raw context (no throwing hook) and bail out if
// either piece is missing. We also skip the review-panel's ThreadsProvider
// entirely and replicate the small slice of `addComment` we need (POST
// first message + submit a CommentOperation against the open doc).

type Pending = { from: number; to: number; threadId: string }

type OpenDoc = {
  doc_id?: string
  submitOp?: (op: {
    p: number
    c: string
    t: string
  }) => void
}

export const ClaudePendingAddComment: FC = () => {
  const state = useContext(CodeMirrorStateContext)
  const view = useContext(CodeMirrorViewContext)
  const { projectId } = useProjectContext()
  const { currentDocument } = useEditorOpenDocContext() as {
    currentDocument: OpenDoc | null | undefined
  }
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  if (!state) return null
  const field = state.field(reviewTooltipStateField, false)
  if (!field) return null

  const pending: Pending[] = []
  field.addCommentRanges.between(0, state.doc.length, (from, to, value) => {
    const id = (value as { spec?: { id?: string } }).spec?.id
    if (id) pending.push({ from, to, threadId: id })
  })
  if (pending.length === 0) return null

  const dropPending = (threadId: string) => {
    if (view) {
      view.dispatch({
        effects: removeNewCommentRangeEffect.of(threadId),
      })
    }
    setDrafts(d => {
      const n = { ...d }
      delete n[threadId]
      return n
    })
  }

  const cancel = (threadId: string) => {
    dropPending(threadId)
  }

  const submit = async (item: Pending) => {
    const content = (drafts[item.threadId] || '').trim()
    if (!content) return
    setBusy(b => ({ ...b, [item.threadId]: true }))
    setError(null)
    try {
      const text = state.sliceDoc(item.from, item.to)
      // Use a fresh threadId — we don't reuse the one CodeMirror generated
      // for the pending decoration so the chat service controls its own
      // namespace.
      const threadId = uuid()
      await postJSON(
        `/project/${projectId}/thread/${threadId}/messages`,
        { body: { content } }
      )
      // Insert the CommentOperation into the open document so the comment
      // is anchored. If the document hasn't loaded for any reason we still
      // posted the message — it'll be visible in the Claude rail.
      if (currentDocument?.submitOp) {
        currentDocument.submitOp({ p: item.from, c: text, t: threadId })
      }
      dropPending(item.threadId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add comment')
    } finally {
      setBusy(b => ({ ...b, [item.threadId]: false }))
    }
  }

  return (
    <div style={{ marginBottom: '0.5rem' }}>
      {error && (
        <div className="alert alert-danger py-1 px-2 small">{error}</div>
      )}
      {pending.map(item => {
        const quote = state.sliceDoc(item.from, item.to)
        const isBusy = busy[item.threadId]
        return (
          <div key={item.threadId} className="claude-pending-comment">
            <div className="claude-pending-comment__label">New comment on:</div>
            <div className="claude-pending-comment__quote">{quote}</div>
            <textarea
              autoFocus
              rows={2}
              className="claude-pending-comment__textarea"
              placeholder="Add comment…  (⌘/Ctrl + Enter)"
              value={drafts[item.threadId] || ''}
              onChange={e =>
                setDrafts(d => ({ ...d, [item.threadId]: e.currentTarget.value }))
              }
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  submit(item)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancel(item.threadId)
                }
              }}
              disabled={isBusy}
            />
            <div className="claude-pending-comment__actions">
              <button
                type="button"
                className="claude-btn claude-btn--ghost"
                onClick={() => cancel(item.threadId)}
                disabled={isBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="claude-btn claude-btn--primary"
                onClick={() => submit(item)}
                disabled={isBusy || !(drafts[item.threadId] || '').trim()}
              >
                {isBusy ? 'Sending…' : 'Comment'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
