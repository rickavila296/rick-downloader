"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Lock,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";

import { cancelJob, retryJob } from "@/lib/api";
import { copy, getErrorCodeCopy, isJobRetryable } from "@/lib/copy";
import {
  formatDate,
  formatEta,
  formatJobError,
  formatSpeed,
  getFriendlyHint,
} from "@/lib/format";
import type { Job } from "@/lib/schemas";

interface JobRowProps {
  job: Job;
  onRefresh?: () => void;
}

export function JobRow({ job, onRefresh }: JobRowProps) {
  const [isActionPending, setIsActionPending] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleCancel = async () => {
    setIsActionPending(true);
    try {
      await cancelJob(job.id);
      onRefresh?.();
    } catch (err) {
      console.error("Failed to cancel job", err);
    } finally {
      setIsActionPending(false);
    }
  };

  const handleRetry = async () => {
    setIsActionPending(true);
    try {
      await retryJob(job.id);
      onRefresh?.();
    } catch (err) {
      console.error("Failed to retry job", err);
    } finally {
      setIsActionPending(false);
    }
  };

  const isRunning = job.status === "running";
  const isQueued = job.status === "queued";
  const isDone = job.status === "done";
  const isError = job.status === "error";
  const isCancelled = job.status === "cancelled";
  const isWaitingRetry = Boolean(isRunning && job.status_detail?.includes("Waiting to retry"));

  const canRetry = (isError || isCancelled) && isJobRetryable(job.error_code);

  const errCopy = getErrorCodeCopy(job.error_code, job.video_url);
  const errorTitle = job.error || errCopy.title || formatJobError(job.error);
  const errorHint = job.error_hint || errCopy.hint || getFriendlyHint(job.error_code, job.error);

  return (
    <div className="group relative rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 transition-all hover:border-zinc-700/80 hover:bg-zinc-900/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-100">
              {job.title || job.file_name || job.video_url}
            </span>
            <span className="shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              {job.preset}
            </span>
          </div>

          {job.status_detail && (
            <p className="mt-0.5 text-xs text-amber-400/80 font-medium">
              {job.status_detail}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            {isRunning && isWaitingRetry && (
              <span className="flex items-center gap-1.5 font-medium text-amber-400">
                <RefreshCw className="h-3 w-3 animate-spin text-amber-400" />
                {copy.drawer.retrying}
              </span>
            )}
            {isRunning && !isWaitingRetry && (
              <span className="flex items-center gap-1.5 font-medium text-amber-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                </span>
                {copy.drawer.downloading(Math.round(job.progress))}
              </span>
            )}
            {isQueued && (
              <span className="flex items-center gap-1 text-zinc-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                {copy.drawer.queued}
              </span>
            )}
            {isDone && (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {copy.drawer.completed}
              </span>
            )}
            {isError && (
              <span className="flex items-center gap-1 text-rose-400">
                <AlertCircle className="h-3.5 w-3.5" />
                {copy.drawer.failed}
              </span>
            )}
            {isCancelled && (
              <span className="flex items-center gap-1 text-zinc-500">
                <XCircle className="h-3.5 w-3.5" />
                {copy.drawer.cancelled}
              </span>
            )}

            {isRunning && !isWaitingRetry && job.speed_bps && (
              <span>• {formatSpeed(job.speed_bps)}</span>
            )}
            {isRunning && !isWaitingRetry && job.eta_s !== null && job.eta_s !== undefined && (
              <span>• ETA {formatEta(job.eta_s)}</span>
            )}
            {!isRunning && <span>• {formatDate(job.created_at)}</span>}
          </div>


          {isError && (
            <div className="mt-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-rose-200">
                {job.error_code === "login_required" ? (
                  <Lock className="h-4 w-4 shrink-0 text-amber-400" />
                ) : job.error_code === "drm" ? (
                  <Lock className="h-4 w-4 shrink-0 text-rose-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                )}
                <span>{errorTitle}</span>
              </div>

              {errorHint && (
                <p className="text-[11px] leading-relaxed text-rose-200/80">
                  {errorHint}
                </p>
              )}

              {job.error_raw && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowDetails(!showDetails)}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    {showDetails ? copy.scan.card.hideTechnicalDetails : copy.scan.card.showTechnicalDetails}
                  </button>
                  {showDetails && (
                    <pre
                      data-testid="job-error-raw"
                      className="mt-1.5 max-h-28 overflow-y-auto rounded bg-zinc-950/80 p-2 text-[10px] font-mono text-zinc-400 whitespace-pre-wrap break-all border border-zinc-800"
                    >
                      {job.error_raw}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action button */}
        <div className="flex shrink-0 items-center gap-1">
          {(isRunning || isQueued) && (
            <button
              onClick={handleCancel}
              disabled={isActionPending}
              title={copy.actions.cancelDownload}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-800/40 text-zinc-400 transition hover:border-rose-900/50 hover:bg-rose-950/40 hover:text-rose-300 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {canRetry && (
            <button
              onClick={handleRetry}
              disabled={isActionPending}
              title={copy.actions.retryDownload}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-800/40 text-zinc-400 transition hover:border-amber-900/50 hover:bg-amber-950/40 hover:text-amber-300 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isActionPending ? "animate-spin" : ""}`} />
            </button>
          )}

          {isDone && (
            <a
              href={`/api/files/${job.id}`}
              download
              title={copy.actions.downloadFile}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-900/50 bg-emerald-950/30 text-emerald-400 transition hover:bg-emerald-900/40 hover:text-emerald-300"
            >
              <Download className="h-4 w-4" />
            </a>
          )}

        </div>
      </div>

      {/* Progress bar for running/queued */}
      {(isRunning || isQueued) && (
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/80">
          <div
            className={`h-full transition-all duration-300 ease-out ${
              isWaitingRetry
                ? "bg-amber-500/70 animate-pulse w-full"
                : isRunning
                ? "bg-gradient-to-r from-amber-500 to-amber-400"
                : "bg-zinc-600 animate-pulse"
            }`}
            style={{
              width: isWaitingRetry ? "100%" : `${Math.max(5, Math.min(100, job.progress))}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}
