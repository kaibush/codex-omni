import { Toaster as Sonner, ToasterProps } from "sonner";
import { useTheme } from "@/context/theme-provider";

export function Toaster({ ...props }: ToasterProps) {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group [&_div[data-content]]:w-full"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)"
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
