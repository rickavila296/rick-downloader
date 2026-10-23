"use client";

import { useEffect, useState } from "react";
import { DownloadCloud, Layers, X } from "lucide-react";

import { JobRow } from "@/components/downloads/job-row";
import { copy } from "@/lib/copy";
import { useJobs } from "@/lib/use-jobs";


interface DownloadsDrawerProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DownloadsDrawer({
  isOpen: controlledIsOpen,
  onOpenChange,
}: DownloadsDrawerProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = onOpenChange || setInternalIsOpen;

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("open-downloads-drawer", handler);
    return () => window.removeEventListener("open-downloads-drawer", handler);
  }, [setIsOpen]);

  const { data, refetch } = useJobs();
  const jobs = data?.jobs || [];

  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const activeCount = activeJobs.length;


  return (
    <>
      {/* Floating Trigger Button (when drawer is closed) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full border border-zinc-700/80 bg-zinc-900/90 px-4 py-2.5 text-sm font-medium text-zinc-100 shadow-2xl backdrop-blur-md transition-all hover:border-amber-500/50 hover:bg-zinc-800"
        >
          <div className="relative">
            <DownloadCloud className="h-5 w-5 text-amber-400" />
            {activeCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
            )}
          </div>
          <span>{copy.header.downloadsButton(activeCount)}</span>
        </button>
      )}

      {/* Drawer Overlay backdrop on mobile */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity sm:hidden"
        />
      )}

      {/* Slide-out Drawer Panel */}
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-xl transition-transform duration-300 sm:w-[420px] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <DownloadCloud className="h-5 w-5 text-amber-400" />
            <h2 className="text-base font-semibold text-zinc-100">{copy.drawer.title}</h2>
            {activeCount > 0 && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                {copy.drawer.activeCount(activeCount)}
              </span>
            )}
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {jobs.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-zinc-500">
                <Layers className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-medium text-zinc-300">{copy.drawer.emptyTitle}</p>
              <p className="mt-1 text-xs text-zinc-500 max-w-[220px]">
                {copy.drawer.emptyBody}
              </p>
            </div>
          ) : (
            jobs.map((job) => (
              <JobRow key={job.id} job={job} onRefresh={refetch} />
            ))
          )}
        </div>
      </aside>
    </>
  );
}

