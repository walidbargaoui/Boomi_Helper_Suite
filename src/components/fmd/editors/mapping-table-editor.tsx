"use client";

import { useState, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, ArrowRight } from "lucide-react";
import { z } from "zod";
import type { SectionEditorProps } from "@/lib/fmd-editor-registry";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { fieldMappingDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof fieldMappingDataSchema>;

const columns: Array<{ key: string; label: string }> = [
  { key: "destinationField", label: "Dest Field" },
  { key: "destinationRequired", label: "Required" },
  { key: "destinationType", label: "Dest Type" },
  { key: "sourceField", label: "Source Field" },
  { key: "sourceType", label: "Source Type" },
  { key: "mappingType", label: "Mapping Type" },
  { key: "expression", label: "Expression" },
  { key: "defaultValue", label: "Default" },
  { key: "businessRule", label: "Biz Rule" },
  { key: "transformationNotes", label: "Notes" },
  { key: "reviewed", label: "Reviewed" },
];

export function MappingTableEditor({ section, project }: SectionEditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(fieldMappingDataSchema.parse(wrapper.data ?? {}));
  const [filter, setFilter] = useState("");

  const selectedMappingSetId = data.linkedMappingSetId;

  const selectMappingSet = (mappingSetId: string) => {
    const ms = project.mappingSets.find((m) => m.id === mappingSetId);
    const sourceProfile = project.profiles.find((p) => p.id === ms?.sourceProfileId);
    const destProfile = project.profiles.find((p) => p.id === ms?.destinationProfileId);
    const sourceFields = new Map(sourceProfile?.fields.map((f) => [f.id, f]) ?? []);
    const destFields = new Map(destProfile?.fields.map((f) => [f.id, f]) ?? []);
    setData({
      linkedMappingSetId: mappingSetId,
      rules:
        ms?.rules.map((rule) => {
          const srcField = rule.sourceFieldId ? sourceFields.get(rule.sourceFieldId) : undefined;
          const dstField = destFields.get(rule.destinationFieldId);
          return {
            destinationPath: dstField?.parentPath ?? "",
            destinationField: dstField?.name ?? "",
            destinationRequired: dstField?.required ?? false,
            destinationType: dstField?.dataType ?? "",
            sourcePath: srcField?.parentPath ?? "",
            sourceField: srcField?.name ?? "",
            sourceType: srcField?.dataType ?? "",
            mappingType: rule.mappingType,
            expression: rule.expression ?? "",
            defaultValue: rule.defaultValue ?? "",
            transformationNotes: rule.comment ?? "",
            businessRule: "",
            reviewed: rule.reviewed ?? false,
            qualityStatus: rule.qualityStatus ?? "",
            linkedRuleId: rule.id,
          };
        }) ?? [],
    });
  };

  const parentRef = useRef<HTMLDivElement>(null);

  const { filteredRules } = useMemo(() => {
    if (!filter.trim()) {
      return { filteredRules: data.rules };
    }
    const lower = filter.toLowerCase();
    const rules: typeof data.rules = [];
    data.rules.forEach((rule) => {
      if (Object.values(rule).some((v) => String(v ?? "").toLowerCase().includes(lower))) {
        rules.push(rule);
      }
    });
    return { filteredRules: rules };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.rules, filter]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: filteredRules.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-[#cfe1d9] bg-[#eef8f4] px-3 py-2 text-xs text-[#1b5e4a]">
        <ArrowRight size={14} />
        <span>Edit mappings in the <strong>Mapping</strong> page. This view is read-only.</span>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold uppercase text-[#66706a]">Mapping Set</label>
        <select
          className="h-9 w-full max-w-xs rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
          value={selectedMappingSetId ?? ""}
          onChange={(e) => selectMappingSet(e.target.value)}
        >
          <option value="">-- Select a mapping set --</option>
          {project.mappingSets.map((ms) => (
            <option key={ms.id} value={ms.id}>
              {ms.name}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#66706a]" />
        <input
          className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white pl-8 pr-3 text-sm outline-none focus:border-[#298b68]"
          placeholder={"Search rules\u2026"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {!selectedMappingSetId ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          Select a mapping set to view its rules
        </p>
      ) : filteredRules.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          {filter ? "No rules match your search" : "No mapping rules defined for this set"}
        </p>
      ) : (
        <>
          <div className="overflow-auto rounded-md border border-[#d9ded8]">
            <div className="flex items-center bg-[#eef1ee] text-xs font-semibold uppercase text-[#66706a]">
              {columns.map((col) => (
                <div key={col.key} className="flex-1 px-3 py-2">
                  {col.label}
                </div>
              ))}
            </div>
            <div ref={parentRef} className="max-h-[60vh] overflow-auto">
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const rule = filteredRules[virtualRow.index];
                  return (
                    <div
                      key={virtualRow.key}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        transform: `translateY(${virtualRow.start}px)`,
                        height: `${virtualRow.size}px`,
                        width: "100%",
                      }}
                      className="flex items-center border-b border-[#e3e7e2] bg-white"
                    >
                      {columns.map((col) => (
                        <div key={col.key} className="flex-1 truncate px-3 py-1.5 text-xs text-[#4a524d]">
                          {col.key === "destinationRequired" || col.key === "reviewed" ? (
                            <input
                              type="checkbox"
                              className="rounded border-[#cfd6cf] opacity-70"
                              checked={(rule as unknown as Record<string, boolean>)[col.key] ?? false}
                              disabled
                            />
                          ) : col.key === "mappingType" ? (
                            <span>{rule.mappingType}</span>
                          ) : (
                            <span className="truncate">
                              {(rule as unknown as Record<string, string>)[col.key] ?? ""}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="text-xs text-[#66706a]">
            Showing {filteredRules.length} of {data.rules.length} rules
          </p>
        </>
      )}

    </div>
  );
}
