import { NextRequest, NextResponse } from "next/server";
import { computeXmlDiff, findProfileTemplateDraft, findTemplateDraft, validateComponentXml } from "@/lib/boomi-sandbox";
import { buildProposedXml } from "@/lib/boomi-xml";
import { getWorkspaceProject, updateWorkspaceProject, sanitizeProjectForClient } from "@/lib/db";
import type { BoomiComponentDraft } from "@/lib/domain";
import { randomUUID } from "crypto";

/**
 * Auto-resolve a Database connector-settings componentId for SqlLookup function steps.
 *
 * Strategy: scan imported drafts for a `connector-settings` whose templateXml mentions
 * a database connector type. Prefer entries whose name/XML contains explicit DB hints.
 * Returns the Boomi componentId from the template envelope (not the local draft id) so
 * SqlLookup's `connection=` attribute lands as a real Boomi UUID. Returns undefined
 * when no candidate exists — the generator falls back to `connection=""` in that case.
 */
function findDatabaseConnectorComponentId(drafts: BoomiComponentDraft[]): string | undefined {
  const candidates = drafts.filter(
    (d) => d.componentType === "connector-settings" && d.templateXml?.trim(),
  );
  if (candidates.length === 0) return undefined;

  const dbHint = /database|jdbc|sql|oracle|postgres|mysql|mssql|db2|redshift|snowflake|sqlserver/i;
  const ranked = [...candidates].sort((a, b) => {
    const aScore = (dbHint.test(a.componentName) ? 2 : 0) + (dbHint.test(a.templateXml ?? "") ? 1 : 0);
    const bScore = (dbHint.test(b.componentName) ? 2 : 0) + (dbHint.test(b.templateXml ?? "") ? 1 : 0);
    return bScore - aScore;
  });
  const best = ranked[0];
  if (!best.templateXml) return undefined;

  // Extract the real Boomi componentId from the envelope. Fall back to the local
  // draft id only if the XML doesn't carry one (shouldn't happen for imported templates).
  const idMatch = best.templateXml.match(/componentId="([^"]+)"/);
  return idMatch?.[1] || best.componentId;
}


export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const project = await getWorkspaceProject(typeof body.projectId === "string" ? body.projectId : undefined);

    if (project.profiles.length === 0 && project.mappingSets.length === 0) {
      return NextResponse.json(
        {
          error: "Nothing to dry-run.",
          detail: "Add at least one profile or mapping set before running dry-run.",
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    // Key existing drafts by the stable componentId so type/name changes update
    // the same draft entry instead of creating a duplicate.
    const existingById = new Map<string, BoomiComponentDraft>();
    for (const draft of project.boomiDrafts) {
      existingById.set(draft.componentId, draft);
    }

    const generatedDrafts: BoomiComponentDraft[] = [];
    const warnings: string[] = [];

    for (const mappingSet of project.mappingSets) {
      const sourceProfile = project.profiles.find((p) => p.id === mappingSet.sourceProfileId);
      const destinationProfile = project.profiles.find((p) => p.id === mappingSet.destinationProfileId);
      if (!sourceProfile || !destinationProfile) {
        warnings.push(`Mapping set "${mappingSet.name}" is missing source or destination profile.`);
        continue;
      }
      const componentId = `draft-map-${mappingSet.id}`;
      const existing = existingById.get(componentId);
      const templateDraft = findTemplateDraft(project.boomiDrafts, componentId, "transform.map", mappingSet.name);
      const templateXml = existing?.templateXml?.trim() ? existing.templateXml : templateDraft?.templateXml ?? "";
      const srcProfileTemplate = findProfileTemplateDraft(project.boomiDrafts, sourceProfile);
      const dstProfileTemplate = findProfileTemplateDraft(project.boomiDrafts, destinationProfile);
      const lookupConnectionId = findDatabaseConnectorComponentId(project.boomiDrafts);
      const { xml: proposedXml, source, reconciledKeys } = buildProposedXml({
        kind: "transform.map",
        project,
        mappingSet,
        sourceProfile,
        destinationProfile,
        templateXml: templateXml || undefined,
        sourceProfileTemplateXml: srcProfileTemplate?.templateXml,
        destinationProfileTemplateXml: dstProfileTemplate?.templateXml,
        lookupConnectionId,
      });
      const validation = validateComponentXml(proposedXml);
      const diff = templateXml ? computeXmlDiff(templateXml, proposedXml) : `+ ${proposedXml}`;
      const sourceLabel = source === "template-patch" ? "Template-patched" : "Scaffold (no template)";
      const keyInfo = reconciledKeys ? " (reconciled profile keys)" : "";
      const nextStep = source === "template-patch"
        ? "Review proposed XML and publish safety before sandbox publish."
        : "Import a Boomi template to enable safe publish.";
      generatedDrafts.push({
        id: existing?.id ?? randomUUID(),
        componentId,
        componentName: mappingSet.name,
        componentType: "transform.map",
        templateXml,
        proposedXml,
        diff,
        validationStatus: validation.ok ? "Dry-run valid" : "Blocked",
        notes: validation.issues.length > 0
          ? validation.issues.join(" ")
          : `${sourceLabel}${keyInfo}. ${nextStep}`,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }

    for (const profile of project.profiles) {
      const componentId = `draft-profile-${profile.id}`;
      const existing = existingById.get(componentId);
      const templateDraft = findProfileTemplateDraft(project.boomiDrafts, profile);
      const templateXml = existing?.templateXml?.trim() ? existing.templateXml : templateDraft?.templateXml ?? "";
      const { xml, componentType, source } = buildProposedXml({
        kind: "profile",
        profile,
        templateXml: templateXml || undefined,
      });
      const validation = validateComponentXml(xml);
      const diff = templateXml ? computeXmlDiff(templateXml, xml) : `+ ${xml}`;
      const sourceLabel = source === "template-patch" ? "Template-patched" : "Scaffold (no template)";
      generatedDrafts.push({
        id: existing?.id ?? randomUUID(),
        componentId,
        componentName: profile.name,
        componentType,
        templateXml,
        proposedXml: xml,
        diff,
        validationStatus: validation.ok ? "Dry-run valid" : "Blocked",
        notes: validation.issues.length > 0
          ? validation.issues.join(" ")
          : `${sourceLabel} for ${profile.role} profile (${profile.type} / ${profile.format}).`,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }

    if (generatedDrafts.length === 0) {
      return NextResponse.json(
        {
          error: "Nothing to dry-run.",
          detail: warnings.length > 0
            ? warnings.join(" ")
            : "No profiles or mapping sets resolved into a draft.",
        },
        { status: 400 },
      );
    }

    const generatedIds = new Set(generatedDrafts.map((d) => d.componentId));
    const preservedExisting = project.boomiDrafts.filter((draft) => !generatedIds.has(draft.componentId));
    project.boomiDrafts = [...generatedDrafts, ...preservedExisting];

    await updateWorkspaceProject(project);
    const refreshed = await getWorkspaceProject(project.id);

    return NextResponse.json({
      mode: project.boomiConnections[0]?.mode ?? "mock",
      drafts: generatedDrafts,
      warnings,
      project: sanitizeProjectForClient(refreshed),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Dry-run failed.",
        detail: error instanceof Error ? error.message : "Unknown dry-run error.",
      },
      { status: 500 },
    );
  }
}
