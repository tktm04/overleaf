# claude-sidecar

Local sidecar that bridges the Overleaf web service to the
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

This runs **on the host** (not inside Docker) so it can use the same
authentication as the host's Claude Code (`~/.claude/.credentials.json`).
That lets the "Ask Claude" feature in your Overleaf fork bill against your
Claude.ai subscription instead of requiring a separate API key.

## Setup

```bash
cd tools/claude-sidecar
npm install
```

Make sure `claude` is logged in on the host:

```bash
claude /login
```

## Run

```bash
npm start                            # 127.0.0.1:8888 (loopback only)
PORT=9000 npm start                  # custom port
HOST=0.0.0.0 npm start               # bind all interfaces (remote use)
```

The Overleaf web container reaches the sidecar via
`host.docker.internal:8888` when sidecar is on the same Mac — set this in
`develop/dev.env`:

```
OVERLEAF_CLAUDE_SIDECAR_URL=http://host.docker.internal:8888
```

For a sidecar on a different host (e.g., an Ubuntu server reachable via
Tailscale), don't change `dev.env`. Instead set `sidecar_url` per-project in
`_claude/config.json` (the Configure Claude modal in the review panel writes
this for you).

## Endpoints

### `POST /review`

```jsonc
{
  "projectId": "<overleaf project id>",      // required
  "prompt": "<the user's review request>",   // required
  "cwd": "/path/to/experiment_repo",         // working_dir for Claude
  "systemPrompt": "...",                     // optional
  "allowedTools": ["Read", "Edit", "Bash"],  // optional, defaults to read-only
  "permissionMode": "default",               // SDK permission mode
  "resumeFresh": false,                      // true → ignore stored session
  "model": "claude-opus-4-7"                 // optional
}
```

Returns:

```jsonc
{
  "ok": true,
  "projectId": "...",
  "sessionId": "...",            // saved; reused on next call for same project
  "reply": "<claude's text>",
  "totalCostUsd": 0.0123,
  "usage": { /* token usage */ }
}
```

### `POST /session/clear`

Clears the stored session id for a project so the next `/review` starts fresh.

```jsonc
{ "projectId": "<id>" }
```

### `GET /health`

```jsonc
{ "ok": true, "port": 8888 }
```
