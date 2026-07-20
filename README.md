# Zaim

**Secure, stylish mail — for humans *and* their AI agents.**

Zaim is a mail client with three faces on one secure core:

- **Web app** — a clean, fast, Outlook-class inbox. Deploy to Vercel; a company runs its own.
- **CLI** — `zaim list / read / send`, so agents like **Claude Code, Gemini, and Codex** manage professional email from a tool call.
- **MCP server** — the same mailbox as first-class Model Context Protocol tools (`zaim_list`, `zaim_read`, `zaim_send`, `zaim_draft`, `zaim_delete`), so any MCP client drives it natively.
- **API** — the same endpoints the web app uses, key-authenticated, ready for any integration.

Built by **ZeroAI**.

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

## MCP server

For MCP clients (Claude Code, Codex, etc.), Zaim ships a stdio MCP server that
exposes the mailbox as native tools — `zaim_status`, `zaim_folders`,
`zaim_list`, `zaim_read`, `zaim_send`, `zaim_draft`, `zaim_delete` — so an agent
manages mail through tool calls instead of shelling out. It's zero-dependency
(pure Node, same as the CLI) and reads the same `ZAIM_URL` / `ZAIM_API_KEY`.

Register it with Claude Code:

```bash
claude mcp add zaim -s user \
  -e ZAIM_URL=https://mail.yourco.com \
  -e ZAIM_API_KEY=zaim_… \
  -- node /path/to/zaim/bin/zaim-mcp.mjs
```

Or point any MCP client at `node bin/zaim-mcp.mjs` (stdio transport) with those
two env vars set. `zaim_send` sends immediately; `zaim_draft` only ever writes
to Drafts (no SMTP), so agent-prepared outreach can't go out unreviewed.

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
