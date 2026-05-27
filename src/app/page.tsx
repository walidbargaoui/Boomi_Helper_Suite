import { WorkspaceApp } from "@/components/workspace-app";
import { getWorkspaceProject, listProjectSummaries, sanitizeProjectForClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: projectId } = await searchParams;
  const [projects, rawProject] = await Promise.all([
    listProjectSummaries(),
    projectId ? getWorkspaceProject(projectId) : null,
  ]);
  // Strip encrypted credentials before the project object crosses the server/client
  // boundary — see sanitizeProjectForClient() in src/lib/db.ts.
  const project = rawProject ? sanitizeProjectForClient(rawProject) : null;
  return <WorkspaceApp key={project?.id ?? "home"} initialProject={project} initialProjects={projects} />;
}
