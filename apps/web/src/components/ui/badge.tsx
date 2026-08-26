import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive [a&]:hover:bg-destructive/20 dark:bg-destructive/20",
        success: "bg-success/12 text-success [a&]:hover:bg-success/20",
        warning: "bg-warning/12 text-warning [a&]:hover:bg-warning/20",
        info: "bg-info/12 text-info [a&]:hover:bg-info/20",
        outline:
          "border-border text-foreground [a&]:hover:bg-muted [a&]:hover:text-muted-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
