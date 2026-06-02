"use client";

import { useState } from "react";
import { Cpu, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { BoomiConnectionsAdmin } from "@/components/boomi-connections-admin";
import { LlmProvidersAdmin } from "@/components/llm-providers-admin";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import type { ProjectSummary } from "@/lib/db";

type AdminConnectionTab = "boomi" | "llm";

export function AdminConnectionsShell({
  projects,
  initialTab = "boomi",
}: {
  projects: ProjectSummary[];
  initialTab?: AdminConnectionTab;
}) {
  const [activeTab, setActiveTab] = useState<AdminConnectionTab>(initialTab);

  function switchTab(tab: AdminConnectionTab) {
    setActiveTab(tab);
    const url = tab === "llm" ? "/admin/connections?tab=llm" : "/admin/connections";
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="relative min-h-screen bg-[#f5f6f4] flex">
      <WorkspaceSidebar
        projects={projects}
        activeProject={null}
        activePage="connections"
        onSwitchProject={() => {}}
        onShowProjectDialog={() => {}}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-[#d9ded8] bg-white px-6 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-lg font-semibold">Connection Management</h1>
            </div>
            <p className="mt-1 text-xs text-[#66706a]">Manage global Boomi and LLM connections across all projects</p>
          </div>
        </header>
        <nav className="flex items-center gap-1 border-b border-[#d9ded8] bg-white px-6">
          <button
            type="button"
            onClick={() => switchTab("boomi")}
            className={clsx(
              "flex cursor-pointer items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition",
              activeTab === "boomi"
                ? "border-[#3fb58b] text-[#1b5e4a]"
                : "border-transparent text-[#66706a] hover:text-[#111714]",
            )}
          >
            <ShieldCheck size={15} />
            Boomi Connections
          </button>
          <button
            type="button"
            onClick={() => switchTab("llm")}
            className={clsx(
              "flex cursor-pointer items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition",
              activeTab === "llm"
                ? "border-[#3fb58b] text-[#1b5e4a]"
                : "border-transparent text-[#66706a] hover:text-[#111714]",
            )}
          >
            <Cpu size={15} />
            LLM Providers
          </button>
        </nav>
        <div className="flex-1 p-6">
          {activeTab === "boomi" ? <BoomiConnectionsAdmin /> : <LlmProvidersAdmin />}
        </div>
      </main>
    </div>
  );
}
