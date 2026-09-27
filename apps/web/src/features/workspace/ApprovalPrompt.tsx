import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApprovalResponse } from "@codex-omni/protocol";
import type { TimelineItem } from "@/types";

export type ApprovalHandler = (
  id: string,
  decision: "accept" | "acceptForSession" | "decline",
  response?: Omit<ApprovalResponse, "decision">
) => void;
type Question = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
};
type ElicitationField = {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  default?: string | number | boolean | string[];
  items?: { enum?: string[] };
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
};

export function ApprovalPrompt({
  item,
  onApproval,
  className = ""
}: {
  item: TimelineItem;
  onApproval?: ApprovalHandler | undefined;
  className?: string;
}) {
  const data = item.data ?? {};
  const input = data.input ?? {};
  const questions = (
    Array.isArray(data.questions ?? input.questions) ? (data.questions ?? input.questions) : []
  ) as Question[];
  const isQuestion = data.kind === "question" || data.tool === "AskUserQuestion";
  const isPlan = data.kind === "plan" || data.tool === "ExitPlanMode";
  const isElicitation = data.kind === "elicitation";
  const properties = (input.requestedSchema?.properties ?? {}) as Record<string, ElicitationField>;
  const [answers, setAnswers] = useState<Record<string, string>>(data.answers ?? {});
  const [fields, setFields] = useState<Record<string, string | number | boolean | string[]>>(
    () => ({
      ...Object.fromEntries(
        Object.entries(properties)
          .filter(([, field]) => field.default !== undefined || field.type === "boolean")
          .map(([key, field]) => [key, field.default ?? false])
      ),
      ...data.updatedInput
    })
  );
  const [feedback, setFeedback] = useState("");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const pending = !data.status || data.status === "pending";
  const finalAnswers = Object.fromEntries(
    questions.map((question) => [
      question.question,
      custom[question.question]?.trim() || answers[question.question] || ""
    ])
  );
  const required = Array.isArray(input.requestedSchema?.required)
    ? (input.requestedSchema.required as string[])
    : [];
  const content = Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => [
        key,
        ["number", "integer"].includes(properties[key]?.type ?? "") ? Number(value) : value
      ])
  );
  const valid = isQuestion
    ? questions.length > 0 && Object.values(finalAnswers).every(Boolean)
    : !isElicitation ||
      (required.every((key) => content[key] !== undefined) &&
        Object.entries(content).every(([key, value]) => {
          const field = properties[key];
          if (typeof value === "number")
            return (
              Number.isFinite(value) &&
              (field?.type !== "integer" || Number.isInteger(value)) &&
              (field?.minimum === undefined || value >= field.minimum) &&
              (field?.maximum === undefined || value <= field.maximum)
            );
          if (Array.isArray(value))
            return (
              value.length >= (field?.minItems ?? 0) &&
              value.length <= (field?.maxItems ?? Infinity)
            );
          return true;
        }));
  const submit = () => {
    if (isQuestion) onApproval?.(data.approvalId, "accept", { answers: finalAnswers });
    else if (isElicitation) onApproval?.(data.approvalId, "accept", { updatedInput: content });
    else onApproval?.(data.approvalId, "accept");
  };
  const url = typeof input.url === "string" && /^https?:\/\//i.test(input.url) ? input.url : null;
  return (
    <article
      data-message-id={item.id}
      className={`event-card event-card-bot border-amber-300/70 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/20${className}`}
    >
      <header className="event-title min-w-0">
        <ShieldQuestion className="size-4 text-amber-600" />
        <span>
          {isQuestion
            ? "Claude Code 需要你的回答"
            : isPlan
              ? "计划待确认"
              : isElicitation
                ? "MCP 请求信息"
                : "等待操作确认"}
        </span>
      </header>
      {isQuestion ? (
        <div className="space-y-4">
          {questions.map((question, index) => (
            <fieldset
              key={`${index}:${question.question}`}
              disabled={!pending}
              className="space-y-2"
            >
              <legend className="text-sm font-medium">{question.question}</legend>
              <div className="grid gap-2">
                {(question.options ?? []).map((option) => {
                  const selected = question.multiSelect
                    ? (answers[question.question] ?? "").split(", ").includes(option.label)
                    : answers[question.question] === option.label;
                  return (
                    <label
                      key={option.label}
                      className={`flex cursor-pointer gap-2 rounded-lg border p-2 text-sm ${selected ? "border-primary bg-accent" : "bg-card"}`}
                    >
                      <input
                        type={question.multiSelect ? "checkbox" : "radio"}
                        name={`${item.id}:${index}`}
                        checked={selected}
                        onChange={() =>
                          setAnswers((current) => {
                            if (!question.multiSelect)
                              return { ...current, [question.question]: option.label };
                            const values = new Set(
                              (current[question.question] ?? "").split(", ").filter(Boolean)
                            );
                            if (values.has(option.label)) values.delete(option.label);
                            else values.add(option.label);
                            return { ...current, [question.question]: [...values].join(", ") };
                          })
                        }
                      />
                      <span>
                        <span className="block">{option.label}</span>
                        {option.description ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              <input
                className="field h-8 rounded-lg"
                aria-label={`自定义回答：${question.question}`}
                placeholder="也可以直接输入回答"
                value={custom[question.question] ?? ""}
                onChange={(event) =>
                  setCustom((current) => ({ ...current, [question.question]: event.target.value }))
                }
              />
            </fieldset>
          ))}
        </div>
      ) : isPlan ? (
        <div className="prose prose-sm max-h-96 max-w-none overflow-auto dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {String(data.plan ?? input.plan ?? "请检查上方计划。批准后，Claude Code 将继续执行。")}
          </ReactMarkdown>
        </div>
      ) : isElicitation ? (
        <div className="space-y-3">
          <p className="text-sm">{String(input.message ?? data.command ?? "")}</p>
          {url ? (
            <a
              className="text-sm text-primary underline"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              打开认证页面
            </a>
          ) : null}
          {Object.entries(properties).map(([key, field]) => (
            <label key={key} className="field-label">
              {field.title ?? key}
              {required.includes(key) ? " *" : ""}
              {field.enum ? (
                <select
                  className="field h-8 rounded-lg"
                  disabled={!pending}
                  value={String(fields[key] ?? "")}
                  onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                >
                  <option value="">请选择</option>
                  {field.enum.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : field.type === "boolean" ? (
                <input
                  type="checkbox"
                  disabled={!pending}
                  checked={Boolean(fields[key])}
                  onChange={(event) => setFields({ ...fields, [key]: event.target.checked })}
                />
              ) : field.type === "array" ? (
                field.items?.enum ? (
                  <select
                    className="field min-h-20 rounded-lg"
                    multiple
                    disabled={!pending}
                    value={Array.isArray(fields[key]) ? (fields[key] as string[]) : []}
                    onChange={(event) =>
                      setFields({
                        ...fields,
                        [key]: Array.from(event.target.selectedOptions, (option) => option.value)
                      })
                    }
                  >
                    {field.items.enum.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    className="field min-h-20 rounded-lg"
                    disabled={!pending}
                    placeholder="每行一项"
                    value={Array.isArray(fields[key]) ? (fields[key] as string[]).join("\n") : ""}
                    onChange={(event) =>
                      setFields({
                        ...fields,
                        [key]: event.target.value.split("\n").filter(Boolean)
                      })
                    }
                  />
                )
              ) : (
                <input
                  className="field h-8 rounded-lg"
                  type={field.type === "number" || field.type === "integer" ? "number" : "text"}
                  disabled={!pending}
                  value={String(fields[key] ?? "")}
                  onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                />
              )}
              {field.description ? (
                <span className="text-xs text-muted-foreground">{field.description}</span>
              ) : null}
            </label>
          ))}
        </div>
      ) : (
        <pre className="max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-200">
          {data.command ?? item.text}
        </pre>
      )}
      {pending && isPlan ? (
        <textarea
          className="field min-h-16 rounded-lg"
          aria-label="计划调整意见"
          placeholder="如需调整计划，可填写意见后选择暂不执行"
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />
      ) : null}
      {pending ? (
        <div className="flex flex-wrap gap-2">
          <Button className="h-8 rounded-lg" disabled={!valid || !onApproval} onClick={submit}>
            {isQuestion
              ? "提交回答"
              : isPlan
                ? "批准计划并执行"
                : isElicitation
                  ? "提交"
                  : "本次允许"}
          </Button>
          {!isQuestion && !isPlan && !isElicitation && !data.suppressAlwaysAllow ? (
            <Button
              className="h-8 rounded-lg"
              variant="outline"
              onClick={() => onApproval?.(data.approvalId, "acceptForSession")}
            >
              本会话允许
            </Button>
          ) : null}
          <Button
            className="h-8 rounded-lg text-destructive"
            variant="outline"
            onClick={() =>
              onApproval?.(
                data.approvalId,
                "decline",
                feedback.trim() ? { updatedInput: { feedback: feedback.trim() } } : undefined
              )
            }
          >
            {isQuestion ? "跳过" : isPlan ? "暂不执行" : "拒绝"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {data.status === "accepted"
            ? isQuestion
              ? "已提交回答"
              : isPlan
                ? "计划已批准"
                : "已允许该操作"
            : data.status === "expired"
              ? "请求已过期"
              : data.status === "cancelled"
                ? "请求已取消"
                : "已拒绝该操作"}
        </p>
      )}
    </article>
  );
}
