// @ts-check
//
// Stores Claude-proposed edits per project so the UI can show Apply/Skip
// buttons after a /review call returns. Backed by Redis with a 1-hour TTL —
// if the user doesn't act within that window the proposal is discarded.

import RedisWrapper from '../../infrastructure/RedisWrapper.mjs'
import { randomUUID } from 'node:crypto'

const TTL_SECONDS = 60 * 60
const rclient = RedisWrapper.client('web')

function key(projectId) {
  return `claude:edits:${projectId}`
}

/**
 * @typedef {Object} EditProposal
 * @property {string} id
 * @property {string} thread_id
 * @property {string} file_path
 * @property {string} old_text
 * @property {string} new_text
 * @property {string} [rationale]
 * @property {number} created_at
 * @property {'pending'|'applied'|'skipped'} status
 */

/** @param {string} projectId @param {EditProposal[]} edits */
async function add(projectId, edits) {
  if (!edits.length) return []
  const stamped = edits.map(e => ({
    ...e,
    id: e.id || randomUUID(),
    status: 'pending',
    created_at: Date.now(),
  }))
  const json = JSON.stringify(stamped)
  const existing = await rclient.get(key(projectId))
  let merged
  if (existing) {
    try {
      merged = JSON.stringify([...JSON.parse(existing), ...stamped])
    } catch {
      merged = json
    }
  } else {
    merged = json
  }
  await rclient.set(key(projectId), merged, 'EX', TTL_SECONDS)
  return stamped
}

/** @param {string} projectId */
async function list(projectId) {
  const raw = await rclient.get(key(projectId))
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

/** @param {string} projectId @param {string} editId @param {EditProposal['status']} status */
async function setStatus(projectId, editId, status) {
  const items = await list(projectId)
  const idx = items.findIndex(e => e.id === editId)
  if (idx === -1) return null
  items[idx].status = status
  await rclient.set(key(projectId), JSON.stringify(items), 'EX', TTL_SECONDS)
  return items[idx]
}

/** @param {string} projectId */
async function clear(projectId) {
  await rclient.del(key(projectId))
}

export default { add, list, setStatus, clear }
