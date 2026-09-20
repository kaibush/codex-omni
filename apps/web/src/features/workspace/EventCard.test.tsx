import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventCard } from "./EventCard";

describe("EventCard copy controls", () => {
  it("offers full-message and fenced-code copy controls for assistant messages", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "assistant-1",
          kind: "assistant",
          text: "示例：\n```ts\nconst answer = 42;\nconst next = answer + 1;\n```"
        }}
      />
    );

    expect(html).toContain('aria-label="复制整条消息"');
    expect(html).toContain('aria-label="复制代码"');
    expect(html).toContain('class="markdown-code-language">ts</span>');
    expect(html).toContain("language-typescript");
    expect(html).toContain("answer");
    expect(html).toContain("42");
    expect(html).toContain('aria-label="下载代码"');
    expect(html).toContain("2 行");
  });

  it("skips fenced-code highlighting while assistant text is still streaming", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "assistant-stream",
          kind: "assistant",
          streaming: true,
          text: "示例：\n```ts\nconst answer = 42;\nconst next = answer + 1;\n```"
        }}
      />
    );
    expect(html).toContain("answer");
    expect(html).toContain("markdown-stream-pre");
    expect(html).not.toContain("markdown-code-block");
    expect(html).not.toContain("markdown-code-language");
    expect(html).not.toContain("<p>");
  });

  it("renders short single-line commands as compact copyable blocks", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "assistant-cmd",
          kind: "assistant",
          text: "请你在自己的终端执行：\n```bash\nkill 1942793 1942794\n```"
        }}
      />
    );

    expect(html).toContain("markdown-code-inline-block");
    expect(html).toContain("kill 1942793 1942794");
    expect(html).toContain('aria-label="复制代码"');
    expect(html).not.toContain("markdown-code-language");
  });

  it("renders fenced code in user bubbles with its own copy control", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{ id: "user-1", kind: "user", text: "```sh\npnpm test\npnpm typecheck\n```" }}
      />
    );

    expect(html).toContain('aria-label="复制整条消息"');
    expect(html).toContain('aria-label="复制代码"');
    expect(html).toContain('class="markdown-code-language">sh</span>');
  });

  it("offers a fork action on user messages", () => {
    const html = renderToStaticMarkup(
      <EventCard item={{ id: "user-2", kind: "user", text: "hello" }} onFork={() => undefined} />
    );
    expect(html).toContain('aria-label="从此处分叉"');
  });

  it("marks automatic failure retries on user messages", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "user-retry",
          kind: "user",
          text: "自动重试：继续执行",
          data: { continuation: true, failureRetry: true }
        }}
      />
    );
    expect(html).toContain("继续执行");
    expect(html).toContain("自动重试");
  });

  it("offers edit, retry, quote, copy-link and create-file actions", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "user-3",
          kind: "user",
          text: "see src/app.ts:12\n```ts\nconst answer = 42;\nconst next = answer + 1;\n```"
        }}
        onEdit={() => undefined}
        onRetry={() => undefined}
        onQuote={() => undefined}
        onCopyLink={() => undefined}
        onCreateFile={() => undefined}
        onOpenFile={() => undefined}
      />
    );
    expect(html).not.toContain('aria-label="收藏消息"');
    expect(html).not.toContain('aria-label="标记为项目笔记"');
    expect(html).not.toContain('aria-label="生成摘要"');
    expect(html).toContain('aria-label="编辑并重新发送"');
    expect(html).toContain('aria-label="重试本 turn"');
    expect(html).toContain('aria-label="引用到输入框"');
    expect(html).toContain('aria-label="复制消息链接"');
    expect(html).toContain('aria-label="在项目中创建文件"');
    expect(html).toContain("file-ref-link");
    expect(html).toContain("src/app.ts:12");
  });

  it("renders markdown lists and bold text in user bubbles", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "user-md",
          kind: "user",
          text: [
            "**终端启动命令**",
            "",
            "- 「新建」下拉支持增删改启动命令，可写环境变量和复杂参数，例如 `IS_SANDBOX=1 claude --dangerously-skip-permissions --settings ~/.claude/settings.grok.json`",
            "- 命令通过登录 Shell 执行；留空则开普通 Shell"
          ].join("\n")
        }}
        onOpenFile={() => undefined}
      />
    );
    expect(html).toContain("<strong>");
    expect(html).toContain("终端启动命令");
    expect(html).toContain("<li>");
    expect(html).toContain("~/.claude/settings.grok.json");
    expect(html).not.toContain("**终端启动命令**");
    expect(html).not.toContain("codex-file:");
  });

  it("keeps file path links in user bubbles", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{ id: "user-agents", kind: "user", text: "把这段约束写到当前项目的 AGENTS.md 里" }}
        onOpenFile={() => undefined}
      />
    );
    expect(html).toContain("event-card-user");
    expect(html).toContain("file-ref-link");
    expect(html).toContain("AGENTS.md");
  });

  it("opens bare file paths and markdown file links from chat", () => {
    const bare = renderToStaticMarkup(
      <EventCard
        item={{ id: "user-path", kind: "assistant", text: "see src/app.ts and `apps/web/src/foo.ts`" }}
        onOpenFile={() => undefined}
      />
    );
    expect(bare).toContain("file-ref-link");
    expect(bare).toContain("src/app.ts");
    expect(bare).toContain("apps/web/src/foo.ts");

    const markdown = renderToStaticMarkup(
      <EventCard
        item={{
          id: "user-md-link",
          kind: "assistant",
          text: "open [the file](apps/web/src/foo.ts)"
        }}
        onOpenFile={() => undefined}
      />
    );
    expect(markdown).toContain("file-ref-link");
    expect(markdown).toContain("the file");
    expect(markdown).not.toContain('href="apps/web/src/foo.ts"');
  });

  it("renders latex math with katex", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "assistant-math",
          kind: "assistant",
          text: "公式 $$E = mc^2$$"
        }}
      />
    );
    expect(html).toContain("katex");
    expect(html).toContain("mc");
  });

  it("does not crash the timeline on broken latex", () => {
    expect(() =>
      renderToStaticMarkup(
        <EventCard
          item={{
            id: "assistant-bad-math",
            kind: "assistant",
            text: "broken $$\\notACommand{$$ and $HOME"
          }}
        />
      )
    ).not.toThrow();
  });

  it("keeps markdown images as deferred previews instead of raw img tags", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "assistant-img",
          kind: "assistant",
          text: "![shot](/api/projects/p/files/download?path=shot.png&inline=1)"
        }}
      />
    );
    expect(html).toContain("data-image-src=");
    expect(html).toContain("/api/projects/p/files/download?path=shot.png");
    expect(html).not.toContain("<img");
  });

  it("renders mermaid fences as on-demand charts", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "assistant-mermaid",
          kind: "assistant",
          text: "```mermaid\ngraph TD; A-->B;\n```"
        }}
      />
    );
    expect(html).toContain('class="markdown-code-language">mermaid</span>');
    expect(html).toContain("正在渲染图表");
  });

  it("offers quote, copy-link and export on assistant messages", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{ id: "assistant-2", kind: "assistant", text: "done" }}
        onQuote={() => undefined}
        onCopyLink={() => undefined}
      />
    );
    expect(html).toContain('aria-label="引用到输入框"');
    expect(html).toContain('aria-label="复制消息链接"');
    expect(html).toContain('aria-label="导出消息"');
  });

  it("renders grouped activity summaries", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "activity-1",
          kind: "activity",
          data: {
            items: [
              { id: "tool-1", kind: "tool", data: { command: "pnpm test" } },
              {
                id: "file-1",
                kind: "file",
                data: { changes: [{ path: "src/app.ts", kind: "modify" }] }
              }
            ]
          }
        }}
      />
    );
    expect(html).toContain("执行过程");
    expect(html).toContain("1 个工具");
    expect(html).toContain("1 个文件变更");
  });

  it("renders plan cards as a checklist instead of raw json", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "plan-1",
          kind: "tool",
          data: {
            tool: "update_plan",
            items: [
              { text: "检查仓库", completed: true },
              { text: "补齐测试", status: "in_progress" }
            ]
          }
        }}
        defaultOpen={false}
      />
    );
    expect(html).toContain("计划");
    expect(html).toContain("检查仓库");
    expect(html).toContain("补齐测试");
    expect(html).toContain("1/2");
    expect(html).not.toContain("&quot;tool&quot;: &quot;update_plan&quot;");
    expect(html).not.toContain('"completed": true');
  });

  it("renders collab cards with the agent prompt", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "collab-1",
          kind: "tool",
          data: {
            tool: "spawn_agent",
            prompt: "Explore the repo",
            nickname: "Pascal",
            receiverThreadIds: ["agent-a"]
          }
        }}
      />
    );
    expect(html).toContain("启动子代理");
    expect(html).toContain("Pascal");
    expect(html).toContain("Explore the repo");
    expect(html).toContain("agent-a");
  });

  it("renders wait_agent results instead of runtime errors", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "collab-2",
          kind: "tool",
          data: {
            tool: "wait_agent",
            receiverThreadIds: ["agent-1"],
            output: JSON.stringify({
              status: { "agent-1": { completed: "Sun Aug 30 05:22:22 UTC 2026" } }
            })
          }
        }}
      />
    );
    expect(html).toContain("等待子代理");
    expect(html).toContain("Sun Aug 30 05:22:22 UTC 2026");
    expect(html).not.toContain("runtime_error");
  });
  it("renders model metadata notices instead of runtime error dumps", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "notice-1",
          kind: "tool",
          data: {
            tool: "runtime_error",
            message:
              "Model metadata for `grok-4.6` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."
          }
        }}
      />
    );
    expect(html).toContain("模型提示");
    expect(html).toContain("grok-4.6");
    expect(html).not.toContain("Runtime error");
    expect(html).not.toContain("&quot;tool&quot;: &quot;runtime_error&quot;");
  });

  it("renders service tier and compaction heads-up as warnings", () => {
    const tier = renderToStaticMarkup(
      <EventCard
        item={{
          id: "notice-2",
          kind: "tool",
          data: {
            tool: "runtime_error",
            message:
              "Configured service tier `priority` is not advertised as supported for model `grok-4.6` and will be omitted from requests."
          }
        }}
      />
    );
    expect(tier).toContain("服务层级");
    expect(tier).not.toContain("Runtime error");
    const compact = renderToStaticMarkup(
      <EventCard
        item={{
          id: "notice-3",
          kind: "tool",
          data: {
            tool: "runtime_error",
            message:
              "Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted."
          }
        }}
      />
    );
    expect(compact).toContain("会话提示");
  });

  it("renders real failures as 运行失败", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "fail-1",
          kind: "error",
          text: "Codex 运行失败"
        }}
      />
    );
    expect(html).toContain("运行失败");
    expect(html).toContain("Codex 运行失败");
    expect(html).not.toContain("Runtime error");
  });

  it("hides empty runtime_error placeholders", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{ id: "empty-1", kind: "tool", data: { tool: "runtime_error", message: "" } }}
      />
    );
    expect(html).toBe("");
  });

  it("renders request_user_input as a choice card", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "ask-1",
          kind: "tool",
          data: {
            tool: "request_user_input",
            questions: [
              {
                id: "pop3_plan",
                header: "POP3方案",
                question: "你要用哪种方案支持 POP3？",
                options: [
                  { label: "VPS 邮件服务", description: "部署完整邮件栈" },
                  { label: "outlookEmail 客户端" }
                ]
              }
            ]
          }
        }}
      />
    );
    expect(html).toContain("需要你选择");
    expect(html).toContain("POP3方案");
    expect(html).toContain("VPS 邮件服务");
    expect(html).not.toContain("runtime_error");
  });

  it("renders unavailable request_user_input as a notice instead of a choice card", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "ask-empty",
          kind: "tool",
          text: "request_user_input is unavailable in Default mode",
          data: {
            tool: "request_user_input",
            input: {},
            status: "completed",
            output: "request_user_input is unavailable in Default mode"
          }
        }}
      />
    );
    expect(html).toContain("选择不可用");
    expect(html).toContain("Default 模式");
    expect(html).not.toContain("需要你选择");
  });

  it("renders view_image with the file name", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "img-1",
          kind: "tool",
          data: { tool: "view_image", path: "/tmp/gamepad-preview/gamepad.png" }
        }}
      />
    );
    expect(html).toContain("查看图片");
    expect(html).toContain("gamepad.png");
  });

  it("renders write_stdin as a command input card", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "stdin-1",
          kind: "tool",
          data: { tool: "write_stdin", session_id: 79822, chars: "yes\n" }
        }}
      />
    );
    expect(html).toContain("向命令输入");
    expect(html).toContain("79822");
  });

  it("keeps thinking collapsed unless defaultOpen", () => {
    const closed = renderToStaticMarkup(
      <EventCard
        item={{ id: "r1", kind: "reasoning", text: "secret-thought" }}
        defaultOpen={false}
      />
    );
    expect(closed).toContain("Thinking");
    expect(closed).not.toContain("secret-thought");

    const opened = renderToStaticMarkup(
      <EventCard item={{ id: "r1", kind: "reasoning", text: "secret-thought" }} defaultOpen />
    );
    expect(opened).toContain("secret-thought");
  });

  it("renders view_image open-in-files and project-relative preview urls", () => {
    const relative = renderToStaticMarkup(
      <EventCard
        item={{
          id: "img-open-1",
          kind: "tool",
          data: { tool: "view_image", path: ".codex-uploads/foo.png" }
        }}
        projectId="proj-1"
        onOpenFile={() => undefined}
      />
    );
    expect(relative).toContain("查看图片");
    expect(relative).toContain("在文件中打开");
    expect(relative).toContain(
      `/api/projects/proj-1/files/download?path=${encodeURIComponent(".codex-uploads/foo.png")}&amp;inline=1`
    );

    const inside = renderToStaticMarkup(
      <EventCard
        item={{
          id: "img-open-2",
          kind: "tool",
          data: { tool: "view_image", path: "/workspace/app/.codex-uploads/foo.png" }
        }}
        projectId="proj-1"
        projectPath="/workspace/app"
        onOpenFile={() => undefined}
      />
    );
    expect(inside).toContain("在文件中打开");
    expect(inside).toContain(
      `/api/projects/proj-1/files/download?path=${encodeURIComponent(".codex-uploads/foo.png")}&amp;inline=1`
    );

    const outside = renderToStaticMarkup(
      <EventCard
        item={{
          id: "img-open-3",
          kind: "tool",
          data: { tool: "view_image", path: "/tmp/gamepad.png" }
        }}
        projectId="proj-1"
        projectPath="/workspace/app"
        onOpenFile={() => undefined}
      />
    );
    expect(outside).toContain("查看图片");
    expect(outside).toContain("在文件中打开");
    expect(outside).toContain("/tmp/gamepad.png");
    expect(outside).toContain(
      `/api/filesystem/file/download?path=${encodeURIComponent("/tmp/gamepad.png")}&amp;inline=1`
    );
    expect(outside).not.toContain("files/download?path=tmp");
  });

  it("renders the uploaded image path instead of the model prompt", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "user-img",
          kind: "user",
          text: "以下图片已作为本轮输入直接附加，请基于图片内容作答，不要只重复文件路径：\n- image.png",
          data: {
            attachments: [{ name: "image.png", path: ".codex-uploads/1-image.png", kind: "image" }]
          }
        }}
        projectId="proj-1"
      />
    );
    expect(html).not.toContain("以下图片已作为本轮输入直接附加");
    expect(html).toContain(".codex-uploads/1-image.png");
    expect(html).toContain(
      `/api/projects/proj-1/files/download?path=${encodeURIComponent(".codex-uploads/1-image.png")}&amp;inline=1`
    );
  });

  it("renders a lightweight placeholder without markdown", () => {
    const html = renderToStaticMarkup(
      <EventCard
        lite
        item={{
          id: "assistant-lite",
          kind: "assistant",
          text: "示例：\n```ts\nconst answer = 42;\n```"
        }}
      />
    );
    expect(html).toContain('data-lite="1"');
    expect(html).toContain("Codex");
    expect(html).not.toContain("markdown-code-block");
    expect(html).not.toContain("language-typescript");
  });

  it("offers to load the full truncated payload", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "tool-truncated",
          messageId: "message-1",
          kind: "tool",
          text: "head",
          data: { previewTruncated: true, originalLength: 50_000, tool: "command" }
        }}
        onLoadFull={() => undefined}
      />
    );
    expect(html).toContain("加载完整内容");
    expect(html).toContain("字符");
  });

  it("renders a thread goal lock as a warning notice", () => {
    const html = renderToStaticMarkup(
      <EventCard
        item={{
          id: "goal-1",
          kind: "error",
          text: "Codex 已把该线程标记为额度用尽，继续发送也只会收到收尾总结。",
          data: { tool: "thread_goal", title: "目标额度已用尽" }
        }}
      />
    );
    expect(html).toContain("目标额度已用尽");
    expect(html).toContain("notice-card");
    expect(html).not.toContain("运行失败");
  });

});
