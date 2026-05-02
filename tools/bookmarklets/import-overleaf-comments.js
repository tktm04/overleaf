// Bookmarklet: import-overleaf-comments
// ----------------------------------------
// Run this on a tab logged in to www.overleaf.com (or any Overleaf
// instance) while a project is open. It reads the project's open threads
// via the same internal API the editor uses, then POSTs them to your
// local fork's /claude/import-threads endpoint so Claude can review them.
//
// The first time you run it, you'll be prompted for the local-fork
// project id and base URL. Both are stored in localStorage afterwards
// (key: "claudeImportTarget").
//
// To install: minify this file (e.g. with `terser --compress --mangle`)
// and prefix the output with `javascript:`. Drag the resulting URL into
// your browser's bookmarks bar. Click while on overleaf.com.

;(async () => {
  const remoteProjectMatch = location.pathname.match(/project\/([^/?#]+)/)
  if (!remoteProjectMatch) {
    alert('Run this on an Overleaf project page (URL must contain /project/<id>).')
    return
  }
  const remoteProjectId = remoteProjectMatch[1]

  const STORAGE_KEY = 'claudeImportTarget'
  let target
  try {
    target = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
  } catch (_) {
    target = null
  }

  if (!target?.localProjectId || !target?.localBaseUrl) {
    const localProjectId = prompt(
      'Local-fork project id (the part after /project/ in the URL):',
      target?.localProjectId || ''
    )
    if (!localProjectId) return
    const localBaseUrl =
      prompt(
        'Local-fork base URL:',
        target?.localBaseUrl || 'http://localhost'
      ) || 'http://localhost'
    target = { localProjectId, localBaseUrl }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(target))
  }

  // Fetch open threads from the remote project. Overleaf's response is a
  // map from thread_id to { messages, resolved? }.
  let remoteThreads
  try {
    const r = await fetch(`/project/${remoteProjectId}/threads`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) throw new Error(`threads HTTP ${r.status}`)
    remoteThreads = await r.json()
  } catch (e) {
    alert('Failed to fetch remote threads: ' + (e?.message || e))
    return
  }

  // Reduce to the payload our import endpoint expects.
  const payload = {
    threads: Object.entries(remoteThreads || {})
      .filter(([, t]) => !t?.resolved && (t?.messages || []).length > 0)
      .map(([id, t]) => ({
        remote_thread_id: id,
        anchor_text: '', // overleaf.com's API doesn't return the anchor — anchoring will be best-effort
        messages: (t.messages || []).map((m) => ({
          author:
            (m.user && (m.user.email || m.user.first_name || m.user_id)) ||
            m.user_id ||
            'remote-user',
          content: m.content,
          timestamp: m.timestamp,
        })),
      })),
  }

  if (payload.threads.length === 0) {
    alert('No open threads on this project.')
    return
  }

  // Local fork CSRF: fetch any page that returns the meta tag, parse it,
  // and reuse it on the POST. We only need a CSRF token because our local
  // fork's middleware enforces it for cross-origin POSTs even with CORS.
  let csrfToken = ''
  try {
    const r = await fetch(
      `${target.localBaseUrl}/project/${target.localProjectId}`,
      { credentials: 'include' }
    )
    if (r.ok) {
      const html = await r.text()
      const m = html.match(/name="ol-csrfToken"\s+content="([^"]+)"/)
      if (m) csrfToken = m[1]
    }
  } catch (_) {
    // ignore — try without token; the request will fail with a friendly error
  }

  let result
  try {
    const r = await fetch(
      `${target.localBaseUrl}/project/${target.localProjectId}/claude/import-threads`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      }
    )
    const text = await r.text()
    if (!r.ok) {
      alert(`Import failed (HTTP ${r.status}): ${text.slice(0, 400)}`)
      return
    }
    result = JSON.parse(text)
  } catch (e) {
    alert(
      'Could not reach local fork. Is it running?  ' +
        target.localBaseUrl +
        '\n\n' +
        (e?.message || e)
    )
    return
  }

  alert(
    `Imported: ${result.imported}\n` +
      `Already-present (skipped): ${result.skipped}\n` +
      `Anchors ambiguous: ${result.ambiguous || 0}` +
      (result.errors?.length ? `\nErrors: ${result.errors.length}` : '')
  )
})()
