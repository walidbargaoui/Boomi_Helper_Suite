/**
 * Fetch representative Boomi component samples to align the dry-run generators
 * against real component XML.
 *
 * Reads credentials from env vars (never hard-coded):
 *   BOOMI_ACCOUNT_ID
 *   BOOMI_API_USERNAME
 *   BOOMI_API_TOKEN
 *
 * For each component type (transform.map, profile.flatfile, profile.json,
 * profile.xml) it queries ComponentMetadata, fetches the first N current
 * components, and writes the smallest into samples/boomi/.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const accountId = process.env.BOOMI_ACCOUNT_ID;
const apiUsername = process.env.BOOMI_API_USERNAME;
const apiToken = process.env.BOOMI_API_TOKEN;

if (!accountId || !apiUsername || !apiToken) {
  console.error("Missing BOOMI_ACCOUNT_ID / BOOMI_API_USERNAME / BOOMI_API_TOKEN env vars.");
  process.exit(1);
}

const baseUrl = "https://api.boomi.com";
const authHeader = "Basic " + Buffer.from(`${apiUsername}:${apiToken}`).toString("base64");

type MetaItem = {
  componentId: string;
  version: number;
  currentVersion: boolean | string;
  name: string;
  type: string;
  deleted: boolean | string;
  modifiedDate?: string;
};

function parseBool(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === "true";
}

async function queryMetadata(type: string, limit = 200): Promise<MetaItem[]> {
  const url = `${baseUrl}/api/rest/v1/${accountId}/ComponentMetadata/query`;
  const body = {
    QueryFilter: {
      expression: {
        operator: "EQUALS",
        property: "type",
        argument: [type],
      },
    },
  };

  const allItems: MetaItem[] = [];
  let token: string | undefined;
  const url2 = `${baseUrl}/api/rest/v1/${accountId}/ComponentMetadata/queryMore`;

  // First page
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Query ${type} failed: HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as { result?: MetaItem[]; queryToken?: string; numberOfResults?: number };
  allItems.push(...(parsed.result ?? []));
  token = parsed.queryToken;

  // Continue paging while we have a token and haven't hit the limit
  while (token && allItems.length < limit) {
    const moreResp = await fetch(url2, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "text/plain",
        Accept: "application/json",
      },
      body: token,
    });
    if (!moreResp.ok) break;
    const moreText = await moreResp.text();
    const more = JSON.parse(moreText) as { result?: MetaItem[]; queryToken?: string };
    allItems.push(...(more.result ?? []));
    token = more.queryToken;
    if (!more.result || more.result.length === 0) break;
  }

  return allItems
    .filter((item) => parseBool(item.currentVersion) && !parseBool(item.deleted))
    .slice(0, limit);
}

async function fetchComponentXml(componentId: string, version: number): Promise<string> {
  const url = `${baseUrl}/api/rest/v1/${accountId}/Component/${componentId}~${version}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/xml",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Fetch ${componentId}~${version} failed: HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.text();
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80);
}

async function sampleType(type: string, opts: { maxFetch: number; keepCount: number }) {
  console.log(`\n=== ${type} ===`);
  const items = await queryMetadata(type, 500);
  console.log(`Query returned ${items.length} current/non-deleted ${type} components`);

  // Fetch up to maxFetch candidates. Random sample if there are many.
  const shuffled = items.slice().sort(() => Math.random() - 0.5);
  const candidates = shuffled.slice(0, opts.maxFetch);

  const fetched: Array<{ item: MetaItem; xml: string }> = [];
  for (const item of candidates) {
    try {
      const xml = await fetchComponentXml(item.componentId, Number(item.version));
      fetched.push({ item, xml });
    } catch (err) {
      console.warn(`  ! fetch failed for ${item.componentId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  fetched.sort((a, b) => a.xml.length - b.xml.length);
  console.log(`  fetched ${fetched.length}; sizes ${fetched.length ? fetched[0].xml.length + ".." + fetched[fetched.length - 1].xml.length : "n/a"}`);

  // Pick a spread across the size spectrum: smallest, mid, largest, plus extras filling the gaps.
  const picked: typeof fetched = [];
  if (fetched.length <= opts.keepCount) {
    picked.push(...fetched);
  } else {
    // Evenly spaced indices across the sorted list.
    for (let i = 0; i < opts.keepCount; i += 1) {
      const idx = Math.round((i / (opts.keepCount - 1)) * (fetched.length - 1));
      picked.push(fetched[idx]);
    }
  }

  const outDir = resolve(__dirname, "..", "samples", "boomi");
  mkdirSync(outDir, { recursive: true });

  for (const entry of picked) {
    const sizeLabel = String(entry.xml.length).padStart(7, "0");
    const fileName = `${type.replace(/\./g, "-")}__${sizeLabel}__${safeFileName(entry.item.name || entry.item.componentId)}__${entry.item.componentId}.xml`;
    const outPath = resolve(outDir, fileName);
    writeFileSync(outPath, entry.xml, "utf8");
    console.log(`  ✓ saved ${entry.xml.length} bytes: ${fileName}`);
  }

  if (picked.length === 0) {
    console.warn(`  ! no usable ${type} samples saved`);
  }
}

async function main() {
  const types = ["transform.map", "profile.flatfile", "profile.json", "profile.xml", "profile.db"];
  for (const type of types) {
    try {
      await sampleType(type, { maxFetch: 300, keepCount: 250 });
    } catch (err) {
      console.error(`Failed sampling ${type}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
