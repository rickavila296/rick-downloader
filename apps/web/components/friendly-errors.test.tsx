import React from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { JobRow } from "@/components/downloads/job-row";
import { UrlForm } from "@/components/scan/url-form";
import type { Job } from "@/lib/schemas";

describe("Friendly errors and transparency UI", () => {
  it("details toggle is collapsed by default and does not render error_raw initially", () => {
    const job: Job = {
      id: "job-err-1",
      video_url: "https://example.com/video",
      title: "Private Video",
      preset: "best",
      status: "error",
      progress: 0,
      status_detail: null,
      error: "Private or requires login",
      error_code: "login_required",
      error_hint: "This video isn't public (private, friends-only, members-only, or login required). Only public videos can be downloaded.",
      error_raw: "ERROR: [youtube] Private video. Sign in if you've been granted access to this video",
      created_at: "2026-10-23T12:00:00Z",
    };

    const html = renderToString(React.createElement(JobRow, { job }));

    // Friendly title and hint are rendered
    expect(html).toContain("Private or requires login");
    expect(html).toContain("Only public videos can be downloaded");

    // Toggle button is rendered
    expect(html).toContain("Show technical details");

    // Raw technical error text is NOT rendered when collapsed by default
    expect(html).not.toContain("job-error-raw");
    expect(html).not.toContain("ERROR: [youtube] Private video");
  });

  it("Retry button is hidden for login_required, drm, unsupported, and unavailable", () => {
    const nonRetryableCodes = ["login_required", "drm", "unsupported", "unavailable"];

    for (const code of nonRetryableCodes) {
      const job: Job = {
        id: `job-${code}`,
        video_url: "https://example.com/video",
        title: `Error video ${code}`,
        preset: "best",
        status: "error",
        progress: 0,
        status_detail: null,
        error: "Some error",
        error_code: code,
        created_at: "2026-10-23T12:00:00Z",
      };

      const html = renderToString(React.createElement(JobRow, { job }));
      expect(html).not.toContain("Retry download");
    }

    // Conversely, retryable jobs like rate_limited or unknown show Retry
    const retryableJob: Job = {
      id: "job-retryable",
      video_url: "https://example.com/video",
      title: "Rate limited video",
      preset: "best",
      status: "error",
      progress: 0,
      status_detail: null,
      error: "Rate-limited by YouTube",
      error_code: "rate_limited",
      created_at: "2026-10-23T12:00:00Z",
    };
    const retryableHtml = renderToString(React.createElement(JobRow, { job: retryableJob }));
    expect(retryableHtml).toContain("Retry download");
  });

  it("the scan helper text renders under the scan input", () => {
    const html = renderToString(
      React.createElement(UrlForm, {
        url: "",
        onUrlChange: () => {},
        onSubmit: () => {},
        isLoading: false,
      }),
    );

    expect(html).toContain(
      "Public videos only. Private, login-only and copy-protected videos are skipped.",
    );
  });
});

