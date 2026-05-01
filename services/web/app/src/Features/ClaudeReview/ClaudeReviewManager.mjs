// @ts-check

import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import ContextBuilder from './ContextBuilder.mjs'
import SidecarClient from './SidecarClient.mjs'
import PendingEditStore from './PendingEditStore.mjs'
import ChatApiHandler from '../Chat/ChatApiHandler.mjs'
import EditorRealTimeController from '../Editor/EditorRealTimeController.mjs'
import UserInfoManager from '../User/UserInfoManager.mjs'
import UserInfoController from '../User/UserInfoController.mjs'
import settings from '@overleaf/settings'

const DEFAULT_SYSTEM_PROMPT = `You are a research-paper review assistant
integrated into Overleaf.

You can read files in the experiment repository (your cwd) using the Read /
Glob / Grep tools. The manuscript itself is NOT on disk — it lives in the
Overleaf docstore. We will provide the manuscript text in the user message.
Do NOT attempt to Edit / Write the manuscript files directly; instead emit
"edits" entries (see schema below) and the Overleaf web service will apply
them on user approval.

For each unresolved Overleaf comment in the user message, produce:
  1) a "reply" that will be posted to that comment thread (markdown), AND
  2) zero or more "edits" — concrete proposed text replacements for the
     manuscript files included in the user message.

Output ONE JSON object at the end of your response, in a \`\`\`json fenced
code block:

{
  "replies": [
    { "thread_id": "<id>", "reply": "<markdown for the thread reply>" }
  ],
  "edits": [
    {
      "thread_id": "<id this edit addresses>",
      "file_path": "<path exactly as shown in the manuscript section, e.g. /main.tex>",
      "old_text": "<exact substring of current file content; must match verbatim>",
      "new_text": "<replacement text>",
      "rationale": "<one short sentence on why>"
    }
  ]
}

Rules for edits:
- "old_text" MUST appear exactly once in the named file. Include enough
  surrounding context to disambiguate.
- Keep "old_text" small (typically 1–5 sentences). Do not propose a single
  giant whole-file replacement.
- If you cannot produce a clean edit, omit it and explain in "reply".`

function parseProjectConfig(jsonString) {
  try {
    return JSON.parse(jsonString)
  } catch (err) {
    throw new OError('failed to parse _claude/config.json', {
      preview: jsonString?.slice(0, 200),
    }).withCause(err)
  }
}

function extractStructuredResponse(text) {
  // Find a ```json ... ``` block, fall back to last {...}.
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i)
  const candidate = fenceMatch
    ? fenceMatch[1]
    : (() => {
        const start = text.lastIndexOf('{')
        const end = text.lastIndexOf('}')
        if (start === -1 || end === -1 || end < start) return null
        return text.slice(start, end + 1)
      })()
  if (!candidate) return { replies: [], edits: [] }
  try {
    const parsed = JSON.parse(candidate)
    return {
      replies: Array.isArray(parsed?.replies) ? parsed.replies : [],
      edits: Array.isArray(parsed?.edits) ? parsed.edits : [],
    }
  } catch {
    return { replies: [], edits: [] }
  }
}

function buildPrompt(ctx, threadIds) {
  let target = ctx.threads
  if (threadIds && threadIds.length > 0) {
    const wanted = new Set(threadIds)
    target = ctx.threads.filter(t => wanted.has(t.threadId))
  }

  const sections = []

  if (ctx.guideText) {
    sections.push('# Writing guide\n\n' + ctx.guideText)
  }
  if (ctx.relatedWorkText) {
    sections.push('# Related work (from project)\n\n' + ctx.relatedWorkText)
  }

  const manuscript = ctx.manuscriptDocs
    .map(d => `## ${d.path}\n\n\`\`\`latex\n${d.content}\n\`\`\``)
    .join('\n\n')
  sections.push('# Manuscript (current snapshot from Overleaf)\n\n' + manuscript)

  const commentsText = target
    .map(t => {
      const messages = t.messages.map(m => `  - ${m.content}`).join('\n')
      const anchor = t.anchorText
        ? `Anchored on text:\n\`\`\`\n${t.anchorText}\n\`\`\`\n`
        : '(no anchor — locate the text by context)\n'
      return `## thread_id=${t.threadId}\n${anchor}Messages:\n${messages}`
    })
    .join('\n\n')
  sections.push(
    '# Unresolved comments to address\n\n' +
      commentsText +
      '\n\nFor each comment above, produce a revision proposal and emit ' +
      'the JSON summary as instructed in the system prompt.'
  )

  return { prompt: sections.join('\n\n---\n\n'), targetThreads: target }
}

