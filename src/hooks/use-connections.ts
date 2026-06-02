"use client";

import useSWR from "swr";
import type { BoomiConnection } from "@/lib/domain";
import { extractError } from "@/lib/api-utils";

const fetcher = async (url: string): Promise<BoomiConnection[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await extractError(res));
  const json = await res.json();
  return json.connections as BoomiConnection[];
};

export function useConnections(
  fallbackData?: BoomiConnection[],
) {
  const { data, error, mutate, isValidating } = useSWR<BoomiConnection[]>(
    "/api/boomi/connections",
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
