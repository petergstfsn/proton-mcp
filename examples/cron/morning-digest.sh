#!/usr/bin/env bash
# Writes a JSON inbox digest to a log file every time it runs.
# Requires: proton-mail-bridge-client installed globally, Proton Bridge running,
# and PROTONMAIL_USERNAME/PROTONMAIL_PASSWORD (or the _FILE/_COMMAND variants)
# set in the environment this script runs under.
#
# Install (crontab -e), runs weekdays at 8am:
#   0 8 * * 1-5 /path/to/morning-digest.sh
set -euo pipefail
umask 077

LOG_DIR="${PROTONMAIL_DIGEST_LOG_DIR:-$HOME/.proton-mail-bridge-client/digests}"
mkdir -p "$LOG_DIR"

OUT="$LOG_DIR/digest-$(date +%Y-%m-%d).json"
proton-mail-bridge-client digest --json > "$OUT"

echo "Digest written to $OUT"
