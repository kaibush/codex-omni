# Codex Omni production SPA + API.
# Public pages are the built frontend in /var/www/codex-omni (see deploy/publish-frontend.sh).
# Vite keeps 5173 for local `pnpm dev`. API/WebSocket go to Fastify on 8790.
# Chat/terminal streams must not pass through encode; gzip waits for EOF.
codex.lvyrix.com {
	import access_log
	@api path /api /api/*
	handle @api {
		reverse_proxy 127.0.0.1:8790 {
			flush_interval -1
			transport http {
				read_timeout 3600s
				write_timeout 3600s
			}
		}
	}

	@immutable_assets path /assets/*
	header @immutable_assets Cache-Control "public, max-age=31536000, immutable"

	@html_shell path / /index.html
	header @html_shell Cache-Control "no-cache"

	handle {
		encode zstd gzip
		root * /var/www/codex-omni
		try_files {path} /index.html
		file_server
	}
}
