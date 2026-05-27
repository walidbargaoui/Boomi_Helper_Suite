"use client";

import { useState } from "react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { errorHandlingDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof errorHandlingDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

const fieldEntries: Array<{ key: keyof Data; label: string }> = [
  { key: "retryPolicy", label: "Retry Policy" },
  { key: "failureRouting", label: "Failure Routing" },
  { key: "notifications", label: "Notifications" },
  { key: "loggingAudit", label: "Logging / Audit" },
  { key: "duplicateHandling", label: "Duplicate Handling" },
  { key: "validationFailureBehavior", label: "Validation Failure Behavior" },
  { key: "partialFailureRules", label: "Partial Failure Rules" },
  { key: "operationalOwner", label: "Operational Owner" },
];

export function ErrorHandlingEditor({ section, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(errorHandlingDataSchema.parse(wrapper.data ?? {}));

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updateField = (key: keyof Data, value: string) => {
    setData({ ...data, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        {fieldEntries.map(({ key, label }) => (
          <div key={key}>
            <label className="text-xs font-semibold uppercase text-[#66706a]">{label}</label>
            <textarea
              className="mt-1 h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 py-2 text-sm outline-none focus:border-[#298b68] min-h-[72px] resize-y"
              value={(data[key] as string) ?? ""}
              onChange={(e) => updateField(key, e.target.value)}
            />
          </div>
        ))}
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