/**
 * @param {{
 *   projectId: string,
 *   userId: string,
 *   threadIds?: string[],
 *   resumeFresh?: boolean,
 * }} args
 */
async function review({ projectId, userId, threadIds, resumeFresh }) {
  const ctx = await ContextBuilder.build(projectId)

  if (!ctx.config) {
    throw new OError(
      '_claude/config.json missing — create it with at least { "experiment_repo": "<absolute path>" }'
    )
  }
  const cfg = parseProjectConfig(ctx.config)
  if (!cfg.experiment_repo) {
    throw new OError(
      '_claude/config.json must define "experiment_repo" (absolute path on the host)'
    )
  }

  const { prompt, targetThreads } = buildPrompt(ctx, threadIds)
  if (targetThreads.length === 0) {
    return { repliesPosted: 0, skipped: 'no unresolved threads' }
  }

  const sidecarResult = await SidecarClient.runReview({
    projectId,
    prompt,
    cwd: cfg.experiment_repo,
    systemPrompt: cfg.system_prompt || DEFAULT_SYSTEM_PROMPT,
    allowedTools: cfg.allowed_tools,
    permissionMode: cfg.permission_mode,
    resumeFresh: !!resumeFresh,
    model: cfg.model || settings.apis?.claudeReview?.defaultModel,
    sidecarUrl: cfg.sidecar_url,
  })

  const { replies, edits } = extractStructuredResponse(sidecarResult.reply || '')

  let storedEdits = []
  if (edits.length > 0) {
    storedEdits = await PendingEditStore.add(projectId, edits)
    EditorRealTimeController.emitToRoom(
      projectId,
      'claude-edits-updated',
      storedEdits
    )
  }

  const userInfo = await UserInfoManager.promises.getPersonalInfo(userId)
  const formattedUser = UserInfoController.formatPersonalInfo(userInfo)

  async function postReply(threadId, body) {
    const message = await ChatApiHandler.promises.sendComment(
      projectId,
      threadId,
      userId,
      body
    )
    // Mirror what ThreadsController does so connected clients update without
    // a manual reload.
    message.user = formattedUser
    EditorRealTimeController.emitToRoom(
      projectId,
      'new-comment',
      threadId,
      message
    )
    return message
  }

  let posted = 0
  for (const r of replies) {
    if (!r?.thread_id || !r?.reply) continue
    try {
      await postReply(r.thread_id, `🤖 **Claude Review**\n\n${r.reply}`)
      posted += 1
    } catch (err) {
      logger.warn(
        { projectId, threadId: r.thread_id, err },
        'failed to post Claude reply to thread'
      )
    }
  }

  // If Claude produced no JSON but did produce free-form text, post that
  // as a single message on the first targeted thread so the user is not left
  // wondering whether anything happened.
  if (replies.length === 0 && sidecarResult.reply) {
    try {
      await postReply(
        targetThreads[0].threadId,
        `🤖 **Claude Review**\n\n${sidecarResult.reply}`
      )
      posted = 1
    } catch (err) {
      logger.warn({ projectId, err }, 'failed to post fallback reply')
    }
  }

  return {
    repliesPosted: posted,
    repliesParsed: replies.length,
    editsProposed: storedEdits.length,
    threadsConsidered: targetThreads.length,
    sessionId: sidecarResult.sessionId,
    totalCostUsd: sidecarResult.totalCostUsd,
    usage: sidecarResult.usage,
  }
}

async function clearSession(projectId) {
  const ctx = await ContextBuilder.build(projectId)
  let override
  if (ctx.config) {
    try {
      override = JSON.parse(ctx.config).sidecar_url
    } catch {
      // fall through to default sidecar
    }
  }
  return SidecarClient.clearSession(projectId, override)
}

/**
 * Free-form chat consultation with Claude. Independent of comment threads.
 * Uses a separate session key so it doesn't pollute the comment-review
 * conversation history.
 *
 * @param {{ projectId: string, userMessage: string, resumeFresh?: boolean }} args
 */
