"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { MoreHorizontal, Pencil, RotateCcw } from "lucide-react";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { projectSummaryDataSchema } from "@/lib/fmd-section-schemas";
type Data = z.infer<typeof projectSummaryDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
  onProjectFieldUpdate?: (field: string, value: string) => Promise<void>;
}

const projectStatusOptions: Project["status"][] = [
  "Draft",
  "Mapping Review",
  "Ready for Sandbox",
  "Published",
];

const linkedFields: Array<{ key: keyof Data; label: string; sourceKey: keyof Project }> = [
  { key: "linkedProcessId", label: "Process ID", sourceKey: "processId" },
  { key: "linkedProcessName", label: "Process Name", sourceKey: "name" },
  { key: "linkedSourceSystem", label: "Source System", sourceKey: "sourceSystem" },
  { key: "linkedDestinationSystem", label: "Destination System", sourceKey: "destinationSystem" },
  { key: "linkedOwner", label: "Owner", sourceKey: "owner" },
  { key: "linkedSchedule", label: "Schedule", sourceKey: "schedule" },
];

const editableFields: Array<{ key: keyof Data; label: string }> = [
  { key: "fmdTitle", label: "FMD Title" },
  { key: "documentVersion", label: "Document Version" },
  { key: "classification", label: "Classification" },
  { key: "customerOrTeam", label: "Customer / Team" },
  { key: "preparedBy", label: "Prepared By" },
  { key: "reviewedBy", label: "Reviewed By" },
  { key: "approvedBy", label: "Approved By" },
];

export function ProjectSummaryEditor({ section, project, onSave, saving, onProjectFieldUpdate }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(projectSummaryDataSchema.parse(wrapper.data ?? {}));
  const [overrides, setOverrides] = useState<Record<string, unknown>>(
    (wrapper.overrides as Record<string, unknown>) ?? {},
  );
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [editingField, setEditingField] = useState<{ key: keyof Data; isSaving: boolean } | null>(null);

  const handleSave = () => {
    onSave({ ...wrapper, overrides, data } as unknown as Record<string, unknown>);
  };

  const updateField = (key: keyof Data, value: string) => {
    setData({ ...data, [key]: value });
  };

  const handleEditSource = async (field: { key: keyof Data; sourceKey: keyof Project }) => {
    setEditingField({ key: field.key, isSaving: true });
    try {
      return await onProjectFieldUpdate?.(field.sourceKey as string, String(project[field.sourceKey] ?? ""));
    } catch (err) {
      console.error("Failed to edit project field:", err);
    } finally {
      setEditingField(null);
    }
  };


  const getSourceValue = (field: { key: keyof Data; sourceKey: keyof Project }): string => {
    const val = project[field.sourceKey];
    return typeof val === "string" ? val : "";
  };

  const isOverridden = (field: string) => field in overrides;

  const persistOverride = (
    nextOverrides: Record<string, unknown>,
    nextData: Data,
  ) => {
    setOverrides(nextOverrides);
    setData(nextData);
    onSave({
      ...wrapper,
      overrides: nextOverrides,
      data: nextData,
    } as unknown as Record<string, unknown>);
  };

  const handleOverride = (field: string, value: string) => {
    const nextOverrides = { ...overrides, [field]: value };
    const nextData = { ...data, [field]: value } as Data;
    persistOverride(nextOverrides, nextData);
  };

  const handleResetOverride = (field: string, sourceValue: string) => {
    const nextOverrides = { ...overrides };
    delete nextOverrides[field];
    const nextData = { ...data, [field]: sourceValue } as Data;
    persistOverride(nextOverrides, nextData);
  };

  const handleStartOverride = (field: { key: keyof Data; sourceKey: keyof Project }) => {
    const currentValue = (data[field.key] as string) ?? getSourceValue(field);
    handleOverride(field.key, currentValue);
    setOpenMenu(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        {editableFields.map(({ key, label }) => (
          <div key={key}>
            <label className="text-xs font-semibold uppercase text-[#66706a]">{label}</label>
            <input
              className="mt-1 h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
              value={(data[key] as string) ?? ""}
              onChange={(e) => updateField(key, e.target.value)}
            />
          </div>
        ))}

        {linkedFields.map((field) => {
          const overridden = isOverridden(field.key);
          const sourceValue = getSourceValue(field);
          const displayValue = overridden
            ? ((data[field.key] as string) ?? "")
            : sourceValue;

          return (
            <div key={field.key} className="relative">
              <label className="flex items-center text-xs font-semibold uppercase text-[#66706a]">
                {field.label}
                {overridden ? (
                  <span className="ml-1.5 inline-flex items-center rounded-md bg-[#fef3cd] px-1.5 py-0.5 text-[10px] font-medium text-[#856404]">
                    overridden
                  </span>
                ) : (
                  <span className="ml-1.5 inline-flex items-center rounded-md bg-[#d4edda] px-1.5 py-0.5 text-[10px] font-medium text-[#155724]">
                    from source
                  </span>
                )}
              </label>

              <div className="mt-1 flex items-center gap-1">
                {overridden ? (
                  <input
                    className="h-9 flex-1 rounded-md border border-[#e0a800] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                    value={displayValue}
                    onChange={(e) => handleOverride(field.key, e.target.value)}
                  />
                ) : (
                  <div className="flex h-9 flex-1 items-center rounded-md border border-[#d9ded8] bg-[#f5f7f5] px-3 text-sm text-[#66706a]">
                    {displayValue || "—"}
                  </div>
                )}

                <div className="relative" ref={openMenu === field.key ? menuRef : null}>
                  <button
                    type="button"
                    onClick={() => setOpenMenu(openMenu === field.key ? null : field.key)}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-[#cfd6cf] text-[#66706a] hover:bg-[#eef1ee]"
                    aria-label={`${field.label} actions`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>

                  {openMenu === field.key && (
                     <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-[#cfd6cf] bg-white py-1 shadow-lg">
                       <button
                         type="button"
                         onClick={editingField?.key === field.key ? undefined : () => handleEditSource(field)}
                         disabled={!!editingField?.isSaving}
                         className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#1b5e4a] hover:bg-[#eef1ee] disabled:opacity-50 disabled:cursor-wait"
                       >
                         <Pencil className="h-3.5 w-3.5" />
                         Edit source {editingField?.isSaving ? "(saving...)" : ""}
                       </button>
                      {!overridden && (
                        <button
                          type="button"
                          onClick={() => handleStartOverride(field)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#333] hover:bg-[#eef1ee]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Override in FMD
                        </button>
                      )}
                      {overridden && (
                        <button
                          type="button"
                          onClick={() => {
                            handleResetOverride(field.key, sourceValue);
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#333] hover:bg-[#eef1ee]"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reset override
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {overridden && (
                  <button
                    type="button"
                    onClick={() => handleResetOverride(field.key, sourceValue)}
                    className="flex h-9 items-center gap-1 rounded-md border border-[#cfd6cf] px-2 text-xs text-[#66706a] hover:bg-[#eef1ee]"
                    title="Reset to source value"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div>
          <label className="text-xs font-semibold uppercase text-[#66706a]">
            Status
            <span className="ml-1.5 inline-flex items-center rounded-md bg-[#eef1ee] px-1.5 py-0.5 text-[10px] font-medium text-[#4a524d]">
              auto
            </span>
          </label>
          <select
            className="mt-1 h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
            value={data.linkedStatus ?? project.status}
            onChange={(e) => updateField("linkedStatus", e.target.value)}
          >
            {projectStatusOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end">
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
