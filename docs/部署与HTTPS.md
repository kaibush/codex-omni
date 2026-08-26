# 部署与 HTTPS / WSS

生产环境不要把 Fastify 的 `8790` 或 Vite 的 `5173` 直接暴露到公网。外网只应看到反向代理的 **HTTPS + WSS**。

## 推荐拓扑

```text
浏览器  --HTTPS/WSS-->  Nginx/Caddy  --HTTP/WS-->  Fastify :8790
                                 \-->  静态前端 dist
```

- Cookie 登录会话由浏览器带到 `/api` 和 `/api/ws`。
- WebSocket 必须复用同一套 Origin 和 Cookie，不能换一套域名。
- 设置 `COOKIE_SECURE=true`，并让代理把 `X-Forwarded-Proto=https` 传给后端。

## 环境变量

| 变量                 | 生产建议                                             |
| -------------------- | ---------------------------------------------------- |
| `CODEX_OMNI_HOST`     | `0.0.0.0`（仅内网监听，由代理反代）                  |
| `CODEX_OMNI_PORT`     | `8790`                                               |
| `CODEX_OMNI_ORIGIN`   | 站点 Origin 白名单，例如 `https://codex.example.com` |
| `COOKIE_SECURE`      | `true`                                               |
| `CODEX_OMNI_DATABASE` | 持久卷路径，例如 `/app/data/codex-omni.db`            |
| `CODEX_OMNI_VERSION`  | 可选，覆盖版本号；镜像 tag 构建时会注入               |
| `CODEX_OMNI_GITHUB_REPO` | GitHub Releases 仓库，默认 `kaibush/codex-omni`    |

开发默认 `CODEX_OMNI_ORIGIN` 为空，会回显请求 Origin，方便局域网 IP 访问；生产必须改成明确白名单。

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

Caddy 等价配置：

```caddy
codex.example.com {
  encode gzip
  reverse_proxy /api/* server:8790
  root * /usr/share/nginx/html
  file_server
  try_files {path} /index.html
}
```

Caddy 会自动处理 HTTPS 证书；仍需把 `CODEX_OMNI_ORIGIN` 设为 `https://codex.example.com`。

## 安全边界

- 本服务以单机自用、高权限为前提：Codex Worker 能按设置读写项目文件并开终端。
- 反向代理必须是唯一入口；不要把 `5173`/`8790` 映射到公网。
- 只信任最外层代理的 `X-Forwarded-*`。
- Provider 的 `config.toml` / `auth.json` / API Key 视为密钥，备份 SQLite 时同步保护数据卷。
