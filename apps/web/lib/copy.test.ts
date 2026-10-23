import { describe, expect, it } from "vitest";

import {
  copy,
  getErrorCodeCopy,
  isJobRetryable,
  siteName,
} from "./copy";


describe("siteName helper", () => {
  it("maps designated platforms to capitalized names", () => {
    expect(siteName("youtube.com")).toBe("YouTube");
    expect(siteName("www.youtube.com")).toBe("YouTube");
    expect(siteName("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("YouTube");
    expect(siteName("youtu.be")).toBe("YouTube");

    expect(siteName("facebook.com")).toBe("Facebook");
    expect(siteName("www.facebook.com")).toBe("Facebook");
    expect(siteName("https://facebook.com/reel/123")).toBe("Facebook");
    expect(siteName("fb.watch")).toBe("Facebook");

    expect(siteName("instagram.com")).toBe("Instagram");
    expect(siteName("www.instagram.com")).toBe("Instagram");
    expect(siteName("https://www.instagram.com/p/123")).toBe("Instagram");

    expect(siteName("vimeo.com")).toBe("Vimeo");
    expect(siteName("www.vimeo.com")).toBe("Vimeo");
    expect(siteName("https://vimeo.com/12345")).toBe("Vimeo");
  });

  it("strips www. and returns the bare domain for other platforms", () => {
    expect(siteName("www.tiktok.com")).toBe("tiktok.com");
    expect(siteName("tiktok.com")).toBe("tiktok.com");
    expect(siteName("https://tiktok.com/@user/video/1")).toBe("tiktok.com");

    expect(siteName("www.example.com")).toBe("example.com");
    expect(siteName("example.com")).toBe("example.com");
    expect(siteName("https://example.com/videos/test")).toBe("example.com");
    expect(siteName("x.com")).toBe("x.com");
    expect(siteName("reddit.com")).toBe("reddit.com");
  });

  it("handles empty or missing host gracefully", () => {
    expect(siteName(null)).toBe("the site");
    expect(siteName(undefined)).toBe("the site");
    expect(siteName("")).toBe("the site");
  });
});

describe("error_code copy mapping and retry logic", () => {
  it("maps rate_limited to friendly title with siteName and allows retry", () => {
    const info = getErrorCodeCopy("rate_limited", "youtube.com");
    expect(info.title).toBe("Rate-limited by YouTube");
    expect(info.hint).toContain("Retrying automatically");
    expect(info.retry).toBe(true);
    expect(isJobRetryable("rate_limited")).toBe(true);
  });

  it("maps login_required to non-retryable friendly copy", () => {
    const info = getErrorCodeCopy("login_required");
    expect(info.title).toBe("Private or requires login");
    expect(info.hint).toContain("Only public videos can be downloaded");
    expect(info.retry).toBe(false);
    expect(isJobRetryable("login_required")).toBe(false);
  });

  it("maps age_restricted to non-retryable friendly copy", () => {
    const info = getErrorCodeCopy("age_restricted");
    expect(info.title).toBe("Age-restricted video");
    expect(info.hint).toBe("Needs a signed-in account.");
    expect(info.retry).toBe(false);
    expect(isJobRetryable("age_restricted")).toBe(false);
  });

  it("maps unavailable to non-retryable friendly copy", () => {
    const info = getErrorCodeCopy("unavailable");
    expect(info.title).toBe("Video unavailable");
    expect(info.hint).toContain("deleted or blocked in your region");
    expect(info.retry).toBe(false);
    expect(isJobRetryable("unavailable")).toBe(false);
  });

  it("maps drm to non-retryable friendly copy", () => {
    const info = getErrorCodeCopy("drm");
    expect(info.title).toBe("Protected, can't download");
    expect(info.hint).toContain("Protected by DRM");
    expect(info.retry).toBe(false);
    expect(isJobRetryable("drm")).toBe(false);
  });

  it("maps unsupported to non-retryable friendly copy", () => {
    const info = getErrorCodeCopy("unsupported");
    expect(info.title).toBe("This site isn't supported");
    expect(info.hint).toContain("Check the URL");
    expect(info.retry).toBe(false);
    expect(isJobRetryable("unsupported")).toBe(false);
  });

  it("maps unknown error to retryable general fallback", () => {
    const info = getErrorCodeCopy("some_unknown_error");
    expect(info.title).toBe("Couldn't download this video");
    expect(info.hint).toContain("Try again later");
    expect(info.retry).toBe(true);
    expect(isJobRetryable("some_unknown_error")).toBe(true);
  });
});

describe("copy object structure and helpers", () => {
  it("exports all required typed constants and dynamic functions per UX_PAGES_V2.md", () => {
    expect(copy.nav.save).toBe("Save");
    expect(copy.scan.topBadge).toBe("🔒 Runs on your computer");
    expect(copy.scan.title).toBe("Save videos you own.");
    expect(copy.scan.buttonFind).toBe("Find videos");
    expect(copy.scan.helperText).toContain("Public videos only");
    expect(copy.drawer.queuedHostLimit("YouTube", 2)).toBe(
      "Waiting: YouTube runs one at a time (2 ahead)",
    );
    expect(copy.scan.results.saveSelected(3)).toBe("Save 3 selected");
    expect(copy.header.downloadsButton(2)).toBe("Downloads · 2");
    expect(copy.header.downloadsButton(0)).toBe("Downloads");

    // History copy
    expect(copy.history.title).toBe("History");
    expect(copy.history.subtitle).toBe(
      "Everything you've saved, and anything that didn't work.",
    );
    expect(copy.history.filterAll(5)).toBe("All (5)");
    expect(copy.history.filterSaved(3)).toBe("Saved (3)");
    expect(copy.history.filterDidntSave(2)).toBe("Didn't save (2)");
    expect(copy.history.storageSummary(12, "3.4 GB")).toBe("12 files · 3.4 GB");
    expect(copy.history.searchPlaceholder).toBe("Search by title or site");
    expect(copy.history.emptyTitle).toBe("Nothing saved yet");
    expect(copy.history.emptyBody).toBe(
      "Videos you save will appear here, with their files ready to open.",
    );
    expect(copy.history.emptyAction).toBe("Find videos");
    expect(copy.history.emptyFilteredTitle).toBe("No matches.");
    expect(copy.history.emptyFilteredBody).toBe("Try a different filter or search.");
    expect(copy.history.emptyFilteredAction).toBe("Clear filters");
    expect(copy.history.rowMenu.openFile).toBe("Open file");
    expect(copy.history.rowMenu.showInFolder).toBe("Show in folder");
    expect(copy.history.rowMenu.saveAgain).toBe("Save again");
    expect(copy.history.rowMenu.removeFromHistory).toBe("Remove from history");
    expect(copy.history.rowMenu.removeAndDeleteFile).toBe("Remove and delete file");
    expect(copy.history.deleteDialog.title).toBe("Delete file?");
    expect(copy.history.deleteDialog.confirm).toBe("Delete file");
    expect(copy.history.deleteDialog.cancel).toBe("Keep file");
    expect(copy.history.toast.deleted).toBe("Removed from history.");
    expect(copy.history.toast.fileDeleted).toBe("File deleted and removed from history.");

    // Settings copy
    expect(copy.settings.title).toBe("Settings");
    expect(copy.settings.subtitle).toBe("Choose how videos are saved.");
    expect(copy.settings.saving.title).toBe("Saving");
    expect(copy.settings.saving.subtitle).toBe("Where files go and how they're saved.");
    expect(copy.settings.saving.folderLabel).toBe("Save folder");
    expect(copy.settings.saving.folderHint).toContain("Change it with DOWNLOAD_DIR");
    expect(copy.settings.saving.qualityLabel).toBe("Default quality");
    expect(copy.settings.saving.qualityHint).toContain("Used for new scans");
    expect(copy.settings.saving.concurrencyLabel).toBe("Downloads at the same time");
    expect(copy.settings.saving.concurrencyHint1).toBe("Higher is faster but uses more bandwidth.");
    expect(copy.settings.saving.concurrencyHint2).toContain("Some sites limit how fast you can save");
    expect(copy.settings.saving.activePill(2)).toBe("2 running now");
    expect(copy.settings.saving.saveChanges).toBe("Save changes");
    expect(copy.settings.saving.toastSaved).toBe("Settings saved.");

    // Presets mapping
    expect(copy.presets.best).toBe("Best available");
    expect(copy.presets.source).toBe("Original file");
    expect(copy.presets.audio).toBe("Audio only");

    // Session and System copy
    expect(copy.settings.session.title).toBe("Signed-in session");
    expect(copy.settings.session.badge).toBe("Optional");
    expect(copy.settings.system.title).toBe("System");
    expect(copy.settings.system.updateTitle).toBe("If a site stops working");
    expect(copy.settings.system.updateCommand).toBe(
      "docker compose build --no-cache worker && docker compose up -d",
    );
    expect(copy.settings.about.title).toBe("About and responsible use");
  });
});
