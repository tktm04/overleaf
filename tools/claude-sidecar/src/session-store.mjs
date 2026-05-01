// Tiny file-backed map from Overleaf projectId → Claude SDK sessionId.
// Used so successive "Ask Claude" calls in the same Overleaf project resume
// the prior agent session and remember the conversation history.

import fs from 'node:fs/promises'
import path from 'node:path'

const STORE_PATH = path.resolve('.session-store.json')

let cache = null

async function load() {
  if (cache) return cache
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8')
    cache = JSON.parse(raw)
  } catch {
    cache = {}
  }
  return cache
}

async function save() {
  await fs.writeFile(STORE_PATH, JSON.stringify(cache, null, 2))
}

export async function getSessionId(projectId) {
  const c = await load()
  return c[projectId] || null
}

export async function setSessionId(projectId, sessionId) {
  const c = await load()
  c[projectId] = sessionId
  await save()
}

export async function clearSession(projectId) {
  const c = await load()
  delete c[projectId]
  await save()
}
