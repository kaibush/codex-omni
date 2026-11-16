import { useEffect, useId, useRef, useState } from "react";
import {
  defaultFailureRetrySettings,
  failureRetryDelayMs,
  failureRetryKeywords,
  FAILURE_RETRY_KEYWORDS_MAX_LENGTH,
  matchFailureRetry,
  RESOURCE_MISMATCH_RETRY_KEYWORD,
  type FailureRetryMatch,
  type FailureRetrySettings
} from "@codex-omni/protocol";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { clampRetryAttempts, msFromSeconds, secondsFromMs } from "./runtime-settings";

function RetryNumberField({
  label,
  hint,
  min,
  max,
  value,
  onChange,
  commitOnBlur = false
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  commitOnBlur?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const parsed = Number(text);
    const next =
      text.trim() && Number.isFinite(parsed)
        ? Math.min(max, Math.max(min, Math.trunc(parsed)))
        : value;
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={text}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const parsed = Number(raw);
          if (
            !commitOnBlur &&
            raw.trim() &&
            Number.isInteger(parsed) &&
            parsed >= min &&
            parsed <= max
          )
            onChange(parsed);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
    </Field>
  );
}

function matchDescription(match: FailureRetryMatch) {
  switch (match.source) {
    case "exclude":
      return `命中排除关键词「${match.keyword}」`;
    case "include":
      return `命中强制重试关键词「${match.keyword}」`;
    case "all":
      return "已选择全部失败重试";
    case "builtin":
      return "命中内置临时错误规则";
    case "builtin-excluded":
      return "被内置规则排除，可用强制重试关键词覆盖";
    case "empty":
      return "没有可匹配的错误文本";
    case "unmatched":
      return "未命中重试规则";
  }
}

