"use client";

import { Link2, Loader2, ScanSearch, X, XCircle } from "lucide-react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";

interface UrlFormProps {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel?: () => void;
  isLoading: boolean;
  error?: string | null;
  onClearError?: () => void;
}

export function UrlForm({
  url,
  onUrlChange,
  onSubmit,
  onCancel,
  isLoading,
  error,
  onClearError,
}: UrlFormProps) {
  return (
    <div className="w-full">
      <form
        id="scan-form"
        onSubmit={onSubmit}
        className="group relative flex w-full flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-2xl border border-border/80 bg-card/70 p-2 shadow-2xl shadow-violet-950/30 backdrop-blur-md transition focus-within:border-primary/70 focus-within:ring-4 focus-within:ring-primary/20"
      >
        <div className="flex flex-1 items-center gap-2 px-2">
          <Link2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <label htmlFor="scan-url" className="sr-only">
            Page URL
          </label>
          <input
            id="scan-url"
            name="url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder={copy.scan.inputPlaceholder}
            value={url}
            onChange={(e) => {
              if (error && onClearError) {
                onClearError();
              }
              onUrlChange(e.target.value);
            }}
            disabled={isLoading}
            required
            className="h-11 w-full bg-transparent text-sm sm:text-base outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
          />
          {url && !isLoading && (
            <button
              type="button"
              onClick={() => onUrlChange("")}
              className="text-muted-foreground hover:text-foreground p-1 transition-colors"
              title="Clear input"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isLoading && onCancel && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={onCancel}
              className="h-11 px-4 text-xs sm:text-sm border-border/80 hover:bg-destructive/10 hover:text-destructive"
            >
              {copy.scan.buttonCancel}
            </Button>
          )}
          <Button
            id="scan-submit"
            type="submit"
            size="lg"
            disabled={isLoading || !url.trim()}
            className="h-11 w-full sm:w-auto gap-2 px-6 shadow-md transition-all active:scale-[0.98]"
          >
            {isLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>{copy.scan.buttonScanning}</span>
              </>
            ) : (
              <>
                <ScanSearch className="size-4" />
                <span>{copy.scan.buttonFind}</span>
              </>
            )}
          </Button>
        </div>
      </form>

      <p id="scan-helper-text" className="mt-2.5 text-xs text-muted-foreground text-center sm:text-left">
        {copy.scan.helperText}
      </p>


      {error && (
        <div
          id="scan-error-inline"
          className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs sm:text-sm text-rose-300"
        >
          <XCircle className="size-4 shrink-0 mt-0.5 text-rose-400" />
          <span className="flex-1 break-words">{error}</span>
          {onClearError && (
            <button
              type="button"
              onClick={onClearError}
              className="text-rose-400 hover:text-rose-200 transition-colors"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
