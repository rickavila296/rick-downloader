"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { useHostStatus } from "@/lib/use-jobs";

export function RateLimitBanner() {
  const { data: status } = useHostStatus();
  const [dismissedUntil, setDismissedUntil] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick every second to update countdown and trigger re-render
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeLimit = status?.rate_limited?.find(
    (item) => new Date(item.until).getTime() > now,
  );

  if (!activeLimit) return null;
  if (dismissedUntil === activeLimit.until) return null;

  const secondsLeft = Math.max(
    0,
    Math.floor((new Date(activeLimit.until).getTime() - now) / 1000),
  );

  if (secondsLeft <= 0) return null;

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
  const ss = (secondsLeft % 60).toString().padStart(2, "0");

  const hostName = activeLimit.host.toLowerCase().includes("youtube")
    ? "YouTube"
    : activeLimit.host;

  return (
    <div
      role="alert"
      id="rate-limit-banner"
      className="relative z-40 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2.5 text-xs text-amber-200 backdrop-blur-sm transition-all"
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-amber-300">
              {hostName} is rate-limiting you. Retrying automatically in {mm}:{ss}.
            </span>
            <span className="text-amber-300/80">
              Tips: turn off any VPN, refresh secrets/cookies.txt if it&apos;s old, or try again later.
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDismissedUntil(activeLimit.until)}
          aria-label="Dismiss banner"
          className="rounded-lg p-1 text-amber-300/80 transition hover:bg-amber-500/20 hover:text-amber-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
