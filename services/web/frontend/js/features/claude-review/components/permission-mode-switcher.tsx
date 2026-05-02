import { FC, useCallback, useEffect, useState } from 'react'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { getJSON, putJSON } from '@/infrastructure/fetch-json'

// Quick-switch for the Claude permission_mode kept in _claude/config.json.
// Full Claude Code-style "Approve each tool call" UI (Phase 2-B) needs a
// WebSocket bridge between sidecar and browser; until that lands, the
// user controls safety with these three modes:
//   * default          — sidecar's auto-approve list applies (the
//                         allowed_tools list in config.json)
//   * acceptEdits      — auto-accept Edit / Write but still ask Claude
//                         Code's interactive prompt for Bash etc.
//   * bypassPermissions — fully autonomous (use only when you trust it)

type Mode = 'default' | 'acceptEdits' | 'bypassPermissions'

const MODES: { id: Mode; label: string; tooltip: string }[] = [
  { id: 'default', label: 'Default', tooltip: 'Auto-approve allowed_tools, ask for the rest' },
  { id: 'acceptEdits', label: 'Auto-edit', tooltip: 'Edits run without asking; Bash etc. still gated' },
  { id: 'bypassPermissions', label: 'Autonomous', tooltip: 'No prompts. Use with care.' },
]

type ConfigResponse = {
  config?: { permission_mode?: Mode } & Record<string, unknown>
  defaults: { permission_mode?: Mode } & Record<string, unknown>
}

export const PermissionModeSwitcher: FC = () => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const [mode, setMode] = useState<Mode | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = (await getJSON(
        `/project/${projectId}/claude/config`
      )) as ConfigResponse
      const incoming =
        res.config?.permission_mode || res.defaults?.permission_mode || 'default'
      setMode(incoming as Mode)
    } catch {
      setMode('default')
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const change = async (next: Mode) => {
    if (next === mode || busy) return
    setBusy(true)
    try {
      const res = (await getJSON(
        `/project/${projectId}/claude/config`
      )) as ConfigResponse
      const merged = {
        ...(res.config || res.defaults),
        permission_mode: next,
      }
      await putJSON(`/project/${projectId}/claude/config`, {
        body: { config: merged },
      })
      setMode(next)
    } finally {
      setBusy(false)
    }
  }

  if (!mode) return null

  return (
    <div className="claude-mode-switcher">
      <div className="claude-panel__section-title" style={{ marginTop: 0 }}>
        <span>Permission mode</span>
      </div>
      <div className="claude-mode-switcher__row" role="radiogroup">
        {MODES.map(opt => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={mode === opt.id}
            disabled={busy}
            title={opt.tooltip}
            onClick={() => change(opt.id)}
            className={`claude-mode-switcher__btn ${
              mode === opt.id ? 'claude-mode-switcher__btn--active' : ''
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
