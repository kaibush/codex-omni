#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${CODEX_OMNI_FRONTEND_ROOT:-/var/www/codex-omni}"

cd "$root"
pnpm --filter @codex-omni/web build

install -d -m 755 "$dest"
rsync -a --delete "$root/apps/web/dist/" "$dest/"
if id caddy >/dev/null 2>&1; then
  chown -R caddy:caddy "$dest"
fi

echo "Published $root/apps/web/dist -> $dest"
