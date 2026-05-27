"use client";

import useSWR from "swr";
import type { BoomiConnection } from "@/lib/domain";

const fetcher = async (url: string): Promise<BoomiConnection[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch connections");
  const json = await res.json();
  return json.connections as BoomiConnection[];
};

export function useConnections(
  projectId: string | undefined,
  fallbackData?: BoomiConnection[],
) {
  const { data, error, mutate, isValidating } = useSWR<BoomiConnection[]>(
    projectId ? `/api/boomi/connections?projectId=${projectId}` : null,
    fetcher,
    {
      fallbackData: fallbackData ?? undefined,
      revalidateOnFocus: true,
      dedupingInterval: 2000,
    },
  );
  return {
    connections: data ?? fallbackData ?? [],
    error,
    mutate,
    isLoading: isValidating,
  };
}
