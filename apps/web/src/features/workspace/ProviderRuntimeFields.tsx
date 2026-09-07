import type { ModelRuntimeSettings } from "@codex-omni/protocol";

export function ProviderRuntimeFields({
  value,
  onChange
}: {
  value: ModelRuntimeSettings;
  onChange: (patch: ModelRuntimeSettings) => void;
}) {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2">
      <legend className="px-1 text-sm font-medium">模型运行参数</legend>
      <label className="field-label">
        上下文窗口（tokens）
        <input
          className="field h-8 rounded-lg"
          type="number"
          min={1}
          step={1}
          value={value.contextWindow ?? ""}
          placeholder="使用配置或模型默认"
          onChange={(event) =>
            onChange({ contextWindow: event.target.value ? event.target.valueAsNumber : null })
          }
        />
      </label>
      <label className="field-label">
        自动压缩阈值（tokens）
        <input
          className="field h-8 rounded-lg"
          type="number"
          min={1}
          step={1}
          value={value.autoCompactTokenLimit ?? ""}
          placeholder="使用配置或模型默认"
          onChange={(event) =>
            onChange({
              autoCompactTokenLimit: event.target.value ? event.target.valueAsNumber : null
            })
          }
        />
      </label>
      <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
        留空继承 config.toml 或模型默认值，不再按模型名称猜测容量。填写后仅覆盖当前供应商，
        不修改已有目录配置；压缩阈值须小于上下文窗口。切换模型时请按实际容量调整。
      </p>
    </fieldset>
  );
}
