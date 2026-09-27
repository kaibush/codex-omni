import { useState } from "react";
import { claudeOptionsSchema, type ClaudeOptions } from "@codex-omni/protocol";
import { Button } from "@/components/ui/button";
import type { WorkspaceSettings } from "./SettingsDialog";

export const claudePermissionLabels = {
  default: "逐项确认",
  acceptEdits: "自动编辑",
  plan: "计划",
  dontAsk: "拒绝未授权操作",
  bypassPermissions: "允许全部操作"
};

export function ClaudeRuntimeFields({
  settings,
  onChange
}: {
  settings: WorkspaceSettings;
  onChange: (settings: WorkspaceSettings) => void;
}) {
  const options = settings.claude ?? {};
  const update = (patch: Partial<ClaudeOptions>) =>
    onChange({ ...settings, claude: { ...options, ...patch } });
  const [agents, setAgents] = useState(() => JSON.stringify(options.agents ?? {}, null, 2));
  const [error, setError] = useState("");
  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2" aria-label="Claude 执行模式">
        {(
          [
            ["execute", "执行"],
            ["plan", "计划"]
          ] as const
        ).map(([mode, label]) => (
          <button
            type="button"
            key={mode}
            aria-pressed={settings.executionMode === mode}
            className={`h-8 rounded-lg border text-sm ${settings.executionMode === mode ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
            onClick={() => onChange({ ...settings, executionMode: mode })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        计划模式使用 Claude 原生规划流程，批准计划后可继续执行。
      </p>
      <label className="field-label">
        工具权限
        <select
          className="field h-8 rounded-lg"
          value={options.permissionMode ?? "default"}
          onChange={(event) =>
            update({ permissionMode: event.target.value as ClaudeOptions["permissionMode"] })
          }
        >
          {Object.entries(claudePermissionLabels)
            .filter(([mode]) => mode !== "plan")
            .map(([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="field-label">
          思考强度
          <select
            className="field h-8 rounded-lg"
            value={options.effort ?? "high"}
            onChange={(event) => update({ effort: event.target.value as ClaudeOptions["effort"] })}
          >
            {[
              ["low", "低"],
              ["medium", "中"],
              ["high", "高"],
              ["xhigh", "更高"],
              ["max", "最高"]
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          思考模式
          <select
            className="field h-8 rounded-lg"
            value={options.thinking ?? "adaptive"}
            onChange={(event) =>
              update({ thinking: event.target.value as "adaptive" | "disabled" })
            }
          >
            <option value="adaptive">自适应</option>
            <option value="disabled">关闭</option>
          </select>
        </label>
        <label className="field-label">
          最多模型轮次
          <input
            type="number"
            min="1"
            max="1000"
            className="field h-8 rounded-lg"
            placeholder="SDK 默认"
            value={options.maxTurns ?? ""}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!event.target.value || (Number.isInteger(value) && value > 0 && value <= 1000))
                update({ maxTurns: event.target.value ? value : undefined });
            }}
          />
        </label>
        <label className="field-label">
          预算上限（美元）
          <input
            type="number"
            min="0.01"
            step="0.1"
            max="10000"
            className="field h-8 rounded-lg"
            placeholder="不限"
            value={options.maxBudgetUsd ?? ""}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!event.target.value || (value > 0 && value <= 10000))
                update({ maxBudgetUsd: event.target.value ? value : undefined });
            }}
          />
        </label>
      </div>
      <details className="rounded-lg border p-2">
        <summary className="cursor-pointer text-xs font-medium">子智能体与高级设置</summary>
        <p className="my-2 text-xs leading-5 text-muted-foreground">
          内置子智能体和 .claude/agents 自动可用，也可以在这里定义当前工作台的子智能体。
        </p>
        <label className="field-label">
          主智能体
          <input
            className="field h-8 rounded-lg"
            placeholder="默认，或填写已定义的名称"
            value={options.agent ?? ""}
            onChange={(event) => update({ agent: event.target.value || undefined })}
          />
        </label>
        <label className="field-label mt-2">
          附加系统提示词
          <textarea
            className="field min-h-20 text-xs"
            value={options.systemPrompt ?? ""}
            onChange={(event) => update({ systemPrompt: event.target.value || undefined })}
          />
        </label>
        <label className="field-label mt-2">
          禁止工具（逗号分隔）
          <input
            className="field h-8 rounded-lg"
            value={options.disallowedTools?.join(", ") ?? ""}
            onChange={(event) =>
              update({
                disallowedTools: event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean)
              })
            }
          />
        </label>
        <label className="field-label mt-2">
          自定义子智能体 JSON
          <textarea
            className="field min-h-32 font-mono text-xs"
            value={agents}
            onChange={(event) => setAgents(event.target.value)}
            placeholder={
              '{"reviewer":{"description":"检查代码","prompt":"检查修改并报告问题","tools":["Read","Grep","Glob"]}}'
            }
          />
        </label>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <Button
          type="button"
          variant="outline"
          className="mt-2 h-8 rounded-lg"
          onClick={() => {
            try {
              const parsed = claudeOptionsSchema.parse({ ...options, agents: JSON.parse(agents) });
              onChange({ ...settings, claude: parsed });
              setError("");
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "子智能体配置无效");
            }
          }}
        >
          保存子智能体
        </Button>
      </details>
    </div>
  );
}
