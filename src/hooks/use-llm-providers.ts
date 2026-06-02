"use client";

import useSWR from "swr";
import type { LlmProvider } from "@/lib/domain";
import { extractError } from "@/lib/api-utils";

const fetcher = async (url: string): Promise<LlmProvider[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await extractError(res));
  const json = await res.json();
  return json.providers as LlmProvider[];
};

export function useLlmProviders(fallbackData?: LlmProvider[]) {
  const { data, error, mutate, isValidating } = useSWR<LlmProvider[]>(
    "/api/llm/providers",
    fetcher,
    {
      fallbackData: fallbackData ?? undefined,
      revalidateOnFocus: true,
      dedupingInterval: 2000,
    },
  );
  return {
    providers: data ?? fallbackData ?? [],
    error,
    mutate,
    isLoading: isValidating,
  };
}
