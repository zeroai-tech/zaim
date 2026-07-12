# Zaim

**Secure, stylish mail — for humans *and* their AI agents.**

Zaim is a mail client with three faces on one secure core:

- **Web app** — a clean, fast, Outlook-class inbox. Deploy to Vercel; a company runs its own.
- **CLI** — `zaim list / read / send`, so agents like **Claude Code, Gemini, and Codex** manage professional email from a tool call.
- **API** — the same endpoints the web app uses, key-authenticated, ready for any integration.

Built by **ZeroAI**.

---

## Why

Every AI coding agent can write an email — none can *send* one safely from your real mailbox. Zaim is the secure bridge: your accounts stay encrypted on your own deployment, and agents act through a scoped, key-gated API instead of touching raw credentials.

## Quick start

```bash
cp .env.example .env        # fill in ZAIM_API_KEY + your IMAP/SMTP account
npm install
npm run dev                 # → http://localhost:3000
```

Open the web app, enter your `ZAIM_API_KEY`, and you're in.

## The agent / CLI surface

```bash
export ZAIM_URL=https://mail.yourco.com   ZAIM_API_KEY=…

zaim status
zaim list --limit 20
zaim read 4096
zaim send --to principal@school.org --subject "Follow-up" --body "…" --json
```

Every command maps to an HTTP endpoint (`GET /api/mail/list`, `GET /api/mail/message/:uid`, `POST /api/mail/send`), authenticated with `Authorization: Bearer $ZAIM_API_KEY`. That's the whole contract an agent needs.

## Security posture

- **No plaintext at rest** — mailbox passwords can be stored AES-256-GCM encrypted (`ZAIM_ENC_KEY`); `zaim encrypt "<pw>"` produces the value.
- **Key-gated** — every API call requires the key; timing-safe comparison; httpOnly `Secure` cookie for the web session.
- **Sandboxed rendering** — HTML email is rendered in a `sandbox=""` iframe (no scripts, no same-origin) so a malicious email can't touch your session.
- **Your data, your deployment** — Zaim never phones home; it talks only to your mail host.

## Deploy to Vercel

```bash
vercel        # set the ZAIM_* env vars in the Vercel dashboard
```
API routes run on the Node.js runtime (imapflow/nodemailer), one connection per request — serverless-friendly.

## Roadmap

- **Phase 1 (this repo)** — web client + agent API + CLI on one secure single-account core ✅
- **Phase 2** — per-user auth + encrypted multi-account **vault** (companies, teams)
- **Phase 3** — installable desktop app (Electron)
- **Phase 4** — full ZeroAI-family branding + marketing launch

---

© ZeroAI Technologies — engine: imapflow · nodemailer · mailparser · Next.js.
