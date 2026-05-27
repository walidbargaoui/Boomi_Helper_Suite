/**
 * Resolver evaluation harness — run the FMD resolver with and without the local
 * Qwen3-8B LLM on the same fixture set and report what changed.
 *
 * Usage:
 *   npx tsx scripts/eval-resolver.ts                  # all built-in fixtures
 *   npx tsx scripts/eval-resolver.ts path/to/file.xlsx [more.xlsx]
 *
 * Writes JSON results to samples/eval/results-{ISO}.json. Calibration helper at
 * the bottom converts a results file into per-strategy confidence multipliers.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { resolveFmdWorkbook, type FmdResolveResponse, type FmdImportDraft } from "../src/lib/fmd-import";

const builtInFixtures = [
  "/Users/walidbargaoui/Documents/Downloads for Chrome/Boomi設計書_SRSN001_セーレン商事_受注_in.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/FMD_To_SFs_Phone_v1.7.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/【販売管理】FMD_IFID043_SMSO_TO_TOPS_EBK_FILE_DAILY(通告管理)_v1.00.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/G06 - Employee Expense FMD V1.3.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/FMD_sheet_FOX_算定結果ステータス・業務日付更新.xlsx",
];

type RunMetrics = {
  filename: string;
  provider: string;
  ok: boolean;
  durationMs: number;
  profileCount: number;
  fieldCount: number;
  mappingSetCount: number;
  ruleCount: number;
  endpointCount: number;
  sectionCount: number;
  warningCount: number;
  unresolvedRefCount: number;
  projectConfidence: number;
  ruleConfidenceMean: number;
  ruleConfidenceMin: number;
};

function summarize(filename: string, response: FmdResolveResponse, fallbackDurationMs: number): RunMetrics {
  const draft: FmdImportDraft = response.draft;
  const ruleConfs = draft.mappingSets.flatMap((set) => set.rules.map((r) => r.confidence ?? 0));
  const fieldCount = draft.profiles.reduce((sum, p) => sum + p.fields.length, 0);
  const ruleCount = ruleConfs.length;
  return {
    filename: basename(filename),
    provider: response.resolver.provider,
    ok: response.resolver.ok,
    durationMs: response.resolver.durationMs || fallbackDurationMs,
    profileCount: draft.profiles.length,
    fieldCount,
    mappingSetCount: draft.mappingSets.length,
    ruleCount,
    endpointCount: draft.endpoints.length,
    sectionCount: draft.fmdSections.length,
    warningCount: draft.warnings.length,
    unresolvedRefCount: draft.unresolvedEvidenceRefs.length,
    projectConfidence: draft.project.confidence ?? 0,
    ruleConfidenceMean: ruleCount ? ruleConfs.reduce((s, c) => s + c, 0) / ruleCount : 0,
    ruleConfidenceMin: ruleCount ? Math.min(...ruleConfs) : 0,
  };
}

async function runOne(filePath: string) {
  if (!existsSync(filePath)) {
    console.warn(`  ! Skip (missing): ${filePath}`);
    return null;
  }
  const buffer = readFileSync(filePath);
  console.log(`\n=== ${basename(filePath)} ===`);

  const detT0 = Date.now();
  const det = await resolveFmdWorkbook(buffer, filePath, { useLlm: false });
  const detMs = Date.now() - detT0;
  const detMetrics = summarize(filePath, det, detMs);
  console.log(`  deterministic  · ${detMs}ms · ${detMetrics.profileCount}p ${detMetrics.fieldCount}f ${detMetrics.mappingSetCount}ms ${detMetrics.ruleCount}r conf=${detMetrics.projectConfidence.toFixed(2)} avgRule=${detMetrics.ruleConfidenceMean.toFixed(2)}`);

  const llmT0 = Date.now();
  const llm = await resolveFmdWorkbook(buffer, filePath, {}).catch((err) => {
    console.warn(`  ! LLM error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  const llmMs = Date.now() - llmT0;
  const llmMetrics = llm ? summarize(filePath, llm, llmMs) : null;
  if (llmMetrics) {
    console.log(`  ${llmMetrics.provider.padEnd(13)}· ${llmMs}ms · ${llmMetrics.profileCount}p ${llmMetrics.fieldCount}f ${llmMetrics.mappingSetCount}ms ${llmMetrics.ruleCount}r conf=${llmMetrics.projectConfidence.toFixed(2)} avgRule=${llmMetrics.ruleConfidenceMean.toFixed(2)}`);
    if (llmMetrics.warningCount > detMetrics.warningCount) {
      console.log(`  ↪ LLM surfaced ${llmMetrics.warningCount - detMetrics.warningCount} extra warning(s)`);
    }
    if (llmMetrics.profileCount !== detMetrics.profileCount || llmMetrics.ruleCount !== detMetrics.ruleCount) {
      console.log(`  ↪ Structural diff: profiles ${detMetrics.profileCount}→${llmMetrics.profileCount}, rules ${detMetrics.ruleCount}→${llmMetrics.ruleCount}`);
    }
  }

  return { deterministic: detMetrics, llm: llmMetrics };
}

/**
 * Confidence calibration — adjusts the local resolver's reported confidence
 * based on observed eval outcomes. If a strategy's LLM-adjusted output had
 * meaningfully different content than the deterministic run, the deterministic
 * confidence was overstated; the helper returns a multiplier to dampen it.
 */
export function calibrateConfidence(results: Array<{ deterministic: RunMetrics; llm: RunMetrics | null }>): Record<string, number> {
  let totalSame = 0;
  let totalDiff = 0;
  for (const r of results) {
    if (!r.llm) continue;
    const profileSame = r.llm.profileCount === r.deterministic.profileCount;
    const ruleSame = r.llm.ruleCount === r.deterministic.ruleCount;
    if (profileSame && ruleSame) totalSame += 1; else totalDiff += 1;
  }
  const denom = totalSame + totalDiff;
  const agreement = denom > 0 ? totalSame / denom : 1;
  // Conservative: never multiply below 0.6 or above 1.0
  const multiplier = Math.max(0.6, Math.min(1, agreement));
  return {
    deterministic: multiplier,
    notes: agreement,
  } as Record<string, number>;
}

async function main() {
  const args = process.argv.slice(2);
  const fixtures = args.length > 0 ? args : builtInFixtures;

  const outDir = resolve(__dirname, "..", "samples", "eval");
  mkdirSync(outDir, { recursive: true });

  const allResults: Array<{ deterministic: RunMetrics; llm: RunMetrics | null }> = [];
  for (const path of fixtures) {
    const r = await runOne(path);
    if (r) allResults.push(r);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = resolve(outDir, `results-${stamp}.json`);
  writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), results: allResults, calibration: calibrateConfidence(allResults) }, null, 2), "utf8");
  console.log(`\n✓ Saved ${allResults.length} result(s) to ${outFile}`);
  const cal = calibrateConfidence(allResults);
  console.log(`Calibration: deterministic confidence multiplier = ${cal.deterministic.toFixed(3)} (agreement = ${(cal.notes * 100).toFixed(1)}%)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
