# 部署与 HTTPS / WSS

生产环境不要把 Fastify 的 `8790`/`8791` 或 Vite 的 `5173` 直接暴露到公网。外网只应看到反向代理的 **HTTPS + WSS**。

下面的域名、目录和 Node 路径都是示例。复制到服务器前改成你自己的值，不要把真实域名、机器路径或证书提交回仓库。

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
| `CODEX_OMNI_HOST`     | 本机 Caddy 用 `127.0.0.1`；对外进程用 `0.0.0.0`        |
| `CODEX_OMNI_PORT`     | 本机生产 API `8791`；开发默认 `8790`         |
| `CODEX_OMNI_ORIGIN`   | 站点 Origin 白名单，例如 `https://example.com` |
| `CODEX_OMNI_INSTANCE` | 同库多进程时的实例名。生产可用 `prod`，`pnpm dev` 用 `dev` |
| `COOKIE_SECURE`      | `true`                                               |
| `CODEX_OMNI_DATABASE` | 持久卷路径，例如 `/var/lib/codex-omni/codex-omni.db`            |
| `CODEX_OMNI_VERSION`  | 可选，覆盖版本号；发布包默认用 `package.json`               |
| `CODEX_OMNI_GITHUB_REPO` | GitHub Releases 仓库，默认 `kaibush/codex-omni`    |

开发默认 `CODEX_OMNI_ORIGIN` 为空，会回显请求 Origin，方便局域网 IP 访问；生产必须改成明确白名单。生产和 `pnpm dev` 如果共用同一个 SQLite，请设置不同的 `CODEX_OMNI_INSTANCE`。启动时只回收本实例的运行中任务，避免热加载把另一个进程的对话打断。

## Docker Compose

安装和生产发布走 npm，GitHub Actions 不会构建或推送镜像。仓库里仍保留本地 Docker 文件，需要时自行构建：

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
- 如果前端要加载第三方统计脚本，把那个域名加进 `script-src`。不要把你的统计域名提交进仓库。

## Caddy 示例

把 [`deploy/Caddyfile.example`](../deploy/Caddyfile.example) 复制到 Caddy 配置目录，把 `example.com` 换成实际域名。生产 API 用 [`deploy/codex-omni-api.service`](../deploy/codex-omni-api.service) 做参考：复制到 `/etc/systemd/system/` 后，改工作目录、`node` 路径和 `CODEX_OMNI_ORIGIN`。

```caddy
example.com {
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

```bash
# 先按上面的示例装好 systemd 单元，再构建并重启已安装的服务。
# 这两个脚本不会覆盖你机器上的 Caddy 或 systemd 配置。
bash deploy/publish-frontend.sh
bash deploy/publish-backend.sh
```

Caddy 会自动处理 HTTPS 证书。生产进程的 `CODEX_OMNI_ORIGIN` 应设为实际站点，例如 `https://example.com`。不要把 `5173`/`8790` 反代到公网。


## 发布方式

通用部署和子路径部署共用 `deploy/publish-frontend.sh` 与 `deploy/publish-backend.sh`。两个脚本都按站点根路径构建，也不会覆盖服务器上已有的 Caddy 或 systemd 配置。

### 通用根路径

适合 `https://example.com/` 直接打开这一套服务。Caddy 按 [`deploy/Caddyfile.example`](../deploy/Caddyfile.example) 把页面和 `/api` 转到本机，然后执行：

```bash
bash deploy/publish-frontend.sh
bash deploy/publish-backend.sh
```

前端脚本会把 `apps/web/dist` 同步到 `/var/www/codex-omni`。后端脚本只构建并重启已经安装好的 `codex-omni-api`。

### 子路径

同一域名要挂多个实例时，不要改应用的构建前缀，也不要把真实域名写进仓库。每套服务仍用上面的命令按 `/` 发布。边缘再用 [`deploy/path-prefix-proxy.mjs`](../deploy/path-prefix-proxy.mjs) 把根路径改写到 `/ca` 或 `/us`，并给 Cookie 加上前缀，避免两个实例互相覆盖登录态。

```bash
PREFIX=/ca LISTEN_PORT=8792 UPSTREAM_TLS=false PUBLIC_HOST=example.com \
  node deploy/path-prefix-proxy.mjs
```

```caddy
handle /ca /ca/* {
  reverse_proxy 127.0.0.1:8792
}
```

另一台没改过的服务也可以挂到别的前缀：本机代理去掉前缀、改写页面和 Cookie，再转发到对方的根路径。对方继续用通用方式发布。单元示例是 [`deploy/codex-omni-prefix-proxy.service.example`](../deploy/codex-omni-prefix-proxy.service.example)，真实上游地址只放在服务器本地配置里。

## 安全边界

- 本服务以单机自用、高权限为前提：Codex Worker 能按设置读写项目文件并开终端。
- 反向代理必须是唯一入口；不要把 `5173`/`8790`/`8791` 映射到公网。
- 只信任最外层代理的 `X-Forwarded-*`。
- Provider 的 `config.toml` / `auth.json` / API Key 视为密钥，备份 SQLite 时同步保护数据卷。
