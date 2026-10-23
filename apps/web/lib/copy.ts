/**
 * Centralized UX copy and text constants (UX_PAGES_V2.md).
 * No user-facing strings should be hard-coded in UI components.
 */

/**
 * Returns a friendly site name from a host or URL:
 * youtube.com → "YouTube"
 * facebook.com → "Facebook"
 * instagram.com → "Instagram"
 * vimeo.com → "Vimeo"
 * otherwise: the bare domain without "www."
 */
export function siteName(hostOrUrl: string | null | undefined): string {
  if (!hostOrUrl) return "the site";
  let str = hostOrUrl.trim();

  // If URL, parse out hostname
  if (str.startsWith("http://") || str.startsWith("https://")) {
    try {
      str = new URL(str).hostname;
    } catch {
      // ignore parse error, use fallback
    }
  }

  // Strip port
  str = str.split(":")[0];
  // Strip paths
  str = str.split("/")[0];

  let domain = str.toLowerCase();
  if (domain.startsWith("www.")) {
    domain = domain.slice(4);
  }

  if (domain === "youtube.com" || domain === "youtu.be" || domain.endsWith(".youtube.com")) {
    return "YouTube";
  }
  if (domain === "facebook.com" || domain === "fb.watch" || domain.endsWith(".facebook.com")) {
    return "Facebook";
  }
  if (domain === "instagram.com" || domain.endsWith(".instagram.com")) {
    return "Instagram";
  }
  if (domain === "vimeo.com" || domain.endsWith(".vimeo.com")) {
    return "Vimeo";
  }

  return domain || "the site";
}

export interface ErrorCodeInfo {
  code: string;
  title: string | ((site: string) => string);
  hint: string;
  retry: boolean;
}

export const ERROR_CODES: Record<string, ErrorCodeInfo> = {
  rate_limited: {
    code: "rate_limited",
    title: (site: string) => `Rate-limited by ${site}`,
    hint: "Retrying automatically. You can also turn off your VPN or wait a while.",
    retry: true,
  },
  login_required: {
    code: "login_required",
    title: "Private or requires login",
    hint: "This video isn't public (private, friends-only, members-only, or login required). Only public videos can be downloaded.",
    retry: false,
  },
  age_restricted: {
    code: "age_restricted",
    title: "Age-restricted video",
    hint: "Needs a signed-in account.",
    retry: false,
  },
  unavailable: {
    code: "unavailable",
    title: "Video unavailable",
    hint: "It may be deleted or blocked in your region.",
    retry: false,
  },
  drm: {
    code: "drm",
    title: "Protected, can't download",
    hint: "Protected by DRM. Downloads are not supported.",
    retry: false,
  },
  unsupported: {
    code: "unsupported",
    title: "This site isn't supported",
    hint: "Check the URL or try another site.",
    retry: false,
  },
  disk_space: {
    code: "disk_space",
    title: "Insufficient disk space (< 2 GB free). Free up space to continue.",
    hint: "Free up drive space in the download folder to proceed.",
    retry: true,
  },
  unknown: {
    code: "unknown",
    title: "Couldn't download this video",
    hint: "Try again later. The site may have changed.",
    retry: true,
  },
};

export function getErrorCodeCopy(
  code: string | null | undefined,
  hostOrSite?: string | null,
): { title: string; hint: string; retry: boolean } {
  const c = code?.toLowerCase();
  const info = c && ERROR_CODES[c] ? ERROR_CODES[c] : ERROR_CODES.unknown;
  const site = hostOrSite ? siteName(hostOrSite) : "the site";
  const title = typeof info.title === "function" ? info.title(site) : info.title;
  return {
    title,
    hint: info.hint,
    retry: info.retry,
  };
}

export function isJobRetryable(code: string | null | undefined): boolean {
  if (!code) return true;
  const c = code.toLowerCase();
  if (c in ERROR_CODES) {
    return ERROR_CODES[c].retry;
  }
  return true;
}