async function chat({ projectId, userMessage, resumeFresh }) {
  const ctx = await ContextBuilder.build(projectId)
  if (!ctx.config) {
    throw new OError(
      '_claude/config.json missing — open ⚙ Configure Claude first'
    )
  }
  const cfg = JSON.parse(ctx.config)
  if (!cfg.experiment_repo) {
    throw new OError('_claude/config.json must define experiment_repo')
  }

  const sections = []
  if (ctx.guideText) sections.push('# Writing guide\n\n' + ctx.guideText)
  const manuscript = ctx.manuscriptDocs
    .map(d => `## ${d.path}\n\n\`\`\`latex\n${d.content}\n\`\`\``)
    .join('\n\n')
  if (manuscript) sections.push('# Current manuscript\n\n' + manuscript)
  sections.push('# User message\n\n' + userMessage)

  const result = await SidecarClient.runReview({
    projectId: `${projectId}::chat`,
    prompt: sections.join('\n\n---\n\n'),
    cwd: cfg.experiment_repo,
    systemPrompt:
      'You are a research-paper assistant for an Overleaf project. Reply in ' +
      'the same language the user writes. Be terse. Use code blocks for ' +
      'LaTeX snippets you suggest. You may use Read/Glob/Grep to inspect ' +
      'the experiment repository if helpful.',
    allowedTools: cfg.allowed_tools,
    permissionMode: cfg.permission_mode,
    resumeFresh: !!resumeFresh,
    model: cfg.model || settings.apis?.claudeReview?.defaultModel,
    sidecarUrl: cfg.sidecar_url,
  })

  return {
    reply: result.reply || '',
    sessionId: result.sessionId,
    totalCostUsd: result.totalCostUsd,
    usage: result.usage,
  }
}

async function listEdits(projectId) {
  return PendingEditStore.list(projectId)
}

/**
 * Apply a single proposed edit by replacing `old_text` with `new_text` in
 * the named project doc. Validates that `old_text` appears exactly once so
 * we never silently overwrite the wrong section.
 */
async function applyEdit({ projectId, userId, editId, EditorController, ProjectEntityHandler }) {
  const items = await PendingEditStore.list(projectId)
  const edit = items.find(e => e.id === editId)
  if (!edit) throw new OError('edit not found', { editId })
  if (edit.status !== 'pending') {
    throw new OError('edit already resolved', { editId, status: edit.status })
  }

  const docs = await ProjectEntityHandler.promises.getAllDocs(projectId)
  const doc = docs[edit.file_path]
  if (!doc) throw new OError('doc not found', { file_path: edit.file_path })

  const currentContent = (doc.lines || []).join('\n')
  const occurrences = currentContent.split(edit.old_text).length - 1
  if (occurrences === 0) {
    throw new OError('old_text not present in current document', {
      file_path: edit.file_path,
    })
  }
  if (occurrences > 1) {
    throw new OError('old_text matches multiple times — refusing to apply', {
      file_path: edit.file_path,
      occurrences,
    })
  }

  // Use split+join instead of String#replace to avoid the latter
  // interpreting special replacement patterns like $&, $$ inside new_text —
  // common in LaTeX (math mode delimiters) and would silently corrupt
  // Claude's proposed text.
  const newContent = currentContent.split(edit.old_text).join(edit.new_text)
  await EditorController.promises.upsertDocWithPath(
    projectId,
    edit.file_path,
    newContent.split('\n'),
    'claude-review',
    userId
  )

  await PendingEditStore.setStatus(projectId, editId, 'applied')
  EditorRealTimeController.emitToRoom(
    projectId,
    'claude-edit-applied',
    editId
  )
  return { ok: true, edit: { ...edit, status: 'applied' } }
}

async function skipEdit({ projectId, editId }) {
  const updated = await PendingEditStore.setStatus(projectId, editId, 'skipped')
  if (!updated) throw new OError('edit not found', { editId })
  EditorRealTimeController.emitToRoom(projectId, 'claude-edit-skipped', editId)
  return { ok: true, edit: updated }
}

export default {
  review,
  chat,
  clearSession,
  listEdits,
  applyEdit,
  skipEdit,
}
