"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { SectionEditorProps } from "@/lib/fmd-editor-registry";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { getAllSectionTypes } from "@/lib/fmd-section-registry";
import type { FmdSectionType } from "@/lib/fmd-section-schemas";
import { createDefaultFmdSection } from "@/lib/fmd-section-helpers";

export function LegacyEditor({ section, project, onSave, saving }: SectionEditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [title, setTitle] = useState(section.title);
  const [convertTarget, setConvertTarget] = useState<FmdSectionType | "">("");

  const convertibleTypes = getAllSectionTypes().filter((meta) => meta.sectionType !== "legacy");

  const handleSave = () => {
    onSave(section.content as Record<string, unknown>, { title });
  };

  const handleConvert = async () => {
    if (!convertTarget) return;
    const defaults = createDefaultFmdSection(project, convertTarget, {
      overrideTitle: title || section.title,
      sourceMode: "imported",
    });
    await onSave(defaults.content as Record<string, unknown>, {
      title: title || section.title,
      sectionType: convertTarget,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-[#f3c5c5] bg-[#fff8e8] p-3 text-xs leading-5 text-[#7a5211]">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          This section was imported from a workbook and doesn&apos;t match a known section type.
        </span>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-[#66706a]">Title</label>
        <input
          className="mt-1 h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-[#66706a]">Raw Content</label>
        <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-3 text-xs leading-5 text-[#66706a]">
          {JSON.stringify(wrapper.data, null, 2)}
        </pre>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <select
            value={convertTarget}
            onChange={(e) => setConvertTarget(e.target.value as FmdSectionType | "")}
            className="h-9 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
          >
            <option value="">Convert to...</option>
            {convertibleTypes.map((meta) => (
              <option key={meta.sectionType} value={meta.sectionType}>
                {meta.displayLabel}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleConvert}
            disabled={!convertTarget || saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68] disabled:cursor-not-allowed disabled:opacity-55"
          >
            Convert
          </button>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving\u2026" : "Save"}
        </button>
      </div>
    </div>
  );
}
