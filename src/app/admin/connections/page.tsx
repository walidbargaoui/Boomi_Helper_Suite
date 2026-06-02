import { listProjectSummaries } from "@/lib/db";
import { AdminConnectionsShell } from "@/components/admin-connections-shell";

export const dynamic = "force-dynamic";

export default async function AdminConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const projects = await listProjectSummaries();
  const params = await searchParams;
  const tab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  return <AdminConnectionsShell projects={projects} initialTab={tab === "llm" ? "llm" : "boomi"} />;
}
