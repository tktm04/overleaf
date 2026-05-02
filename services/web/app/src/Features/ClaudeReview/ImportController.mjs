// @ts-check
//
// Import comment threads from a remote Overleaf project (typically
// www.overleaf.com) into this local fork. Triggered by the bookmarklet at
// tools/bookmarklets/import-overleaf-comments.js, which the user runs while
// logged in to the remote project.
//
// The remote thread payload is keyed by `remote_thread_id`. We embed that id
// in a marker on the first message so subsequent imports can deduplicate
// without keeping a separate mapping table.

import logger from '@overleaf/logger'
import SessionManager from '../Authentication/SessionManager.mjs'
import ChatApiHandler from '../Chat/ChatApiHandler.mjs'
import EditorRealTimeController from '../Editor/EditorRealTimeController.mjs'
import ProjectEntityHandler from '../Project/ProjectEntityHandler.mjs'
import UserInfoManager from '../User/UserInfoManager.mjs'
import UserInfoController from '../User/UserInfoController.mjs'
import { v4 as uuid } from 'uuid'

const MARKER_PREFIX = '[overleaf-import:'
const MARKER_SUFFIX = ']'

function makeMarker(remoteThreadId) {
  return `${MARKER_PREFIX}${remoteThreadId}${MARKER_SUFFIX}`
}

function findRemoteIdInThread(thread) {
  for (const message of thread?.messages || []) {
    const m = message?.content?.match(
      /\[overleaf-import:([0-9a-f-]+)\]/i
    )
    if (m) return m[1]
  }
  return null
}

function findAnchor(docs, anchorText) {
  if (!anchorText) return null
  let match = null
  for (const [docPath, doc] of Object.entries(docs)) {
    const content = (doc.lines || []).join('\n')
    const idx = content.indexOf(anchorText)
    if (idx === -1) continue
    const last = content.lastIndexOf(anchorText)
    if (idx !== last) {
      // ambiguous: more than one occurrence, skip anchoring
      return { ambiguous: true }
    }
    if (match) {
      // matched in another doc as well
      return { ambiguous: true }
    }
    match = { docPath, docId: doc._id, offset: idx, length: anchorText.length }
  }
  return match
}

async function importThreads(req, res, next) {
  try {
    const projectId = req.params.project_id || req.params.projectId
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (!userId) {
      return res.status(401).json({ error: 'not authenticated' })
    }
    const incoming = req.body?.threads
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: 'threads array required' })
    }

    const [existing, docs, userInfo] = await Promise.all([
      ChatApiHandler.promises.getThreads(projectId).catch(() => ({})),
      ProjectEntityHandler.promises.getAllDocs(projectId).catch(() => ({})),
      UserInfoManager.promises.getPersonalInfo(userId),
    ])
    const formattedUser = UserInfoController.formatPersonalInfo(userInfo)

    // Build a set of already-imported remote ids by scanning local thread
    // messages for our marker.
    const alreadyImported = new Set()
    for (const thread of Object.values(existing || {})) {
      const remoteId = findRemoteIdInThread(thread)
      if (remoteId) alreadyImported.add(remoteId)
    }

    let imported = 0
    let skipped = 0
    let ambiguous = 0
    const errors = []

    for (const thread of incoming) {
      const remoteId = thread?.remote_thread_id
      if (!remoteId) {
        errors.push({ reason: 'missing remote_thread_id' })
        continue
      }
      if (alreadyImported.has(remoteId)) {
        skipped += 1
        continue
      }

      const localThreadId = uuid()
      const messages = Array.isArray(thread.messages) ? thread.messages : []

      // Anchor in source if possible. We don't fail the import if anchoring
      // doesn't work — the thread still appears in the Claude rail.
      const anchor = findAnchor(docs, thread.anchor_text)
      if (anchor?.ambiguous) ambiguous += 1
      // Note: actually inserting a CommentOperation requires a live
      // currentDocument context which we don't have server-side. We record
      // anchor info in the marker so the frontend can perform the
      // CommentOperation insertion if/when the doc is open.

      try {
        let first = true
        for (const m of messages) {
          const author =
            m?.author || m?.user?.email || m?.user_id || 'remote-user'
          const original = (m?.content ?? '').toString()
          const ts = m?.timestamp ? ` (${m.timestamp})` : ''
          const header = first
            ? `${makeMarker(remoteId)} (from ${author})${ts}`
            : `(from ${author})${ts}`
          const body = `${header}\n\n${original}`
          const sent = await ChatApiHandler.promises.sendComment(
            projectId,
            localThreadId,
            userId,
            body
          )
          sent.user = formattedUser
          EditorRealTimeController.emitToRoom(
            projectId,
            'new-comment',
            localThreadId,
            sent
          )
          first = false
        }
        // If no messages were posted (empty source thread), we still record
        // the marker so a re-run skips it.
        if (first) {
          await ChatApiHandler.promises.sendComment(
            projectId,
            localThreadId,
            userId,
            `${makeMarker(remoteId)} (empty thread imported from overleaf.com)`
          )
        }
        imported += 1
      } catch (err) {
        logger.warn(
          { remoteId, err },
          'failed to import remote thread'
        )
        errors.push({ remoteId, reason: err?.message || 'unknown' })
      }
    }

    res.json({ imported, skipped, ambiguous, errors })
  } catch (err) {
    logger.err({ err }, 'claude import-threads failed')
    next(err)
  }
}

// Open CORS preflight + actual response just for this endpoint, restricted
// to the overleaf.com origin so a bookmarklet on that tab can call us.
function corsHeaders(req, res) {
  const origin = req.get('Origin') || ''
  const allowed = [
    'https://www.overleaf.com',
    'https://overleaf.com',
    // Useful for testing against a Server Pro instance the user controls:
    process.env.OVERLEAF_IMPORT_ALLOWED_ORIGIN || '',
  ].filter(Boolean)
  if (allowed.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Credentials', 'true')
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.set('Access-Control-Allow-Headers', 'content-type, x-csrf-token')
    res.set('Vary', 'Origin')
  }
}

function corsMiddleware(req, res, next) {
  corsHeaders(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
}

export default { importThreads, corsMiddleware }
