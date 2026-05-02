import { FC, useState } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'

// "Import from overleaf.com" entry point in the Claude rail. The actual
// fetching happens in the bookmarklet (tools/bookmarklets/...) — this
// modal just explains the workflow and surfaces the local project id so
// the user doesn't have to look it up in the URL bar.

export const ImportFromOverleafButton: FC = () => {
  const { projectId } = useIdeReactContext() as { projectId: string }
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(projectId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore (no clipboard permission)
    }
  }

  return (
    <>
      <button
        type="button"
        className="review-panel-resolved-comments-toggle"
        onClick={() => setOpen(true)}
        aria-label="Import comments from overleaf.com"
        title="Import comments from overleaf.com (bookmarklet)"
      >
        <MaterialIcon type="cloud_download" />
      </button>
      <OLModal show={open} onHide={() => setOpen(false)} size="lg">
        <OLModalHeader closeButton>
          <OLModalTitle>Import comments from overleaf.com</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <p className="text-muted small">
            Comments on overleaf.com aren't synced through git, so we use a
            small browser bookmarklet to copy them into this fork. The
            bookmarklet lives at{' '}
            <code>tools/bookmarklets/import-overleaf-comments.js</code> and
            its setup is documented in{' '}
            <code>LOCAL_SETUP.md</code>.
          </p>
          <ol className="small">
            <li>Open your project on www.overleaf.com</li>
            <li>Click the <strong>Import to Claude</strong> bookmarklet</li>
            <li>
              When prompted for a local-fork project id, paste the value
              below
            </li>
            <li>The Comments tab will refresh with imported threads</li>
          </ol>
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              marginTop: '0.5rem',
            }}
          >
            <code
              style={{
                flex: 1,
                padding: '0.4rem 0.55rem',
                background: 'var(--neutral-10, #f5f5f5)',
                borderRadius: 4,
                fontSize: 12,
                userSelect: 'all',
                wordBreak: 'break-all',
              }}
            >
              {projectId}
            </code>
            <OLButton
              variant="secondary"
              size="sm"
              onClick={copyId}
            >
              {copied ? 'Copied' : 'Copy'}
            </OLButton>
          </div>
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="primary" onClick={() => setOpen(false)}>
            Close
          </OLButton>
        </OLModalFooter>
      </OLModal>
    </>
  )
}