export function FailureRetrySettingsFields({
  settings: input,
  onChange,
  compact = false
}: {
  settings: FailureRetrySettings;
  onChange: (patch: Partial<FailureRetrySettings>) => void;
  compact?: boolean;
}) {
  const settings = { ...defaultFailureRetrySettings, ...input };
  const id = useId();
  const [sample, setSample] = useState("");
  const [includeKeywords, setIncludeKeywords] = useState(settings.failureRetryIncludeKeywords);
  const [excludeKeywords, setExcludeKeywords] = useState(settings.failureRetryExcludeKeywords);
  const latestDraft = useRef({ settings, includeKeywords, excludeKeywords, onChange });
  latestDraft.current = { settings, includeKeywords, excludeKeywords, onChange };
  useEffect(
    () => () => {
      // The popover can unmount on Escape or an outside pointerdown before blur.
      if (!compact) return;
      const draft = latestDraft.current;
      const patch: Partial<FailureRetrySettings> = {};
      if (draft.includeKeywords !== draft.settings.failureRetryIncludeKeywords)
        patch.failureRetryIncludeKeywords = draft.includeKeywords;
      if (draft.excludeKeywords !== draft.settings.failureRetryExcludeKeywords)
        patch.failureRetryExcludeKeywords = draft.excludeKeywords;
      if (Object.keys(patch).length) draft.onChange(patch);
    },
    [compact]
  );
  useEffect(
    () => setIncludeKeywords(settings.failureRetryIncludeKeywords),
    [settings.failureRetryIncludeKeywords]
  );
  useEffect(
    () => setExcludeKeywords(settings.failureRetryExcludeKeywords),
    [settings.failureRetryExcludeKeywords]
  );
  const match = matchFailureRetry(sample, {
    ...settings,
    failureRetryIncludeKeywords: includeKeywords,
    failureRetryExcludeKeywords: excludeKeywords
  });
  const delaySeconds = secondsFromMs(settings.failureRetryDelayMs, 15);
  const maxDelaySeconds = secondsFromMs(settings.failureRetryMaxDelayMs, 90);
  const maxAttempts = clampRetryAttempts(settings.failureRetryMaxAttempts);
  const waits = Array.from(
    { length: Math.min(5, maxAttempts) },
    (_, i) =>
      failureRetryDelayMs(
        i + 1,
        settings.failureRetryDelayMs,
        settings.failureRetryMaxDelayMs,
        settings.failureRetryBackoff
      ) / 1000
  );
  const keywords = failureRetryKeywords(includeKeywords);
  const hasResourceRule = keywords.some(
    (keyword) => keyword.toLowerCase() === RESOURCE_MISMATCH_RETRY_KEYWORD.toLowerCase()
  );
  const withResourceRule = [...keywords, RESOURCE_MISMATCH_RETRY_KEYWORD].join("\n");
  const grid = cn("grid min-w-0 gap-4", !compact && "lg:grid-cols-2");

  return (
    <FieldGroup className="gap-5">
      <Field className="flex-row items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel htmlFor={`${id}-enabled`}>失败后自动重试</FieldLabel>
          <FieldDescription>
            按下方规则继续原任务，直到成功、手动停止或达到次数上限。Codex 与 Claude Code 共用。
          </FieldDescription>
        </div>
        <Switch
          id={`${id}-enabled`}
          checked={settings.failureRetryEnabled}
          onCheckedChange={(failureRetryEnabled) => onChange({ failureRetryEnabled })}
        />
      </Field>
      <FieldGroup className={grid}>
        <Field>
          <FieldLabel htmlFor={`${id}-mode`}>重试范围</FieldLabel>
          <Select
            value={settings.failureRetryMode}
            onValueChange={(value) =>
              onChange({ failureRetryMode: value as FailureRetrySettings["failureRetryMode"] })
            }
          >
            <SelectTrigger
              id={`${id}-mode`}
              className="w-full"
              aria-describedby={`${id}-mode-hint`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="builtin">内置规则 + 自定义（兼容原逻辑）</SelectItem>
                <SelectItem value="custom">仅自定义关键词</SelectItem>
                <SelectItem value="all">全部失败（排除关键词除外）</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription id={`${id}-mode-hint`}>
            {settings.failureRetryMode === "all"
              ? "包含鉴权、余额和参数错误；手动停止、取消及任务预算限制不会触发失败重试。"
              : settings.failureRetryMode === "custom"
                ? "仅重试命中下方强制重试关键词的错误；留空则不重试。"
                : "保留限流、超时、断流等临时错误重试；默认排除鉴权、余额及 400 等请求错误。"}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-backoff`}>等待方式</FieldLabel>
          <Select
            value={settings.failureRetryBackoff}
            onValueChange={(value) =>
              onChange({
                failureRetryBackoff: value as FailureRetrySettings["failureRetryBackoff"]
              })
            }
          >
            <SelectTrigger id={`${id}-backoff`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="exponential">指数递增（原逻辑，每次翻倍）</SelectItem>
                <SelectItem value="fixed">固定间隔</SelectItem>
                <SelectItem value="linear">线性递增（每次增加首次等待）</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <RetryNumberField
          commitOnBlur={compact}
          label="首次等待（秒）"
          hint="固定间隔时，每次都使用此值；0 表示立即重试。"
          min={0}
          max={600}
          value={delaySeconds}
          onChange={(value) => onChange({ failureRetryDelayMs: msFromSeconds(value) })}
        />
        <RetryNumberField
          commitOnBlur={compact}
          label="封顶等待（秒）"
          hint="所有等待方式都受此上限约束，最多 600 秒；0 表示不等待。"
          min={0}
          max={600}
          value={maxDelaySeconds}
          onChange={(value) => onChange({ failureRetryMaxDelayMs: msFromSeconds(value) })}
        />
        <RetryNumberField
          commitOnBlur={compact}
          label="最多重试次数"
          hint="1–100 次，不含首次请求。成功后下一轮重新计数。"
          min={1}
          max={100}
          value={maxAttempts}
          onChange={(value) => onChange({ failureRetryMaxAttempts: value })}
        />
        <Field>
          <FieldLabel>等待预览</FieldLabel>
          <FieldDescription>
            前 {waits.length} 次：{waits.join(" → ")} 秒{maxAttempts > waits.length ? "…" : ""}
          </FieldDescription>
          <FieldDescription>
            保存后的设置用于下一次判定；等待结束后也会复查开关、范围、关键词和次数。
          </FieldDescription>
        </Field>
      </FieldGroup>
      {compact ? (
        <FieldDescription>数字和关键词在输入结束、离开输入框后自动保存。</FieldDescription>
      ) : null}
      <FieldGroup className={grid}>
        <Field>
          <FieldLabel htmlFor={`${id}-include`}>强制重试关键词</FieldLabel>
          <Textarea
            id={`${id}-include`}
            className="min-h-28"
            maxLength={FAILURE_RETRY_KEYWORDS_MAX_LENGTH}
            value={includeKeywords}
            onChange={(event) => {
              setIncludeKeywords(event.target.value);
              if (!compact) onChange({ failureRetryIncludeKeywords: event.target.value });
            }}
            onBlur={() => {
              if (compact && includeKeywords !== settings.failureRetryIncludeKeywords)
                onChange({ failureRetryIncludeKeywords: includeKeywords });
            }}
            aria-describedby={`${id}-include-hint`}
            placeholder={RESOURCE_MISMATCH_RETRY_KEYWORD}
          />
          <FieldDescription id={`${id}-include-hint`}>
            每行一个，包含任意一行即命中，不区分大小写，按普通文本匹配。可覆盖内置的 400 / bad
            request 排除。
          </FieldDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-fit max-w-full rounded-lg"
            disabled={
              hasResourceRule || withResourceRule.length > FAILURE_RETRY_KEYWORDS_MAX_LENGTH
            }
            onClick={() => {
              setIncludeKeywords(withResourceRule);
              onChange({ failureRetryIncludeKeywords: withResourceRule });
            }}
          >
            {hasResourceRule ? "已添加资源不匹配规则" : "添加资源不匹配规则"}
          </Button>
          <FieldDescription>
            适用于 “The requested item was created under a different … OpenAI
            resource”。重试仍使用当前供应商和会话。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-exclude`}>排除关键词</FieldLabel>
          <Textarea
            id={`${id}-exclude`}
            className="min-h-28"
            maxLength={FAILURE_RETRY_KEYWORDS_MAX_LENGTH}
            value={excludeKeywords}
            onChange={(event) => {
              setExcludeKeywords(event.target.value);
              if (!compact) onChange({ failureRetryExcludeKeywords: event.target.value });
            }}
            onBlur={() => {
              if (compact && excludeKeywords !== settings.failureRetryExcludeKeywords)
                onChange({ failureRetryExcludeKeywords: excludeKeywords });
            }}
            aria-describedby={`${id}-exclude-hint`}
            placeholder={"insufficient quota\ninvalid API key"}
          />
          <FieldDescription id={`${id}-exclude-hint`}>
            每行一个，匹配方式相同。优先级最高，命中后始终不重试。
          </FieldDescription>
        </Field>
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${id}-sample`}>测试错误匹配</FieldLabel>
        <Textarea
          id={`${id}-sample`}
          className="min-h-20"
          value={sample}
          maxLength={32_000}
          onChange={(event) => setSample(event.target.value)}
          placeholder="粘贴错误文本或完整 JSON，查看当前草稿是否会重试"
        />
        <FieldDescription>
          优先级：排除关键词 → 强制重试关键词 → 所选范围。这里只做本地试算，不发送请求。
        </FieldDescription>
        {sample.trim() ? (
          <p role="status" className="break-words text-sm">
            {settings.failureRetryEnabled
              ? match.retry
                ? "会自动重试"
                : "不会自动重试"
              : "不会自动重试：总开关已关闭"}
            {" · "}
            {matchDescription(match)}
          </p>
        ) : null}
      </Field>
    </FieldGroup>
  );
}
