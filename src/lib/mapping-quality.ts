import type { MappingIssue, MappingSet, Profile } from "@/lib/domain";

const compatibleTypes: Record<string, string[]> = {
  string: ["string", "char", "text"],
  date: ["date", "datetime", "string"],
  decimal: ["decimal", "number", "integer", "string"],
  number: ["decimal", "number", "integer", "string"],
  boolean: ["boolean", "string"],
};

function normalizeType(type: string) {
  const lower = type.trim().toLowerCase();
  if (lower.includes("char")) return "string";
  if (lower.includes("date")) return "date";
  if (lower.includes("decimal")) return "decimal";
  if (lower.includes("number") || lower.includes("int")) return "number";
  if (lower.includes("bool")) return "boolean";
  return lower;
}

export function validateMappingSet(
  mappingSet: MappingSet,
  sourceProfile: Profile,
  destinationProfile: Profile,
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const sourceById = new Map(sourceProfile.fields.map((field) => [field.id, field]));
  const destinationById = new Map(destinationProfile.fields.map((field) => [field.id, field]));
  const rulesByDestination = new Map<string, typeof mappingSet.rules>();

  for (const rule of mappingSet.rules) {
    const matches = rulesByDestination.get(rule.destinationFieldId) ?? [];
    matches.push(rule);
    rulesByDestination.set(rule.destinationFieldId, matches);

    const destination = destinationById.get(rule.destinationFieldId);
    if (!destination) {
      issues.push({
        id: `missing-destination-${rule.id}`,
        severity: "error",
        title: "Destination field is missing",
        detail: `Rule ${rule.id} points to a destination field that is not part of the destination profile.`,
        ruleId: rule.id,
      });
      continue;
    }

    // A rule satisfies "has input" if it has any of:
    //  - a source field (direct mapping, function input, lookup input, join input)
    //  - a defaultValue (fixed-value mapping, including non-constant types where
    //    the user fell back to a literal)
    //  - a non-empty expression (function/lookup that derives the value standalone)
    // Only flag "Source field is missing" when none of these are present. Previously
    // a destination set to a fixed value was incorrectly flagged because the rule
    // type wasn't `constant`.
    const hasInput =
      Boolean(rule.sourceFieldId) ||
      Boolean(rule.defaultValue?.trim()) ||
      Boolean(rule.expression?.trim());
    if (rule.mappingType !== "constant" && !hasInput) {
      issues.push({
        id: `missing-source-${rule.id}`,
        severity: "error",
        title: "Source field is missing",
        detail: `${destination.name} needs a source field, an expression, or a fixed value.`,
        fieldId: destination.id,
        ruleId: rule.id,
      });
      continue;
    }

    if (rule.mappingType === "constant" && !rule.defaultValue) {
      issues.push({
        id: `missing-constant-${rule.id}`,
        severity: "error",
        title: "Constant value is blank",
        detail: `${destination.name} is configured as a constant mapping without a value.`,
        fieldId: destination.id,
        ruleId: rule.id,
      });
    }

    const source = rule.sourceFieldId ? sourceById.get(rule.sourceFieldId) : undefined;
    if (source) {
      const sourceType = normalizeType(source.dataType);
      const destinationType = normalizeType(destination.dataType);
      const allowed = compatibleTypes[destinationType] ?? [destinationType];
      if (!allowed.includes(sourceType) && rule.mappingType === "direct") {
        issues.push({
          id: `type-mismatch-${rule.id}`,
          severity: "warning",
          title: "Direct type mismatch",
          detail: `${source.name} is ${source.dataType}, while ${destination.name} expects ${destination.dataType}. Add an explicit transform.`,
          fieldId: destination.id,
          ruleId: rule.id,
        });
      }

      if (
        normalizeType(source.dataType) === "date" &&
        normalizeType(destination.dataType) === "date" &&
        source.format &&
        destination.format &&
        source.format !== destination.format &&
        rule.mappingType === "direct"
      ) {
        issues.push({
          id: `date-format-${rule.id}`,
          severity: "warning",
          title: "Date format differs",
          detail: `${source.name} uses ${source.format}; ${destination.name} expects ${destination.format}.`,
          fieldId: destination.id,
          ruleId: rule.id,
        });
      }
    }

    if ((rule.mappingType === "function" || rule.mappingType === "lookup") && !rule.comment) {
      issues.push({
        id: `missing-comment-${rule.id}`,
        severity: "warning",
        title: "Logic mapping needs a comment",
        detail: `${destination.name} uses ${rule.mappingType}; add an FMD-ready explanation.`,
        fieldId: destination.id,
        ruleId: rule.id,
      });
    }
  }

  for (const destination of destinationProfile.fields) {
    if (destination.required && !rulesByDestination.has(destination.id)) {
      issues.push({
        id: `unmapped-required-${destination.id}`,
        severity: "error",
        title: "Required destination is unmapped",
        detail: `${destination.name} is mandatory in ${destinationProfile.name}.`,
        fieldId: destination.id,
      });
    }
  }

  for (const [destinationFieldId, rules] of rulesByDestination) {
    if (rules.length > 1) {
      const destination = destinationById.get(destinationFieldId);
      issues.push({
        id: `duplicate-destination-${destinationFieldId}`,
        severity: "error",
        title: "Destination mapped more than once",
        detail: `${destination?.name ?? destinationFieldId} has ${rules.length} competing rules.`,
        fieldId: destinationFieldId,
      });
    }
  }

  if (issues.length === 0) {
    issues.push({
      id: "quality-clean",
      severity: "info",
      title: "No blocking mapping issues",
      detail: "Required fields, duplicate destinations, data types, and logic comments are complete.",
    });
  }

  return issues;
}

export function qualityScore(issues: MappingIssue[]) {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return Math.max(0, 100 - errors * 25 - warnings * 8);
}
