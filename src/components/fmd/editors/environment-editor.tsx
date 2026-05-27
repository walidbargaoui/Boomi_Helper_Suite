"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { environmentConfigDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof environmentConfigDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

const defaultEnvironments = ["DEV", "QAS", "UAT", "PROD"];

const columns: Array<{ key: string; label: string }> = [
  { key: "environment", label: "Environment" },
  { key: "boomiAccount", label: "Boomi Account" },
  { key: "boomiEnvironment", label: "Boomi Environment" },
  { key: "endpointBaseUrl", label: "Endpoint URL" },
  { key: "authMode", label: "Auth Mode" },
  { key: "notes", label: "Notes" },
];

function ensureEnvironments(envs: Data["environments"]): Data["environments"] {
  if (envs.length > 0) return envs;
  return defaultEnvironments.map((env) => ({
    environment: env,
    boomiAccount: "",
    boomiEnvironment: "",
    endpointBaseUrl: "",
    authMode: "",
    notes: "",
  }));
}

export function EnvironmentEditor({ section, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(() => ({
    environments: ensureEnvironments((wrapper.data as Data)?.environments ?? []),
  }));

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updateEnv = (index: number, field: string, value: string) => {
    const updated = [...data.environments];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, environments: updated });
  };

  const addEnv = () => {
    const nextName = `ENV-${data.environments.length + 1}`;
    setData({
      ...data,
      environments: [
        ...data.environments,
        { environment: nextName, boomiAccount: "", boomiEnvironment: "", endpointBaseUrl: "", authMode: "", notes: "" },
      ],
    });
  };

  const removeEnv = (index: number) => {
    setData({ ...data, environments: data.environments.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      {data.environments.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          No environments configured
        </p>
      ) : (
        <div className="overflow-auto rounded-md border border-[#d9ded8]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#eef1ee] text-xs font-semibold uppercase text-[#66706a]">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className="whitespace-nowrap px-3 py-2">
                    {col.label}
                  </th>
                ))}
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3e7e2] bg-white">
              {data.environments.map((env, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-1.5">
                      {col.key === "environment" ? (
                        <select
                          className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                          value={env.environment}
                          onChange={(e) => updateEnv(i, "environment", e.target.value)}
                        >
                          {[...defaultEnvironments, ...(defaultEnvironments.includes(env.environment) ? [] : [env.environment])].map(
                            (opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ),
                          )}
                        </select>
                      ) : (
                        <input
                          className="h-8 w-full min-w-[80px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                          value={(env as unknown as Record<string, string>)[col.key] ?? ""}
                          onChange={(e) => updateEnv(i, col.key, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeEnv(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                      aria-label="Remove environment"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addEnv}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68]"
        >
          <Plus size={13} />
          Add row
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
