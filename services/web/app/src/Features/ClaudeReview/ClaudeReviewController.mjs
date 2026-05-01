// @ts-check

import logger from '@overleaf/logger'
import SessionManager from '../Authentication/SessionManager.mjs'
import ClaudeReviewManager from './ClaudeReviewManager.mjs'
import EditorController from '../Editor/EditorController.mjs'
import ProjectEntityHandler from '../Project/ProjectEntityHandler.mjs'
import ContextBuilder from './ContextBuilder.mjs'
import settings from '@overleaf/settings'

const CONFIG_PATH = '/_claude/config.json'

const DEFAULT_CONFIG = {
  sidecar_url: '',
  experiment_repo: '',
  allowed_tools: ['Read', 'Glob', 'Grep'],
  model: 'claude-opus-4-7',
  permission_mode: 'default',
}

async function review(req, res, next) {
  try {
    const projectId = req.params.project_id || req.params.projectId
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (!userId) {
      return res.status(401).json({ error: 'not authenticated' })
    }
    const threadIds = Array.isArray(req.body?.threadIds)
      ? req.body.threadIds
      : undefined

    const result = await ClaudeReviewManager.review({
      projectId,
      userId,
      threadIds,
    })

    logger.info({ projectId, userId, ...result }, 'claude review request done')
    res.json(result)
  } catch (err) {
    logger.err({ err }, 'claude review failed')
    next(err)
  }
}

async function getConfig(req, res, next) {
  try {
    const projectId = req.params.project_id || req.params.projectId
    const ctx = await ContextBuilder.build(projectId)
    let parsed = null
    if (ctx.config) {
      try {
        parsed = JSON.parse(ctx.config)
      } catch (err) {
        return res.status(200).json({
          exists: true,
          parseError: err.message,
          raw: ctx.config,
          defaults: DEFAULT_CONFIG,
          fallbackSidecarUrl: settings.apis?.claudeReview?.sidecarUrl || '',
        })
      }
    }
    res.json({
      exists: !!ctx.config,
      config: parsed || { ...DEFAULT_CONFIG },
      defaults: DEFAULT_CONFIG,
      fallbackSidecarUrl: settings.apis?.claudeReview?.sidecarUrl || '',
    })
  } catch (err) {
    next(err)
  }
}

async function putConfig(req, res, next) {
  try {
    const projectId = req.params.project_id || req.params.projectId
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (!userId) return res.status(401).json({ error: 'not authenticated' })
    const incoming = req.body?.config
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'config object required' })
    }
    // Validate the obvious fields
    if (
      incoming.allowed_tools != null &&
      !Array.isArray(incoming.allowed_tools)
    ) {
      return res.status(400).json({ error: 'allowed_tools must be array' })
    }
    const json = JSON.stringify(incoming, null, 2) + '\n'
    await EditorController.promises.upsertDocWithPath(
      projectId,
      CONFIG_PATH,
      json.split('\n'),
      'editor',
      userId
    )
    res.json({ ok: true })
  } catch (err) {
    logger.err({ err }, 'failed to write claude config')
    next(err)
  }
}

async function chat(req, res, next) {
  try {
    const projectId = req.params.project_id || req.params.projectId
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (!userId) return res.status(401).json({ error: 'not authenticated' })
    const userMessage = (req.body?.userMessage || '').toString()
    if (!userMessage.trim()) {
      return res.status(400).json({ error: 'userMessage required' })
    }
    const result = await ClaudeReviewManager.chat({
      projectId,
      userMessage,
      resumeFresh: !!req.body?.resumeFresh,
    })
    res.json(result)
  } catch (err) {
    logger.err({ err }, 'claude chat failed')
    next(err)
  }
}

async function listEdits(req, res, next) {
  try {
    const projectId = req.params.project_id || req.params.projectId
    const edits = await ClaudeReviewManager.listEdits(projectId)
    res.json({ edits })
  } catch (err) {
    next(err)
  }
}

async function applyEdit(req, res, next) {
  try {
    const projectId = req.params.project_id || req.params.projectId
    const editId = req.params.edit_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (!userId) return res.status(401).json({ error: 'not authenticated' })
    const result = await ClaudeReviewManager.applyEdit({
      projectId,
      userId,
      editId,
      EditorController,
      ProjectEntityHandler,
    })
    res.json(result)
  } catch (err) {
    logger.warn({ err }, 'failed to apply Claude edit')
    res.status(409).json({ error: err.message })
  }
}

async function skipEdit(req, res, next) {
  try {
    const projectId = req.params.project_id || req.params.projectId
    const editId = req.params.edit_id
    const result = await ClaudeReviewManager.skipEdit({ projectId, editId })
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export default {
  review,
  chat,
  getConfig,
  putConfig,
  listEdits,
  applyEdit,
  skipEdit,
}
