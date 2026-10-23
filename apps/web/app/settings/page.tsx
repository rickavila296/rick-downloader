"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Folder,
  Info,
  Loader2,
  Save,
  Scale,
  Settings as SettingsIcon,
  Shield,
  Sliders,
  Terminal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getHealth, getSettings, updateSettings } from "@/lib/api";
import { copy } from "@/lib/copy";
import type { Preset } from "@/lib/schemas";
import { useJobs } from "@/lib/use-jobs";

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => getHealth(),
    refetchInterval: 10_000,
  });

  const { data: jobsData } = useJobs();
  const runningCount = useMemo(() => {
    return jobsData?.jobs.filter((j) => j.status === "running").length ?? 0;
  }, [jobsData?.jobs]);

  const [defaultPreset, setDefaultPreset] = useState<Preset>("best");
  const [maxConcurrent, setMaxConcurrent] = useState<number>(2);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (settings) {
      setDefaultPreset(settings.default_preset);
      setMaxConcurrent(settings.max_concurrent);
    }
  }, [settings]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      defaultPreset !== settings.default_preset ||
      maxConcurrent !== settings.max_concurrent
    );
  }, [settings, defaultPreset, maxConcurrent]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateSettings({
        default_preset: defaultPreset,
        max_concurrent: maxConcurrent,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      showToast(copy.settings.saving.toastSaved);
    },
  });

  const handleSave = () => {
    if (!isDirty) return;
    saveMutation.mutate();
  };

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(copy.settings.system.updateCommand);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    } catch (err) {
      console.error("Failed to copy command", err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 py-4">
      {/* Page Header */}
      <div className="border-b border-border/80 pb-5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <SettingsIcon className="size-6 text-primary" /> {copy.settings.title}
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          {copy.settings.subtitle}
        </p>
      </div>

      <div className="grid gap-6">
        {/* Card 1: Saving */}
        <Card className="border-border/80 bg-card/40 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Folder className="size-4 text-amber-400" />
              <CardTitle className="text-base">{copy.settings.saving.title}</CardTitle>
            </div>
            <CardDescription className="text-xs">
              {copy.settings.saving.subtitle}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Download Directory (Read-only) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">
                {copy.settings.saving.folderLabel}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={settings?.download_dir || "./downloads"}
                  className="h-9 w-full rounded-xl border border-border/80 bg-muted/40 px-3 font-mono text-xs text-muted-foreground select-all focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Info className="size-3 text-primary shrink-0" />
                {copy.settings.saving.folderHint}
              </p>
            </div>

            {/* Default Quality Dropdown */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">
                {copy.settings.saving.qualityLabel}
              </label>
              <div className="w-full sm:w-[260px]">
                <Select
                  value={defaultPreset}
                  onValueChange={(val) => {
                    if (val) setDefaultPreset(val as Preset);
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
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
              <p className="text-[11px] text-muted-foreground">
                {copy.settings.saving.qualityHint}
              </p>
            </div>

            {/* Downloads at the same time (Concurrency) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Sliders className="size-3.5 text-primary" />
                  {copy.settings.saving.concurrencyLabel}
                </label>
                {runningCount > 0 && (
                  <Badge variant="secondary" className="font-mono text-xs font-semibold">
                    {copy.settings.saving.activePill(runningCount)}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                {[1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setMaxConcurrent(num)}
                    className={`flex h-9 w-12 items-center justify-center rounded-xl border text-xs font-semibold transition-all ${
                      maxConcurrent === num
                        ? "border-primary bg-primary text-primary-foreground shadow-md"
                        : "border-border/80 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {copy.settings.saving.concurrencyHint1}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {copy.settings.saving.concurrencyHint2}
              </p>
            </div>

            {/* Save Button (disabled until dirty) */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || saveMutation.isPending}
                className="gap-2 text-xs font-semibold"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                <span>{copy.settings.saving.saveChanges}</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Signed-in session (optional) */}
        <Card className="border-border/80 bg-card/40 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-emerald-400" />
                <CardTitle className="text-base">{copy.settings.session.title}</CardTitle>
              </div>
              <Badge variant="outline" className="text-xs text-muted-foreground font-normal">
                {copy.settings.session.badge}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              {copy.settings.session.subtitle}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/30 p-3.5">
              <div>
                <div className="text-xs font-medium text-foreground">
                  {copy.settings.session.rowLabel}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                  {copy.settings.session.rowDetail}
                </div>
              </div>
              <div>
                {settings?.cookies === "loaded" ? (
                  <Badge
                    variant="outline"
                    className="text-xs text-emerald-400 border-emerald-500/30 bg-emerald-500/10 gap-1.5"
                  >
                    <CheckCircle2 className="size-3" />
                    <span>{copy.settings.session.statusLoaded}</span>
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {copy.settings.session.statusNone}
                  </span>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {copy.settings.session.footer}{" "}
              <a
                href="https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
              >
                [{copy.settings.session.howToExport}]
              </a>
            </p>
          </CardContent>
        </Card>

        {/* Card 3: System (id="system" anchor) */}
        <Card id="system" className="border-border/80 bg-card/40 backdrop-blur-sm scroll-mt-20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cpu className="size-4 text-violet-400" />
              <CardTitle className="text-base">{copy.settings.system.title}</CardTitle>
            </div>
            <CardDescription className="text-xs">
              {copy.settings.system.subtitle}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* System Health Rows */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Worker */}
              <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 flex flex-col justify-between">
                <span className="text-xs text-muted-foreground">
                  {copy.settings.system.workerRow}
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span
                    className={`size-2 rounded-full ${
                      health?.ok ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                    }`}
                  />
                  <span
                    className={`text-xs font-semibold ${
                      health?.ok ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {health?.ok ? copy.settings.system.workerOnline : "Offline"}
                  </span>
                </div>
              </div>

              {/* Media Engine */}
              <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 flex flex-col justify-between">
                <span className="text-xs text-muted-foreground">
                  {copy.settings.system.engineRow}
                </span>
                <div className="mt-1 font-mono text-xs font-semibold text-primary">
                  {health?.ytdlp_version || settings?.ytdlp_version || "2026.10.21"}
                </div>
              </div>

              {/* ffmpeg */}
              <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 flex flex-col justify-between">
                <span className="text-xs text-muted-foreground">
                  {copy.settings.system.ffmpegRow}
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span
                    className={`size-2 rounded-full ${
                      health?.ffmpeg ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                  <span
                    className={`text-xs font-semibold ${
                      health?.ffmpeg ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {health?.ffmpeg ? copy.settings.system.ffmpegFound : "Missing"}
                  </span>
                </div>
              </div>
            </div>

            {/* If site stops working / Update section */}
            <div className="space-y-2 pt-2 border-t border-border/60">
              <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Terminal className="size-3.5 text-primary" />
                {copy.settings.system.updateTitle}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {copy.settings.system.updateBody}
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-xs text-zinc-300">
                <span className="truncate select-all px-1">
                  {copy.settings.system.updateCommand}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCommand}
                  className="h-7 shrink-0 gap-1.5 text-[11px] border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300"
                  aria-label={copy.settings.system.copyCommand}
                >
                  {copiedCommand ? (
                    <>
                      <Check className="size-3 text-emerald-400" />
                      <span className="text-emerald-400">{copy.settings.system.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" />
                      <span>{copy.settings.system.copyCommand}</span>
                    </>
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {copy.settings.system.updateFootnote}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: About and responsible use */}
        <Card className="border-border/80 bg-card/40 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Scale className="size-4 text-amber-400" />
              <CardTitle className="text-base">{copy.settings.about.title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-xs leading-relaxed text-muted-foreground">
            <div>
              <strong className="text-foreground">{copy.settings.about.point1Title}</strong>{" "}
              {copy.settings.about.point1Body}
            </div>
            <div>
              <strong className="text-foreground">{copy.settings.about.point2Title}</strong>{" "}
              {copy.settings.about.point2Body}
            </div>
            <div>
              <strong className="text-foreground">{copy.settings.about.point3Title}</strong>{" "}
              {copy.settings.about.point3Body}
            </div>
            <div className="pt-2 border-t border-border/60 text-[11px] text-muted-foreground flex items-center gap-1">
              <span>{copy.settings.about.footer("v0.1.0")}</span>
              <a
                href="https://github.com/rick-downloader/rick-downloader"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-medium"
              >
                [{copy.settings.about.viewOnGithub}]
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Floating Toast Notification */}
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
