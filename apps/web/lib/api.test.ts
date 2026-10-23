import { describe, expect, it } from "vitest";

import { ApiError, createScan, getEntryFormats, getHealth, getScan } from "@/lib/api";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
}

describe("api client", () => {
  describe("getHealth", () => {
    it("parses a valid health payload", async () => {
      const h = await getHealth(fakeFetch(200, { ok: true, ytdlp_version: "2026.10.21", ffmpeg: true }));
      expect(h).toEqual({ ok: true, ytdlp_version: "2026.10.21", ffmpeg: true });
    });

    it("rejects a payload that breaks the contract", async () => {
      await expect(getHealth(fakeFetch(200, { ok: "yes" }))).rejects.toThrow();
    });

    it("maps the spec error shape to ApiError", async () => {
      const err = await getHealth(
        fakeFetch(503, { error: { code: "worker_down", message: "Worker unavailable" } }),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 503, code: "worker_down", message: "Worker unavailable" });
    });
  });

  describe("createScan", () => {
    it("parses ScanResult response on success", async () => {
      const mockResult = {
        scan_id: "s123",
        source_url: "https://example.com/videos",
        status: "ok",
        entries: [
          {
            id: "e1",
            video_url: "https://example.com/v1",
            title: "Sample Video",
            thumbnail: "https://example.com/t1.jpg",
            duration_s: 150,
            extractor: "youtube",
            status: "available",
          },
        ],
        truncated: false,
      };

      const result = await createScan("https://example.com/videos", undefined, fakeFetch(201, mockResult));
      expect(result.scan_id).toBe("s123");
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe("Sample Video");
    });

    it("throws ApiError on blocked url", async () => {
      const fetcher = fakeFetch(400, {
        error: { code: "blocked_url", message: "Access to IP is blocked" },
      });
      await expect(createScan("http://192.168.1.1", undefined, fetcher)).rejects.toMatchObject({
        status: 400,
        code: "blocked_url",
      });
    });
  });

  describe("getScan", () => {
    it("fetches scan by id", async () => {
      const mockResult = {
        scan_id: "s123",
        source_url: "https://example.com/videos",
        status: "ok",
        entries: [],
        truncated: false,
      };
      const result = await getScan("s123", undefined, fakeFetch(200, mockResult));
      expect(result.scan_id).toBe("s123");
    });
  });

  describe("getEntryFormats", () => {
    it("fetches format list for an entry", async () => {
      const mockFormats = {
        formats: [
          {
            format_id: "18",
            ext: "mp4",
            height: 360,
            fps: 30,
            vcodec: "avc1",
            acodec: "mp4a",
            filesize: 1048576,
            note: "360p",
          },
        ],
      };
      const result = await getEntryFormats("s1", "e1", undefined, fakeFetch(200, mockFormats));
      expect(result.formats).toHaveLength(1);
      expect(result.formats[0].height).toBe(360);
    });
  });

  describe("jobs endpoints", () => {
    it("creates jobs and returns response", async () => {
      const { createJobs } = await import("@/lib/api");
      const mockRes = {
        jobs: [
          {
            id: "j1",
            video_url: "https://example.com/v1",
            preset: "1080p",
            status: "queued",
            progress: 0,
            created_at: "2026-10-23T10:00:00Z",
          },
        ],
      };
      const result = await createJobs(
        [{ video_url: "https://example.com/v1", preset: "1080p" }],
        undefined,
        fakeFetch(201, mockRes),
      );
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].status).toBe("queued");
    });

    it("lists jobs with cursor and status filter", async () => {
      const { listJobs } = await import("@/lib/api");
      const mockRes = {
        jobs: [
          {
            id: "j1",
            video_url: "https://example.com/v1",
            preset: "best",
            status: "done",
            progress: 100,
            file_name: "v1.mp4",
            created_at: "2026-10-23T10:00:00Z",
          },
        ],
        next_cursor: null,
      };
      const result = await listJobs({ status: "done", limit: 10 }, undefined, fakeFetch(200, mockRes));
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].file_name).toBe("v1.mp4");
    });

    it("cancels a job", async () => {
      const { cancelJob } = await import("@/lib/api");
      const mockRes = {
        id: "j1",
        video_url: "https://example.com/v1",
        preset: "best",
        status: "cancelled",
        progress: 45,
        created_at: "2026-10-23T10:00:00Z",
      };
      const result = await cancelJob("j1", undefined, fakeFetch(200, mockRes));
      expect(result.status).toBe("cancelled");
    });
  });

  describe("settings endpoints", () => {
    it("fetches settings", async () => {
      const { getSettings } = await import("@/lib/api");
      const mockSettings = {
        download_dir: "/downloads",
        default_preset: "best",
        max_concurrent: 2,
        ytdlp_version: "2026.10.21",
      };
      const result = await getSettings(undefined, fakeFetch(200, mockSettings));
      expect(result.default_preset).toBe("best");
      expect(result.max_concurrent).toBe(2);
    });

    it("updates settings", async () => {
      const { updateSettings } = await import("@/lib/api");
      const mockSettings = {
        download_dir: "/downloads",
        default_preset: "720p",
        max_concurrent: 4,
        ytdlp_version: "2026.10.21",
      };
      const result = await updateSettings({ default_preset: "720p", max_concurrent: 4 }, undefined, fakeFetch(200, mockSettings));
      expect(result.default_preset).toBe("720p");
      expect(result.max_concurrent).toBe(4);
    });
  });
});

