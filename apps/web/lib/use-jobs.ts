"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getHostStatus, listJobs } from "@/lib/api";
import { HostStatusSchema, JobSchema, type JobListResponse } from "@/lib/schemas";


export function useHostStatus() {
  return useQuery({
    queryKey: ["host_status"],
    queryFn: () => getHostStatus(),
    staleTime: 5000,
    refetchInterval: 5000,
  });
}

export function useJobs(statusFilter?: string) {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  const query = useQuery({
    queryKey: ["jobs", statusFilter],
    queryFn: () => listJobs({ status: statusFilter, limit: 100 }),
    staleTime: 5000,
  });

  useEffect(() => {
    // Only connect SSE in browser
    if (typeof window === "undefined") return;

    let retryTimeout: NodeJS.Timeout;

    function connect() {
      const es = new EventSource("/api/jobs/events");
      eventSourceRef.current = es;

      es.addEventListener("job", (event: MessageEvent<string>) => {
        try {
          const raw = JSON.parse(event.data);
          const parsed = JobSchema.safeParse(raw);
          if (!parsed.success) return;

          const updatedJob = parsed.data;

          // Update all jobs query caches
          queryClient.setQueriesData<JobListResponse>(
            { queryKey: ["jobs"] },
            (old) => {
              if (!old) {
                return { jobs: [updatedJob], next_cursor: null };
              }
              const exists = old.jobs.some((j) => j.id === updatedJob.id);
              if (exists) {
                return {
                  ...old,
                  jobs: old.jobs.map((j) => (j.id === updatedJob.id ? updatedJob : j)),
                };
              }
              return {
                ...old,
                jobs: [updatedJob, ...old.jobs],
              };
            },
          );
        } catch {
          // ignore parse errors
        }
      });

      es.addEventListener("host_status", (event: MessageEvent<string>) => {
        try {
          const raw = JSON.parse(event.data);
          const parsed = HostStatusSchema.safeParse(raw);
          if (!parsed.success) return;
          queryClient.setQueryData(["host_status"], parsed.data);
        } catch {
          // ignore parse errors
        }
      });

      es.onopen = () => {
        // Refetch latest jobs and host status whenever stream connects or reconnects
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["host_status"] });
      };

      es.onerror = () => {
        es.close();
        // Reconnect after 3 seconds
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      clearTimeout(retryTimeout);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [queryClient]);

  return query;
}
