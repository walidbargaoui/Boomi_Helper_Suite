import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  deleteMappingRule,
  ruleUpdateSchema,
  updateMappingRule,
  validateRuleSemantics,
} from "@/lib/mapping-mutations";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ mappingSetId: string; ruleId: string }> },
) {
  const { mappingSetId, ruleId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = ruleUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rule payload", issues: parsed.error.issues }, { status: 400 });
  }

  const existing = await prisma.mappingRule.findUnique({ where: { id: ruleId } });
  if (!existing) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  // Detect whether this patch touches any field that affects semantic validity.
  // Toggling `reviewed` or other side-band flags should never re-run the rule
  // semantics check — otherwise a rule with a latent validation error becomes
  // un-toggleable. (Bug: reviewed checkbox unchecked rapidly because PATCH
  // returned 422 from a stale semantic issue, which triggered the optimistic-
  // update rollback in the UI.)
  const semanticFields = [
    "mappingType",
    "sourceFieldId",
    "destinationFieldId",
    "defaultValue",
    "expression",
    "comment",
  ] as const;
  const touchesSemantics = semanticFields.some((field) => field in parsed.data);

  if (touchesSemantics) {
    const merged = {
      ...existing,
      ...parsed.data,
      mappingType: parsed.data.mappingType ?? existing.mappingType,
    } as Parameters<typeof validateRuleSemantics>[0];
    const semanticErrors = validateRuleSemantics(merged, existing.comment ?? undefined);
    if (semanticErrors.length > 0) {
      return NextResponse.json({ error: "Rule validation failed", issues: semanticErrors }, { status: 422 });
    }

    // The duplicate-destination check only matters when destinationFieldId changes.
    if ("destinationFieldId" in parsed.data) {
      const dupCheck = await prisma.mappingRule.findMany({
        where: { mappingSetId, destinationFieldId: merged.destinationFieldId, id: { not: ruleId } },
      });
      if (dupCheck.length > 0) {
        return NextResponse.json({ error: "Duplicate destination", issues: ["This destination field is already mapped."] }, { status: 422 });
      }
    }
  }

  try {
    const rule = await updateMappingRule(prisma, ruleId, parsed.data);
    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update mapping rule", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ mappingSetId: string; ruleId: string }> },
) {
  const { ruleId } = await params;
  try {
    await deleteMappingRule(prisma, ruleId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete mapping rule", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
