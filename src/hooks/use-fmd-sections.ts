"use client";

import useSWR from "swr";
import type { FmdSection } from "@/lib/domain";

interface FmdApiResponse {
  sections: FmdSection[];
  completion: {
    totalRequired: number;
    totalPresent: number;
    requiredPresent: number;
    optionalPresent: number;
  };
  registry: Array<{ sectionType: string; displayLabel: string; required: boolean }>;
}

const fetcher = async (url: string): Promise<FmdApiResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch FMD sections");
  return res.json();
};

export function useFmdSections(projectId: string | undefined) {
  const { data, error, mutate, isValidating } = useSWR<FmdApiResponse>(
    projectId ? `/api/projects/${projectId}/fmd` : null,
    fetcher,
    {
      revalidateOnFocus: true,
      dedupingInterval: 2000,
    },
  );
  return {
    sections: data?.sections ?? [],
    completion: data?.completion ?? { totalRequired: 0, totalPresent: 0, requiredPresent: 0, optionalPresent: 0 },
    registry: data?.registry ?? [],
    error,
    mutate,
    isLoading: isValidating,
  };
}
