import { Ban, GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isThreadGoalLocked, threadGoalBannerCopy, type ThreadGoal } from "@/lib/thread-goal";

export function ThreadGoalBanner({
  goal,
  busy = false,
  disabled = false,
  onClear,
  onFork
}: {
  goal: ThreadGoal | null | undefined;
  busy?: boolean;
  disabled?: boolean;
  onClear: () => void;
  onFork?: () => void;
}) {
  if (!isThreadGoalLocked(goal) || !goal) return null;
  const copy = threadGoalBannerCopy(goal);
  return (
    <div className="thread-goal-banner" role="status">
      <Ban className="mt-0.5 size-4 shrink-0 text-amber-700" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{copy.title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{copy.summary}</p>
        {copy.objective ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={copy.objective}>
            目标：{copy.objective}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {onFork ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            onClick={onFork}
          >
            <GitFork className="size-3.5" />
            分叉新会话
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-lg"
          disabled={busy || disabled}
          title={disabled ? "请先停止当前任务" : "清除卡住的目标后继续执行"}
          onClick={onClear}
        >
          {busy ? "正在清除…" : "清除目标"}
        </Button>
      </div>
    </div>
  );
}
