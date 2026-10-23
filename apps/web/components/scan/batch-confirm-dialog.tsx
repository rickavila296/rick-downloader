"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";

interface BatchConfirmDialogProps {
  open: boolean;
  itemCount: number;
  site?: string;
  onContinue: () => void;
  onCancel: () => void;
}

export function BatchConfirmDialog({
  open,
  itemCount,
  site = "YouTube",
  onContinue,
  onCancel,
}: BatchConfirmDialogProps) {
  if (!open) return null;

  const estimatedMin = Math.round(itemCount * 1.5 * 10) / 10;

  return (
    <div
      role="dialog"
      aria-modal="true"
      id="batch-confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              {site} Rate-Limit Caution
            </h2>
            <p className="text-xs text-zinc-400">
              Batch download of {itemCount} {site} videos
            </p>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
          {copy.scan.dialog.batchConfirm(site, estimatedMin)}
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="h-9 px-4 text-xs font-medium border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300"
          >
            {copy.scan.dialog.cancel}
          </Button>
          <Button
            type="button"
            onClick={onContinue}
            className="h-9 px-5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950"
          >
            {copy.scan.dialog.continue}
          </Button>
        </div>
      </div>
    </div>
  );
}

