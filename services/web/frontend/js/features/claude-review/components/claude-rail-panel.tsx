import { FC, memo, useState } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { AskClaudeButton } from '@/features/review-panel/components/ask-claude-button'
import { ConfigureClaudeButton } from '@/features/review-panel/components/configure-claude-button'
import { PendingEditsList } from './pending-edits-list'
import { ClaudeChatBox } from './claude-chat-box'
import { ThreadsList } from './threads-list'
import { ClaudePendingAddComment } from './claude-pending-add-comment'
import { ImportFromOverleafButton } from './import-from-overleaf-button'
import { SyncSection } from './sync-section'

type Tab = 'comments' | 'chat'

const ClaudeRailPanel: FC = () => {
  const [tab, setTab] = useState<Tab>('comments')
  const [showHelp, setShowHelp] = useState(false)
  const [activeThreads, setActiveThreads] = useState(0)

  return (
    <div className="claude-panel">
      <RailPanelHeader
        title="Claude"
        actions={
          <>
            <ImportFromOverleafButton key="import-overleaf" />
            <ConfigureClaudeButton key="configure-claude" />
            <AskClaudeButton key="ask-claude" />
          </>
        }
      />
      <div className="claude-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'comments'}
          className={`claude-tabs__tab ${
            tab === 'comments' ? 'claude-tabs__tab--active' : ''
          }`}
          onClick={() => setTab('comments')}
        >
          Comments
          {activeThreads > 0 && (
            <span className="claude-tabs__badge">{activeThreads}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={`claude-tabs__tab ${
            tab === 'chat' ? 'claude-tabs__tab--active' : ''
          }`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
      </div>

      <div className="claude-panel__body">
        {tab === 'comments' && (
          <>
            <div className="claude-panel__intro">
              <span className="claude-panel__intro-icon">✨</span>
              <div className="claude-panel__intro-text">
                Claude reviews each new comment automatically. Replies are
                posted in the thread; suggested edits appear below for you to
                Apply or Skip.
              </div>
            </div>
            <ClaudePendingAddComment />
            <ThreadsList onActiveChange={setActiveThreads} />
            <PendingEditsList />
            <SyncSection />
          </>
        )}
        {tab === 'chat' && (
          <>
            <div className="claude-panel__intro">
              <span className="claude-panel__intro-icon">💭</span>
              <div className="claude-panel__intro-text">
                Free-form chat with Claude about this project — independent of
                comment threads. Use this for broad consultation.
              </div>
            </div>
            <ClaudeChatBox />
          </>
        )}

        <div style={{ marginTop: '0.8rem', textAlign: 'right' }}>
          <button
            type="button"
            className="claude-btn claude-btn--link"
            onClick={() => setShowHelp(v => !v)}
          >
            {showHelp ? 'Hide help' : 'Show help'}
          </button>
        </div>
        {showHelp && (
          <div className="claude-help-banner">
            <strong>First-time setup:</strong>
            <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
              <li>
                Run <code>claude /login</code> on the sidecar host once.
              </li>
              <li>
                Start the sidecar:{' '}
                <code>cd tools/claude-sidecar && npm start</code>.
              </li>
              <li>
                Click ⚙ Configure Claude and set{' '}
                <code>experiment_repo</code>.
              </li>
              <li>Add a comment in the editor — Claude reviews automatically.</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(ClaudeRailPanel)
