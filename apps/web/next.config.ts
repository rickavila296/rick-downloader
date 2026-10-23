import type { NextConfig } from "next";

// The browser never talks to the worker directly (spec §7). Every /api/* call
// is proxied server-side to WORKER_URL.
// NOTE: rewrites are resolved at `next build` time, so in Docker WORKER_URL is
// passed as a build arg (see apps/web/Dockerfile).
const workerUrl = (process.env.WORKER_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Standalone output is only needed for the Docker image (set in apps/web/Dockerfile).
  // On Windows hosts it fails creating symlinks unless Developer Mode is on.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  // Keep SSE (spec §8.3 /api/jobs/events) unbuffered through the proxy.
  compress: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${workerUrl}/api/:path*` }];
  },
};

export default nextConfig;
