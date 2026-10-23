"use client";

import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copy } from "@/lib/copy";
import type { Preset } from "@/lib/schemas";


interface ResultsToolbarProps {
  totalCount: number;
  availableCount: number;
  selectedCount: number;
  isAllSelected: boolean;
  onToggleSelectAll: () => void;
  globalPreset: Preset;
  onGlobalPresetChange: (preset: Preset) => void;
  onDownloadSelected: () => void;
  isDownloading?: boolean;
  isTruncated?: boolean;
}

export function ResultsToolbar({
  totalCount,
  availableCount,
  selectedCount,
  isAllSelected,
  onToggleSelectAll,
  globalPreset,
  onGlobalPresetChange,
  onDownloadSelected,
  isDownloading,
  isTruncated,
}: ResultsToolbarProps) {
  const skippedCount = Math.max(0, totalCount - availableCount);

  return (
    <div
      id="results-toolbar"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 p-3 backdrop-blur-sm"
    >
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <label
          htmlFor="select-all-checkbox"
          className="flex cursor-pointer items-center gap-2 select-none text-sm font-medium"
        >
          <Checkbox
            id="select-all-checkbox"
            checked={isAllSelected}
            disabled={availableCount === 0}
            onCheckedChange={onToggleSelectAll}
          />
          <span>{copy.scan.results.selectAll}</span>
        </label>

        <span className="text-xs text-muted-foreground">·</span>

        <span className="text-xs sm:text-sm text-muted-foreground">
          Found <strong className="text-foreground">{totalCount}</strong> video
          {totalCount === 1 ? "" : "s"}
          {selectedCount > 0 && (
            <span className="ml-1.5 text-primary font-medium">({selectedCount} selected)</span>
          )}
        </span>

        {skippedCount > 0 && (
          <>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="inline-flex items-center gap-1 text-xs text-amber-400/90">
              <span>{copy.scan.results.skippedSummary(skippedCount)}</span>
              <Tooltip>
                <TooltipTrigger>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={copy.scan.results.whySkippedTooltip}
                    className="inline-flex items-center text-xs underline underline-offset-2 hover:text-amber-300 transition-colors cursor-pointer"
                  >
                    [{copy.scan.results.whySkipped}]
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  {copy.scan.results.whySkippedTooltip}
                </TooltipContent>
              </Tooltip>
            </span>
          </>
        )}


        {isTruncated && (
          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
            {copy.scan.results.cappedAtLimit}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:inline text-xs text-muted-foreground">
            {copy.scan.results.presetLabel}
          </span>
          <Select
            value={globalPreset}
            onValueChange={(val) => {
              if (val) onGlobalPresetChange(val as Preset);
            }}
          >
            <SelectTrigger
              id="global-preset-select"
              className="h-8 text-xs w-[130px] border-border/80 bg-background/80"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="best">{copy.presets.best}</SelectItem>
              <SelectItem value="1080p">{copy.presets["1080p"]}</SelectItem>
              <SelectItem value="720p">{copy.presets["720p"]}</SelectItem>
              <SelectItem value="480p">{copy.presets["480p"]}</SelectItem>
              <SelectItem value="audio">{copy.presets.audio}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          id="download-selected-btn"
          size="sm"
          disabled={selectedCount === 0 || isDownloading}
          onClick={onDownloadSelected}
          className="h-8 gap-1.5 text-xs font-medium cursor-pointer shadow-md hover:shadow-primary/20"
        >
          <Download className="size-3.5" />
          <span>
            {isDownloading
              ? "Starting..."
              : copy.scan.results.saveSelected(selectedCount)}
          </span>
        </Button>
      </div>
    </div>
  );
}


