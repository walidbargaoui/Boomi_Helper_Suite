import type { Project } from "@/lib/domain";
import type { FmdImportDraft } from "@/lib/fmd-import";

export interface SectionDiff {
  sectionType: string;
  title: string;
  currentData: unknown | null;
  importedData: unknown;
  changed: boolean;
  summary: string;
}

export function computeImportDiffs(
  project: Project,
  draft: FmdImportDraft,
): SectionDiff[] {
  const diffs: SectionDiff[] = [];

  for (const draftSection of draft.fmdSections) {
    const projectSection = project.fmdSections.find(
      (s) => s.sectionType === draftSection.sectionType,
    );

    const currentData = projectSection?.content ?? null;
    const importedData = draftSection.content;

    let changed: boolean;
    let summary: string;

    if (!projectSection) {
      changed = true;
      summary = `New section: ${draftSection.title}`;
    } else {
      const currentJson = JSON.stringify(currentData);
      const importedJson = JSON.stringify(importedData);
      changed = currentJson !== importedJson;

      if (changed) {
        summary = `Updated: ${draftSection.title} — content differs from current project`;
      } else {
        summary = `No changes to: ${draftSection.title}`;
      }
    }

    diffs.push({
      sectionType: draftSection.sectionType,
      title: draftSection.title,
      currentData,
      importedData,
      changed,
      summary,
    });
  }

  return diffs;
}
