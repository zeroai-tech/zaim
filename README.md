# Zaim

**Secure, stylish mail — for humans *and* their AI agents.**

Zaim is a mail client with three faces on one secure core:

- **Web app** — a clean, fast, Outlook-class inbox. Deploy to Vercel; a company runs its own.
- **CLI** — `zaim list / read / send`, so agents like **Claude Code, Gemini, and Codex** manage professional email from a tool call.
- **MCP server** — the same mailbox as first-class Model Context Protocol tools (`zaim_list`, `zaim_read`, `zaim_send`, `zaim_draft`, `zaim_delete`), so any MCP client drives it natively.
- **API** — the same endpoints the web app uses, key-authenticated, ready for any integration.

Built by **ZeroAI**.

## Desktop offline workspace

The desktop app runs its mail server on loopback and stores its vault in the OS application-data directory. Its redesigned inbox, reader, composer, light/dark themes and mobile layouts also serve the web app.

- Sign in while connected. The encrypted mailbox session lasts 30 days; signing in again requires a connection.
- Open a folder and choose **Download for offline**. This downloads the currently loaded messages and available attachments, without changing unread flags. Load additional pages and download them separately as needed.
- During a transport outage, downloaded folder lists and messages remain available. Messages and attachments that were never downloaded require reconnecting. Authentication rejection does not silently fall back to cached mail.
- **Local drafts** save recipients, formatted content and attachments on this device, including incomplete drafts. They survive an app restart. Reconnecting never sends a draft automatically; review it and click **Send** while connected.
- SMTP delivery can be ambiguous after a timeout: check Sent before retrying. Zaim does not automatically retry sending.

Offline records are encrypted with the per-machine key, scoped to the account, and written atomically with owner-only file permissions. The key lives in the same profile; this is not protection against someone who can read the entire profile. Back up the profile and its secrets together. Remote images in message bodies are blocked until explicitly enabled.

Build the Electron app with `npm run desktop:dist`. For an isolated profile, set `ZAIM_USER_DATA_DIR` to an absolute directory; `ZAIM_PORT` optionally changes the loopback port (default 34117). A macOS window can be closed and reopened without stopping the local mail server. The legacy Go shell is not the verified release path.

### Verification

`npm run build`, `npm run lint` and `npm run test:offline` check production compilation, types and encrypted-cache behavior. `node scripts/verify-desktop.cjs /path/to/playwright` runs the production server with isolated fake IMAP/SMTP transports and checks cached mail, attachments, draft persistence, explicit sending, responsive layouts and themes. It requires local Chrome and Electron on macOS.

After packaging a Mac x64 app into `release/mac/Zaim.app`, run `node scripts/verify-packaged.cjs /path/to/playwright`. It seeds downloaded fixture mail into an isolated encrypted profile, then verifies the actual packaged app can read it offline, save a draft, restart with its session and draft intact, and reopen the last window. No real email is sent. Live provider delivery, Windows/Linux installers, signing and notarization require separate validation.

---

## Why

Every AI coding agent can write an email — none can *send* one safely from your real mailbox. Zaim is the secure bridge: your accounts stay encrypted, and agents act through a scoped, key-gated API instead of touching raw credentials.

## Already have a Zaim link (e.g. from your company)?

You don't need Vercel, `.env`, or anything below this section. Zaim runs multi-user:

1. Open the app (e.g. `https://zaim.zeroaitech.tech`) and **sign up** with an email + password.
2. Add your own mailbox from the app (IMAP/SMTP host, user, password) — it's encrypted per-user, nobody else can see it.
3. Click your avatar (top right) → **🔑 Agent keys** → generate a key. That's your `ZAIM_API_KEY`.
4. Give that key to your CLI or agent:
   ```bash
   export ZAIM_URL=https://zaim.zeroaitech.tech   ZAIM_API_KEY=<the key you just generated>
   zaim status
   ```

That's the whole setup. The rest of this README is for standing up a *new* deployment.

## Quick start (deploying your own instance)

```bash
cp .env.example .env        # see the file — multi-user mode needs only 2-3 server secrets
npm install
npm run dev                 # → http://localhost:3000
```

