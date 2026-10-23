export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) {
    return "";
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes <= 0) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(val >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatSpeed(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || isNaN(bps) || bps <= 0) {
    return "";
  }
  return `${formatBytes(bps)}/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds) || seconds <= 0) {
    return "";
  }
  const total = Math.round(seconds);
  if (total < 60) {
    return `${total}s`;
  }
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}m ${secs}s`;
}

export function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function formatJobError(error: string | null | undefined): string {
  if (!error) return "Couldn't download this video";
  const lower = error.toLowerCase().replace(/[\u2018\u2019]/g, "'");

  if (
    lower.includes("not a bot") ||
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("rate-limiting") ||
    lower.includes("rate limited")
  ) {
    if (lower.includes("youtube") || lower.includes("youtu.be")) {
      return "Rate-limited by YouTube";
    }
    return "Rate-limited by site";
  }
  if (lower.includes("confirm your age") || lower.includes("age-restricted") || (lower.includes("age") && lower.includes("restrict"))) {
    return "Age-restricted video";
  }
  if (
    lower.includes("private") ||
    lower.includes("privacy") ||
    lower.includes("password") ||
    lower.includes("login") ||
    lower.includes("log in") ||
    lower.includes("sign in to view") ||
    lower.includes("members only") ||
    lower.includes("members-only") ||
    lower.includes("join this channel") ||
    lower.includes("premium members") ||
    lower.includes("friends") ||
    lower.includes("requires authentication") ||
    lower.includes("cannot parse data") ||
    lower.includes("cookies")
  ) {
    return "Private or requires login";
  }
  if (
    lower.includes("video unavailable") ||
    lower.includes("removed") ||
    lower.includes("deleted") ||
    lower.includes("404") ||
    lower.includes("in your country") ||
    lower.includes("geo")
  ) {
    return "Video unavailable";
  }
  if (lower.includes("drm") || lower.includes("widevine") || lower.includes("protected, can't download")) {
    return "Protected, can't download";
  }
  if (lower.includes("unsupported url") || lower.includes("unsupported")) {
    return "This site isn't supported";
  }
  if (lower.includes("disk space below") || lower.includes("insufficient disk space")) {
    return "Insufficient disk space (< 2 GB free). Free up space to continue.";
  }

  let clean = error;
  if (clean.includes("ERROR:")) {
    clean = clean.split("ERROR:")[1].trim();
  }
  return clean;
}

export function getFriendlyHint(code: string | null | undefined, error?: string | null): string {
  const c = code?.toLowerCase();
  if (c === "login_required") {
    return "This video isn't public (private, friends-only, members-only, or login required). Only public videos can be downloaded.";
  }
  if (c === "rate_limited") {
    return "Retrying automatically. You can also turn off your VPN or wait a while.";
  }
  if (c === "age_restricted") {
    return "Needs a signed-in account.";
  }
  if (c === "unavailable") {
    return "It may be deleted or blocked in your region.";
  }
  if (c === "drm") {
    return "Protected by DRM. Downloads are not supported.";
  }
  if (c === "unsupported") {
    return "Check the URL or try another site.";
  }
  if (error) {
    const lower = error.toLowerCase();
    if (lower.includes("private") || lower.includes("login") || lower.includes("members")) {
      return "This video isn't public (private, friends-only, members-only, or login required). Only public videos can be downloaded.";
    }
    if (lower.includes("rate") || lower.includes("429")) {
      return "Retrying automatically. You can also turn off your VPN or wait a while.";
    }
    if (lower.includes("age")) {
      return "Needs a signed-in account.";
    }
    if (lower.includes("unavailable") || lower.includes("country") || lower.includes("geo")) {
      return "It may be deleted or blocked in your region.";
    }
  }
  return "Try again later. The site may have changed.";
}


