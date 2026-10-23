import { z } from "zod";

// Spec §8.4 Shared types mirrored in Zod

export const PresetSchema = z.enum(["best", "1080p", "720p", "480p", "audio"]);
export type Preset = z.infer<typeof PresetSchema>;

export const EntryStatusSchema = z.enum(["available", "drm", "login_required", "unsupported"]);
export type EntryStatus = z.infer<typeof EntryStatusSchema>;

export const ScanEntrySchema = z.object({
  id: z.string(),
  video_url: z.string(),
  title: z.string().nullable(),
  thumbnail: z.string().nullable(),
  duration_s: z.number().nullable(),
  extractor: z.string(),
  status: EntryStatusSchema,
  error_code: z.string().nullable().optional(),
  error_raw: z.string().nullable().optional(),
});
export type ScanEntry = z.infer<typeof ScanEntrySchema>;

export const ScanResultSchema = z.object({
  scan_id: z.string(),
  source_url: z.string(),
  status: z.enum(["ok", "empty", "error"]),
  reason: z.string().nullable().optional(),
  entries: z.array(ScanEntrySchema),
  truncated: z.boolean(),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;

export const FormatSchema = z.object({
  format_id: z.string(),
  ext: z.string(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  vcodec: z.string().nullable(),
  acodec: z.string().nullable(),
  filesize: z.number().nullable(),
  note: z.string().nullable(),
});
export type Format = z.infer<typeof FormatSchema>;

export const EntryFormatsResponseSchema = z.object({
  formats: z.array(FormatSchema),
});
export type EntryFormatsResponse = z.infer<typeof EntryFormatsResponseSchema>;

// Health schema (spec §8.3)
export const HealthSchema = z.object({
  ok: z.boolean(),
  ytdlp_version: z.string(),
  ffmpeg: z.boolean(),
});
export type Health = z.infer<typeof HealthSchema>;

// Jobs schema (spec §8.4)
export const JobStatusSchema = z.enum(["queued", "running", "done", "error", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  id: z.string(),
  entry_id: z.string().nullable().optional(),
  video_url: z.string(),
  title: z.string().nullable().optional(),
  preset: PresetSchema,
  status: JobStatusSchema,
  progress: z.number(),
  speed_bps: z.number().nullable().optional(),
  eta_s: z.number().nullable().optional(),
  bytes_total: z.number().nullable().optional(),
  file_name: z.string().nullable().optional(),
  status_detail: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_hint: z.string().nullable().optional(),
  error_raw: z.string().nullable().optional(),
  created_at: z.string(),
  finished_at: z.string().nullable().optional(),
});
export type Job = z.infer<typeof JobSchema>;

export const JobListResponseSchema = z.object({
  jobs: z.array(JobSchema),
  next_cursor: z.string().nullable().optional(),
});
export type JobListResponse = z.infer<typeof JobListResponseSchema>;

export const JobCreateItemSchema = z.object({
  entry_id: z.string().optional(),
  video_url: z.string().optional(),
  preset: PresetSchema.default("best"),
  format_id: z.string().optional(),
});
export type JobCreateItem = z.infer<typeof JobCreateItemSchema>;

export const JobCreateResponseSchema = z.object({
  jobs: z.array(JobSchema),
});
export type JobCreateResponse = z.infer<typeof JobCreateResponseSchema>;

export const RateLimitedHostSchema = z.object({
  host: z.string(),
  until: z.string(),
  reason: z.string(),
});
export type RateLimitedHost = z.infer<typeof RateLimitedHostSchema>;

export const HostStatusSchema = z.object({
  host_limits: z.record(z.string(), z.number()),
  rate_limited: z.array(RateLimitedHostSchema),
});
export type HostStatus = z.infer<typeof HostStatusSchema>;

// Settings schema (spec §8.4)
export const SettingsSchema = z.object({
  download_dir: z.string(),
  default_preset: PresetSchema,
  max_concurrent: z.number(),
  ytdlp_version: z.string(),
  cookies: z.enum(["loaded", "not_loaded"]).default("not_loaded"),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsUpdateSchema = z.object({
  default_preset: PresetSchema.optional(),
  max_concurrent: z.number().min(1).max(5).optional(),
});
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

// Spec §8.3: every error body has this shape
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

