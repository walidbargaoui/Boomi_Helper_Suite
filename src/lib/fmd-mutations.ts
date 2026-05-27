import { prisma } from "@/lib/db";
import type { FmdSection } from "@/lib/domain";

function toDomain(row: {
  id: string;
  title: string;
  sectionType: string;
  contentJson: string;
  sortOrder: number;
}): FmdSection {
  return {
    id: row.id,
    title: row.title,
    sectionType: row.sectionType,
    content: JSON.parse(row.contentJson) as Record<string, unknown>,
    sortOrder: row.sortOrder,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getProjectFmdSections(projectId: string): Promise<FmdSection[]> {
  const rows = await prisma.fmdSection.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toDomain);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createFmdSection(
  projectId: string,
  data: {
    title: string;
    sectionType: string;
    sortOrder: number;
    content: Record<string, unknown>;
  },
): Promise<FmdSection> {
  const row = await prisma.fmdSection.create({
    data: {
      projectId,
      title: data.title,
      sectionType: data.sectionType,
      contentJson: JSON.stringify(data.content),
      sortOrder: data.sortOrder,
    },
  });
  return toDomain(row);
}

export async function updateFmdSection(
  projectId: string,
  sectionId: string,
  data: Partial<{
    title: string;
    sectionType: string;
    sortOrder: number;
    content: Record<string, unknown>;
  }>,
): Promise<FmdSection | null> {
  const existing = await prisma.fmdSection.findUnique({
    where: { id: sectionId },
  });
  if (!existing || existing.projectId !== projectId) {
    return null;
  }

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.sectionType !== undefined) updateData.sectionType = data.sectionType;
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
  if (data.content !== undefined) updateData.contentJson = JSON.stringify(data.content);

  const row = await prisma.fmdSection.update({
    where: { id: sectionId },
    data: updateData,
  });
  return toDomain(row);
}

export async function deleteFmdSection(projectId: string, sectionId: string): Promise<boolean> {
  const existing = await prisma.fmdSection.findUnique({
    where: { id: sectionId },
  });
  if (!existing || existing.projectId !== projectId) {
    return false;
  }
  await prisma.fmdSection.delete({ where: { id: sectionId } });
  return true;
}

export async function reorderFmdSections(projectId: string, orderedIds: string[]): Promise<void> {
  const sections = await prisma.fmdSection.findMany({
    where: { projectId },
    select: { id: true },
  });
  const validIds = new Set(sections.map((s) => s.id));

  const updates = orderedIds
    .filter((id) => validIds.has(id))
    .map((id, index) =>
      prisma.fmdSection.update({
        where: { id },
        data: { sortOrder: index },
      }),
    );

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
}

export async function markSectionsStale(projectId: string): Promise<number> {
  const sections = await prisma.fmdSection.findMany({
    where: { projectId },
    select: { id: true, contentJson: true },
  });

  let updated = 0;
  for (const section of sections) {
    try {
      const content = JSON.parse(section.contentJson) as Record<string, unknown>;
      const staleState = (content.staleState as Record<string, unknown>) ?? {};
      if (staleState.isStale) continue;
      content.staleState = {
        ...staleState,
        isStale: true,
        lastSyncedAt: staleState.lastSyncedAt ?? new Date().toISOString(),
      };
      await prisma.fmdSection.update({
        where: { id: section.id },
        data: { contentJson: JSON.stringify(content) },
      });
      updated += 1;
    } catch {
      // skip malformed content
    }
  }
  return updated;
}
