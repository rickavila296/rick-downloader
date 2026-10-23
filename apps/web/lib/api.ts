import type { z } from "zod";

import {
  ApiErrorSchema,
  EntryFormatsResponseSchema,
  HealthSchema,
  HostStatusSchema,
  JobCreateResponseSchema,
  JobListResponseSchema,
  JobSchema,
  ScanResultSchema,
  SettingsSchema,
  type EntryFormatsResponse,
  type Health,
  type HostStatus,
  type Job,
  type JobCreateItem,
  type JobCreateResponse,
  type JobListResponse,
  type ScanResult,
  type Settings,
  type SettingsUpdate,
} from "@/lib/schemas";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Fetcher = typeof fetch;

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  init?: RequestInit,
  fetcher: Fetcher = fetch,
): Promise<z.infer<S>> {
  const res = await fetcher(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new ApiError(res.status, "http_error", `Request failed with status ${res.status}`);
  }
  return schema.parse(body);
}

export function getHealth(fetcher?: Fetcher): Promise<Health> {
  return request(HealthSchema, "/api/health", undefined, fetcher);
}

export function createScan(url: string, signal?: AbortSignal, fetcher?: Fetcher): Promise<ScanResult> {
  return request(
    ScanResultSchema,
    "/api/scans",
    {
      method: "POST",
      body: JSON.stringify({ url }),
      signal,
    },
    fetcher,
  );
}

export function getScan(scanId: string, signal?: AbortSignal, fetcher?: Fetcher): Promise<ScanResult> {
  return request(ScanResultSchema, `/api/scans/${encodeURIComponent(scanId)}`, { signal }, fetcher);
}

function extractHost(urlStr?: string): string {
  if (!urlStr) return "default";
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) {
      return "youtube.com";
    }
    const parts = host.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return host;
  } catch {
    return "default";
  }
}

const hostFormatQueues = new Map<string, Promise<unknown>>();

export function getEntryFormats(
  scanId: string,
  entryId: string,
  videoUrlOrSignal?: string | AbortSignal,
  signalOrFetcher?: AbortSignal | Fetcher,
  maybeFetcher?: Fetcher,
): Promise<EntryFormatsResponse> {
  let videoUrl: string | undefined;
  let signal: AbortSignal | undefined;
  let fetcher: Fetcher | undefined;

  if (typeof videoUrlOrSignal === "string") {
    videoUrl = videoUrlOrSignal;
    if (signalOrFetcher && typeof signalOrFetcher === "object" && "aborted" in signalOrFetcher) {
      signal = signalOrFetcher as AbortSignal;
      fetcher = maybeFetcher;
    } else {
      fetcher = signalOrFetcher as Fetcher;
    }
  } else {
    signal = videoUrlOrSignal;
    fetcher = signalOrFetcher as Fetcher;
  }

  // Requirement 2: Limit format requests to one at a time per host
  const host = extractHost(videoUrl);
  const prevQueue = hostFormatQueues.get(host) ?? Promise.resolve();

  const currentRequest = prevQueue
    .catch(() => {})
    .then(() =>
      request(
        EntryFormatsResponseSchema,
        `/api/scans/${encodeURIComponent(scanId)}/entries/${encodeURIComponent(entryId)}/formats`,
        { signal },
        fetcher,
      ),
    );

  hostFormatQueues.set(host, currentRequest);
  return currentRequest;
}

export function createJobs(
  items: JobCreateItem[],
  signal?: AbortSignal,
  fetcher?: Fetcher,
): Promise<JobCreateResponse> {
  return request(
    JobCreateResponseSchema,
    "/api/jobs",
    {
      method: "POST",
      body: JSON.stringify({ items }),
      signal,
    },
    fetcher,
  );
}

export function listJobs(
  options?: { status?: string; limit?: number; cursor?: string },
  signal?: AbortSignal,
  fetcher?: Fetcher,
): Promise<JobListResponse> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.cursor) params.set("cursor", options.cursor);
  const qs = params.toString() ? `?${params.toString()}` : "";

  return request(
    JobListResponseSchema,
    `/api/jobs${qs}`,
    { signal },
    fetcher,
  );
}

export function getJob(
  jobId: string,
  signal?: AbortSignal,
  fetcher?: Fetcher,
): Promise<Job> {
  return request(
    JobSchema,
    `/api/jobs/${encodeURIComponent(jobId)}`,
    { signal },
    fetcher,
  );
}

export function cancelJob(
  jobId: string,
  signal?: AbortSignal,
  fetcher?: Fetcher,
): Promise<Job> {
  return request(
    JobSchema,
    `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST", signal },
    fetcher,
  );
}

export function retryJob(
  jobId: string,
  signal?: AbortSignal,
  fetcher?: Fetcher,
): Promise<Job> {
  return request(
    JobSchema,
    `/api/jobs/${encodeURIComponent(jobId)}/retry`,
    { method: "POST", signal },
    fetcher,
  );
}

export async function deleteJob(
  jobId: string,
  deleteFile = false,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const res = await fetcher(
    `/api/jobs/${encodeURIComponent(jobId)}?delete_file=${deleteFile}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new ApiError(res.status, "delete_error", `Delete failed with status ${res.status}`);
  }
}

export function getSettings(
  signal?: AbortSignal,
  fetcher?: Fetcher,
): Promise<Settings> {
  return request(
    SettingsSchema,
    "/api/settings",
    { signal },
    fetcher,
  );
}

export function updateSettings(
  data: SettingsUpdate,
  signal?: AbortSignal,
  fetcher?: Fetcher,
): Promise<Settings> {
  return request(
    SettingsSchema,
    "/api/settings",
    {
      method: "PATCH",
      body: JSON.stringify(data),
      signal,
    },
    fetcher,
  );
}

export function getHostStatus(signal?: AbortSignal, fetcher?: Fetcher): Promise<HostStatus> {
  return request(HostStatusSchema, "/api/status", { signal }, fetcher);
}
