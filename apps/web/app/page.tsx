"use client";

import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  FolderDown,
  Link2,
  Lock,
  RefreshCw,
  SearchX,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { BatchConfirmDialog } from "@/components/scan/batch-confirm-dialog";
import { ResultsToolbar } from "@/components/scan/results-toolbar";
import { UrlForm } from "@/components/scan/url-form";
import { VideoGrid } from "@/components/scan/video-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, createJobs, createScan } from "@/lib/api";
import { copy } from "@/lib/copy";
import type { JobCreateItem, Preset, ScanResult } from "@/lib/schemas";
import { cn } from "@/lib/utils";

export default function ScanPage() {
  const [url, setUrl] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [globalPreset, setGlobalPreset] = useState<Preset>("best");
  const [selectedQualities, setSelectedQualities] = useState<Record<string, string>>({});
  const [batchWarningItems, setBatchWarningItems] = useState<JobCreateItem[] | null>(null);
  const [youtubeCount, setYoutubeCount] = useState<number>(0);

  const abortControllerRef = useRef<AbortController | null>(null);

  const scanMutation = useMutation({
    mutationFn: async (targetUrl: string) => {
      abortControllerRef.current = new AbortController();
      return createScan(targetUrl, abortControllerRef.current.signal);
    },
    onSuccess: (data) => {
      setScanResult(data);
      // Auto-select all available entries by default for convenience
      const availableIds = new Set(
        data.entries.filter((e) => e.status === "available").map((e) => e.id),
      );
      setSelectedIds(availableIds);

      // Initialize qualities with current global preset
      const initialQualities: Record<string, string> = {};
      data.entries.forEach((e) => {
        initialQualities[e.id] = globalPreset;
      });
      setSelectedQualities(initialQualities);
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async (items: JobCreateItem[]) => {
      return createJobs(items);
    },
    onSuccess: () => {
      window.dispatchEvent(new CustomEvent("open-downloads-drawer"));
    },
  });

  const handleDownloadSelected = () => {
    if (!scanResult || selectedIds.size === 0) return;

    const items: JobCreateItem[] = Array.from(selectedIds).map((entryId) => {
      const entry = scanResult.entries.find((e) => e.id === entryId);
      const quality = selectedQualities[entryId] || globalPreset;
      const isPreset = ["best", "1080p", "720p", "480p", "audio"].includes(quality);
      return {
        entry_id: entryId,
        video_url: entry?.video_url,
        preset: isPreset ? (quality as Preset) : globalPreset,
        format_id: !isPreset ? quality : undefined,
      };
    });

    const isYouTube = (item: JobCreateItem) => {
      const entry = scanResult.entries.find((e) => e.id === item.entry_id);
      const videoUrl = (item.video_url || entry?.video_url || "").toLowerCase();
      const extractor = (entry?.extractor || "").toLowerCase();
      return extractor.includes("youtube") || videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be");
    };

    const ytCount = items.filter(isYouTube).length;
    if (ytCount > 5) {
      setYoutubeCount(ytCount);
      setBatchWarningItems(items);
      return;
    }

    downloadMutation.mutate(items);
  };

  const handleConfirmBatch = () => {
    if (batchWarningItems) {
      downloadMutation.mutate(batchWarningItems);
      setBatchWarningItems(null);
    }
  };

  const handleCancelBatch = () => {
    setBatchWarningItems(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    scanMutation.mutate(url.trim());
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    scanMutation.reset();
  };

  const availableEntries = useMemo(
    () => scanResult?.entries.filter((e) => e.status === "available") ?? [],
    [scanResult],
  );

  const isAllSelected =
    availableEntries.length > 0 && availableEntries.every((e) => selectedIds.has(e.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(availableEntries.map((e) => e.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleGlobalPresetChange = (preset: Preset) => {
    setGlobalPreset(preset);
    // Update all card qualities to match
    setSelectedQualities((prev) => {
      const next = { ...prev };
      scanResult?.entries.forEach((e) => {
        next[e.id] = preset;
      });
      return next;
    });
  };

  const handleQualityChange = (entryId: string, quality: string) => {
    setSelectedQualities((prev) => ({
      ...prev,
      [entryId]: quality,
    }));
  };

  const isAllLoginRequired = useMemo(() => {
    if (!scanResult) return false;
    if (
      scanResult.entries.length > 0 &&
      availableEntries.length === 0 &&
      scanResult.entries.every((e) => e.status === "login_required")
    ) {
      return true;
    }
    if (
      scanResult.entries.length === 0 &&
      Boolean(scanResult.reason?.toLowerCase().includes("login"))
    ) {
      return true;
    }
    return false;
  }, [scanResult, availableEntries]);

  // Extract friendly error message
  const errorMessage = useMemo(() => {
    if (!scanMutation.error) return null;
    const err = scanMutation.error;
    if (err instanceof ApiError) {
      if (err.code === "blocked_url") {
        return `Blocked address: ${err.message}. Private IPs, localhost, and non-http schemes are blocked for security.`;
      }
      return err.message;
    }
    if (err instanceof Error && err.name === "AbortError") {
      return "Scan was cancelled.";
    }
    return "Failed to connect to scanner service.";
  }, [scanMutation.error]);

  const hasScanned = Boolean(scanResult !== null || scanMutation.isPending);

  return (
    <div className="flex flex-col gap-8">
      {/* Hero Section */}
      <section
        className={cn(
          "mx-auto flex w-full max-w-3xl flex-col items-center text-center transition-all duration-300",
          hasScanned ? "gap-4 pt-0" : "gap-6 pt-4",
        )}
      >
        {!hasScanned && (
          <>
            <Badge variant="secondary" className="gap-1.5 border-border/80 text-xs">
              {copy.scan.topBadge}
            </Badge>

            <h1 className="bg-gradient-to-b from-white via-zinc-200 to-zinc-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-5xl">
              {copy.scan.title}
            </h1>

            <p className="max-w-xl text-balance text-sm sm:text-base text-muted-foreground">
              {copy.scan.subtitle}
            </p>
          </>
        )}

        <div className="w-full">
          <UrlForm
            url={url}
            onUrlChange={setUrl}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={scanMutation.isPending}
            error={errorMessage}
            onClearError={() => scanMutation.reset()}
          />
        </div>

        {/* How it works (shown only before first scan) */}
        {!hasScanned && (
          <div className="flex flex-col items-center gap-6 pt-3 w-full">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl text-left">
              {copy.scan.howItWorks.map((item, idx) => {
                const Icon = idx === 0 ? Link2 : idx === 1 ? SlidersHorizontal : FolderDown;
                return (
                  <div
                    key={item.step}
                    className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-3 backdrop-blur-sm"
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-foreground">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        {item.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Works with */}
            <p className="text-xs text-muted-foreground text-balance max-w-xl">
              {copy.scan.worksWith.text}
              <a
                href={copy.scan.worksWith.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-primary underline underline-offset-2 transition-colors inline-flex items-center gap-0.5"
              >
                [{copy.scan.worksWith.linkText}]
              </a>
            </p>
          </div>
        )}
      </section>

      {/* Main Content Area */}
      <section className="w-full max-w-5xl mx-auto flex flex-col gap-6">
        {/* Loading State */}
        {scanMutation.isPending && (
          <div
            id="scan-loading-state"
            className="flex flex-col items-center justify-center py-16 gap-5 rounded-2xl border border-dashed border-border/80 bg-card/30 backdrop-blur-sm text-center"
          >
            <div className="relative flex size-14 items-center justify-center">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-violet-500 opacity-20" />
              <div className="size-12 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
            </div>

            <div>
              <h3 className="text-base font-semibold text-foreground">
                {copy.scan.loadingTitle}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {copy.scan.loadingSubtitle}
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="mt-2 text-xs"
            >
              {copy.scan.cancelScan}
            </Button>

            {/* Skeleton Grid placeholder */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full px-6 pt-4 opacity-40">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!scanMutation.isPending && scanResult && scanResult.entries.length === 0 && (
          <div
            id="scan-empty-state"
            className="flex flex-col items-center justify-center py-16 px-4 gap-3 text-center rounded-2xl border border-border/80 bg-card/40 backdrop-blur-sm"
          >
            <div
              className={cn(
                "size-12 rounded-full flex items-center justify-center",
                isAllLoginRequired
                  ? "bg-amber-500/10 text-amber-500"
                  : scanResult.status === "error"
                  ? "bg-amber-500/10 text-amber-500"
                  : "bg-muted/60 text-muted-foreground",
              )}
            >
              {isAllLoginRequired ? (
                <Lock className="size-6" />
              ) : scanResult.status === "error" ? (
                <AlertCircle className="size-6" />
              ) : (
                <SearchX className="size-6" />
              )}
            </div>
            <h3 className="text-base font-semibold text-foreground">
              {isAllLoginRequired
                ? copy.scan.emptyState.title
                : scanResult.status === "error"
                ? copy.scan.emptyState.scanNotice
                : copy.scan.emptyState.title}
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-md">
              {isAllLoginRequired
                ? copy.scan.emptyState.bodyLoginRequired
                : scanResult.reason || copy.scan.emptyState.bodyDefault}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setScanResult(null);
                setUrl("");
              }}
              className="mt-2 gap-1.5 text-xs"
            >
              <RefreshCw className="size-3.5" /> {copy.scan.emptyState.tryAnotherPage}
            </Button>
          </div>
        )}

        {/* Notice if all entries in result are login_required */}
        {!scanMutation.isPending && scanResult && scanResult.entries.length > 0 && isAllLoginRequired && (
          <div
            id="scan-empty-state"
            className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-center rounded-2xl border border-amber-500/30 bg-amber-500/10 backdrop-blur-sm"
          >
            <div className="size-10 rounded-full flex items-center justify-center bg-amber-500/20 text-amber-400">
              <Lock className="size-5" />
            </div>
            <h3 className="text-sm sm:text-base font-semibold text-foreground">
              {copy.scan.emptyState.title}
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-md">
              {copy.scan.emptyState.bodyLoginRequired}
            </p>
          </div>
        )}

        {/* Results Toolbar & Video Grid */}
        {!scanMutation.isPending && scanResult && scanResult.entries.length > 0 && (
          <div className="flex flex-col gap-5">
            <ResultsToolbar
              totalCount={scanResult.entries.length}
              availableCount={availableEntries.length}
              selectedCount={selectedIds.size}
              isAllSelected={isAllSelected}
              onToggleSelectAll={handleToggleSelectAll}
              globalPreset={globalPreset}
              onGlobalPresetChange={handleGlobalPresetChange}
              onDownloadSelected={handleDownloadSelected}
              isDownloading={downloadMutation.isPending}
              isTruncated={scanResult.truncated}
            />

            <VideoGrid
              scanId={scanResult.scan_id}
              entries={scanResult.entries}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              selectedQualities={selectedQualities}
              onQualityChange={handleQualityChange}
            />
          </div>
        )}
      </section>

      <BatchConfirmDialog
        open={batchWarningItems !== null}
        itemCount={youtubeCount}
        site="YouTube"
        onContinue={handleConfirmBatch}
        onCancel={handleCancelBatch}
      />
    </div>
  );
}
