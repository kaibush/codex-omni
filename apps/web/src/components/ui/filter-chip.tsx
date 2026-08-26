import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function FilterChip({
  active = false,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type={type}
      data-slot="filter-chip"
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-transparent px-3 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

export { FilterChip };
