import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  findSettingsSection,
  settingsNavGroups,
  settingsParentOf,
  type SettingsSectionId
} from "../settings-navigation";

export function SettingsSidebar({
  activeId,
  onNavigate
}: {
  activeId: SettingsSectionId;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const parent = settingsParentOf(activeId);
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({ [parent.title]: true });

  useEffect(() => {
    setOpenMenus((current) => ({ ...current, [parent.title]: true }));
  }, [parent.title]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-2 py-2">
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-full justify-start gap-1.5 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/")}
        >
          <ChevronLeft className="size-4 shrink-0" />
          返回工作区
        </Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="系统设置菜单">
        {settingsNavGroups.map((group) => (
          <section key={group.id} className="pb-2">
            <p className="px-2 pb-1 pt-2 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const open = openMenus[item.title] ?? false;
                return (
                  <div key={item.title}>
                    <button
                      type="button"
                      className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-sm hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        setOpenMenus((current) => ({ ...current, [item.title]: !open }))
                      }
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                      <ChevronRight
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                          open && "rotate-90"
                        )}
                      />
                    </button>
                    {open ? (
                      <div className="ms-3.5 space-y-0.5 border-l py-0.5 pl-2">
                        {item.items.map((leaf) => {
                          const active = leaf.id === activeId;
                          return (
                            <button
                              key={leaf.id}
                              type="button"
                              className={cn(
                                "flex h-8 w-full items-center rounded-lg px-2 text-sm",
                                active
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                              )}
                              onClick={() => {
                                navigate(leaf.href);
                                onNavigate?.();
                              }}
                            >
                              <span className="min-w-0 flex-1 truncate text-left">
                                {leaf.title}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
    </div>
  );
}

export function SettingsMobileNav({ activeId }: { activeId: SettingsSectionId }) {
  const navigate = useNavigate();
  const active = findSettingsSection(activeId);
  return (
    <div className="flex gap-2 overflow-x-auto px-3 py-2 lg:hidden">
      {settingsNavGroups
        .flatMap((group) => group.items.flatMap((item) => item.items))
        .map((leaf) => (
          <button
            key={leaf.id}
            type="button"
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs",
              leaf.id === active.id
                ? "bg-primary/10 font-medium text-primary"
                : "bg-muted text-muted-foreground"
            )}
            onClick={() => navigate(leaf.href)}
          >
            {leaf.title}
          </button>
        ))}
    </div>
  );
}
