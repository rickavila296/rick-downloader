"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Clock,
  Film,
  Loader2,
  Lock,
  Radio,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getEntryFormats } from "@/lib/api";
import { copy, getErrorCodeCopy, siteName } from "@/lib/copy";
import { formatBytes, formatDuration } from "@/lib/format";
import type { ScanEntry } from "@/lib/schemas";
import { cn } from "@/lib/utils";

interface VideoCardProps {
  scanId: string;
  entry: ScanEntry;
  isSelected: boolean;
  onToggleSelect: () => void;
  selectedQuality: string; // preset name or format_id
  onQualityChange: (quality: string) => void;
}

export function VideoCard({
  scanId,
  entry,
  isSelected,
  onToggleSelect,
  selectedQuality,
  onQualityChange,
}: VideoCardProps) {
  const [thumbError, setThumbError] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const isAvailable = entry.status === "available";

  const errorDetails = getErrorCodeCopy(entry.error_code || entry.status, entry.video_url);
  const friendlyStatusTitle = errorDetails.title;
  const friendlyStatusHint = errorDetails.hint;

  // Requirement 2: Only fetch formats for a card when the user opens its quality dropdown, not for every card on render.
  const shouldFetchFormats = isAvailable && (dropdownOpen || hasOpened);

  const {
    data: formatsData,
    isLoading: isLoadingFormats,
    error: formatsError,
  } = useQuery({
    queryKey: ["formats", scanId, entry.id],
    queryFn: () => getEntryFormats(scanId, entry.id, entry.video_url),
    enabled: shouldFetchFormats,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const formats = formatsData?.formats ?? [];

  return (
    <Card
      id={`video-card-${entry.id}`}
      className={cn(
        "group relative overflow-hidden transition-all duration-200 border-border/70 bg-card/60 hover:border-primary/50 flex flex-col",
        isSelected && "ring-2 ring-primary border-primary bg-card/90",
        !isAvailable && "opacity-75 bg-muted/20 border-dashed hover:border-border cursor-not-allowed",
      )}
    >
      {/* 16:9 Thumbnail container */}
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-900 flex items-center justify-center">
        {entry.thumbnail && !thumbError ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={entry.thumbnail}
            alt={entry.title || "Video thumbnail"}
            loading="lazy"
            onError={() => setThumbError(true)}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-600 gap-1.5 p-4 text-center">
            <Film className="size-8" />
            <span className="text-[11px] font-mono uppercase tracking-wider">{entry.extractor}</span>
          </div>
        )}

        {/* Selection Checkbox (top-left) */}
        <div className="absolute top-2.5 left-2.5 z-10">
          <Checkbox
            id={`checkbox-${entry.id}`}
            checked={isSelected}
            disabled={!isAvailable}
            onCheckedChange={() => onToggleSelect()}
            className={cn(
              "size-5 bg-background/80 backdrop-blur-md shadow-md border-zinc-400/80 data-[state=checked]:bg-primary data-[state=checked]:border-primary",
              !isAvailable && "opacity-40 cursor-not-allowed",
            )}
          />
        </div>

        {/* Duration badge (bottom-right) */}
        {entry.duration_s !== null && entry.duration_s !== undefined && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-mono text-zinc-200 backdrop-blur-sm">
            <Clock className="size-3 text-zinc-400" />
            <span>{formatDuration(entry.duration_s)}</span>
          </div>
        )}

        {/* Non-available overlay badge */}
        {!isAvailable && (
          <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] flex items-center justify-center p-3">
            <StatusBadge status={entry.status} />
          </div>
        )}
      </div>

      {/* Card Content */}
      <CardContent className="p-3.5 flex flex-col flex-1 justify-between gap-3">
        <div>
          {/* Title - clamped to 2 lines */}
          <h3
            className="text-sm font-medium leading-snug line-clamp-2 text-foreground"
            title={entry.title || entry.video_url}
          >
            {entry.title || "Untitled Video"}
          </h3>

          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Radio className="size-3 text-violet-400" />
            <span className="capitalize">{entry.extractor}</span>
          </div>

          {!isAvailable && (
            <div className="mt-2.5 rounded-lg border border-border/80 bg-muted/40 p-2.5 text-xs flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-foreground">
                {entry.status === "login_required" ? (
                  <Lock className="size-3.5 shrink-0 text-amber-400" />
                ) : entry.status === "drm" ? (
                  <Lock className="size-3.5 shrink-0 text-rose-400" />
                ) : (
                  <AlertCircle className="size-3.5 shrink-0 text-zinc-400" />
                )}
                <span>{friendlyStatusTitle}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {friendlyStatusHint}
              </p>
              {entry.error_raw && (
                <div className="pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowDetails(!showDetails)}
                    className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    {showDetails ? copy.scan.card.hideTechnicalDetails : copy.scan.card.showTechnicalDetails}
                  </button>
                  {showDetails && (
                    <pre
                      data-testid="card-error-raw"
                      className="mt-1.5 max-h-24 overflow-y-auto rounded bg-zinc-950/80 p-2 text-[10px] font-mono text-zinc-400 whitespace-pre-wrap break-all border border-zinc-800"
                    >
                      {entry.error_raw}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quality selector dropdown */}
        <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{copy.scan.card.qualityLabel}</span>
          {isAvailable ? (
            <Select
              value={selectedQuality}
              onValueChange={(val) => {
                if (val) onQualityChange(val);
              }}
              onOpenChange={(open) => {
                setDropdownOpen(open);
                if (open) setHasOpened(true);
              }}
            >
              <SelectTrigger
                id={`quality-select-${entry.id}`}
                className="h-7 text-xs w-[145px] border-border/70 bg-background/60"
              >
                <SelectValue placeholder={`Preset: ${copy.presets.best}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {copy.scan.card.presetsLabel}
                  </SelectLabel>
                  <SelectItem value="best">{copy.presets.best}</SelectItem>
                  <SelectItem value="1080p">{copy.presets["1080p"]}</SelectItem>
                  <SelectItem value="720p">{copy.presets["720p"]}</SelectItem>
                  <SelectItem value="480p">{copy.presets["480p"]}</SelectItem>
                  <SelectItem value="audio">{copy.presets.audio}</SelectItem>
                </SelectGroup>

                {shouldFetchFormats && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                        <span>{copy.scan.card.directFormatsLabel}</span>
                        {isLoadingFormats && <Loader2 className="size-3 animate-spin" />}
                      </SelectLabel>
                      {formats.length > 0 ? (
                        formats
                          .filter((f) => f.height || f.filesize || f.vcodec !== "none")
                          .slice(0, 8)
                          .map((f) => (
                            <SelectItem key={f.format_id} value={f.format_id} className="text-xs">
                              {f.height ? `${f.height}p` : f.note || f.ext}{" "}
                              {f.ext && `(${f.ext})`}
                              {f.filesize ? ` · ${formatBytes(f.filesize)}` : ""}
                            </SelectItem>
                          ))
                      ) : (
                        <div className="py-2 px-2 text-center text-xs text-muted-foreground max-w-[200px] leading-relaxed">
                          {isLoadingFormats
                            ? copy.scan.card.loadingFormats
                            : formatsError
                              ? formatsError.message || copy.scan.card.rateLimitedFormats(siteName(entry.video_url))
                              : copy.scan.card.defaultPresetsOnly}
                        </div>
                      )}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground italic">{copy.scan.card.unavailable}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ScanEntry["status"] }) {
  if (status === "drm") {
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className="inline-flex">
            <Badge
              variant="destructive"
              className="gap-1.5 bg-rose-500/90 text-white font-medium text-xs px-2.5 py-1 shadow-lg shadow-rose-950/50"
            >
              <Lock className="size-3.5" />
              <span>{copy.scan.card.badges.drm}</span>
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {copy.scan.card.tooltips.drm}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (status === "login_required") {
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className="inline-flex">
            <Badge
              variant="secondary"
              className="gap-1.5 bg-amber-500/90 text-zinc-950 font-medium text-xs px-2.5 py-1 shadow-lg shadow-amber-950/40"
            >
              <Lock className="size-3.5" />
              <span>{copy.scan.card.badges.loginRequired}</span>
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {copy.scan.card.tooltips.loginRequired}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="inline-flex">
          <Badge variant="secondary" className="gap-1.5 bg-zinc-800 text-zinc-300 text-xs px-2.5 py-1">
            <AlertCircle className="size-3.5" />
            <span>{copy.scan.card.badges.unsupported}</span>
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {copy.scan.card.tooltips.unsupported}
      </TooltipContent>
    </Tooltip>
  );
}

