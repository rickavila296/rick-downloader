"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { HealthDot } from "@/components/health-dot";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: copy.nav.save, id: "nav-save" },
  { href: "/history", label: copy.nav.history, id: "nav-history" },
  { href: "/settings", label: copy.nav.settings, id: "nav-settings" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-4 px-4">
        <Link href="/" id="nav-logo" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-violet-400 to-cyan-400 text-zinc-950 shadow-lg shadow-violet-500/20">
            <Download className="size-4" strokeWidth={2.5} />
          </span>
          <span>{copy.appName}</span>
        </Link>
        <nav className="ml-2 flex items-center gap-1 text-sm">
          {NAV.map(({ href, label, id }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                id={id}
                href={href}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  active
                    ? "bg-secondary text-foreground font-medium"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <HealthDot />
        </div>
      </div>
    </header>
  );
}

