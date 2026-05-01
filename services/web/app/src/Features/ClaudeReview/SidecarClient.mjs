// @ts-check

import { fetchJson } from '@overleaf/fetch-utils'
import settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import logger from '@overleaf/logger'

function sidecarUrl(path, overrideBase) {
  const base = overrideBase || settings.apis?.claudeReview?.sidecarUrl
  if (!base) {
    throw new OError('claude sidecar URL not configured', {
      hint:
        'set sidecar_url in _claude/config.json or ' +
        'OVERLEAF_CLAUDE_SIDECAR_URL in develop/dev.env',
    })
  }
  return new URL(path, base)
}

/**
 * Run a review request through a claude-sidecar (local or remote).
 * @param {{
 *   projectId: string,
 *   prompt: string,
 *   cwd?: string,
 *   systemPrompt?: string,
 *   allowedTools?: string[],
 *   permissionMode?: string,
 *   resumeFresh?: boolean,
 *   model?: string,
 *   sidecarUrl?: string,
 * }} body
 */
async function runReview(body) {
  const { sidecarUrl: override, ...payload } = body
  logger.info(
    {
      projectId: payload.projectId,
      cwd: payload.cwd,
      tools: payload.allowedTools,
      resumeFresh: payload.resumeFresh,
      sidecar: override || 'default',
    },
    'calling claude-sidecar /review'
  )
  try {
    const result = await fetchJson(sidecarUrl('/review', override), {
      method: 'POST',
      json: payload,
    })
    return result
  } catch (err) {
    throw new OError('claude-sidecar request failed', {
      hint:
        'is the sidecar running? `cd tools/claude-sidecar && npm start` ' +
        'and confirm sidecar_url (config.json) or ' +
        'OVERLEAF_CLAUDE_SIDECAR_URL points at it',
    }).withCause(err)
  }
}

async function clearSession(projectId, override) {
  return fetchJson(sidecarUrl('/session/clear', override), {
    method: 'POST',
    json: { projectId },
  })
}

export default { runReview, clearSession }
