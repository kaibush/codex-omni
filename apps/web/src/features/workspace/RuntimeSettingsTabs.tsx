import type { ClientType } from "@codex-omni/protocol";
import { ClaudeRuntimeFields } from "./ClaudeRuntimeFields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  SettingsField,
  SettingsFormGrid,
  SettingsSelect,
  SettingsSwitchField
} from "./settings/settings-ui";
import type { WorkspaceSettings } from "./SettingsDialog";
import { FailureRetrySettingsFields } from "./FailureRetrySettingsFields";

export function RuntimeSettingsTabs({
  settings,
  onChange,
  compact = false,
  clientType = "codex"
}: {
  settings: WorkspaceSettings;
  onChange: (settings: WorkspaceSettings) => void;
  compact?: boolean;
  clientType?: ClientType;
}) {
  const patch = (next: Partial<WorkspaceSettings>) => onChange({ ...settings, ...next });
  const permissionFields = compact ? (
    <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
      <label className="field-label">
        执行方式
        <Select
          value={settings.executionMode}
          onValueChange={(value) =>
            patch({ executionMode: value as WorkspaceSettings["executionMode"] })
          }
        >
          <SelectTrigger className="mt-1.5 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="execute">Execute</SelectItem>
            <SelectItem value="plan">Plan</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="field-label">
        文件权限
        <Select
          value={settings.sandbox}
          onValueChange={(value) => patch({ sandbox: value as WorkspaceSettings["sandbox"] })}
        >
          <SelectTrigger className="mt-1.5 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="read-only">只读</SelectItem>
            <SelectItem value="workspace-write">工作区可写</SelectItem>
            <SelectItem value="danger-full-access">完全访问</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="field-label">
        审批策略
        <Select
          value={settings.approvalPolicy}
          onValueChange={(value) =>
            patch({ approvalPolicy: value as WorkspaceSettings["approvalPolicy"] })
          }
        >
          <SelectTrigger className="mt-1.5 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="untrusted">建议模式</SelectItem>
            <SelectItem value="on-request">平衡模式（推荐）</SelectItem>
            <SelectItem value="never">全自动</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="mt-0 flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
        允许命令访问网络
        <Switch
          checked={settings.networkAccessEnabled}
          onCheckedChange={(checked) => patch({ networkAccessEnabled: checked })}
        />
      </label>
    </div>
  ) : (
    <SettingsFormGrid>
      <SettingsSelect
        label="文件权限"
        hint="限制 Codex 可读写的文件范围。"
        value={settings.sandbox}
        onValueChange={(value) => patch({ sandbox: value })}
        options={[
          { value: "read-only", label: "只读：仅查看文件" },
          { value: "workspace-write", label: "工作区可写：允许修改当前工程" },
          { value: "danger-full-access", label: "完全访问：允许访问全部文件" }
        ]}
      />
      <SettingsSelect
        label="审批策略"
        hint="平衡模式允许在工作区内正常编辑；需要提升权限时才请求确认。"
        value={settings.approvalPolicy}
        onValueChange={(value) => patch({ approvalPolicy: value })}
        options={[
          { value: "untrusted", label: "建议模式：非可信操作请求确认" },
          { value: "on-request", label: "平衡模式（推荐）：需要提升权限时确认" },
          { value: "never", label: "全自动：不请求确认" }
        ]}
      />
      <SettingsSelect
        label="Plan / Execute"
        hint="Plan 只读规划，确认后再执行写入。"
        value={settings.executionMode}
        onValueChange={(value) => patch({ executionMode: value })}
        options={[
          { value: "execute", label: "Execute：允许按文件权限修改" },
          { value: "plan", label: "Plan：只读规划，确认后再执行" }
        ]}
      />
      <SettingsSwitchField
        label="允许命令访问网络"
        description="关闭后，命令和工具默认不能访问外网。"
        checked={settings.networkAccessEnabled}
        onCheckedChange={(checked) => patch({ networkAccessEnabled: checked })}
      />
    </SettingsFormGrid>
  );

  const sendFields = compact ? (
    <div className="grid gap-2">
      <label className="field-label">
        消息发送方式
        <Select
          value={settings.sendMode}
          onValueChange={(value) => patch({ sendMode: value as WorkspaceSettings["sendMode"] })}
        >
          <SelectTrigger className="mt-1.5 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="queue">排队等待</SelectItem>
            <SelectItem value="steer">直接插入</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
        启用继续执行提示词
        <Switch
          checked={settings.continuationEnabled}
          onCheckedChange={(checked) => patch({ continuationEnabled: checked })}
        />
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        排队等待会在当前任务结束后按顺序自动发送，空闲时立即发送；直接插入模式会立即发送，运行中在当前工具调用完成后继续。继续触发词可在系统设置里编辑。
      </p>
    </div>
  ) : (
    <SettingsFormGrid>
      <SettingsSelect
        label="消息发送方式"
        hint="排队等待会在当前任务结束后按顺序自动发送，空闲时立即发送。直接插入模式会立即发送，运行中在当前工具调用完成后继续。"
        value={settings.sendMode}
        onValueChange={(value) => patch({ sendMode: value })}
        options={[
          { value: "queue", label: "排队等待" },
          { value: "steer", label: "直接插入" }
        ]}
      />
      <SettingsSwitchField
        label="启用继续执行提示词"
        description="输入已配置的继续触发词时，自动追加提示词并要求模型继续实际工作。"
        checked={settings.continuationEnabled}
        onCheckedChange={(checked) => patch({ continuationEnabled: checked })}
      />
      <SettingsField
        label="继续执行触发词"
        hint="每行一个短语。用户消息完整匹配时，会追加下方指令并要求模型立即继续实际工作。"
        span="full"
      >
        <Textarea
          className="min-h-24"
          value={settings.continuationTriggers.join("\n")}
          onChange={(event) =>
            patch({
              continuationTriggers: event.target.value
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean)
            })
          }
          placeholder="继续\n继续完成"
        />
      </SettingsField>
      <SettingsField
        label="继续执行指令"
        hint="留空可关闭追加指令。建议保持为明确要求调用工具并完成工作的短文本。"
        span="full"
      >
        <Textarea
          className="min-h-28"
          value={settings.continuationDirective}
          onChange={(event) => patch({ continuationDirective: event.target.value })}
          placeholder="要求模型立即调用工具并完成未完成的工作"
        />
      </SettingsField>
    </SettingsFormGrid>
  );

  return (
    <Tabs defaultValue="permissions" className={compact ? "mt-3" : undefined}>
      <TabsList className={compact ? "grid h-8 w-full grid-cols-3" : "h-8"}>
        <TabsTrigger value="permissions" className="px-2.5 text-xs">
          权限
        </TabsTrigger>
        <TabsTrigger value="send" className="px-2.5 text-xs">
          发送
        </TabsTrigger>
        <TabsTrigger value="retry" className="px-2.5 text-xs">
          重试
        </TabsTrigger>
      </TabsList>
      <TabsContent value="permissions" className="mt-3">
        {clientType === "claude-code" ? (
          <ClaudeRuntimeFields settings={settings} onChange={onChange} />
        ) : (
          permissionFields
        )}
      </TabsContent>
      <TabsContent value="send" className="mt-3">
        {sendFields}
      </TabsContent>
      <TabsContent value="retry" className="mt-3">
        <FailureRetrySettingsFields settings={settings} onChange={patch} compact={compact} />
      </TabsContent>
    </Tabs>
  );
}
