"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { getHealth } from "@/lib/api";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: () => getHealth(), refetchInterval: 30_000 });
}

export function HealthDot() {
  const { data, isPending, isError } = useHealth();
  const healthy = !!data?.ok && data.ffmpeg;

  const label = isPending
    ? copy.header.statusChecking
    : healthy
      ? copy.header.statusReady
      : copy.header.statusNeedsAttention;

  const tooltip = isPending
    ? copy.header.statusChecking
    : healthy
      ? copy.header.statusTooltip(data?.ytdlp_version ?? "unknown", true)
      : isError
        ? copy.header.statusUnreachable
        : !data?.ffmpeg
          ? copy.header.statusFfmpegMissing
          : copy.header.statusAttentionTooltip;

  const indicator = (
    <div
      id="health-indicator"
      className={cn(
        "flex items-center gap-2 text-xs transition-colors",
        healthy ? "text-muted-foreground" : "text-rose-400 hover:text-rose-300 font-medium",
      )}
      title={tooltip}
      aria-live="polite"
    >
      <span className="relative flex size-2.5">
        {healthy && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2.5 rounded-full",
            isPending && "bg-zinc-500",
            (isError || (!healthy && !isPending)) && "bg-rose-500",
            !isPending && !isError && healthy && "bg-emerald-400",
          )}
        />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );

  if (!healthy && !isPending) {
    return (
      <Link href="/settings#system" title={tooltip} className="cursor-pointer">
        {indicator}
      </Link>
    );
  }

  return indicator;
}

