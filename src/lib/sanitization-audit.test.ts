import { describe, test } from "vitest";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

/**
 * Recursively list all .ts files under a directory.
 */
async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && full.endsWith(".ts")) {
      yield full;
    }
  }
}

describe("Route sanitization audit", () => {
  test("every API route that returns a project key uses a sanitizer", async () => {
    const routesDir = join(process.cwd(), "src/app/api");
    const issues: string[] = [];

    for await (const file of walk(routesDir)) {
      const content = await readFile(file, "utf-8");
      // Only look at route handlers (Next.js App Router route.ts files)
      if (!content.includes("NextResponse.json")) continue;

      // Find lines that include "project:" in a JSON response body
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Match patterns like `project: sanitizeProjectForClient(...)` or `project: scrubPrismaProjectForClient(...)`
        // Skip lines that already call a sanitizer
        if (/project:\s*(sanitizeProjectForClient|scrubPrismaProjectForClient)/.test(line)) continue;
        // Skip lines that are just destructuring or type annotations
        if (/project:\s*Project/.test(line)) continue;
        // Skip import lines
        if (line.startsWith("import ")) continue;
        // Skip comments
        if (line.startsWith("// ")) continue;
        // If the line contains `project:` in a response context, flag it
        if (/project:/.test(line) && line.includes("NextResponse.json") || line.includes("project:")) {
          // Additional heuristic: check if the file imports any sanitizer
          const hasSanitizerImport = content.includes("sanitizeProjectForClient") || content.includes("scrubPrismaProjectForClient");
          if (!hasSanitizerImport) {
            issues.push(`${file}:${i + 1} returns a project response but imports no sanitizer`);
          }
        }
      }
    }

    if (issues.length > 0) {
      throw new Error(`Sanitization audit failed:\n${issues.join("\n")}`);
    }
  });
});
