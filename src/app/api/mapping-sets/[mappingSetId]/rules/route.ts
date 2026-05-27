import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createMappingRule,
  ruleCreateSchema,
  validateRuleSemantics,
} from "@/lib/mapping-mutations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mappingSetId: string }> },
) {
  const { mappingSetId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = ruleCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rule payload", issues: parsed.error.issues }, { status: 400 });
  }

  const semanticErrors = validateRuleSemantics(parsed.data);
  if (semanticErrors.length > 0) {
    return NextResponse.json({ error: "Rule validation failed", issues: semanticErrors }, { status: 422 });
  }

  const existing = await prisma.mappingRule.findMany({
    where: { mappingSetId, destinationFieldId: parsed.data.destinationFieldId },
  });
  if (existing.length > 0) {
    return NextResponse.json({ error: "Duplicate destination", issues: ["This destination field is already mapped."] }, { status: 422 });
  }

  try {
    const rule = await createMappingRule(prisma, mappingSetId, parsed.data);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create mapping rule", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
