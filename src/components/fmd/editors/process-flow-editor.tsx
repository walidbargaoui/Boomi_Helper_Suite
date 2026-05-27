"use client";

import { useState } from "react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { processFlowDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof processFlowDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

const readCols: Array<{ key: string; label: string }> = [
  { key: "stepNumber", label: "Step" },
  { key: "shapeType", label: "Shape Type" },
  { key: "label", label: "Label" },
];

const editCols: Array<{ key: string; label: string }> = [
  { key: "description", label: "Description" },
  { key: "narrative", label: "Narrative" },
  { key: "businessBehavior", label: "Business Behavior" },
  { key: "errorBehavior", label: "Error Behavior" },
  { key: "operationNotes", label: "Operation Notes" },
];

export function ProcessFlowEditor({ section, project, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(processFlowDataSchema.parse(wrapper.data ?? {}));
  const [manualNarrative, setManualNarrative] = useState("");

  const handleSave = () => {
    if (project.processFlows.length === 0) {
      onSave({
        ...section.content,
        data: { ...data, narrative: manualNarrative },
      } as Record<string, unknown>);
    } else {
      onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
    }
  };

  const updateStep = (index: number, field: string, value: string) => {
    const updated = [...data.steps];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, steps: updated });
  };

  if (project.processFlows.length === 0) {
    return (
      <div className="space-y-4">
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          No process flows in this project
        </p>

        <div>
          <label className="text-xs font-semibold uppercase text-[#66706a]">
            Manual Narration
          </label>
          <textarea
            className="mt-1 min-h-[120px] w-full resize-y rounded-md border border-[#cfd6cf] bg-white px-3 py-2 text-sm outline-none focus:border-[#298b68]"
            value={manualNarrative}
            onChange={(e) => setManualNarrative(e.target.value)}
          />
        </div>

        <div className="flex justify-end border-t border-[#d9ded8] pt-4">
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

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold uppercase text-[#66706a]">
          Linked Process Flow
          <span className="ml-1.5 inline-flex items-center rounded-md bg-[#eef1ee] px-1.5 py-0.5 text-[10px] font-medium text-[#4a524d]">
            auto
          </span>
        </label>
        <div className="mt-1 inline-flex items-center gap-2 rounded-md border border-[#cfd6cf] bg-[#f5f7f5] px-3 py-2 text-xs text-[#66706a]">
          <span>{data.linkedProcessFlowId || project.processFlows[0]?.id}</span>
        </div>
      </div>

      <div className="overflow-auto rounded-md border border-[#d9ded8]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#eef1ee] text-xs font-semibold uppercase text-[#66706a]">
            <tr>
              {readCols.map((col) => (
                <th key={col.key} className="whitespace-nowrap px-3 py-2">
                  {col.label}
                </th>
              ))}
              {editCols.map((col) => (
                <th key={col.key} className="whitespace-nowrap px-3 py-2">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e3e7e2] bg-white">
            {data.steps.map((step, i) => (
              <tr key={i}>
                {readCols.map((col) => (
                  <td key={col.key} className="px-3 py-1.5">
                    <div className="h-8 w-full rounded-md border border-[#d9ded8] bg-[#f5f7f5] px-2 text-xs leading-8 text-[#66706a]">
                      {String((step as Record<string, unknown>)[col.key] ?? "")}
                    </div>
                  </td>
                ))}
                {editCols.map((col) => (
                  <td key={col.key} className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={((step as unknown) as Record<string, string>)[col.key] ?? ""}
                      onChange={(e) => updateStep(i, col.key, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end border-t border-[#d9ded8] pt-4">
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
