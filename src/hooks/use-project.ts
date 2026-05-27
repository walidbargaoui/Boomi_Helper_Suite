"use client";

import useSWR from "swr";
import type { Project } from "@/lib/domain";

const fetcher = async (url: string): Promise<Project> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch project");
  const json = await res.json();
  return json.project as Project;
};

export function useProject(
  projectId: string | undefined,
  fallbackData?: Project | null,
) {
  const { data, error, mutate, isValidating } = useSWR<Project>(
    projectId ? `/api/projects/${projectId}` : null,
    fetcher,
    {
      fallbackData: fallbackData ?? undefined,
      revalidateOnFocus: true,
      dedupingInterval: 2000,
    },
  );
  return {
    project: data ?? fallbackData ?? null,
    error,
    mutate,
    isLoading: isValidating,
  };
}
