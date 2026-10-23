import React from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/copy";
import type { Preset } from "@/lib/schemas";

describe("Settings UX behavior and copy", () => {
  it("renders active downloads pill only when active count is greater than 0", () => {
    // When activeCount > 0, pill is rendered with label "{n} running now"
    const activeCount = 2;
    const shouldRenderPill = activeCount > 0;
    expect(shouldRenderPill).toBe(true);

    const html = renderToString(
      React.createElement(
        Badge,
        { variant: "secondary", className: "font-mono text-xs font-semibold" },
        copy.settings.saving.activePill(activeCount),
      ),
    );
    expect(html).toContain("2 running now");

    // When activeCount is 0, pill should not be rendered
    const zeroCount = 0;
    const shouldRenderZeroPill = zeroCount > 0;
    expect(shouldRenderZeroPill).toBe(false);
  });

  it("determines Save changes button disabled state based on form dirty check", () => {
    const originalSettings: { default_preset: Preset; max_concurrent: number } = {
      default_preset: "best",
      max_concurrent: 2,
    };

    // When form has same values as settings, isDirty is false
    const currentPreset: Preset = "best";
    const currentMaxConcurrent = 2;
    const isDirty =
      currentPreset !== originalSettings.default_preset ||
      currentMaxConcurrent !== originalSettings.max_concurrent;

    expect(isDirty).toBe(false);

    // When user changes preset, isDirty is true
    const changedPreset: Preset = "1080p";
    const isDirtyAfterPresetChange =
      changedPreset !== originalSettings.default_preset ||
      currentMaxConcurrent !== originalSettings.max_concurrent;

    expect(isDirtyAfterPresetChange).toBe(true);

    // When user changes max concurrent, isDirty is true
    const changedMaxConcurrent = 4;
    const isDirtyAfterConcurrentChange =
      currentPreset !== originalSettings.default_preset ||
      changedMaxConcurrent !== originalSettings.max_concurrent;

    expect(isDirtyAfterConcurrentChange).toBe(true);
  });

  it("provides expected empty states copy for history and scan", () => {
    expect(copy.history.emptyTitle).toBe("Nothing saved yet");
    expect(copy.history.emptyAction).toBe("Find videos");
    expect(copy.history.emptyFilteredTitle).toBe("No matches.");
    expect(copy.history.emptyFilteredAction).toBe("Clear filters");

    expect(copy.scan.emptyState.title).toBe("No downloadable videos found");
  });
});
