"use client";

import { Braces, FileSpreadsheet, GitCompareArrows, PlayCircle, Plus, Workflow } from "lucide-react";
import type { ProjectSummary } from "@/lib/db";
import { ImportExcelButton } from "@/components/import-excel-button";

export function GlobalDashboard({ projects, onCreateProject }: { projects: ProjectSummary[]; onCreateProject: () => void }) {
  const totalProfiles = projects.length;
  const recentProjects = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);

  return (
    <div className="flex flex-col items-center px-6 py-12">
      <div className="w-full max-w-3xl">
        <div className="text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-[#3fb58b] text-white">
            <Workflow size={28} />
          </div>
          <h1 className="mt-4 text-xl font-bold text-[#1b1f23]">Boomi Helper Suite</h1>
          <p className="mt-2 text-sm text-[#66706a] max-w-md mx-auto">
            Design, document, validate, and publish Boomi integration assets. Select a project in the sidebar to get started.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-4 text-sm font-medium text-white hover:bg-[#164d3d]"
              onClick={onCreateProject}
              type="button"
            >
              <Plus size={14} />
              New project
            </button>
            <ImportExcelButton />
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Braces} label="Total Projects" value={totalProfiles} />
          <StatCard icon={FileSpreadsheet} label="FMDs Available" value="Import from Excel" variant />
          <StatCard icon={GitCompareArrows} label="Mapping Studio" value="Visual Editor" variant />
          <StatCard icon={PlayCircle} label="Boomi Sandbox" value="Publish Enabled" variant />
        </div>

        {recentProjects.length > 0 ? (
          <div className="mt-10">
            <h2 className="text-sm font-semibold text-[#1b1f23]">Recent Projects</h2>
            <div className="mt-3 space-y-2">
              {recentProjects.map((p) => (
                <a
                  key={p.id}
                  href={`/?project=${p.id}`}
                  className="flex items-center justify-between rounded-lg border border-[#d9ded8] bg-white px-4 py-3 hover:border-[#9fb7aa] transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-[#66706a]">{p.processId} · {p.status}</p>
                  </div>
                  <span className="text-xs text-[#9fb7aa]">{new Date(p.updatedAt).toLocaleDateString()}</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, variant }: { icon: typeof Braces; label: string; value: string | number; variant?: boolean }) {
  return (
    <div className="rounded-lg border border-[#d9ded8] bg-white p-4">
      <Icon size={20} className={variant ? "text-[#66706a]" : "text-[#3fb58b]"} />
      <p className="mt-3 text-xs text-[#66706a]">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-[#1b1f23]">{value}</p>
    </div>
  );
}
