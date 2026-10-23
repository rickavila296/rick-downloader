import { test, expect } from "@playwright/test";

test.describe("Rick-downloader E2E Flow", () => {
  test("scan -> select -> download -> job appears in history", async ({ page }) => {
    // Pre-set first-run dialog as seen
    await page.addInitScript(() => {
      localStorage.setItem("rick_downloader_first_run_acknowledged", "true");
    });

    const mockScanId = "scan-test-123";
    const mockJobId = "job-test-456";

    // 1. Mock /api/scans
    await page.route("**/api/scans", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            scan_id: mockScanId,
            source_url: "https://example.com/watch?v=rick123",
            status: "ok",
            reason: null,
            truncated: false,
            entries: [
              {
                id: "entry-1",
                video_url: "https://example.com/watch?v=rick123",
                title: "Rick Astley - Never Gonna Give You Up",
                thumbnail: "https://example.com/thumb.jpg",
                duration_s: 213,
                extractor: "generic",
                status: "available",
              },
            ],
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Mock /api/scans/{scan_id}/entries/{entry_id}/formats
    await page.route("**/api/scans/**/formats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          formats: [
            {
              format_id: "best",
              ext: "mp4",
              height: 1080,
              fps: 60,
              vcodec: "avc1",
              acodec: "mp4a",
              filesize: 45000000,
              note: "1080p60",
            },
          ],
        }),
      });
    });

    // 2. Mock /api/jobs (POST create & GET list)
    await page.route("**/api/jobs*", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jobs: [
              {
                id: mockJobId,
                entry_id: "entry-1",
                video_url: "https://example.com/watch?v=rick123",
                title: "Rick Astley - Never Gonna Give You Up",
                preset: "best",
                status: "queued",
                progress: 0,
                speed_bps: null,
                eta_s: null,
                file_name: null,
                error: null,
                created_at: new Date().toISOString(),
                finished_at: null,
              },
            ],
          }),
        });
      } else if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jobs: [
              {
                id: mockJobId,
                entry_id: "entry-1",
                video_url: "https://example.com/watch?v=rick123",
                title: "Rick Astley - Never Gonna Give You Up",
                preset: "best",
                status: "done",
                progress: 100,
                speed_bps: 1500000,
                eta_s: 0,
                file_name: "Rick Astley - Never Gonna Give You Up [best].mp4",
                error: null,
                created_at: new Date().toISOString(),
                finished_at: new Date().toISOString(),
              },
            ],
            next_cursor: null,
          }),
        });
      } else {
        await route.continue();
      }
    });

    // 3. Open Homepage
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Save videos you own|Find every video on a page/i);

    // 4. Scan a URL
    const urlInput = page.locator("#scan-url");
    await expect(urlInput).toBeVisible();
    await urlInput.fill("https://example.com/watch?v=rick123");

    const scanBtn = page.locator("#scan-submit");
    await scanBtn.click();

    // 5. Verify scan result card appears
    await expect(
      page.getByRole("heading", { name: "Rick Astley - Never Gonna Give You Up" }),
    ).toBeVisible({ timeout: 10000 });

    // 6. Select and Download
    const downloadBtn = page.getByRole("button", { name: /Save \d+ selected|Download selected/i });
    await expect(downloadBtn).toBeVisible();
    await downloadBtn.click();

    // 7. Navigate to History page
    await page.click('a[href="/history"]');
    await expect(page).toHaveURL(/\/history/);

    // 8. Verify the downloaded job appears in history table
    await expect(
      page.getByRole("table").getByText("Rick Astley - Never Gonna Give You Up", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("table").getByText(/Saved|done/i)).toBeVisible();
  });

  test("drawer displays failed job with friendly error message and retry action", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("rick_downloader_first_run_acknowledged", "true");
    });

    const failedJobId = "job-failed-bot";

    await page.route("**/api/jobs*", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jobs: [
              {
                id: failedJobId,
                entry_id: "entry-bot",
                video_url: "https://example.com/watch?v=botcheck",
                title: "Bot Protected Video",
                preset: "best",
                status: "error",
                progress: 0,
                speed_bps: null,
                eta_s: null,
                file_name: null,
                error: "Sign in to confirm you're not a bot",
                created_at: new Date().toISOString(),
                finished_at: new Date().toISOString(),
              },
            ],
            next_cursor: null,
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/");

    // Open downloads drawer
    const drawerToggle = page.getByRole("button", { name: /Downloads/i });
    await drawerToggle.click();

    // Verify Failed status badge appears
    await expect(page.getByText("Failed")).toBeVisible();

    // Verify friendly message is shown on the row
    await expect(
      page.getByText("YouTube is rate-limiting you. Try again later."),
    ).toBeVisible();

    // Verify retry button is available
    await expect(page.getByTitle("Retry download")).toBeVisible();
  });

  test("settings page shows cookies status", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("rick_downloader_first_run_acknowledged", "true");
    });

    await page.route("**/api/settings*", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            download_dir: "./downloads",
            default_preset: "best",
            max_concurrent: 2,
            ytdlp_version: "2026.10.21",
            cookies: "not_loaded",
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/settings");
    await expect(page.getByText(/Not added|Cookies: not loaded/i)).toBeVisible();
  });

  test("first-run notice appears on initial visit and can be acknowledged", async ({ page }) => {
    await page.goto("/");
    const noticeHeading = page.getByRole("heading", { name: "Welcome to Rick-downloader" });
    await expect(noticeHeading).toBeVisible();

    const ackButton = page.getByRole("button", { name: "I understand" });
    await ackButton.click();
    await expect(noticeHeading).not.toBeVisible();
  });

  test("responsive viewport check at 375px mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.addInitScript(() => {
      localStorage.setItem("rick_downloader_first_run_acknowledged", "true");
    });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#scan-url")).toBeVisible();
    await expect(page.locator("#scan-submit")).toBeVisible();
  });
});
