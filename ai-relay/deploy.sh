#!/bin/bash
# Ships ai-relay/server.js to the Oracle VM and restarts the systemd service.
# Does NOT touch .env or the systemd unit file — those are provisioned once,
# by hand, since they hold secrets / need sudo:
#   scp/heredoc zaim-ai-relay.service -> /etc/systemd/system/, write
#   /home/ubuntu/zaim-ai-relay/.env with AI_RELAY_TOKEN + GROQ_API_KEY (chmod 600),
#   then: sudo systemctl daemon-reload && sudo systemctl enable --now zaim-ai-relay
set -euo pipefail

KEY="${AI_RELAY_SSH_KEY:-$HOME/Downloads/ssh-key-2026-06-09.key}"
HOST="${AI_RELAY_HOST:-ubuntu@140.245.213.143}"
REMOTE="/home/ubuntu/zaim-ai-relay"
SSH_OPTS=(-i "$KEY" -o BatchMode=yes -o ConnectTimeout=20)

[ -f "$KEY" ] || { echo "SSH key not found: $KEY"; exit 1; }

echo "▸ Shipping server.js → $HOST:$REMOTE …"
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p $REMOTE"
tar czf - -C "$(dirname "$0")" server.js | ssh "${SSH_OPTS[@]}" "$HOST" "tar xzf - -C $REMOTE"

echo "▸ Restarting service…"
ssh "${SSH_OPTS[@]}" "$HOST" \
  "sudo systemctl restart zaim-ai-relay && sleep 1 && test \"\$(systemctl is-active zaim-ai-relay)\" = active && echo '✓ zaim-ai-relay active'"
