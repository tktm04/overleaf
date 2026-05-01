import { FC, memo } from 'react'
import { ReviewPanelResolvedThreadsButton } from './review-panel-resolved-threads-button'
import { AskClaudeButton } from './ask-claude-button'
import { ConfigureClaudeButton } from './configure-claude-button'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'

const ReviewPanelHeader: FC = () => {
  const { t } = useTranslation()

  return (
    <div className="review-panel-header">
      <RailPanelHeader
        title={t('review')}
        actions={
          <>
            <ConfigureClaudeButton key="configure-claude" />
            <AskClaudeButton key="ask-claude" />
            <ReviewPanelResolvedThreadsButton key="resolve-threads" />
          </>
        }
      />
    </div>
  )
}

export default memo(ReviewPanelHeader)
