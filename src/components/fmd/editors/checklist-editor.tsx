"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent, deriveSectionData } from "@/lib/fmd-section-helpers";
import { qualityChecklistDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof qualityChecklistDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

const statusOptions = ["open", "in-progress", "done", "na"];

export function ChecklistEditor({ section, project, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(
    () => {
      const parsed = wrapper.data as Data;
      return parsed?.items?.length
        ? parsed
        : (deriveSectionData(project, "qualityChecklist") as Data);
    },
  );

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updateItem = (index: number, field: string, value: unknown) => {
    const updated = [...data.items];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, items: updated });
  };

  const addItem = () => {
    setData({
      ...data,
      items: [...data.items, { check: "", owner: "", status: "open", comments: "" }],
    });
  };

  const removeItem = (index: number) => {
    setData({ ...data, items: data.items.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      {data.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          No checklist items
        </p>
      ) : (
        <div className="overflow-auto rounded-md border border-[#d9ded8]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#eef1ee] text-xs font-semibold uppercase text-[#66706a]">
              <tr>
                <th className="px-3 py-2">Check</th>
                <th className="px-3 py-2">Passed</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Comments</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3e7e2] bg-white">
              {data.items.map((item, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[140px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={item.check}
                      onChange={(e) => updateItem(i, "check", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-[#cfd6cf] text-[#1b5e4a] focus:ring-[#298b68]"
                      checked={item.passed ?? false}
                      onChange={(e) => updateItem(i, "passed", e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={item.owner ?? ""}
                      onChange={(e) => updateItem(i, "owner", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={item.status ?? "open"}
                      onChange={(e) => updateItem(i, "status", e.target.value)}
                    >
                      {statusOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={item.comments ?? ""}
                      onChange={(e) => updateItem(i, "comments", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                      aria-label="Remove item"
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
          onClick={addItem}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68]"
        >
          <Plus size={13} />
          Add item
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
