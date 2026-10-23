import { describe, expect, it } from "vitest";

import { formatJobError, getFriendlyHint } from "./format";

describe("formatJobError and getFriendlyHint", () => {
  it("maps bot check and 429 errors to friendly rate-limiting advice", () => {
    expect(
      formatJobError("ERROR: [youtube] Sign in to confirm you're not a bot"),
    ).toBe("Rate-limited by YouTube");

    expect(
      formatJobError("Sign in to confirm you’re not a bot"),
    ).toBe("Rate-limited by site");

    expect(
      formatJobError("HTTP Error 429: Too Many Requests"),
    ).toBe("Rate-limited by site");
  });

  it("maps age-restricted and member content", () => {
    expect(formatJobError("Sign in to confirm your age")).toBe("Age-restricted video");
    expect(formatJobError("This video is only available to channel members-only")).toBe(
      "Private or requires login",
    );
  });

  it("maps private and unavailable videos", () => {
    expect(formatJobError("Private video")).toBe("Private or requires login");
    expect(formatJobError("Video unavailable")).toBe("Video unavailable");
  });

  it("handles empty or generic errors", () => {
    expect(formatJobError(null)).toBe("Couldn't download this video");
    expect(formatJobError("ERROR: Something went wrong")).toBe("Something went wrong");
  });

  it("returns appropriate hints for codes", () => {
    expect(getFriendlyHint("login_required")).toContain("Only public videos can be downloaded");
    expect(getFriendlyHint("rate_limited")).toContain("Retrying automatically");
    expect(getFriendlyHint("age_restricted")).toContain("Needs a signed-in account");
    expect(getFriendlyHint("unavailable")).toContain("deleted or blocked in your region");
    expect(getFriendlyHint("unknown")).toContain("Try again later");
  });
});
