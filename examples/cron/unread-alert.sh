#!/usr/bin/env bash
# Checks unread count in INBOX and prints an alert if it crosses a threshold.
# Errors produce a nonzero exit so broken credentials or JSON are visible. Wire stdout
# into your own notification method (a webhook, a Slack CLI, etc).
#
# Install (crontab -e), checks every 30 minutes during work hours:
#   */30 9-18 * * 1-5 /path/to/unread-alert.sh
set -euo pipefail

THRESHOLD="${PROTONMAIL_UNREAD_THRESHOLD:-20}"

UNREAD=$(proton-mail-bridge-client tool count_messages --args '{"folder":"INBOX","isRead":false}' --json \
  | jq -er '.structuredContent.count | select(type == "number" and . >= 0)')

if [ "$UNREAD" -ge "$THRESHOLD" ]; then
  echo "Unread count in INBOX ($UNREAD) has reached the alert threshold ($THRESHOLD)."
  # Example: pipe to a webhook —
  # curl -s -X POST -H 'Content-Type: application/json' \
  #   -d "{\"text\":\"Inbox has $UNREAD unread\"}" "$SLACK_WEBHOOK_URL"
fi
