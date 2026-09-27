# Codex Omni

> 面向远程服务器的 Codex / Claude Code 工作台：同一工程可创建两种客户端的对话，同一客户端的对话可切换供应商。

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)

## 一眼了解

Codex Omni 把 Codex 和 Claude Code 跑在远程服务器上，用浏览器完成「打开工程 → 提问 → 改文件 → 看 Diff → 终端验证 → 提交」的闭环。前端是 React + Vite + Tailwind + shadcn/ui，后端是 Fastify + WebSocket + SQLite；两种客户端分别通过官方 `@openai/codex-sdk`、`@anthropic-ai/claude-agent-sdk` 在独立 Bridge Worker 中执行。生产入口是一条命令：`codex-omni`。

这是单机自用、高权限的工作台：Worker 能按设置读写项目文件并打开终端。不要把开发端口直接暴露到公网。

## 能做什么

- **对话工作台**：多工程、多 Session；流式回复、工具调用、审批、草稿和消息队列。
- **工程与会话**：浏览服务器目录创建工程；会话支持搜索、重命名、置顶、归档和导出。
- **供应商与模型**：按客户端管理供应商和默认模型；会话按客户端保存，供应商配置和凭据按运行隔离，支持 API Key、兼容 Base URL、原生配置和模型目录。
- **跨供应商续聊**：切换时选择在当前对话继续或新建续接对话；同一客户端使用原生会话 ID 继续，保留完整原生历史，无需复制会话。
- **Claude Code**：原生计划审批、提问表单、工具审批、子智能体与后台任务、单独停止子任务、思考强度、预算、原生命令、Skills / MCP 和 Hooks。
- **文件工作区**：文件树、搜索、CodeMirror 编辑、Markdown 预览和冲突提示。
- **Git**：分支状态、staged / working-tree Diff、暂存、提交和历史。
- **内置终端**：xterm.js + node-pty，多 Tab，刷新或短暂断线后可重订阅。
- **运行中心**：查看真实 Run、Worker 状态、心跳和事件序号。
- **系统设置**：运行权限、界面、Prompt 模板，以及项目规则、Skills、MCP 和定时任务。

## 快速开始

### 别人安装

机器需要 Node.js 20+。安装包包含两种客户端的 SDK；可在网页中配置供应商 API Key，也可复用服务器上已有的客户端登录。Linux 上 `node-pty` / `better-sqlite3` 如需编译，请准备 Python 3、`make` 和 C/C++ 编译器。

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

生产环境请走反向代理的 HTTPS / WSS，不要把 `8790` 或 `5173` 直接映射到公网。见 [部署与 HTTPS](docs/部署与HTTPS.md)。

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

创建项目时可通过文件夹弹框浏览服务器目录。服务端运行账号需要能访问项目目录，并在供应商中配置相应客户端的 API Key 或已有登录目录。

## 使用 Claude Code 与跨供应商续聊

1. 在「供应商」选择 Claude Code，添加 Anthropic Messages 兼容供应商的 Base URL、API Key 和模型。也可选择「客户端原生配置」使用固定目录中的登录状态，或通过运行设置和环境变量配置网关。
2. 新建对话时选择 Codex 或 Claude Code；创建后客户端固定，输入区只显示该客户端的供应商、模型与权限选项。两种客户端各自保留默认供应商，同一工程可以分别创建两种对话，共享工程文件。
3. 切换同一客户端的供应商时，弹框默认选择「在当前对话继续」，也可选择「新建续接对话」。运行中或仍有待发送队列时，先结束任务或处理队列再切换。

Claude 使用原生计划模式；计划卡片可审阅正文并批准执行，提问卡片支持选项与自由回答。子智能体和后台任务显示执行状态，运行中的子任务可单独停止。输入区支持 SDK 可用的原生命令、项目 `.claude/commands`，并自动加载 `CLAUDE.md`、`.claude/agents`、`.claude/skills`、MCP 和 Hooks。系统设置中可分别管理 Codex 与 Claude 的权限、思考强度、轮次、预算和自定义子智能体。

Codex 与 Claude Code 各自使用固定 HOME，默认位于数据库目录下的 `runtime/clients/codex` 和 `runtime/clients/claude-code`。可通过 `CODEX_OMNI_CODEX_HOME`、`CODEX_OMNI_CLAUDE_HOME` 指定各客户端的绝对目录；原生登录和全局 Skills 等资源也放在该目录中。

在当前对话切换供应商时，下一轮只更换独立 Worker 的配置和凭据，使用原会话 ID 从相同 HOME 恢复，不复制会话，也不改写共享的原生配置和认证文件。不同对话可以同时使用不同供应商；同一对话串行执行。Codex 与 Claude Code 不互相恢复或续接会话。

「新建续接对话」使用同一客户端，带入最近用户与助手消息的有限快照（最多 40 条、约 48,000 字符），长消息保留首尾，并携带附件路径。CLI 专属交互以 SDK 提供的能力为准，长期定时任务使用工作台的「定时任务」页面。

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
| `CODEX_OMNI_CODEX_HOME` | 数据库目录下的 `runtime/clients/codex` | Codex 固定配置、登录与会话目录，所有 Codex 供应商共用 |
| `CODEX_OMNI_CLAUDE_HOME` | 数据库目录下的 `runtime/clients/claude-code` | Claude Code 固定配置、登录与会话目录，所有 Claude 供应商共用 |
| `CODEX_OMNI_INSTANCE` | 空（随机 id） | 同库多进程时的实例名；`pnpm dev` 设为 `dev` |
| `CODEX_OMNI_ORIGIN` | 空（回显请求 Origin） | CORS Origin 白名单，逗号分隔；生产应写成明确站点 |
| `CODEX_OMNI_STATIC` | 打包内的 `public/` | 前端静态目录 |
| `CODEX_OMNI_FS_ROOTS` | 系统根目录 | 目录浏览范围，逗号分隔 |
| `CODEX_OMNI_VERSION` | `package.json` 的 version | 覆盖展示 / 比较用的版本号 |
| `CODEX_OMNI_GITHUB_REPO` | `kaibush/codex-omni` | 应用内更新检查读取的 GitHub Releases 仓库 |
| `CODEX_OMNI_SHELL` | 当前用户登录 shell | 工程终端启动的 shell；systemd 等无 `SHELL` 环境时也会回退到 zsh/bash |

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
- `packages/claude-runtime`：Claude Agent SDK Bridge Worker（`@codex-omni/claude-runtime`）
- `packages/agent-runtime`：客户端共用的进程桥接与生命周期管理（`@codex-omni/agent-runtime`）

## 许可

源码以本仓库为准。仓库暂未附加 LICENSE 文件。