In multi-user mode (recommended — see `.env.example`), you only set `POSTGRES_URL` + `ZAIM_ENC_KEY` (+ optionally `ZAIM_SESSION_SECRET`) once per deployment. Every user then signs up and configures their *own* mailbox and keys from the UI — the IMAP/SMTP/`ZAIM_API_KEY` block in `.env.example` is only for the older single-shared-account mode, and isn't needed for a normal multi-user deployment.

## The agent / CLI surface

```bash
export ZAIM_URL=https://mail.yourco.com   ZAIM_API_KEY=…

zaim status
zaim list --limit 20
zaim read 4096
zaim send --to principal@school.org --subject "Follow-up" --body "…" --json
```

Every command maps to an HTTP endpoint (`GET /api/mail/list`, `GET /api/mail/message/:uid`, `POST /api/mail/send`), authenticated with `Authorization: Bearer $ZAIM_API_KEY`. That's the whole contract an agent needs.

## Model Context Protocol (MCP) server

Zaim supports the Model Context Protocol (MCP) across two distinct, production-ready transports:

1. **Local `stdio` MCP** — for local CLI agents such as Claude Code, Codex, and Cursor.
2. **Remote Streamable HTTP MCP** — for internet-connected AI clients, including ChatGPT-compatible MCP connectors, cloud agents, and multi-tenant platforms.

Both transports share the same underlying tool registry and enforce server-side permission scopes so agents only execute what their API key permits.

### Available MCP tools

| Tool Name | Required Scope | Privileged? | Description |
| :--- | :--- | :---: | :--- |
| `zaim_status` | `mail.read` | No | Verify connection, configured mailbox, and granted scopes. |
| `zaim_folders` | `mail.read` | No | List mailbox folders (`INBOX`, `Sent`, `Drafts`, `Trash`, etc.). |
| `zaim_list` | `mail.search` | No | List and filter messages in a folder with read/flagged states. |
| `zaim_read` | `mail.read` | No | Read a message in full by its UID (headers, body, attachment metadata). |
| `zaim_draft` | `mail.draft` | No | Compose and save to Drafts via IMAP append (no SMTP; safe for review). |
| `zaim_send` | `mail.send` | **Yes** | Send email immediately via SMTP and save a copy to Sent. |
| `zaim_delete` | `mail.delete` | **Yes** | Move message to Trash or permanently expunge. |

---

### Local MCP (`stdio`)

Run the zero-dependency stdio server directly:

```bash
node bin/zaim-mcp.mjs
```

Or configure Claude Code:

```bash
claude mcp add zaim -s user \
  -e ZAIM_URL=https://mail.yourco.com \
  -e ZAIM_API_KEY=zaim_... \
  -- node /path/to/zaim/bin/zaim-mcp.mjs
```

---

### Remote MCP (Streamable HTTP & SSE)

Start the remote MCP server:

```bash
# Starts listening on http://0.0.0.0:3001/mcp
npm run mcp:server
```

Or run via Node with custom environment variables:

```bash
ZAIM_URL=https://mail.yourdomain.com \
ZAIM_MCP_HOST=0.0.0.0 \
ZAIM_MCP_PORT=3001 \
ZAIM_MCP_PATH=/mcp \
node bin/zaim-mcp-server.mjs
```

#### Health check

```bash
curl http://localhost:3001/health
# {"status":"ok","service":"zaim-mcp"}
```

#### Docker deployment

Build and run with Docker:

```bash
docker build -t zaim-mcp -f Dockerfile.mcp .
docker run -d \
  -p 3001:3001 \
  -e ZAIM_URL=https://mail.yourdomain.com \
  zaim-mcp
```

Or use Docker Compose:

```bash
docker compose -f docker-compose.mcp.yml up -d
```

The service listens on `0.0.0.0` and respects platform-provided `$PORT` (Render, Railway, Fly.io, Kubernetes, VPS).

---

### Authentication & Permission Scopes

Remote MCP clients authenticate on every request using standard HTTP headers:

```http
Authorization: Bearer <ZAIM_API_KEY>
```

#### Granular Scopes
- `mail.read` — Read emails and view folder contents.
- `mail.search` — List folders and search/filter messages.
- `mail.draft` — Save drafts in the Drafts folder (zero sending risk).
- `mail.send` — **Privileged**: Send emails immediately via SMTP.
- `mail.delete` — **Privileged**: Delete or permanently expunge messages.
- `mail.manage` (or `*`) — Full mailbox access.