export const copy = {
  appName: "Rick-downloader",
  pageTitle: "Rick-downloader · Save videos you own",
  pageDescription:
    "Self-hosted tool to scan a web page for videos and save the ones you're allowed to keep to a local folder.",

  nav: {
    save: "Save",
    history: "History",
    settings: "Settings",
  },

  header: {
    statusReady: "Ready",
    statusNeedsAttention: "Needs attention",
    statusChecking: "Checking worker…",
    statusUnreachable: "Worker unreachable",
    statusFfmpegMissing: "ffmpeg missing",
    statusTooltip: (engineVersion: string, ffmpegFound: boolean) =>
      `Worker online · Media engine ${engineVersion} · ${ffmpegFound ? "ffmpeg found" : "ffmpeg missing"}`,
    statusAttentionTooltip: "Worker unreachable or media engine requires attention",
    downloadsButton: (activeCount?: number) =>
      activeCount && activeCount > 0 ? `Downloads · ${activeCount}` : "Downloads",
  },

  scan: {
    topBadge: "🔒 Runs on your computer",
    title: "Save videos you own.",
    subtitle:
      "Paste a link to a post or page. We'll find the videos you can save and keep them on your computer.",
    inputPlaceholder: "Paste a link, e.g. https://example.com/my-video",
    buttonFind: "Find videos",
    buttonScanning: "Scanning…",
    buttonCancel: "Cancel",
    helperText: "Public videos only. Private, login-only and copy-protected videos are skipped.",
    worksWith: {
      text: "Works with most video sites, including TikTok, Instagram, X, Facebook, Vimeo and YouTube. ",
      linkText: "See all",
      linkUrl: "https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md",
    },
    howItWorks: [
      {
        step: 1,
        title: "Paste a link",
        description: "any post, reel or page with video",
      },
      {
        step: 2,
        title: "Pick what to keep",
        description: "choose videos and quality",
      },
      {
        step: 3,
        title: "Saved locally",
        description: "files go to your save folder",
      },
    ],
    loadingTitle: "Scanning page for videos…",
    loadingSubtitle:
      "Inspecting yt-dlp metadata and HTML tags (videos, sources, embeds, direct media links).",
    cancelScan: "Cancel scan",
    emptyState: {
      title: "No downloadable videos found",
      bodyDefault:
        "No supported video streams, embed tags, or direct media links could be extracted from this page.",
      bodyLoginRequired:
        "0 downloadable videos found because all were login_required. Only public videos can be downloaded.",
      tryAnotherPage: "Try another page",
      scanNotice: "Scan Notice",
    },
    results: {
      saveSelected: (k: number) => `Save ${k} selected`,
      selectAll: "Select all",
      foundVideos: (total: number, selected: number) =>
        `Found ${total} video${total === 1 ? "" : "s"}${selected > 0 ? ` (${selected} selected)` : ""}`,
      skippedSummary: (count: number) => `${count} skipped`,
      whySkipped: "why?",
      whySkippedTooltip:
        "Private, login-required, and copy-protected videos cannot be saved.",
      cappedAtLimit: "Capped at limit",
      presetLabel: "Preset:",
    },
    card: {
      qualityLabel: "Quality:",
      presetsLabel: "Presets",
      directFormatsLabel: "Direct Formats",
      loadingFormats: "Loading formats…",
      defaultPresetsOnly: "Default presets only",
      rateLimitedFormats: (site: string) =>
        `${site} is rate-limiting you. Try again later.`,
      unavailable: "Unavailable",
      showTechnicalDetails: "Show technical details",
      hideTechnicalDetails: "Hide technical details",
      badges: {
        drm: "Protected, can't download",
        loginRequired: "Login required",
        unsupported: "Unsupported",
      },
      tooltips: {
        drm: "This stream is protected with DRM encryption (Widevine/PlayReady). Spec §2 strictly forbids DRM circumvention.",
        loginRequired:
          "This video is private, friends-only, members-only, or requires authentication. Only public videos can be downloaded.",
        unsupported: "No downloadable stream could be resolved for this item.",
      },
    },
    dialog: {
      batchConfirm: (site: string, estMin: number) =>
        `These will download one at a time to avoid ${site} limits (about ${estMin} min).`,
      continue: "Continue",
      cancel: "Cancel",
    },
  },

  presets: {
    best: "Best available",
    "1080p": "1080p",
    "720p": "720p",
    "480p": "480p",
    audio: "Audio only",
    source: "Original file",
  },

  drawer: {
    title: "Downloads",
    activeCount: (n: number) => `${n} active`,
    emptyTitle: "No downloads yet",
    emptyBody: "Scan a video link and click Download to start saving videos.",
    queuedHostLimit: (site: string, n: number) =>
      `Waiting: ${site} runs one at a time (${n} ahead)`,
    waitingRetry: (time: string, site: string) =>
      `Waiting to retry in ${time} (${site} rate limit)`,
    retrying: "Retrying...",
    downloading: (pct: number) => `Downloading ${pct}%`,
    queued: "Queued",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  },

  actions: {
    cancelDownload: "Cancel download",
    tryAgain: "Try again",
    retryDownload: "Retry download",
    downloadFile: "Download file to device",
  },

  banner: {
    rateLimited: (site: string, mm: string, ss: string) =>
      `${site} is rate-limiting you. Retrying automatically in ${mm}:${ss}.`,
    tips: "Tips: turn off any VPN, refresh secrets/cookies.txt if it's old, or try again later.",
    backToNormal: (site: string) => `${site} rate limit cleared. Resuming downloads.`,
    dismiss: "Dismiss banner",
  },

  history: {
    title: "History",
    subtitle: "Everything you've saved, and anything that didn't work.",
    filterAll: (n: number) => `All (${n})`,
    filterSaved: (n: number) => `Saved (${n})`,
    filterDidntSave: (n: number) => `Didn't save (${n})`,
    searchPlaceholder: "Search by title or site",
    emptyTitle: "Nothing saved yet",
    emptyBody: "Videos you save will appear here, with their files ready to open.",
    emptyAction: "Find videos",
    emptyFilteredTitle: "No matches.",
    emptyFilteredBody: "Try a different filter or search.",
    emptyFilteredAction: "Clear filters",
    storageSummary: (n: number, size: string) => `${n} files · ${size}`,
    rowMenu: {
      openFile: "Open file",
      showInFolder: "Show in folder",
      saveAgain: "Save again",
      removeFromHistory: "Remove from history",
      removeAndDeleteFile: "Remove and delete file",
    },
    deleteDialog: {
      title: "Delete file?",
      body: "This will remove the download record and permanently delete the file from your computer.",
      confirm: "Delete file",
      cancel: "Keep file",
    },
    toast: {
      deleted: "Removed from history.",
      fileDeleted: "File deleted and removed from history.",
    },
  },

  settings: {
    title: "Settings",
    subtitle: "Choose how videos are saved.",
    saving: {
      title: "Saving",
      subtitle: "Where files go and how they're saved.",
      folderLabel: "Save folder",
      folderHint: "Change it with DOWNLOAD_DIR in your .env file, then restart.",
      qualityLabel: "Default quality",
      qualityHint: "Used for new scans. You can still change it per video.",
      concurrencyLabel: "Downloads at the same time",
      concurrencyHint1: "Higher is faster but uses more bandwidth.",
      concurrencyHint2:
        "Some sites limit how fast you can save, so videos from those sites always save one at a time.",
      activePill: (n: number) => `${n} running now`,
      saveChanges: "Save changes",
      toastSaved: "Settings saved.",
    },
    session: {
      title: "Signed-in session",
      badge: "Optional",
      subtitle:
        "Some sites only show certain videos to signed-in users. If it's your own content, you can let the app use your session.",
      rowLabel: "Session file",
      rowDetail: "secrets/cookies.txt · read-only · never uploaded",
      statusNone: "Not added. That's fine: public videos work without it.",
      statusLoaded: "Added",
      footer:
        "Export a cookies.txt (Netscape format) from your browser, save it to secrets/cookies.txt, and restart. Use a spare account. The file is never logged, shown or sent anywhere.",
      howToExport: "How to export",
    },
    system: {
      title: "System",
      subtitle: "Health of the parts that do the work.",
      workerRow: "Worker",
      workerOnline: "Online",
      engineRow: "Media engine (yt-dlp)",
      ffmpegRow: "ffmpeg",
      ffmpegFound: "Found",
      updateTitle: "If a site stops working",
      updateBody:
        "Sites change often. Updating the media engine usually fixes it. Run this in the project folder:",
      updateCommand:
        "docker compose build --no-cache worker && docker compose up -d",
      updateFootnote: "Takes 1–2 minutes. Your files and history are kept.",
      copyCommand: "Copy command",
      copied: "Copied",
    },
    about: {
      title: "About and responsible use",
      point1Title: "Runs only on your computer.",
      point1Body:
        "Nothing is uploaded, and the app isn't reachable from other devices.",
      point2Title: "Never bypasses protection.",
      point2Body:
        "Copy-protected, private and login-only videos are skipped. There are no tools for getting around them.",
      point3Title: "Your content, your responsibility.",
      point3Body:
        "Save only what you own or have permission to keep. Some sites' terms don't allow downloading, and copyright law applies.",
      footer: (version: string) =>
        `Rick-downloader ${version} · Open source (MIT) · `,
      viewOnGithub: "View on GitHub",
    },
  },

  firstRun: {
    welcomeTitle: "Welcome to Rick-downloader",
    badge: "Personal, local-only",
    intro:
      "Before you start, please take a moment to understand how this tool works and what it's for:",
    point1Title: "Runs only on your machine",
    point1Body:
      "Rick-downloader binds to 127.0.0.1. No account, no cloud, no multi-user features. Your downloads and history never leave your computer.",
    point2Title: "No DRM circumvention",
    point2Body:
      "Copy-protected streams (Widevine, PlayReady, FairPlay) are strictly not supported. The app marks them \"Protected, can't download\" and will never attempt decryption.",
    point3Title: "Respect terms and copyright",
    point3Body:
      "This tool is meant for personal offline backups of public content that you have the right to access. Respect site Terms of Service and content creators.",
    checkboxLabel:
      "I understand and agree to use Rick-downloader responsibly for my own content.",
    acknowledgeButton: "I understand",
  },
} as const;
