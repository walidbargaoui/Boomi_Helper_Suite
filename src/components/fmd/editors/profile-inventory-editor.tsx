"use client";

import { useState } from "react";
import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { SectionEditorProps } from "@/lib/fmd-editor-registry";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { profileInventoryDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof profileInventoryDataSchema>;

const columns: Array<{ key: string; label: string }> = [
  { key: "role", label: "Role" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "format", label: "Format" },
  { key: "rootPath", label: "Root Path" },
  { key: "fieldCount", label: "Fields" },
  { key: "keyFields", label: "Key Fields" },
  { key: "requiredCount", label: "Required" },
  { key: "notes", label: "Notes" },
];

export function ProfileInventoryEditor({ section, onSave, saving }: SectionEditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(profileInventoryDataSchema.parse(wrapper.data ?? {}));

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updateProfile = (index: number, field: string, value: string | boolean) => {
    const updated = [...data.profiles];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, profiles: updated });
  };

  const addProfile = () => {
    setData({
      ...data,
      profiles: [
        ...data.profiles,
        { role: "", name: "", type: "", format: "", rootPath: "", notes: "", keyFields: [], includeFieldDictionary: false },
      ],
    });
  };

  const removeProfile = (index: number) => {
    setData({ ...data, profiles: data.profiles.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      {data.profiles.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          No profiles defined
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
                <th className="whitespace-nowrap px-3 py-2">Include Dict</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3e7e2] bg-white">
              {data.profiles.map((profile, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-1.5">
                      {col.key === "keyFields" || col.key === "fieldCount" || col.key === "requiredCount" ? (
                        <span className="block px-2 py-1 text-xs text-[#4a524d]">
                          {String((profile as Record<string, unknown>)[col.key] ?? "")}
                        </span>
                      ) : (
                        <input
                          className="h-8 w-full min-w-[80px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                          value={(profile as unknown as Record<string, string>)[col.key] ?? ""}
                          onChange={(e) => updateProfile(i, col.key, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      className="rounded border-[#cfd6cf]"
                      checked={profile.includeFieldDictionary}
                      onChange={(e) => updateProfile(i, "includeFieldDictionary", e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeProfile(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                      aria-label="Remove profile"
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
          onClick={addProfile}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68]"
        >
          <Plus size={13} />
          Add profile
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={clsx(
            "inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d]",
            saving && "cursor-not-allowed opacity-60",
          )}
        >
          {saving ? "Saving\u2026" : "Save"}
        </button>
      </div>
    </div>
  );
}
