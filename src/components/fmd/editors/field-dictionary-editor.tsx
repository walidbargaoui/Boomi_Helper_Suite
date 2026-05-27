"use client";

import { useState } from "react";
import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { SectionEditorProps } from "@/lib/fmd-editor-registry";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { fieldDictionaryDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof fieldDictionaryDataSchema>;

const columns: Array<{ key: string; label: string }> = [
  { key: "parentPath", label: "Path" },
  { key: "name", label: "Name" },
  { key: "label", label: "Label" },
  { key: "description", label: "Description" },
  { key: "dataType", label: "Type" },
  { key: "length", label: "Length" },
  { key: "required", label: "Req" },
  { key: "key", label: "Key" },
  { key: "format", label: "Format" },
  { key: "sample", label: "Sample" },
  { key: "notes", label: "Notes" },
];

export function FieldDictionaryEditor({ section, project, onSave, saving }: SectionEditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(fieldDictionaryDataSchema.parse(wrapper.data ?? {}));

  const selectedProfileId = data.linkedProfileId;

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const selectProfile = (profileId: string) => {
    const savedWrapper = parseFmdSectionContent(section.content);
    const savedData = savedWrapper.data as { linkedProfileId?: string; fields?: unknown[] } | undefined;
    if (savedData?.linkedProfileId === profileId && savedData.fields && savedData.fields.length > 0) {
      setData(savedData as Data);
      return;
    }
    const profile = project.profiles.find((p) => p.id === profileId);
    setData({
      linkedProfileId: profileId,
      fields:
        profile?.fields.map((field) => ({
          parentPath: field.parentPath ?? "",
          name: field.name,
          label: field.label ?? "",
          description: field.description ?? "",
          dataType: field.dataType ?? "",
          length: field.length ?? "",
          required: field.required,
          key: field.keyField,
          format: field.format ?? "",
          sample: field.sample ?? "",
          notes: field.description ?? "",
          linkedFieldId: field.id,
        })) ?? [],
    });
  };

  const updateField = (index: number, field: string, value: string | boolean) => {
    const updated = [...data.fields];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, fields: updated });
  };

  const addField = () => {
    setData({
      ...data,
      fields: [...data.fields, { name: "" }],
    });
  };

  const removeField = (index: number) => {
    setData({ ...data, fields: data.fields.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold uppercase text-[#66706a]">Linked Profile</label>
        <select
          className="h-9 w-full max-w-xs rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
          value={selectedProfileId ?? ""}
          onChange={(e) => selectProfile(e.target.value)}
        >
          <option value="">-- Select a profile --</option>
          {project.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.role})
            </option>
          ))}
        </select>
      </div>

      {!selectedProfileId ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          Select a linked profile to view its field dictionary
        </p>
      ) : data.fields.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          No fields defined for this profile
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
              {data.fields.map((field, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-1.5">
                      {col.key === "required" || col.key === "key" ? (
                        <input
                          type="checkbox"
                          className="rounded border-[#cfd6cf]"
                          checked={(field as unknown as Record<string, boolean>)[col.key] ?? false}
                          onChange={(e) => updateField(i, col.key, e.target.checked)}
                        />
                      ) : (
                        <input
                          className="h-8 w-full min-w-[72px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                          value={(field as unknown as Record<string, string>)[col.key] ?? ""}
                          onChange={(e) => updateField(i, col.key, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeField(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                      aria-label="Remove field"
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
          onClick={addField}
          disabled={!selectedProfileId}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={13} />
          Add field
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
