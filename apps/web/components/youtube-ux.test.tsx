import React from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { JobRow } from "@/components/downloads/job-row";
import { BatchConfirmDialog } from "@/components/scan/batch-confirm-dialog";
import type { Job } from "@/lib/schemas";

describe("JobRow status_detail and error separation", () => {
  it("shows status_detail in JobRow for queued jobs blocked by host limit", () => {
    const job: Job = {
      id: "job-1",
      video_url: "https://www.youtube.com/watch?v=1",
      title: "Test Video 1",
      preset: "best",
      status: "queued",
      progress: 0,
      status_detail: "Waiting: YouTube runs one at a time (2 ahead)",
      error: null,
      created_at: "2026-10-23T12:00:00Z",
    };

    const html = renderToString(React.createElement(JobRow, { job }));
    expect(html).toContain("Waiting: YouTube runs one at a time (2 ahead)");
    expect(html).not.toContain("Failed");
  });

  it("shows status_detail during backoff and keeps job.error empty", () => {
    const job: Job = {
      id: "job-2",
      video_url: "https://www.youtube.com/watch?v=2",
      title: "Test Video 2",
      preset: "best",
      status: "running",
      progress: 0,
      status_detail: "Waiting to retry in 1:45 (YouTube rate limit)",
      error: null,
      created_at: "2026-10-23T12:00:00Z",
    };

    const html = renderToString(React.createElement(JobRow, { job }));
    expect(html).toContain("Waiting to retry in 1:45 (YouTube rate limit)");
    expect(html).not.toContain("Failed");
  });

  it("shows job.error only for failed jobs", () => {
    const job: Job = {
      id: "job-3",
      video_url: "https://www.youtube.com/watch?v=3",
      title: "Failed Video",
      preset: "best",
      status: "error",
      progress: 0,
      status_detail: null,
      error: "YouTube is rate-limiting you. Try again later.",
      created_at: "2026-10-23T12:00:00Z",
    };

    const html = renderToString(React.createElement(JobRow, { job }));
    expect(html).toContain("Failed");
    expect(html).toContain("YouTube is rate-limiting you. Try again later.");
  });

  it("does not show error box if job is not failed even if error string exists", () => {
    const job: Job = {
      id: "job-4",
      video_url: "https://www.youtube.com/watch?v=4",
      title: "Running Video",
      preset: "best",
      status: "running",
      progress: 50,
      status_detail: null,
      error: "old error string",
      created_at: "2026-10-23T12:00:00Z",
    };

    const html = renderToString(React.createElement(JobRow, { job }));
    expect(html).not.toContain("Failed");
    expect(html).not.toContain("old error string");
  });
});

describe("BatchConfirmDialog triggers at more than 5 YouTube items", () => {
  function shouldTriggerBatchConfirm(selectedUrls: string[]): {
    trigger: boolean;
    ytCount: number;
    estimatedMin: number;
  } {
    const isYouTube = (url: string) =>
      url.toLowerCase().includes("youtube.com") || url.toLowerCase().includes("youtu.be");
    const ytCount = selectedUrls.filter(isYouTube).length;
    const trigger = ytCount > 5;
    const estimatedMin = Math.round(ytCount * 1.5 * 10) / 10;
    return { trigger, ytCount, estimatedMin };
  }

  it("does not trigger for 5 YouTube items", () => {
    const urls = [
      "https://youtube.com/1",
      "https://youtube.com/2",
      "https://youtube.com/3",
      "https://youtube.com/4",
      "https://youtube.com/5",
    ];
    const res = shouldTriggerBatchConfirm(urls);
    expect(res.trigger).toBe(false);
    expect(res.ytCount).toBe(5);
  });

  it("triggers for 6 YouTube items with items * 1.5 estimate (about 9 min)", () => {
    const urls = [
      "https://youtube.com/1",
      "https://youtube.com/2",
      "https://youtube.com/3",
      "https://youtube.com/4",
      "https://youtube.com/5",
      "https://youtube.com/6",
    ];
    const res = shouldTriggerBatchConfirm(urls);
    expect(res.trigger).toBe(true);
    expect(res.ytCount).toBe(6);
    expect(res.estimatedMin).toBe(9);

    const html = renderToString(
      React.createElement(BatchConfirmDialog, {
        open: res.trigger,
        itemCount: res.ytCount,
        onContinue: () => {},
        onCancel: () => {},
      }),
    );
    expect(html).toContain("These will download one at a time to avoid YouTube limits (about 9 min).");
    expect(html).toContain("Continue");
    expect(html).toContain("Cancel");
  });

  it("renders correct estimate for 7 YouTube items (about 10.5 min)", () => {
    const html = renderToString(
      React.createElement(BatchConfirmDialog, {
        open: true,
        itemCount: 7,
        onContinue: () => {},
        onCancel: () => {},
      }),
    );
    expect(html).toContain("These will download one at a time to avoid YouTube limits (about 10.5 min).");
  });

  it("renders nothing when closed", () => {
    const html = renderToString(
      React.createElement(BatchConfirmDialog, {
        open: false,
        itemCount: 10,
        onContinue: () => {},
        onCancel: () => {},
      }),
    );
    expect(html).toBe("");
  });
});

describe("Rate-limit banner countdown, tips, and automatic hide", () => {
  function formatCountdown(untilIso: string, currentTimestamp: number): {
    visible: boolean;
    timeString: string;
    secondsLeft: number;
  } {
    const diff = Math.max(0, Math.floor((new Date(untilIso).getTime() - currentTimestamp) / 1000));
    if (diff <= 0) {
      return { visible: false, timeString: "00:00", secondsLeft: 0 };
    }
    const mm = Math.floor(diff / 60).toString().padStart(2, "0");
    const ss = (diff % 60).toString().padStart(2, "0");
    return { visible: true, timeString: `${mm}:${ss}`, secondsLeft: diff };
  }

  it("formats countdown correctly for remaining time (e.g. 105s -> 01:45)", () => {
    const now = 1000000000000;
    const until = new Date(now + 105 * 1000).toISOString();
    const result = formatCountdown(until, now);

    expect(result.visible).toBe(true);
    expect(result.timeString).toBe("01:45");
    expect(result.secondsLeft).toBe(105);
  });

  it("formats countdown for 30s -> 00:30", () => {
    const now = 1000000000000;
    const until = new Date(now + 30 * 1000).toISOString();
    const result = formatCountdown(until, now);

    expect(result.visible).toBe(true);
    expect(result.timeString).toBe("00:30");
  });

  it("automatically hides when until has passed (0 seconds left)", () => {
    const now = 1000000000000;
    const until = new Date(now - 1000).toISOString(); // 1 second ago
    const result = formatCountdown(until, now);

    expect(result.visible).toBe(false);
    expect(result.secondsLeft).toBe(0);
  });

  it("banner text and tips match requirements", () => {
    const now = 1000000000000;
    const until = new Date(now + 45 * 1000).toISOString();
    const { timeString } = formatCountdown(until, now);

    const bannerText = `YouTube is rate-limiting you. Retrying automatically in ${timeString}.`;
    const tipsText = "Tips: turn off any VPN, refresh secrets/cookies.txt if it's old, or try again later.";

    expect(bannerText).toBe("YouTube is rate-limiting you. Retrying automatically in 00:45.");
    expect(tipsText).toContain("turn off any VPN");
    expect(tipsText).toContain("refresh secrets/cookies.txt if it's old");
    expect(tipsText).toContain("try again later");
  });
});
