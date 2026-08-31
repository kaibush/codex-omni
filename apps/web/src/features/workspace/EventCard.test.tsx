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
        onStar={() => undefined}
        onSaveNote={() => undefined}
        onSummarize={() => undefined}
      />
    );
    expect(html).toContain('aria-label="收藏消息"');
    expect(html).toContain('aria-label="标记为项目笔记"');
    expect(html).toContain('aria-label="生成摘要"');
    expect(html).toContain('aria-label="编辑并重新发送"');
    expect(html).toContain('aria-label="重试本 turn"');
    expect(html).toContain('aria-label="引用到输入框"');
    expect(html).toContain('aria-label="复制消息链接"');
    expect(html).toContain('aria-label="在项目中创建文件"');
    expect(html).toContain("file-ref-link");
    expect(html).toContain("src/app.ts:12");
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
    expect(outside).not.toContain("files/download?path=tmp");
  });
});
