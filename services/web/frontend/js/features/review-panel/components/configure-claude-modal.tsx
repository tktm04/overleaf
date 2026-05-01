import { FC, useEffect, useState } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { getJSON, putJSON } from '@/infrastructure/fetch-json'

type ClaudeConfig = {
  sidecar_url?: string
  experiment_repo?: string
  allowed_tools?: string[]
  model?: string
  permission_mode?: string
}

type ConfigGetResponse = {
  exists: boolean
  config?: ClaudeConfig
  defaults: ClaudeConfig
  fallbackSidecarUrl: string
  parseError?: string
  raw?: string
}

const TOOL_CHOICES = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash']
const PERMISSION_CHOICES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
]
const MODEL_CHOICES = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]

type Props = {
  show: boolean
  onClose: () => void
}

export const ConfigureClaudeModal: FC<Props> = ({ show, onClose }) => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallback, setFallback] = useState<string>('')
  const [cfg, setCfg] = useState<ClaudeConfig>({
    sidecar_url: '',
    experiment_repo: '',
    allowed_tools: ['Read', 'Glob', 'Grep'],
    model: 'claude-opus-4-7',
    permission_mode: 'default',
  })

  useEffect(() => {
    if (!show) return
    setLoading(true)
    setError(null)
    getJSON<ConfigGetResponse>(`/project/${projectId}/claude/config`)
      .then(res => {
        setFallback(res.fallbackSidecarUrl || '')
        if (res.parseError) {
          setError(`Existing config could not be parsed: ${res.parseError}`)
        }
        const c = res.config || res.defaults
        setCfg({
          sidecar_url: c.sidecar_url || '',
          experiment_repo: c.experiment_repo || '',
          allowed_tools: c.allowed_tools || ['Read', 'Glob', 'Grep'],
          model: c.model || 'claude-opus-4-7',
          permission_mode: c.permission_mode || 'default',
        })
      })
      .catch(e => setError(e.message || 'Failed to load config'))
      .finally(() => setLoading(false))
  }, [show, projectId])

  const toggleTool = (tool: string) => {
    setCfg(prev => {
      const set = new Set(prev.allowed_tools || [])
      if (set.has(tool)) set.delete(tool)
      else set.add(tool)
      return { ...prev, allowed_tools: Array.from(set) }
    })
  }

  const onSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const body: ClaudeConfig = {
        ...cfg,
        sidecar_url: cfg.sidecar_url?.trim() || undefined,
        experiment_repo: cfg.experiment_repo?.trim() || undefined,
      }
      await putJSON(`/project/${projectId}/claude/config`, {
        body: { config: body },
      })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  return (
    <OLModal show={show} onHide={onClose} size="lg">
      <OLModalHeader closeButton>
        <OLModalTitle>Configure Claude Review</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <>
            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            <p className="text-muted small">
              These settings are saved as <code>_claude/config.json</code> in
              your project, so they sync to overleaf.com via git.
            </p>

            <OLFormGroup className="mb-3">
              <OLFormLabel>Sidecar URL (override)</OLFormLabel>
              <OLFormControl
                type="text"
                placeholder={fallback || 'http://host.docker.internal:8888'}
                value={cfg.sidecar_url || ''}
                onChange={e =>
                  setCfg({ ...cfg, sidecar_url: e.currentTarget.value })
                }
              />
              <small className="form-text text-muted">
                Leave blank to use the fork-wide default
                {fallback ? ` (${fallback})` : ''}. For an SSH/Tailscale host,
                e.g. <code>http://ubuntu-tailscale:8888</code>.
              </small>
            </OLFormGroup>

            <OLFormGroup className="mb-3">
              <OLFormLabel>Experiment repository (cwd)</OLFormLabel>
              <OLFormControl
                type="text"
                placeholder="/home/user/typography-jailbreak/papers/neurips2026"
                value={cfg.experiment_repo || ''}
                onChange={e =>
                  setCfg({ ...cfg, experiment_repo: e.currentTarget.value })
                }
              />
              <small className="form-text text-muted">
                Absolute path on the sidecar host. Claude runs with this as
                its working directory.
              </small>
            </OLFormGroup>

            <OLFormGroup className="mb-3">
              <OLFormLabel>Allowed tools</OLFormLabel>
              <div className="d-flex flex-wrap" style={{ gap: '0.75rem' }}>
                {TOOL_CHOICES.map(tool => {
                  const checked = (cfg.allowed_tools || []).includes(tool)
                  return (
                    <label
                      key={tool}
                      className="d-flex align-items-center"
                      style={{ gap: '0.25rem' }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTool(tool)}
                      />
                      <span>{tool}</span>
                    </label>
                  )
                })}
              </div>
              <small className="form-text text-muted">
                Read/Glob/Grep is read-only. Add Edit/Write/Bash to let Claude
                modify the experiment repo and run commands.
              </small>
            </OLFormGroup>

            <OLFormGroup className="mb-3">
              <OLFormLabel>Model</OLFormLabel>
              <OLFormControl
                as="select"
                value={cfg.model || 'claude-opus-4-7'}
                onChange={e => setCfg({ ...cfg, model: e.currentTarget.value })}
              >
                {MODEL_CHOICES.map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </OLFormControl>
            </OLFormGroup>

            <OLFormGroup>
              <OLFormLabel>Permission mode</OLFormLabel>
              <OLFormControl
                as="select"
                value={cfg.permission_mode || 'default'}
                onChange={e =>
                  setCfg({ ...cfg, permission_mode: e.currentTarget.value })
                }
              >
                {PERMISSION_CHOICES.map(p => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </OLFormControl>
              <small className="form-text text-muted">
                <code>default</code> mirrors Claude Code's interactive prompts.
                <code>acceptEdits</code> auto-accepts file edits.{' '}
                <code>bypassPermissions</code> auto-allows everything (use
                with care).
              </small>
            </OLFormGroup>
          </>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </OLButton>
        <OLButton variant="primary" onClick={onSave} disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save'}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
