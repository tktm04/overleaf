import { FC, useState } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import { ConfigureClaudeModal } from './configure-claude-modal'

export const ConfigureClaudeButton: FC = () => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="review-panel-resolved-comments-toggle"
        onClick={() => setOpen(true)}
        aria-label="Configure Claude"
        title="Configure Claude (writes _claude/config.json)"
      >
        <MaterialIcon type="settings" />
      </button>
      <ConfigureClaudeModal show={open} onClose={() => setOpen(false)} />
    </>
  )
}
