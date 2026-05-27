"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { endpointDetailsDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof endpointDetailsDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

const columns: Array<{ key: string; label: string }> = [
  { key: "role", label: "Role" },
  { key: "name", label: "Name" },
  { key: "connectorType", label: "Connector Type" },
  { key: "profileType", label: "Profile Type" },
  { key: "format", label: "Format" },
  { key: "purpose", label: "Purpose" },
  { key: "authNotes", label: "Auth Notes" },
  { key: "environmentNotes", label: "Env Notes" },
];

export function EndpointTableEditor({ section, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(endpointDetailsDataSchema.parse(wrapper.data ?? {}));

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updateEndpoint = (index: number, field: string, value: string) => {
    const updated = [...data.endpoints];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, endpoints: updated });
  };

  const addEndpoint = () => {
    setData({
      ...data,
      endpoints: [
        ...data.endpoints,
        { role: "", name: "", connectorType: "", profileType: "", format: "" },
      ],
    });
  };

  const removeEndpoint = (index: number) => {
    setData({ ...data, endpoints: data.endpoints.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      {data.endpoints.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          No endpoints defined
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
              {data.endpoints.map((ep, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-1.5">
                      <input
                        className="h-8 w-full min-w-[80px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                        value={(ep as unknown as Record<string, string>)[col.key] ?? ""}
                        onChange={(e) => updateEndpoint(i, col.key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeEndpoint(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                      aria-label="Remove endpoint"
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
          onClick={addEndpoint}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68]"
        >
          <Plus size={13} />
          Add endpoint
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
