"use client";

import { useState } from "react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { integrationOverviewDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof integrationOverviewDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

const fieldEntries: Array<{ key: Exclude<keyof Data, "narrative" | "linkedProcessFlowId">; label: string }> = [
  { key: "direction", label: "Direction" },
  { key: "sourceSystem", label: "Source System" },
  { key: "destinationSystem", label: "Destination System" },
  { key: "schedule", label: "Schedule" },
  { key: "frequency", label: "Frequency" },
  { key: "triggerType", label: "Trigger Type" },
  { key: "dataVolume", label: "Data Volume" },
  { key: "sla", label: "SLA" },
  { key: "latency", label: "Latency" },
];

export function OverviewEditor({ section, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(integrationOverviewDataSchema.parse(wrapper.data ?? {}));

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updateField = (key: keyof Data, value: string) => {
    setData({ ...data, [key]: value });
  };

  return (
    <div className="space-y-4">
      {/* Narrative */}
      <div>
        <label className="text-xs font-semibold uppercase text-[#66706a]">Narrative</label>
        <textarea
          className="mt-1 h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 py-2 text-sm outline-none focus:border-[#298b68] min-h-[100px] resize-y"
          value={data.narrative ?? ""}
          onChange={(e) => updateField("narrative", e.target.value)}
        />
      </div>

      {/* Field grid */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        {fieldEntries.map(({ key, label }) => (
          <div key={key}>
            <label className="text-xs font-semibold uppercase text-[#66706a]">{label}</label>
            <input
              className="mt-1 h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
              value={(data[key] as string) ?? ""}
              onChange={(e) => updateField(key, e.target.value)}
            />
          </div>
        ))}
      </div>

      {/* linkedProcessFlowId */}
      {data.linkedProcessFlowId ? (
        <div>
          <label className="text-xs font-semibold uppercase text-[#66706a]">
            Linked Process Flow
            <span className="ml-1.5 inline-flex items-center rounded-md bg-[#eef1ee] px-1.5 py-0.5 text-[10px] font-medium text-[#4a524d]">
              auto
            </span>
          </label>
          <div className="mt-1 inline-flex items-center gap-2 rounded-md border border-[#cfd6cf] bg-[#f5f7f5] px-3 py-2 text-xs text-[#66706a]">
            <span>{data.linkedProcessFlowId}</span>
          </div>
        </div>
      ) : null}

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
