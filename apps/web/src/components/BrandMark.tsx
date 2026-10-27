import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { brandingQueryKey, fetchBranding, normalizeBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  iconClassName = "size-4",
  alt = ""
}: {
  className?: string;
  iconClassName?: string;
  alt?: string;
}) {
  const branding = useQuery({
    queryKey: brandingQueryKey,
    queryFn: fetchBranding,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false
  });
  const iconUrl = normalizeBranding(branding.data).iconUrl;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden",
        iconUrl ? "bg-background ring-1 ring-border" : "brand-mark",
        className
      )}
    >
      {iconUrl ? (
        <img src={iconUrl} alt={alt} className="size-full object-contain" />
      ) : (
        <Bot className={cn("shrink-0", iconClassName)} />
      )}
    </span>
  );
}
