"use client";

import { useState, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { boomiComponentsDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof boomiComponentsDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

type ComponentItem = Data["components"][number];

export function BoomiComponentsEditor({ section, project, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(boomiComponentsDataSchema.parse(wrapper.data ?? {}));

  const draftIds = useMemo(
    () => new Set(project.boomiDrafts.map((d) => d.componentId)),
    [project.boomiDrafts],
  );

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updateComponent = (index: number, field: string, value: unknown) => {
    const updated = [...data.components];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, components: updated });
  };

  const addComponent = () => {
    setData({
      ...data,
      components: [
        ...data.components,
        {
          name: "",
          componentType: "",
          componentId: "",
          templateImported: false,
          validationStatus: "",
          dependencies: [],
          publishReadiness: "",
          notes: "",
        },
      ],
    });
  };

  const removeComponent = (index: number) => {
    setData({ ...data, components: data.components.filter((_, i) => i !== index) });
  };

  const isDerived = (comp: ComponentItem) =>
    Boolean(comp.componentId && draftIds.has(comp.componentId));

  return (
    <div className="space-y-4">
      {data.components.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          No Boomi components
        </p>
      ) : (
        <div className="overflow-auto rounded-md border border-[#d9ded8]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#eef1ee] text-xs font-semibold uppercase text-[#66706a]">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Component ID</th>
                <th className="px-3 py-2">Imported</th>
                <th className="px-3 py-2">Validation Status</th>
                <th className="px-3 py-2">Dependencies</th>
                <th className="px-3 py-2">Publish Readiness</th>
                <th className="px-3 py-2">Notes</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3e7e2] bg-white">
              {data.components.map((comp, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68] disabled:cursor-not-allowed disabled:opacity-50"
                      value={comp.name}
                      onChange={(e) => updateComponent(i, "name", e.target.value)}
                      readOnly={isDerived(comp)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68] disabled:cursor-not-allowed disabled:opacity-50"
                      value={comp.componentType}
                      onChange={(e) => updateComponent(i, "componentType", e.target.value)}
                      readOnly={isDerived(comp)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68] disabled:cursor-not-allowed disabled:opacity-50"
                      value={comp.componentId ?? ""}
                      onChange={(e) => updateComponent(i, "componentId", e.target.value)}
                      readOnly={isDerived(comp)}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-[#cfd6cf] text-[#1b5e4a] focus:ring-[#298b68]"
                      checked={comp.templateImported ?? false}
                      onChange={(e) => updateComponent(i, "templateImported", e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={comp.validationStatus ?? ""}
                      onChange={(e) => updateComponent(i, "validationStatus", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={(comp.dependencies ?? []).join(", ")}
                      onChange={(e) =>
                        updateComponent(
                          i,
                          "dependencies",
                          e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={comp.publishReadiness ?? ""}
                      onChange={(e) => updateComponent(i, "publishReadiness", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={comp.notes ?? ""}
                      onChange={(e) => updateComponent(i, "notes", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeComponent(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                      aria-label="Remove component"
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
          onClick={addComponent}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68]"
        >
          <Plus size={13} />
          Add component
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
