# Codex Omni

> 面向远程服务器的 Codex 工作台：打开浏览器即可对话、改文件、看 Diff、开终端并提交。

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)

## 一眼了解

Codex Omni 把 Codex 跑在远程服务器上，用浏览器完成「打开工程 → 提问 → 改文件 → 看 Diff → 终端验证 → 提交」的闭环。前端是 React + Vite + Tailwind + shadcn/ui，后端是 Fastify + WebSocket + SQLite；每个 turn 由独立的 Bridge Worker（`@openai/codex-sdk`）执行。生产入口是一条命令：`codex-omni`。

这是单机自用、高权限的工作台：Worker 能按设置读写项目文件并打开终端。不要把开发端口直接暴露到公网。

## 能做什么

- **对话工作台**：多工程、多 Session；流式回复、工具调用、审批、草稿和消息队列。
- **工程与会话**：浏览服务器目录创建工程；会话支持搜索、重命名、置顶、归档和导出。
- **供应商与模型**：每个 Provider 独立 `CODEX_HOME`，可配 API Key、Base URL 和模型目录。
- **文件工作区**：文件树、搜索、CodeMirror 编辑、Markdown 预览和冲突提示。
- **Git**：分支状态、staged / working-tree Diff、暂存、提交和历史。
- **内置终端**：xterm.js + node-pty，多 Tab，刷新或短暂断线后可重订阅。
- **运行中心**：查看真实 Run、Worker / Codex PID、心跳和事件序号。
- **系统设置**：运行权限、界面、Prompt 模板，以及项目规则、Skills、MCP 和定时任务。

## 快速开始

### 别人安装

机器需要 Node.js 20+，以及能跑 Codex 的环境（已登录 CLI，或稍后在网页里配置 Provider）。Linux 上 `node-pty` / `better-sqlite3` 如需编译，请准备 Python 3、`make` 和 C/C++ 编译器。

```bash
npm i -g @kaibush/codex-omni
codex-omni
```

也可以从 GitHub Release 安装：

```bash
npm i -g https://github.com/kaibush/codex-omni/releases/latest/download/codex-omni.tgz
codex-omni
```

浏览器打开 `http://localhost:8790`。首次进入页面会引导创建管理员。也可以先建好账户：

```bash
codex-omni user create --username admin --password 'change-this-password'
```

常用参数：

```bash
codex-omni start --host 0.0.0.0 --port 8790 --data ./data/codex-omni.db
```

数据默认写在当前工作目录的 `data/codex-omni.db`。前端静态资源和 API 由同一个进程提供。

打包、本地 tgz 和 npm 发布见 [安装与发布](docs/安装与发布.md)。

### Docker

生产环境请走反向代理的 HTTPS / WSS，不要把 `8790` 或 `5173` 直接映射到公网。Docker Compose、Nginx 和证书见 [部署与 HTTPS](docs/部署与HTTPS.md)。

### 本地开发

```bash
pnpm install
pnpm dev
```

如果要用当前仓库自己对话，请改用不会热重启 Server 的命令，避免改文件或热加载把进行中的任务杀掉：

```bash
pnpm dev:stable
```

首次打开页面时设置管理员账户和密码。也可以继续用 CLI 预创建：

```bash
pnpm user:create --username admin --password 'change-this-password'
```

默认地址：

- Web：`http://localhost:5173`
- API：`http://localhost:8790`

创建项目时可通过文件夹弹框浏览服务器目录。服务端运行账号需要能访问项目目录，并且需要已经完成 Codex 登录，或在供应商里配置相应的 `CODEX_HOME` / API Key。

## 版本检查与更新

Codex Omni 启动后会立即读取 [`kaibush/codex-omni`](https://github.com/kaibush/codex-omni) 的最新 GitHub Release，之后每 1 小时检查一次。发现高于当前版本的 Release 时，已登录页面会显示可关闭的更新弹框；「系统设置 → 版本更新」也可查看当前版本、最新版本、Release 说明和最近检查时间，或手动触发检查。

本地运行 `pnpm dev` 时，「版本更新」页会额外显示「预览提醒」按钮，用于模拟完整弹框。该入口由 `import.meta.env.DEV` 编译条件控制，生产构建不会显示，也不会向后端写入模拟版本。

更新已安装的 CLI：

```bash
npm i -g @kaibush/codex-omni
```

或从 GitHub Release 覆盖安装：

```bash
npm i -g https://github.com/kaibush/codex-omni/releases/latest/download/codex-omni.tgz
```

仅有普通分支构建、没有 GitHub Release 时，不会被识别为新版本。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CODEX_OMNI_HOST` | `0.0.0.0` | 监听地址 |
| `CODEX_OMNI_PORT` | `8790` | 服务端口 |
| `CODEX_OMNI_DATABASE` | `./data/codex-omni.db` | SQLite 路径 |
| `CODEX_OMNI_ORIGIN` | 空（回显请求 Origin） | CORS Origin 白名单，逗号分隔；生产应写成明确站点 |
| `CODEX_OMNI_STATIC` | 打包内的 `public/` | 前端静态目录 |
| `CODEX_OMNI_FS_ROOTS` | 系统根目录 | 目录浏览范围，逗号分隔 |
| `CODEX_OMNI_VERSION` | `package.json` 的 version | 覆盖展示 / 比较用的版本号 |
| `CODEX_OMNI_GITHUB_REPO` | `kaibush/codex-omni` | 应用内更新检查读取的 GitHub Releases 仓库 |

本地开发时，前端还可通过 `CODEX_OMNI_API_URL` 指定 API 地址（默认 `http://127.0.0.1:8790`）。HTTPS 部署请同时设置 `COOKIE_SECURE=true`，详见 [部署与 HTTPS](docs/部署与HTTPS.md)。

## 本地自检

```bash
pnpm ci:check
```

等价于 `pnpm typecheck && pnpm test && pnpm lint`。也可单独跑 `pnpm typecheck` 或 `pnpm test`。

## 工程结构

- `apps/web`：React + Vite 工作台（`@codex-omni/web`）
- `apps/server`：Fastify API、WebSocket 与 `codex-omni` CLI（`@codex-omni/server`）
- `packages/protocol`：HTTP / WS / Bridge 的 Zod 协议（`@codex-omni/protocol`）
- `packages/db`：SQLite schema 与 repository（`@codex-omni/db`）
- `packages/codex-runtime`：Codex SDK Bridge Worker（`@codex-omni/codex-runtime`）

## 许可

源码以本仓库为准。仓库暂未附加 LICENSE 文件。
