import { FC, useState } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { postJSON } from '@/infrastructure/fetch-json'

type ReviewResult = {
  repliesPosted?: number
  repliesReceived?: number
  threadsConsidered?: number
  skipped?: string
  error?: string
}

export const AskClaudeButton: FC = () => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<ReviewResult | null>(null)

  const onClick = async () => {
    if (busy) return
    setBusy(true)
    setLastResult(null)
    try {
      const result = (await postJSON(
        `/project/${projectId}/claude/review`,
        { body: {} }
      )) as ReviewResult
      setLastResult(result)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error'
      setLastResult({ error: message })
    } finally {
      setBusy(false)
    }
  }

  const title = busy
    ? 'Claude is reviewing…'
    : lastResult?.error
      ? `Error: ${lastResult.error}`
      : lastResult?.skipped
        ? lastResult.skipped
        : lastResult?.repliesPosted != null
          ? `Posted ${lastResult.repliesPosted} replies`
          : 'Ask Claude to review unresolved comments'

  return (
    <button
      type="button"
      className="review-panel-resolved-comments-toggle"
      onClick={onClick}
      disabled={busy}
      aria-label="Ask Claude"
      title={title}
    >
      <MaterialIcon type={busy ? 'hourglass_empty' : 'auto_awesome'} />
    </button>
  )
}
