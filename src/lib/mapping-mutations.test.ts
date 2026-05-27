import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createMappingRule,
  deleteMappingRule,
  profileUpdateSchema,
  ruleCreateSchema,
  ruleUpdateSchema,
  updateMappingRule,
  updateProfile,
  validateRuleSemantics,
} from "@/lib/mapping-mutations";
import { validateMappingSet } from "@/lib/mapping-quality";
import { sampleProject } from "@/lib/sample-data";

function buildPrismaMock() {
  const mappingRule = {
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "rule-new", qualityStatus: "unchecked", ...data })),
    update: vi.fn().mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, qualityStatus: "unchecked", ...data }),
    ),
    delete: vi.fn().mockResolvedValue({ id: "rule-deleted" }),
  };
  const profile = {
    update: vi.fn().mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data }),
    ),
  };
  return { mappingRule, profile } as unknown as PrismaClient & { mappingRule: typeof mappingRule; profile: typeof profile };
}

describe("rule schemas", () => {
  it("accepts a valid direct rule", () => {
    const parsed = ruleCreateSchema.safeParse({
      destinationFieldId: "dst-1",
      sourceFieldId: "src-1",
      mappingType: "direct",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown mapping types", () => {
    const parsed = ruleCreateSchema.safeParse({
      destinationFieldId: "dst-1",
      mappingType: "magic",
    });
    expect(parsed.success).toBe(false);
  });

  it("treats partial updates as valid", () => {
    const parsed = ruleUpdateSchema.safeParse({ comment: "renamed" });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty profile updates fields", () => {
    const parsed = profileUpdateSchema.safeParse({ format: "" });
    expect(parsed.success).toBe(false);
  });
});

describe("validateRuleSemantics", () => {
  it("requires a default value for constant mappings", () => {
    const errors = validateRuleSemantics({
      destinationFieldId: "dst",
      mappingType: "constant",
    });
    expect(errors).toContain("Constant mappings require a default value.");
  });

  it("requires a source field for non-constant mappings", () => {
    const errors = validateRuleSemantics({
      destinationFieldId: "dst",
      sourceFieldId: "",
      mappingType: "direct",
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts a valid constant rule", () => {
    const errors = validateRuleSemantics({
      destinationFieldId: "dst",
      mappingType: "constant",
      defaultValue: "SEIREN",
    });
    expect(errors).toEqual([]);
  });

  it("requires a comment for function mappings", () => {
    const errors = validateRuleSemantics({
      destinationFieldId: "dst",
      sourceFieldId: "src-1",
      mappingType: "function",
      expression: "normalize(x)",
    });
    expect(errors).toContain("Function/lookup mappings require a comment.");
  });

  it("requires a comment for lookup mappings", () => {
    const errors = validateRuleSemantics({
      destinationFieldId: "dst",
      sourceFieldId: "src-1",
      mappingType: "lookup",
      expression: "lookup(x)",
    });
    expect(errors).toContain("Function/lookup mappings require a comment.");
  });

  it("accepts function/lookup when comment is provided", () => {
    const errors = validateRuleSemantics({
      destinationFieldId: "dst",
      sourceFieldId: "src-1",
      mappingType: "function",
      expression: "normalize(x)",
      comment: "Normalizes date format",
    });
    expect(errors).toEqual([]);
  });

  it("uses existingComment fallback for updates", () => {
    const errors = validateRuleSemantics(
      { mappingType: "lookup", expression: "lookup(x)" },
      "Existing comment from DB",
    );
    expect(errors).toEqual([]);
  });

  it("flags missing comment even with existingComment when blank", () => {
    const errors = validateRuleSemantics(
      { mappingType: "function", expression: "f(x)" },
      "   ",
    );
    expect(errors).toContain("Function/lookup mappings require a comment.");
  });
});

describe("mapping rule mutations", () => {
  it("creates a rule and nulls source for constants", async () => {
    const prisma = buildPrismaMock();
    await createMappingRule(prisma, "set-1", {
      destinationFieldId: "dst-1",
      sourceFieldId: "src-1",
      mappingType: "constant",
      defaultValue: "X",
    });
    expect(prisma.mappingRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mappingSetId: "set-1",
        sourceFieldId: null,
        mappingType: "constant",
        defaultValue: "X",
      }),
    });
  });

  it("updates only provided fields and clears source when switching to constant", async () => {
    const prisma = buildPrismaMock();
    await updateMappingRule(prisma, "rule-1", {
      mappingType: "constant",
      defaultValue: "Z",
    });
    expect(prisma.mappingRule.update).toHaveBeenCalledWith({
      where: { id: "rule-1" },
      data: expect.objectContaining({
        mappingType: "constant",
        sourceFieldId: null,
        defaultValue: "Z",
      }),
    });
  });

  it("deletes a rule by id", async () => {
    const prisma = buildPrismaMock();
    await deleteMappingRule(prisma, "rule-9");
    expect(prisma.mappingRule.delete).toHaveBeenCalledWith({ where: { id: "rule-9" } });
  });

  it("updates a profile format", async () => {
    const prisma = buildPrismaMock();
    await updateProfile(prisma, "profile-1", { format: "CSV" });
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: "profile-1" },
      data: { format: "CSV" },
    });
  });
});

describe("editing rules updates quality", () => {
  const mappingSet = sampleProject.mappingSets[0];
  const sourceProfile = sampleProject.profiles.find((p) => p.id === mappingSet.sourceProfileId)!;
  const destinationProfile = sampleProject.profiles.find((p) => p.id === mappingSet.destinationProfileId)!;

  it("clears an unmapped-required error when a rule is added back", () => {
    const broken = {
      ...mappingSet,
      rules: mappingSet.rules.filter((rule) => rule.destinationFieldId !== "dst-u-company"),
    };
    const before = validateMappingSet(broken, sourceProfile, destinationProfile);
    expect(before.some((issue) => issue.id === "unmapped-required-dst-u-company")).toBe(true);

    const fixed = {
      ...broken,
      rules: [
        ...broken.rules,
        {
          id: "rule-fix",
          sourceFieldId: "src-company-code",
          destinationFieldId: "dst-u-company",
          mappingType: "direct" as const,
          comment: "Restored direct mapping",
        },
      ],
    };
    const after = validateMappingSet(fixed, sourceProfile, destinationProfile);
    expect(after.some((issue) => issue.id === "unmapped-required-dst-u-company")).toBe(false);
  });

  it("flags duplicate destinations after a duplicate rule is added", () => {
    const original = validateMappingSet(mappingSet, sourceProfile, destinationProfile);
    expect(original.some((issue) => issue.id.startsWith("duplicate-destination-"))).toBe(false);

    const dup = {
      ...mappingSet,
      rules: [
        ...mappingSet.rules,
        {
          ...mappingSet.rules[0],
          id: "rule-dup",
        },
      ],
    };
    const after = validateMappingSet(dup, sourceProfile, destinationProfile);
    expect(after.some((issue) => issue.id.startsWith("duplicate-destination-"))).toBe(true);
  });
});
