import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { useConnectionContext } from '@/features/ide-react/context/connection-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'

type Edit = {
  id: string
  thread_id: string
  file_path: string
  old_text: string
  new_text: string
  rationale?: string
  status: 'pending' | 'applied' | 'skipped'
  created_at: number
}

type ListResponse = { edits: Edit[] }

function renderDiffLines(text: string, kind: 'del' | 'add') {
  const prefix = kind === 'del' ? '- ' : '+ '
  return text.split('\n').map((line, i) => (
    <span
      key={i}
      className={`claude-edit__diff-line claude-edit__diff-line--${kind}`}
    >
      {prefix}
      {line || ' '}
    </span>
  ))
}

export const PendingEditsList: FC = () => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const { socket } = useConnectionContext() as {
    socket?: {
      on: (e: string, h: (...a: unknown[]) => void) => void
      removeListener: (e: string, h: (...a: unknown[]) => void) => void
    }
  }
  const { currentDocument } = useEditorOpenDocContext() as {
    currentDocument: { doc_id?: string } | null | undefined
  }
  const { pathInFolder } = useFileTreePathContext() as {
    pathInFolder: (id: string) => string | null
  }
  const [edits, setEdits] = useState<Edit[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dispatchedRef = useRef<{ edits: Edit[]; path: string | null }>({
    edits: [],
    path: null,
  })

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = (await getJSON(
        `/project/${projectId}/claude/edits`
      )) as ListResponse
      setEdits(res.edits || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load edits')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!socket) return
    const handler = () => refresh()
    socket.on('claude-edits-updated', handler)
    socket.on('claude-edit-applied', handler)
    socket.on('claude-edit-skipped', handler)
    return () => {
      socket.removeListener('claude-edits-updated', handler)
      socket.removeListener('claude-edit-applied', handler)
      socket.removeListener('claude-edit-skipped', handler)
    }
  }, [socket, refresh])

  // Broadcast edits + open-doc path to the source-editor extension
  // (claude-pending-edits.ts) so it can render inline diff decorations.
  useEffect(() => {
    let path: string | null = null
    const docId = currentDocument?.doc_id
    if (docId && pathInFolder) {
      const raw = pathInFolder(docId)
      if (raw) path = raw.startsWith('/') ? raw : `/${raw}`
    }
    const prev = dispatchedRef.current
    if (prev.path === path && prev.edits === edits) return
    dispatchedRef.current = { edits, path }
    window.dispatchEvent(
      new CustomEvent('claude:pending-edits', {
        detail: { projectId, currentDocPath: path, edits },
      })
    )
  }, [edits, projectId, currentDocument, pathInFolder])

  const apply = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      await postJSON(`/project/${projectId}/claude/edits/${id}/apply`, {
        body: {},
      })
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setBusyId(null)
    }
  }

  const skip = async (id: string) => {
    setBusyId(id)
    try {
      await postJSON(`/project/${projectId}/claude/edits/${id}/skip`, {
        body: {},
      })
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const pending = edits.filter(e => e.status === 'pending')

  return (
    <>
      <div className="claude-panel__section-title">
        <span>Pending edits ({pending.length})</span>
        <button
          type="button"
          className="claude-panel__refresh"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="alert alert-danger py-1 px-2 small">{error}</div>
      )}

      {pending.length === 0 && !loading && (
        <p className="claude-panel__empty">
          No proposals yet. Add a comment and click ✨ Ask Claude.
        </p>
      )}

      {pending.map(edit => (
        <div key={edit.id} className="claude-edit">
          <div className="claude-edit__path">{edit.file_path}</div>
          {edit.rationale && (
            <div className="claude-edit__rationale">{edit.rationale}</div>
          )}
          <div className="claude-edit__diff">
            {renderDiffLines(edit.old_text, 'del')}
            {renderDiffLines(edit.new_text, 'add')}
          </div>
          <div className="claude-edit__actions">
            <button
              type="button"
              className="claude-btn claude-btn--primary"
              disabled={busyId === edit.id}
              onClick={() => apply(edit.id)}
            >
              {busyId === edit.id ? 'Applying…' : 'Apply'}
            </button>
            <button
              type="button"
              className="claude-btn claude-btn--ghost"
              disabled={busyId === edit.id}
              onClick={() => skip(edit.id)}
            >
              Skip
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
