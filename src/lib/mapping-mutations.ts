import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

const mappingTypeSchema = z.enum(["direct", "constant", "lookup", "function", "join"]);

export const ruleCreateSchema = z.object({
  destinationFieldId: z.string().min(1),
  sourceFieldId: z.string().min(1).optional().nullable(),
  mappingType: mappingTypeSchema,
  expression: z.string().optional().nullable(),
  defaultValue: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  reviewed: z.boolean().optional(),
});

export const ruleUpdateSchema = ruleCreateSchema.partial();

export const profileUpdateSchema = z.object({
  format: z.string().min(1).optional(),
  type: z.enum(["Flat File", "JSON", "XML", "Database", "API"]).optional(),
  name: z.string().min(1).optional(),
  rootPath: z.string().optional().nullable(),
});

export type RuleCreateInput = z.infer<typeof ruleCreateSchema>;
export type RuleUpdateInput = z.infer<typeof ruleUpdateSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export function validateRuleSemantics(input: RuleCreateInput | RuleUpdateInput, existingComment?: string) {
  const errors: string[] = [];
  if (input.mappingType === "constant") {
    if (!input.defaultValue || !String(input.defaultValue).trim()) {
      errors.push("Constant mappings require a default value.");
    }
  } else if (input.mappingType) {
    const sourceMissing = input.sourceFieldId === null || input.sourceFieldId === "";
    if ("sourceFieldId" in input && sourceMissing) {
      errors.push(`${input.mappingType} mappings require a source field.`);
    }
  }
  const comment = input.comment ?? existingComment;
  if ((input.mappingType === "function" || input.mappingType === "lookup") && !comment?.trim()) {
    errors.push("Function/lookup mappings require a comment.");
  }
  return errors;
}

export async function createMappingRule(
  prisma: PrismaClient,
  mappingSetId: string,
  input: RuleCreateInput,
) {
  return prisma.mappingRule.create({
    data: {
      mappingSetId,
      destinationFieldId: input.destinationFieldId,
      sourceFieldId: input.mappingType === "constant" ? null : input.sourceFieldId ?? null,
      mappingType: input.mappingType,
      expression: input.expression ?? null,
      defaultValue: input.defaultValue ?? null,
      comment: input.comment ?? null,
    },
  });
}

export async function updateMappingRule(
  prisma: PrismaClient,
  ruleId: string,
  input: RuleUpdateInput,
) {
  const data: Record<string, unknown> = {};
  if (input.destinationFieldId !== undefined) data.destinationFieldId = input.destinationFieldId;
  if (input.mappingType !== undefined) {
    data.mappingType = input.mappingType;
    if (input.mappingType === "constant") data.sourceFieldId = null;
  }
  if (input.sourceFieldId !== undefined) {
    data.sourceFieldId = input.sourceFieldId === "" ? null : input.sourceFieldId;
  }
  if (input.expression !== undefined) data.expression = input.expression;
  if (input.defaultValue !== undefined) data.defaultValue = input.defaultValue;
  if (input.comment !== undefined) data.comment = input.comment;
  if (input.reviewed !== undefined) data.reviewed = input.reviewed;

  return prisma.mappingRule.update({
    where: { id: ruleId },
    data,
  });
}

export async function deleteMappingRule(prisma: PrismaClient, ruleId: string) {
  return prisma.mappingRule.delete({ where: { id: ruleId } });
}

export async function updateProfile(
  prisma: PrismaClient,
  profileId: string,
  input: ProfileUpdateInput,
) {
  return prisma.profile.update({
    where: { id: profileId },
    data: {
      ...(input.format !== undefined ? { format: input.format } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.rootPath !== undefined ? { rootPath: input.rootPath } : {}),
    },
  });
}