#### Security Recommendation: Scoped Keys for AI Clients
Never grant raw mailbox credentials or blanket send/delete permissions to automated AI agents. Instead, mint scoped keys in Zaim:

1. **`AI_READ_ONLY_KEY`** (`mail.read,mail.search`)
   - For email summarization, inbox triage, and notification agents.
   - Any attempt to call `zaim_send` or `zaim_delete` is rejected server-side with code `-32001 Permission denied`.
2. **`AI_DRAFT_KEY`** (`mail.read,mail.search,mail.draft`)
   - For outreach and email assistant agents that draft replies.
   - The agent writes to `Drafts` so a human can inspect and approve before sending.
3. **`AI_SEND_KEY`** (`mail.read,mail.send`)
   - Reserved strictly for designated high-trust transactional sending agents.

---

### Connecting ChatGPT / Remote MCP Clients

Remote clients connect over HTTPS to your public MCP endpoint:

```text
Endpoint URL: https://mcp.yourdomain.com/mcp
Authentication: Bearer Token (ZAIM_API_KEY)
```

Example ChatGPT MCP connector / custom action configuration:
- **Server URL**: `https://mcp.yourdomain.com/mcp`
- **Auth Type**: Bearer
- **Token**: `zaim_...` (Scoped Agent Key)

## Security posture

- **No plaintext at rest** — mailbox passwords can be stored AES-256-GCM encrypted (`ZAIM_ENC_KEY`); `zaim encrypt "<pw>"` produces the value.
- **Key-gated** — every API call requires the key; timing-safe comparison; httpOnly `Secure` cookie for the web session.
- **Sandboxed rendering** — HTML email is rendered in a `sandbox=""` iframe (no scripts, no same-origin) so a malicious email can't touch your session.
- **Your data, your deployment** — Zaim never phones home; it talks only to your mail host.

## Deploy to Vercel

```bash
vercel
# In the Vercel dashboard, set:
#   POSTGRES_URL        — Neon/Supabase/Vercel Postgres connection string
#   ZAIM_ENC_KEY         — openssl rand -hex 32
#   ZAIM_SESSION_SECRET  — openssl rand -hex 32 (optional, falls back to ZAIM_ENC_KEY)
# That's it for multi-user mode — do NOT set the IMAP/SMTP/ZAIM_API_KEY block,
# those are single-account-mode only and users will configure their own instead.
```
API routes run on the Node.js runtime (imapflow/nodemailer), one connection per request — serverless-friendly.

## Roadmap

- **Phase 1** — web client + agent API + CLI on one secure single-account core ✅
- **Phase 2** — per-user auth + encrypted multi-account **vault** (companies, teams) ✅
- **Phase 3** — installable desktop app (Electron) ✅
- **MCP server** — native Model Context Protocol tools for any MCP client ✅
- **Phase 4** — full ZeroAI-family branding + marketing launch

---

© ZeroAI Technologies — engine: imapflow · nodemailer · mailparser · Next.js.

## Desktop updates

The desktop app checks for stable updates after startup and every six hours. Users can also choose **Help → Check for Updates** or use the profile menu. **Update** downloads and verifies the package; **Restart and update** first saves any open draft, then applies the update. Closing the app alone never installs an update.

Windows NSIS and Linux AppImage updates use `electron-updater`. Mac updates verify the release checksum and app identity, replace the bundle in place, and restore the previous bundle if the new mail server does not start. Existing mail, credentials, cache and drafts remain in the application-data directory. The app's installation folder must be writable. Differential downloads reuse cached packages and published block maps where possible; the first update or an unavailable delta can require a complete package transfer.

Each published main-branch build receives `major.minor.GITHUB_RUN_NUMBER` from `scripts/version-build.cjs`, so builds are detectable without manually changing the patch number. CI publishes Windows/Linux update YAML, block maps and per-architecture Mac manifests with the installers, then makes the complete release public under its `v<version>` tag. Keep the package major/minor version current when starting a new release series.

Versions before this updater was added require one installation of an updater-enabled release. Future releases are applied inside Zaim.

Verification: `npm run test:updates`, `node scripts/verify-desktop.cjs` and `node scripts/verify-packaged.cjs`. The latter two use Playwright and isolated test profiles; fixture messages are never sent to real recipients.
