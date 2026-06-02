type CacheEntry = {
  hash: string;
  resultJson: unknown;
  createdAt: string;
};

const isServer = typeof window === "undefined";

let cacheFilePath = ".cache/fmd-resolver-cache.json";

function getFs() {
  if (!isServer) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require(/* turbopackIgnore: true */ "node:fs") as typeof import("node:fs");
  return fs;
}

function getPath() {
  if (!isServer) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require(/* turbopackIgnore: true */ "node:path") as typeof import("node:path");
  return p;
}

function ensureDir(filePath: string) {
  const fs = getFs();
  const path = getPath();
  if (!fs || !path) return;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  }
}

function readEntries(): CacheEntry[] {
  const fs = getFs();
  if (!fs || !fs.existsSync(/*turbopackIgnore: true*/ cacheFilePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ cacheFilePath, "utf-8");
    const parsed = JSON.parse(raw) as CacheEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeEntries(entries: CacheEntry[]) {
  const fs = getFs();
  if (!fs) return;
  ensureDir(cacheFilePath);
  fs.writeFileSync(/*turbopackIgnore: true*/ cacheFilePath, JSON.stringify(entries, null, 2));
}

const CACHE_MAX_SIZE = 5;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function lookupCache(hash: string): unknown | null {
  if (!isServer) return null;
  const entries = readEntries();
  const index = entries.findIndex((entry) => entry.hash === hash);
  if (index === -1) return null;
  const entry = entries[index];
  const createdAt = new Date(entry.createdAt).getTime();
  if (Date.now() - createdAt > CACHE_TTL_MS) {
    entries.splice(index, 1);
    writeEntries(entries);
    return null;
  }
  entries.splice(index, 1);
  entries.push(entry);
  writeEntries(entries);
  return entry.resultJson;
}

export function storeCache(hash: string, result: unknown): void {
  if (!isServer) return;
  const entries = readEntries();
  const existingIndex = entries.findIndex((entry) => entry.hash === hash);
  if (existingIndex !== -1) {
    entries.splice(existingIndex, 1);
  }
  entries.push({ hash, resultJson: result, createdAt: new Date().toISOString() });
  while (entries.length > CACHE_MAX_SIZE) {
    entries.shift();
  }
  writeEntries(entries);
}

export function clearResolverCache(): void {
  if (!isServer) return;
  const fs = getFs();
  if (fs && fs.existsSync(/*turbopackIgnore: true*/ cacheFilePath)) {
    fs.unlinkSync(/*turbopackIgnore: true*/ cacheFilePath);
  }
}

export function setResolverCacheFilePath(filePath: string): void {
  cacheFilePath = filePath;
}
