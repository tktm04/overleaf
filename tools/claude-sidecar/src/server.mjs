import express from 'express'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  getSessionId,
  setSessionId,
  clearSession,
} from './session-store.mjs'

const execFileP = promisify(execFile)

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

// --------------------------------------------------------------------------
// Git sync helpers
//
// The web service proxies /sync/{status,pull,push} from the Claude rail's
// "Sync" section to here. We just shell out to git inside the project's
// experiment_repo (the same path Claude operates in).

function isPathSafe(p) {
  return typeof p === 'string' && p.length > 0 && !p.includes('\0')
}

async function runGit(repoPath, args) {
  const { stdout, stderr } = await execFileP('git', ['-C', repoPath, ...args], {
    maxBuffer: 4 * 1024 * 1024,
  })
  return { stdout, stderr }
}

app.post('/sync/status', async (req, res) => {
  const { repoPath } = req.body || {}
  if (!isPathSafe(repoPath))
    return res.status(400).json({ error: 'repoPath required' })
  try {
    const [porcelain, head, upstream] = await Promise.all([
      runGit(repoPath, ['status', '--porcelain']).catch(() => ({ stdout: '' })),
      runGit(repoPath, ['log', '-1', '--format=%h %ci %s']).catch(() => ({
        stdout: '',
      })),
      runGit(repoPath, [
        'for-each-ref',
        '--format=%(upstream:short) %(upstream:track)',
        'refs/heads',
      ]).catch(() => ({ stdout: '' })),
    ])
    const dirty = porcelain.stdout
      .split('\n')
      .filter(line => line.trim().length > 0)
    res.json({
      ok: true,
      dirty: dirty.length,
      dirtyFiles: dirty.slice(0, 50),
      head: head.stdout.trim(),
      upstream: upstream.stdout.trim(),
    })
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'git status failed',
      stderr: err?.stderr || '',
    })
  }
})

app.post('/sync/pull', async (req, res) => {
  const { repoPath, rebase } = req.body || {}
  if (!isPathSafe(repoPath))
    return res.status(400).json({ error: 'repoPath required' })
  try {
    const args = rebase ? ['pull', '--rebase'] : ['pull', '--ff-only']
    const { stdout, stderr } = await runGit(repoPath, args)
    res.json({ ok: true, stdout, stderr })
  } catch (err) {
    res.status(409).json({
      ok: false,
      error: err?.message || 'git pull failed',
      stdout: err?.stdout || '',
      stderr: err?.stderr || '',
    })
  }
})

app.post('/sync/push', async (req, res) => {
  const { repoPath, message } = req.body || {}
  if (!isPathSafe(repoPath))
    return res.status(400).json({ error: 'repoPath required' })
  const commitMessage =
    (typeof message === 'string' && message.trim()) ||
    `Claude Review apply (${new Date().toISOString()})`
  try {
    const out = []
    const stage = await runGit(repoPath, ['add', '-A'])
    out.push(stage)
    // Only commit if there's anything staged.
    let committed = false
    try {
      const commit = await runGit(repoPath, [
        'commit',
        '-m',
        commitMessage,
      ])
      out.push(commit)
      committed = true
    } catch (err) {
      // exit 1 with "nothing to commit" is fine; rethrow others
      if (!/nothing to commit/i.test(err?.stdout || '')) {
        throw err
      }
    }
    const push = await runGit(repoPath, ['push'])
    out.push(push)
    res.json({
      ok: true,
      committed,
      stdout: out.map(o => o.stdout).join('\n'),
      stderr: out.map(o => o.stderr).join('\n'),
    })
  } catch (err) {
    res.status(409).json({
      ok: false,
      error: err?.message || 'git push failed',
      stdout: err?.stdout || '',
      stderr: err?.stderr || '',
    })
  }
})

app.listen(PORT, HOST, () => {
  console.log(`claude-sidecar listening on http://${HOST}:${PORT}`)
})
