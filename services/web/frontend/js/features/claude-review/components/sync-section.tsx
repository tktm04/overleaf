import { FC, useCallback, useEffect, useState } from 'react'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'

// "Sync" section in the Claude rail. Talks to the local fork's
// /project/:p/claude/sync/{status,pull,push} routes which proxy git
// operations through claude-sidecar against the experiment_repo.

type Status = {
  ok?: boolean
  dirty?: number
  dirtyFiles?: string[]
  head?: string
  upstream?: string
  error?: string
  stderr?: string
}

type SyncResponse = {
  ok?: boolean
  committed?: boolean
  stdout?: string
  stderr?: string
  error?: string
}

export const SyncSection: FC = () => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState<'pull' | 'push' | 'status' | null>(null)
  const [result, setResult] = useState<SyncResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy('status')
    setError(null)
    try {
      const res = (await getJSON(
        `/project/${projectId}/claude/sync/status`
      )) as Status
      setStatus(res)
      if (res?.error) setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status check failed')
    } finally {
      setBusy(null)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const pull = async () => {
    setBusy('pull')
    setError(null)
    setResult(null)
    try {
      const res = (await postJSON(`/project/${projectId}/claude/sync/pull`, {
        body: {},
      })) as SyncResponse
      setResult(res)
      if (res?.error) setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pull failed')
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const push = async () => {
    setBusy('push')
    setError(null)
    setResult(null)
    try {
      const res = (await postJSON(`/project/${projectId}/claude/sync/push`, {
        body: {},
      })) as SyncResponse
      setResult(res)
      if (res?.error) setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push failed')
    } finally {
      setBusy(null)
      refresh()
    }
  }

  return (
    <div className="claude-sync">
      <div className="claude-panel__section-title">
        <span>Sync (experiment repo)</span>
        <button
          type="button"
          className="claude-panel__refresh"
          onClick={refresh}
          disabled={busy === 'status'}
        >
          {busy === 'status' ? '…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="alert alert-danger py-1 px-2 small">{error}</div>
      )}

      {status && status.ok !== false && (
        <div className="claude-sync__status">
          {(status.dirty || 0) > 0 ? (
            <span className="claude-sync__badge claude-sync__badge--dirty">
              {status.dirty} unsynced
            </span>
          ) : (
            <span className="claude-sync__badge claude-sync__badge--clean">
              clean
            </span>
          )}
          {status.upstream && (
            <span className="claude-sync__upstream">{status.upstream}</span>
          )}
          {status.head && (
            <div className="claude-sync__head" title={status.head}>
              {status.head}
            </div>
          )}
        </div>
      )}

      {result?.stdout && (
        <pre className="claude-sync__output">{result.stdout}</pre>
      )}

      <div className="claude-sync__actions">
        <button
          type="button"
          className="claude-btn claude-btn--ghost"
          onClick={pull}
          disabled={busy !== null}
        >
          {busy === 'pull' ? 'Pulling…' : 'Pull'}
        </button>
        <button
          type="button"
          className="claude-btn claude-btn--primary"
          onClick={push}
          disabled={busy !== null}
        >
          {busy === 'push' ? 'Pushing…' : 'Push'}
        </button>
      </div>
    </div>
  )
}
