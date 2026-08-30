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
            receiverThreadIds: ["agent-a"]
          }
        }}
      />
    );
    expect(html).toContain("启动子代理");
    expect(html).toContain("Explore the repo");
    expect(html).toContain("agent-a");
  });
});
