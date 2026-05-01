import express from 'express'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  getSessionId,
  setSessionId,
  clearSession,
} from './session-store.mjs'

const PORT = parseInt(process.env.PORT || '8888', 10)
// Default to loopback. Set HOST=0.0.0.0 (or a Tailscale IP) when running on
// a remote machine that the Overleaf web container should reach over network.
const HOST = process.env.HOST || '127.0.0.1'

// Tools we are willing to expose by default. The web feature can override per
// request via `allowedTools` in the body. Phase 2-A has no per-call approval
// UI yet — we therefore start with a *read-only-friendly* whitelist and let
// the human approve write/exec tools out-of-band by setting them in
// _claude/config.yml.
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep']

const app = express()
app.use(express.json({ limit: '32mb' }))

app.get('/health', (req, res) => {
  res.json({ ok: true, port: PORT })
})

app.post('/review', async (req, res) => {
  const {
    projectId,
    prompt,
    cwd,
    systemPrompt,
    allowedTools,
    permissionMode,
    resumeFresh,
    model,
  } = req.body || {}

  if (!projectId || !prompt) {
    return res
      .status(400)
      .json({ error: 'projectId and prompt are required' })
  }

  const previousSessionId = resumeFresh
    ? null
    : await getSessionId(projectId)

  const options = {
    cwd: cwd || process.cwd(),
    allowedTools: Array.isArray(allowedTools)
      ? allowedTools
      : DEFAULT_ALLOWED_TOOLS,
    permissionMode: permissionMode || 'default',
  }
  if (systemPrompt) options.systemPrompt = systemPrompt
  if (model) options.model = model
  if (previousSessionId) options.resume = previousSessionId

  console.log(
    `[review] projectId=${projectId} cwd=${options.cwd} resume=${
      previousSessionId || '<new>'
    } tools=${options.allowedTools.join(',')}`
  )

  const messages = []
  let lastSessionId = previousSessionId
  let assistantText = ''
  let totalCostUsd = 0
  let usage = null
  let resultMeta = null

  try {
    for await (const m of query({ prompt, options })) {
      messages.push({ type: m.type, subtype: m.subtype })

      if (m.type === 'system' && m.subtype === 'init') {
        lastSessionId = m.session_id
      } else if (m.type === 'assistant') {
        const content = m.message?.content || []
        for (const block of content) {
          if (block.type === 'text') {
            assistantText += block.text
          }
        }
      } else if (m.type === 'result') {
        totalCostUsd = m.total_cost_usd ?? 0
        usage = m.usage ?? null
        resultMeta = {
          subtype: m.subtype,
          duration_ms: m.duration_ms,
          duration_api_ms: m.duration_api_ms,
          num_turns: m.num_turns,
          is_error: m.is_error,
        }
        if (m.session_id) lastSessionId = m.session_id
      }
    }

    if (lastSessionId) {
      await setSessionId(projectId, lastSessionId)
    }

    res.json({
      ok: true,
      projectId,
      sessionId: lastSessionId,
      reply: assistantText,
      messageCount: messages.length,
      totalCostUsd,
      usage,
      result: resultMeta,
    })
  } catch (err) {
    console.error('[review] error', err)
    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    })
  }
})

app.post('/session/clear', async (req, res) => {
  const { projectId } = req.body || {}
  if (!projectId) return res.status(400).json({ error: 'projectId required' })
  await clearSession(projectId)
  res.json({ ok: true })
})

app.listen(PORT, HOST, () => {
  console.log(`claude-sidecar listening on http://${HOST}:${PORT}`)
})
