# How I gave Claude access to my Proton inbox without any mail leaving my machine

*Ready to post to: r/ProtonMail · r/privacy · r/selfhosted · Proton community forum*

---

I've been using Proton Mail for a few years because I care about where my data goes. When AI email tools started appearing, I wanted the same thing — Claude helping me triage my inbox — but every option I found either required OAuth access that grants a third party read rights to my mail, or routed messages through a cloud relay.

So I built something different.

## How it works

```
Proton Bridge (on your machine)
    ↓  IMAP / SMTP (localhost)
proton-mail-bridge-client
    ↓  SQLite index (on your machine)
Claude Desktop
    ↓  MCP stdio (local process)
Claude
```

Every step in that chain is local. Proton Bridge runs on your machine and exposes your mail over localhost IMAP/SMTP — the same way Thunderbird or Apple Mail connects. The client reads that local IMAP, builds a local SQLite index for fast search, and exposes an MCP server over stdio so Claude Desktop can call it as a local process.

No relay. No remote URL. No OAuth. The Bridge connection is local. A cloud AI client may transmit email content to its model provider; use a local model when content must stay on the machine.

## What you can do with it

**In Claude Desktop:**
> "Give me a digest of my inbox. Flag anything that needs a reply today."

> "Go through my unread from the past 3 days. Archive newsletters, trash promotional, tell me what needs action."

> "I have a call with alice@example.com in an hour. Pull our last 5 threads and summarise the open items."

**From the terminal** (it's also a full CLI):
```bash
# Morning digest
proton-mail-bridge-client digest

# Finance automation
proton-mail-bridge-client search --from stripe.com --json | jq '.[].subject'

# Send via pipe
echo "Deploy done at $(date)" | proton-mail-bridge-client send --to alerts@example.com --subject "Deploy"

# Cron digest every weekday at 8am
0 8 * * 1-5 proton-mail-bridge-client digest >> ~/mail-log.txt
```

## Safety

- `PROTONMAIL_READ_ONLY=true` — Claude can read but never write
- `PROTONMAIL_ALLOW_SEND=false` — disable SMTP entirely
- `PROTONMAIL_CONFIRM_DESTRUCTIVE=true` — Claude pauses and asks before sending or deleting
- `dryRun: true` on all batch operations — preview before mutating
- Audit log of every action at `~/.proton-mail-bridge-client/audit.log`

The recommended system prompt in the README adds these safety rails automatically via Claude's behaviour rather than just config flags.

## Install

```bash
npm install -g proton-mail-bridge-client
# or
brew tap googlarz/tap && brew install proton-mail-bridge-client
```

Then run the guided setup:
```bash
proton-mail-bridge-client setup-claude-desktop
```

The wizard checks your Bridge ports, asks for credentials, builds the project, and writes the Claude Desktop config — about 2 minutes from zero to first triage session.

GitHub: https://github.com/googlarz/proton-mail-bridge-client

Happy to answer questions about the architecture or the Bridge IMAP quirks.
