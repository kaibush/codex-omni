#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

pnpm --filter @codex-omni/protocol --filter @codex-omni/db --filter @codex-omni/codex-runtime --filter @codex-omni/server build

unit_src="$root/deploy/codex-omni-api.service"
unit_dst="/etc/systemd/system/codex-omni-api.service"
if [[ ! -e "$unit_dst" ]] || ! cmp -s "$unit_src" "$unit_dst"; then
  install -m 644 "$unit_src" "$unit_dst"
  systemctl daemon-reload
  systemctl enable codex-omni-api
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

caddy_src="$root/deploy/Caddyfile.codex.lvyrix.com"
caddy_dst="/etc/caddy/conf.d/codex-omni.caddy"
if [[ -d /etc/caddy/conf.d ]]; then
  if [[ ! -e "$caddy_dst" ]] || ! cmp -s "$caddy_src" "$caddy_dst"; then
    install -m 644 "$caddy_src" "$caddy_dst"
    if systemctl is-active --quiet caddy; then
      systemctl reload caddy
    fi
  fi
fi

echo "Production API healthy on 127.0.0.1:8791"
