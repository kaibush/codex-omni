# 部署与 HTTPS / WSS

生产环境不要把 Fastify 的 `8790`/`8791` 或 Vite 的 `5173` 直接暴露到公网。外网只应看到反向代理的 **HTTPS + WSS**。

## 推荐拓扑

```text
浏览器  --HTTPS/WSS-->  Caddy  --HTTP/WS-->  Fastify :8791（生产 API）
                       Caddy  --静态文件-->  /var/www/codex-omni
本机 IP :5173          Vite   --/api------>  Fastify :8790（tsx watch）
```

- Cookie 登录会话由浏览器带到 `/api` 和 `/api/ws`。
- WebSocket 必须复用同一套 Origin 和 Cookie，不能换一套域名。
- 设置 `COOKIE_SECURE=true`，并让代理把 `X-Forwarded-Proto=https` 传给后端。

## 环境变量

| 变量                 | 生产建议                                             |
| -------------------- | ---------------------------------------------------- |
| `CODEX_OMNI_HOST`     | 本机 Caddy 用 `127.0.0.1`；Docker 内 `0.0.0.0`        |
| `CODEX_OMNI_PORT`     | 本机生产 API `8791`；Docker / 开发默认 `8790`         |
| `CODEX_OMNI_ORIGIN`   | 站点 Origin 白名单，例如 `https://codex.lvyrix.com` |
| `CODEX_OMNI_INSTANCE` | 同库多进程时的实例名。本机生产 `prod`，`pnpm dev` 为 `dev` |
| `COOKIE_SECURE`      | `true`                                               |
| `CODEX_OMNI_DATABASE` | 持久卷路径，例如 `/app/data/codex-omni.db`            |
| `CODEX_OMNI_VERSION`  | 可选，覆盖版本号；镜像 tag 构建时会注入               |
| `CODEX_OMNI_GITHUB_REPO` | GitHub Releases 仓库，默认 `kaibush/codex-omni`    |

开发默认 `CODEX_OMNI_ORIGIN` 为空，会回显请求 Origin，方便局域网 IP 访问；生产必须改成明确白名单。本机 `codex.lvyrix.com` 与 `pnpm dev` 共用同一 SQLite，但启动时只回收本实例的运行中任务，避免热加载把生产对话打断。

## Docker Compose

仓库提供：

- [`Dockerfile`](../Dockerfile)：构建协议包、Server 和 Web。
- [`deploy/docker-compose.yml`](../deploy/docker-compose.yml)
- [`deploy/nginx.conf`](../deploy/nginx.conf)

```bash
pnpm --filter @codex-omni/web build
mkdir -p deploy/certs
# 放入 fullchain.pem 和 privkey.pem
cd deploy
# 把 nginx.conf / compose 里的 example.com 改成实际域名
docker compose up -d --build
```

首次启动后创建管理员：

```bash
docker compose exec server node dist/cli/create-user.js --username admin --password 'change-this-password'
```

如果镜像里没有该 CLI 编译产物，可在构建机执行 `pnpm user:create`，或进入容器用 `pnpm --filter @codex-omni/server user:create`。

## Nginx 要点

- `/api/` 反代到 Fastify，并升级 WebSocket：`Upgrade` + `Connection`。
- `proxy_read_timeout` 拉长，避免长 turn 被代理掐断。
- 静态前端用 `try_files` 回退到 `index.html`。
- 启用 HSTS，并设置 `frame-ancestors 'none'`。

Caddy 等价配置（本机当前用法：`codex.lvyrix.com` 挂生产前端 + `8791` 生产 API；`5173`/`8790` 继续给 Vite/`tsx watch`）：

```caddy
codex.lvyrix.com {
  @api path /api /api/*
  handle @api {
    reverse_proxy 127.0.0.1:8791 {
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
```

仓库里的完整文件是 [`deploy/Caddyfile.codex.lvyrix.com`](../deploy/Caddyfile.codex.lvyrix.com)。生产 API 用 [`deploy/codex-omni-api.service`](../deploy/codex-omni-api.service) 监听 `127.0.0.1:8791`，和 Vite 热加载的 `8790` 分开。

```bash
bash deploy/publish-frontend.sh
bash deploy/publish-backend.sh
```

Caddy 会自动处理 HTTPS 证书；生产进程已设 `CODEX_OMNI_ORIGIN=https://codex.lvyrix.com`。不要把 `5173`/`8790` 反代到公网。

## 安全边界

- 本服务以单机自用、高权限为前提：Codex Worker 能按设置读写项目文件并开终端。
- 反向代理必须是唯一入口；不要把 `5173`/`8790`/`8791` 映射到公网。
- 只信任最外层代理的 `X-Forwarded-*`。
- Provider 的 `config.toml` / `auth.json` / API Key 视为密钥，备份 SQLite 时同步保护数据卷。
