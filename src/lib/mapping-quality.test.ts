import { describe, expect, it } from "vitest";
import { validateMappingSet } from "@/lib/mapping-quality";
import { sampleProject } from "@/lib/sample-data";

const mappingSet = sampleProject.mappingSets[0];
const sourceProfile = sampleProject.profiles.find(
  (profile) => profile.id === mappingSet.sourceProfileId,
)!;
const destinationProfile = sampleProject.profiles.find(
  (profile) => profile.id === mappingSet.destinationProfileId,
)!;

describe("mapping quality checks", () => {
  it("accepts the seeded mapping with no blocking errors", () => {
    const issues = validateMappingSet(mappingSet, sourceProfile, destinationProfile);

    expect(issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("finds unmapped required destination fields", () => {
    const broken = {
      ...mappingSet,
      rules: mappingSet.rules.filter((rule) => rule.destinationFieldId !== "dst-u-company"),
    };
    const issues = validateMappingSet(broken, sourceProfile, destinationProfile);

    expect(issues.some((issue) => issue.id === "unmapped-required-dst-u-company")).toBe(true);
  });

  it("does not flag 'source missing' when a non-constant rule carries a defaultValue (fixed value)", () => {
    // Regression: previously a rule with mappingType !== "constant" but
    // defaultValue set (e.g., user typed a literal into the value box) was
    // flagged as needing a source field. A defaultValue alone satisfies the
    // rule's input requirement.
    const fixedValueRule = {
      ...mappingSet.rules[0],
      id: "fixed-value-rule",
      mappingType: "direct" as const,
      sourceFieldId: undefined,
      defaultValue: "STATIC-2024",
    };
    const broken = { ...mappingSet, rules: [fixedValueRule] };
    const issues = validateMappingSet(broken, sourceProfile, destinationProfile);
    expect(issues.some((issue) => issue.id === "missing-source-fixed-value-rule")).toBe(false);
  });

  it("does not flag 'source missing' when a non-constant rule carries an expression", () => {
    const exprOnlyRule = {
      ...mappingSet.rules[0],
      id: "expr-only-rule",
      mappingType: "function" as const,
      sourceFieldId: undefined,
      expression: "new Date().toISOString()",
      comment: "current date",
    };
    const broken = { ...mappingSet, rules: [exprOnlyRule] };
    const issues = validateMappingSet(broken, sourceProfile, destinationProfile);
    expect(issues.some((issue) => issue.id === "missing-source-expr-only-rule")).toBe(false);
  });

  it("still flags 'source missing' when a non-constant rule has no source, defaultValue, or expression", () => {
    const emptyRule = {
      ...mappingSet.rules[0],
      id: "empty-rule",
      mappingType: "direct" as const,
      sourceFieldId: undefined,
      defaultValue: undefined,
      expression: undefined,
    };
    const broken = { ...mappingSet, rules: [emptyRule] };
    const issues = validateMappingSet(broken, sourceProfile, destinationProfile);
    expect(issues.some((issue) => issue.id === "missing-source-empty-rule")).toBe(true);
  });

  it("finds duplicate destination mappings", () => {
    const broken = {
      ...mappingSet,
      rules: [
        ...mappingSet.rules,
        {
          ...mappingSet.rules[0],
          id: "duplicate-rule",
          sourceFieldId: "src-company-code",
        },
      ],
    };
    const issues = validateMappingSet(broken, sourceProfile, destinationProfile);

    expect(issues.some((issue) => issue.id === "duplicate-destination-dst-u-po-no")).toBe(true);
  });
});
