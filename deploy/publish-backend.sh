#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# Include every client runtime and its transitive workspace dependencies.
pnpm --filter '@codex-omni/server...' build

if [[ ! -f /etc/systemd/system/codex-omni-api.service ]]; then
  echo "API built. Copy deploy/codex-omni-api.service and deploy/Caddyfile.example, edit them, then install before restarting." >&2
  exit 0
fi

systemctl restart codex-omni-api

healthy=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 1 http://127.0.0.1:8791/api/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 0.25
done
if [[ "$healthy" -ne 1 ]]; then
  echo "Production API did not become healthy on 127.0.0.1:8791" >&2
  systemctl status --no-pager --lines=40 codex-omni-api >&2 || true
  exit 1
fi

echo "Production API healthy on 127.0.0.1:8791"
echo "Caddy and systemd examples are not installed by this script."
