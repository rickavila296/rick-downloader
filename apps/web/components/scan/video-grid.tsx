"use client";

import { VideoCard } from "@/components/scan/video-card";
import type { ScanEntry } from "@/lib/schemas";

interface VideoGridProps {
  scanId: string;
  entries: ScanEntry[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  selectedQualities: Record<string, string>;
  onQualityChange: (id: string, quality: string) => void;
}

export function VideoGrid({
  scanId,
  entries,
  selectedIds,
  onToggleSelect,
  selectedQualities,
  onQualityChange,
}: VideoGridProps) {
  return (
    <div
      id="video-grid"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full"
    >
      {entries.map((entry) => (
        <VideoCard
          key={entry.id}
          scanId={scanId}
          entry={entry}
          isSelected={selectedIds.has(entry.id)}
          onToggleSelect={() => onToggleSelect(entry.id)}
          selectedQuality={selectedQualities[entry.id] || "best"}
          onQualityChange={(quality) => onQualityChange(entry.id, quality)}
        />
      ))}
    </div>
  );
}
