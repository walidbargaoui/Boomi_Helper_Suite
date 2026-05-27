import { describe, expect, it, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  lookupCache,
  storeCache,
  clearResolverCache,
  setResolverCacheFilePath,
} from "@/lib/fmd-resolver-cache";

beforeEach(() => {
  setResolverCacheFilePath(join(tmpdir(), `fmd-resolver-cache-${randomUUID()}.json`));
  clearResolverCache();
});

describe("fmd-resolver-cache", () => {
  it("returns null for a missing hash", () => {
    expect(lookupCache("missing")).toBeNull();
  });

  it("stores and retrieves a result", () => {
    const result = { foo: "bar", nested: [1, 2, 3] };
    storeCache("hash1", result);
    expect(lookupCache("hash1")).toEqual(result);
  });

  it("evicts expired entries after 24 hours", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    storeCache("hash1", { value: 1 });
    vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1);
    expect(lookupCache("hash1")).toBeNull();
    vi.useRealTimers();
  });

  it("keeps only the last N entries (LRU)", () => {
    for (let i = 0; i < 6; i++) {
      storeCache(`hash${i}`, { index: i });
    }
    expect(lookupCache("hash0")).toBeNull();
    for (let i = 1; i < 6; i++) {
      expect(lookupCache(`hash${i}`)).toEqual({ index: i });
    }
  });

  it("updates LRU order on lookup", () => {
    for (let i = 0; i < 5; i++) {
      storeCache(`hash${i}`, { index: i });
    }
    // Access hash0 so it becomes most-recently used
    lookupCache("hash0");
    // Store a new entry; this should evict hash1, not hash0
    storeCache("hash5", { index: 5 });
    expect(lookupCache("hash0")).toEqual({ index: 0 });
    expect(lookupCache("hash1")).toBeNull();
  });

  it("clearResolverCache removes all entries", () => {
    storeCache("hash1", { foo: "bar" });
    clearResolverCache();
    expect(lookupCache("hash1")).toBeNull();
  });
});
