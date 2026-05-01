// @ts-check

import ProjectEntityHandler from '../Project/ProjectEntityHandler.mjs'
import DocstoreManager from '../Docstore/DocstoreManager.mjs'
import ChatApiHandler from '../Chat/ChatApiHandler.mjs'

const GUIDE_PATHS = [
  '/_claude/WRITING_GUIDE.md',
  '/_claude/FEEDBACK_LESSONS.md',
  '/_claude/CLAUDE.md',
]
const CONFIG_PATH = '/_claude/config.json'

/**
 * Gather everything Claude needs to review a project's open comments:
 * - the project's docs (path + lines)
 * - any _claude/ guide files (concatenated)
 * - any _claude/related/*.tex files (concatenated)
 * - the unresolved threads with their messages and anchor text
 *
 * @param {string} projectId
 * @returns {Promise<{
 *   manuscriptDocs: Array<{path: string, content: string}>,
 *   guideText: string,
 *   relatedWorkText: string,
 *   threads: Array<{
 *     threadId: string,
 *     anchorText: string|null,
 *     messages: Array<{user_id: string, content: string}>,
 *   }>,
 * }>}
 */
async function build(projectId) {
  const docs = await ProjectEntityHandler.promises.getAllDocs(projectId)

  const manuscriptDocs = []
  const guideParts = []
  const relatedParts = []
  let config = null

  for (const [docPath, doc] of Object.entries(docs)) {
    const content = (doc.lines || []).join('\n')
    if (docPath === CONFIG_PATH) {
      config = content
    } else if (GUIDE_PATHS.includes(docPath)) {
      guideParts.push(`### ${docPath}\n\n${content}`)
    } else if (docPath.startsWith('/_claude/related/')) {
      relatedParts.push(`### ${docPath}\n\n${content}`)
    } else if (docPath.startsWith('/_claude/')) {
      // Any other _claude/ markdown is treated as guide
      if (docPath.endsWith('.md')) {
        guideParts.push(`### ${docPath}\n\n${content}`)
      }
    } else {
      manuscriptDocs.push({ path: docPath, content })
    }
  }

  const threadsRaw = await ChatApiHandler.promises.getThreads(projectId)
  const ranges = await DocstoreManager.promises.getAllRanges(projectId)

  // Index comment-anchor positions by threadId.
  // ranges format: [{ _id: docId, ranges: { comments: [{ op: { p, c, t } }] } }]
  const anchorByThread = {}
  for (const docRanges of ranges || []) {
    const comments = docRanges?.ranges?.comments || []
    for (const comment of comments) {
      const op = comment.op || comment
      const threadId = op.t
      const text = op.c
      if (threadId) {
        anchorByThread[threadId] = text || null
      }
    }
  }

  const threads = []
  for (const [threadId, threadInfo] of Object.entries(threadsRaw || {})) {
    if (threadInfo?.resolved) continue
    threads.push({
      threadId,
      anchorText: anchorByThread[threadId] || null,
      messages: (threadInfo?.messages || []).map(m => ({
        user_id: m.user_id,
        content: m.content,
      })),
    })
  }

  return {
    config,
    manuscriptDocs,
    guideText: guideParts.join('\n\n---\n\n'),
    relatedWorkText: relatedParts.join('\n\n---\n\n'),
    threads,
  }
}

export default { build }
