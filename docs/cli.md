# CLI reference

Full command reference for the `proton-mail-bridge-client` CLI. See the [main README](../README.md) for install and setup.

```bash
proton-mail-bridge-client <command> [options]
```

All commands support `--json` for machine-readable output.

## Read

```bash
proton-mail-bridge-client emails --folder INBOX --limit 25
proton-mail-bridge-client read INBOX::25642
proton-mail-bridge-client search "invoice" --limit 10
proton-mail-bridge-client search --live --from openai.com
proton-mail-bridge-client attachments INBOX::25642
```

## Triage

```bash
proton-mail-bridge-client digest
proton-mail-bridge-client threads "quarterly review"
proton-mail-bridge-client actionable
proton-mail-bridge-client followups
proton-mail-bridge-client thread-brief <threadId>
proton-mail-bridge-client document-threads --category invoice
proton-mail-bridge-client meeting-context alice@example.com
```

## Compose & send

```bash
proton-mail-bridge-client send --to bob@example.com --subject "Hey" --body "Hello"
echo "Hello" | proton-mail-bridge-client send --to bob@example.com --subject "Hey"

# Queue with an undo window instead of sending immediately (overrides
# PROTONMAIL_SEND_DELAY_SECONDS for this one send; 0 forces immediate send
# even if the server has a default window configured)
proton-mail-bridge-client send --to bob@example.com --subject "Hey" --body "Hello" --undo-window 10

# A queued send only fires while an MCP server is running against the same
# data directory — a plain CLI invocation exits right after queuing, so
# without --wait it won't deliver on its own. --wait keeps this command
# open (polling) until the send actually fires or is canceled elsewhere.
proton-mail-bridge-client send --to bob@example.com --subject "Hey" --body "Hello" --undo-window 10 --wait

proton-mail-bridge-client reply INBOX::25642 --body "On it."
proton-mail-bridge-client reply INBOX::25642 --reply-all --body "On it."
proton-mail-bridge-client forward INBOX::25642 --to carol@example.com
```

## Mailbox actions

```bash
proton-mail-bridge-client move INBOX::25642 Folders/Archive
proton-mail-bridge-client archive INBOX::25642
proton-mail-bridge-client trash INBOX::25642
proton-mail-bridge-client restore Trash::25642
proton-mail-bridge-client mark-read INBOX::25642
proton-mail-bridge-client mark-read INBOX::25642 --unread
proton-mail-bridge-client star INBOX::25642
proton-mail-bridge-client delete INBOX::25642
proton-mail-bridge-client batch archive INBOX::100,INBOX::101,INBOX::102
proton-mail-bridge-client thread-action <threadId> archive
```

## Folders & labels

```bash
proton-mail-bridge-client folders
proton-mail-bridge-client create-folder Folders/Receipts
proton-mail-bridge-client rename-folder Folders/Receipts Folders/Bills
proton-mail-bridge-client delete-folder Folders/Bills
```

## Drafts

```bash
proton-mail-bridge-client drafts
proton-mail-bridge-client draft-create --to bob@example.com --subject "Draft" --body "..."
proton-mail-bridge-client draft-read <id>
proton-mail-bridge-client draft-update <id> --subject "Updated subject"
proton-mail-bridge-client draft-reply INBOX::25642 --body "Will do."
proton-mail-bridge-client draft-forward INBOX::25642 --to carol@example.com
proton-mail-bridge-client draft-sync <id>
proton-mail-bridge-client draft-send <id>
proton-mail-bridge-client draft-delete <id>
proton-mail-bridge-client remote-drafts
```

## Analytics & diagnostics

```bash
proton-mail-bridge-client stats
proton-mail-bridge-client analytics
proton-mail-bridge-client contacts
proton-mail-bridge-client volume-trends --days 14
proton-mail-bridge-client watch --timeout 30
proton-mail-bridge-client test-email you@example.com
proton-mail-bridge-client doctor
proton-mail-bridge-client status
proton-mail-bridge-client sync --folder INBOX --limit 150

# Each successful sync reconciles deletions within the fetched UID range.
# Repeated --full calls cycle through bounded historical windows after backfill,
# so old deletions are eventually reconciled too. One call is not a full rescan.
proton-mail-bridge-client sync --folder INBOX --full
```

## Ambient notifications

Run as a background daemon — sends a system notification (macOS / Linux) whenever new mail arrives:

```bash
proton-mail-bridge-client notify                              # foreground (Ctrl+C to stop)
proton-mail-bridge-client notify &                            # background
proton-mail-bridge-client notify --folder INBOX --timeout 60  # custom folder and idle timeout
```

Each event is also written as a JSON line to stdout:

```json
{"event":"new_mail","folder":"INBOX","count":2,"at":"2026-05-18T14:32:01.000Z"}
```

Uses IMAP IDLE — no polling between events. Reconnects automatically on transient errors.

## 1:1 tool commands

Every MCP tool has a dedicated CLI subcommand — either one of the friendlier
named commands above, or, for tools without a hand-tuned command, a command
matching the tool name (e.g. `snooze-email`, `create-template`,
`get-attachment-text`). Required fields are positional; anything else
(optional flags, arrays, nested objects) goes through `--args`, same as
`tool` below. Run `proton-mail-bridge-client help` for the full list.

```bash
proton-mail-bridge-client snooze-email INBOX::123 2026-01-15T09:00:00.000Z
proton-mail-bridge-client create-template welcome "Welcome, {{firstName}}!" "Hi {{firstName}}, thanks for joining."
proton-mail-bridge-client render-template <id> --args '{"variables":{"firstName":"Alex"}}'
proton-mail-bridge-client reply-to-email INBOX::123 "Sounds good, thanks!"
```

## MCP tool passthrough

Any MCP tool is also callable directly from the CLI by name — useful for
one-offs or tools you don't want a dedicated command name for:

```bash
proton-mail-bridge-client tools
proton-mail-bridge-client tool get_connection_status --json
proton-mail-bridge-client tool search_indexed_emails --args '{"query":"invoice","limit":3}'
```

## Pipe and script

```bash
# Morning digest to a file
proton-mail-bridge-client digest --json > ~/morning-mail.json

# Pull every email from a domain
proton-mail-bridge-client search --from stripe.com --json | jq '.[].subject'

# Pipe a script's output directly into an email
echo "Deploy complete on $(hostname) at $(date)" \
  | proton-mail-bridge-client send --to alerts@example.com --subject "Deploy done"

# Scheduled digest every weekday at 8am (cron)
0 8 * * 1-5 proton-mail-bridge-client digest >> ~/mail-log.txt

# Count unread in INBOX
proton-mail-bridge-client emails --folder INBOX --json | jq '[.[] | select(.isRead == false)] | length'
```
