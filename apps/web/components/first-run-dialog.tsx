"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";

const STORAGE_KEY = "rick_downloader_first_run_acknowledged";

export function FirstRunDialog() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      const ack = localStorage.getItem(STORAGE_KEY);
      if (!ack) {
        setIsOpen(true);
      }
    } catch {
      // ignore storage access errors
    }
  }, []);

  const handleAcknowledge = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // ignore storage access errors
    }
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Welcome to Rick-downloader</h2>
            <p className="text-xs text-zinc-400">Personal & self-hosted terms of use</p>
          </div>
        </div>

        <div className="space-y-3 text-sm text-zinc-300">
          <div className="flex items-start gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-xs leading-relaxed text-zinc-300">
              <strong className="text-zinc-100">Personal, self-hosted use only:</strong> This tool is designed strictly for running on your private localhost or home server.
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs leading-relaxed text-zinc-300">
              <strong className="text-zinc-100">Public content only:</strong> Only public videos can be downloaded. Private, friends-only, members-only, and DRM-protected videos are skipped.
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-xs leading-relaxed text-zinc-300">
              <strong className="text-zinc-100">Respect copyright & Terms of Service:</strong> Only download videos you have the legal right to access and store for personal offline viewing.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleAcknowledge}
            className="w-full sm:w-auto px-6 font-medium bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold"
          >
            I understand
          </Button>
        </div>
      </div>
    </div>
  );
}
