"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Download,
  Film,
  Folder,
  HardDrive,
  History,
  Loader2,
  MoreVertical,
  RotateCw,
  Search,
  Trash2,
  Video,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteJob, retryJob } from "@/lib/api";
import { copy, isJobRetryable, siteName } from "@/lib/copy";
import { formatBytes, formatDate, formatJobError } from "@/lib/format";
import type { Job } from "@/lib/schemas";
import { useJobs } from "@/lib/use-jobs";

type FilterTab = "all" | "saved" | "didnt_save";

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [jobToDeleteWithFile, setJobToDeleteWithFile] = useState<Job | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { data, isLoading, refetch } = useJobs();
  const allJobs = useMemo(() => data?.jobs || [], [data?.jobs]);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const savedJobs = useMemo(
    () => allJobs.filter((j) => j.status === "done"),
    [allJobs],
  );
  const didntSaveJobs = useMemo(
    () => allJobs.filter((j) => j.status === "error" || j.status === "cancelled"),
    [allJobs],
  );

  // Storage summary: {n} files · {size}
  const storageSummary = useMemo(() => {
    const count = savedJobs.length;
    const totalBytes = savedJobs.reduce((acc, j) => acc + (j.bytes_total || 0), 0);
    const sizeStr = formatBytes(totalBytes) || "0 B";
    return copy.history.storageSummary(count, sizeStr);
  }, [savedJobs]);

  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      // Tab filter
      if (activeTab === "saved" && job.status !== "done") return false;
      if (activeTab === "didnt_save" && job.status !== "error" && job.status !== "cancelled") {
        return false;
      }

      // Search filter: title, filename, URL, and site name
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const title = (job.title || "").toLowerCase();
        const url = (job.video_url || "").toLowerCase();
        const filename = (job.file_name || "").toLowerCase();
        const site = siteName(job.video_url).toLowerCase();
        if (
          !title.includes(query) &&
          !url.includes(query) &&
          !filename.includes(query) &&
          !site.includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [allJobs, activeTab, searchQuery]);

  const handleRetry = async (jobId: string) => {
    setActionLoadingId(jobId);
    try {
      await retryJob(jobId);
      refetch();
    } catch (err) {
      console.error("Failed to retry job", err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteRecordOnly = async (jobId: string) => {
    setActionLoadingId(jobId);
    try {
      await deleteJob(jobId, false);
      showToast(copy.history.toast.deleted);
      refetch();
    } catch (err) {
      console.error("Failed to delete record", err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConfirmDeleteWithFile = async () => {
    if (!jobToDeleteWithFile) return;
    const jobId = jobToDeleteWithFile.id;
    setJobToDeleteWithFile(null);
    setActionLoadingId(jobId);
    try {
      await deleteJob(jobId, true);
      showToast(copy.history.toast.fileDeleted);
      refetch();
    } catch (err) {
      console.error("Failed to delete job with file", err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleShowInFolder = (job: Job) => {
    const filename = job.file_name || "video file";
    showToast(`Saved in download folder: ${filename}`);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 py-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <History className="size-6 text-primary" /> {copy.history.title}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            {copy.history.subtitle}
          </p>
        </div>

        {/* Storage Summary on the right */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-mono text-muted-foreground shadow-sm">
            <HardDrive className="size-3.5 text-muted-foreground/80" />
            {storageSummary}
          </span>
        </div>
      </div>

      {/* Filter Chips & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-card border border-border/80">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "all"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {copy.history.filterAll(allJobs.length)}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("saved")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "saved"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {copy.history.filterSaved(savedJobs.length)}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("didnt_save")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "didnt_save"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {copy.history.filterDidntSave(didntSaveJobs.length)}
          </button>
        </div>

        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={copy.history.searchPlaceholder}
            className="h-9 w-full rounded-xl border border-border/80 bg-background/80 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty State: No history at all */}
      {!isLoading && allJobs.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 py-16 text-center px-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 mb-3 border border-border/60">
            <Video className="size-6 text-muted-foreground/70" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {copy.history.emptyTitle}
          </h3>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-sm">
            {copy.history.emptyBody}
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
          >
            {copy.history.emptyAction}
          </Link>
        </div>
      )}

      {/* Empty State: Filtered / Search has no matches */}
      {!isLoading && allJobs.length > 0 && filteredJobs.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 py-16 text-center px-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 mb-3 border border-border/60">
            <Search className="size-6 text-muted-foreground/70" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {copy.history.emptyFilteredTitle}
          </h3>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-sm">
            {copy.history.emptyFilteredBody}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setActiveTab("all");
              setSearchQuery("");
            }}
            className="mt-5 h-9 rounded-xl border-border/80 text-xs font-medium"
          >
            {copy.history.emptyFilteredAction}
          </Button>
        </div>
      )}

      {/* Desktop Table View (>= sm) */}
      {!isLoading && filteredJobs.length > 0 && (
        <>
          <div className="hidden sm:block overflow-hidden rounded-2xl border border-border/80 bg-card/40 backdrop-blur-sm">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/80 bg-muted/40 font-medium text-muted-foreground">
                <tr>
                  <th className="py-3.5 pl-4 pr-3">Video</th>
                  <th className="px-3 py-3.5">Site</th>
                  <th className="px-3 py-3.5">Quality</th>
                  <th className="px-3 py-3.5">Size</th>
                  <th className="px-3 py-3.5">Date</th>
                  <th className="px-3 py-3.5">Status</th>
                  <th className="py-3.5 pl-3 pr-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredJobs.map((job) => (
                  <HistoryTableRow
                    key={job.id}
                    job={job}
                    isActionLoading={actionLoadingId === job.id}
                    onRetry={() => handleRetry(job.id)}
                    onDeleteRecord={() => handleDeleteRecordOnly(job.id)}
                    onRequestDeleteFile={() => setJobToDeleteWithFile(job)}
                    onShowInFolder={() => handleShowInFolder(job)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View (< sm) */}
          <div className="grid grid-cols-1 gap-3 sm:hidden">
            {filteredJobs.map((job) => (
              <HistoryMobileCard
                key={job.id}
                job={job}
                isActionLoading={actionLoadingId === job.id}
                onRetry={() => handleRetry(job.id)}
                onDeleteRecord={() => handleDeleteRecordOnly(job.id)}
                onRequestDeleteFile={() => setJobToDeleteWithFile(job)}
                onShowInFolder={() => handleShowInFolder(job)}
              />
            ))}
          </div>
        </>
      )}

      {/* Delete with File Confirmation Dialog */}
      {jobToDeleteWithFile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-file-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h2 id="delete-file-title" className="text-base font-semibold text-zinc-100">
                  {copy.history.deleteDialog.title}
                </h2>
                {jobToDeleteWithFile.file_name && (
                  <p className="text-xs text-zinc-400 font-mono truncate max-w-[280px]">
                    {jobToDeleteWithFile.file_name}
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              {copy.history.deleteDialog.body}
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setJobToDeleteWithFile(null)}
                className="h-9 px-4 text-xs font-medium border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300"
              >
                {copy.history.deleteDialog.cancel}
              </Button>
              <Button
                type="button"
                onClick={handleConfirmDeleteWithFile}
                className="h-9 px-5 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
              >
                {copy.history.deleteDialog.confirm}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Accessible Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-border/80 bg-zinc-950/95 px-4 py-2.5 text-xs font-medium text-foreground shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <Check className="size-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

interface ActionProps {
  job: Job;
  isActionLoading: boolean;
  onRetry: () => void;
  onDeleteRecord: () => void;
  onRequestDeleteFile: () => void;
  onShowInFolder: () => void;
}

function HistoryTableRow({
  job,
  isActionLoading,
  onRetry,
  onDeleteRecord,
  onRequestDeleteFile,
  onShowInFolder,
}: ActionProps) {
  const isDone = job.status === "done";
  const isError = job.status === "error";
  const site = siteName(job.video_url);
  const title = job.title || job.file_name || job.video_url;
  const quality = copy.presets[job.preset as keyof typeof copy.presets] || job.preset;
  const size = job.bytes_total ? formatBytes(job.bytes_total) : "–";

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="py-3.5 pl-4 pr-3">
        <div className="flex items-center gap-3 max-w-[320px]">
          <div className="relative h-11 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-900 border border-border/60 flex items-center justify-center">
            <Film className="size-4 text-muted-foreground/40" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-foreground text-sm" title={title}>
              {title}
            </div>
            {job.file_name && (
              <div className="truncate font-mono text-[11px] text-muted-foreground mt-0.5">
                {job.file_name}
              </div>
            )}
            {isError && (
              <div className="line-clamp-2 text-[11px] text-rose-400 mt-1">
                <span className="font-semibold text-rose-300">Error: </span>
                {formatJobError(job.error || job.status_detail || "")}
              </div>
            )}
          </div>
        </div>
      </td>

      <td className="px-3 py-3.5 text-muted-foreground whitespace-nowrap font-medium">
        {site}
      </td>

      <td className="px-3 py-3.5 whitespace-nowrap">
        <Badge variant="outline" className="text-[11px] font-mono">
          {quality}
        </Badge>
      </td>

      <td className="px-3 py-3.5 text-muted-foreground font-mono whitespace-nowrap">
        {size}
      </td>

      <td className="px-3 py-3.5 text-muted-foreground whitespace-nowrap">
        {formatDate(job.created_at)}
      </td>

      <td className="px-3 py-3.5 whitespace-nowrap">
        <StatusBadge status={job.status} />
      </td>

      <td className="py-3.5 pl-3 pr-4 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {isDone && (
            <a
              href={`/api/files/${job.id}`}
              download
              title={copy.history.rowMenu.openFile}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background/80 px-2.5 text-xs font-medium text-foreground transition hover:border-emerald-500/50 hover:bg-emerald-950/20 hover:text-emerald-300"
            >
              <Download className="size-3.5 text-emerald-400" />
              <span>{copy.history.rowMenu.openFile}</span>
            </a>
          )}

          <RowActionMenu
            job={job}
            isActionLoading={isActionLoading}
            onRetry={onRetry}
            onDeleteRecord={onDeleteRecord}
            onRequestDeleteFile={onRequestDeleteFile}
            onShowInFolder={onShowInFolder}
          />
        </div>
      </td>
    </tr>
  );
}

function HistoryMobileCard({
  job,
  isActionLoading,
  onRetry,
  onDeleteRecord,
  onRequestDeleteFile,
  onShowInFolder,
}: ActionProps) {
  const isDone = job.status === "done";
  const isError = job.status === "error";
  const site = siteName(job.video_url);
  const title = job.title || job.file_name || job.video_url;
  const quality = copy.presets[job.preset as keyof typeof copy.presets] || job.preset;
  const size = job.bytes_total ? formatBytes(job.bytes_total) : "–";

  return (
    <div className="rounded-xl border border-border/80 bg-card/50 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="relative h-12 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-900 border border-border/60 flex items-center justify-center">
          <Film className="size-4 text-muted-foreground/40" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground text-sm truncate" title={title}>
            {title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{site}</span>
            <span>•</span>
            <Badge variant="outline" className="text-[10px] font-mono">
              {quality}
            </Badge>
            <span>•</span>
            <span>{formatDate(job.created_at)}</span>
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {isError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
          <span className="font-semibold text-rose-200">Error: </span>
          {formatJobError(job.error || job.status_detail || "")}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60 text-xs">
        <span className="font-mono text-muted-foreground">{size}</span>

        <div className="flex items-center gap-1.5">
          {isDone && (
            <a
              href={`/api/files/${job.id}`}
              download
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background/80 px-2.5 text-xs font-medium text-foreground"
            >
              <Download className="size-3.5 text-emerald-400" />
              <span>{copy.history.rowMenu.openFile}</span>
            </a>
          )}

          <RowActionMenu
            job={job}
            isActionLoading={isActionLoading}
            onRetry={onRetry}
            onDeleteRecord={onDeleteRecord}
            onRequestDeleteFile={onRequestDeleteFile}
            onShowInFolder={onShowInFolder}
          />
        </div>
      </div>
    </div>
  );
}

function RowActionMenu({
  job,
  isActionLoading,
  onRetry,
  onDeleteRecord,
  onRequestDeleteFile,
  onShowInFolder,
}: ActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isDone = job.status === "done";
  const isRunning = job.status === "running" || job.status === "queued";
  const canRetry = isJobRetryable(job.error_code) && !isRunning;

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isActionLoading}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Actions"
        aria-expanded={isOpen}
        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
      >
        <MoreVertical className="size-4" />
      </Button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-48 rounded-xl border border-border/80 bg-zinc-950 p-1.5 shadow-xl space-y-0.5 animate-in fade-in-50 zoom-in-95 duration-100">
          {isDone && (
            <a
              href={`/api/files/${job.id}`}
              download
              onClick={() => setIsOpen(false)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors"
            >
              <Download className="size-3.5 text-emerald-400" />
              <span>{copy.history.rowMenu.openFile}</span>
            </a>
          )}

          {isDone && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onShowInFolder();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors text-left"
            >
              <Folder className="size-3.5 text-sky-400" />
              <span>{copy.history.rowMenu.showInFolder}</span>
            </button>
          )}

          {canRetry && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onRetry();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors text-left"
            >
              <RotateCw className="size-3.5 text-amber-400" />
              <span>{copy.history.rowMenu.saveAgain}</span>
            </button>
          )}

          <div className="my-1 border-t border-zinc-800" />

          <button
            type="button"
            disabled={isRunning}
            onClick={() => {
              setIsOpen(false);
              onDeleteRecord();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-colors text-left disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
            <span>{copy.history.rowMenu.removeFromHistory}</span>
          </button>

          {isDone && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onRequestDeleteFile();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 transition-colors text-left"
            >
              <Trash2 className="size-3.5" />
              <span>{copy.history.rowMenu.removeAndDeleteFile}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 className="size-3" />
        <span>Saved</span>
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-400 border border-rose-500/20">
        <AlertCircle className="size-3" />
        <span>{"Didn't save"}</span>
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-400 border border-zinc-700">
        <XCircle className="size-3" />
        <span>Cancelled</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400 border border-amber-500/20">
      <Loader2 className="size-3 animate-spin" />
      <span>{status === "queued" ? "Queued" : "Downloading"}</span>
    </span>
  );
}
