"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { testCasesDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof testCasesDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

const statusOptions = ["pending", "passed", "failed", "blocked"];

export function TestCasesEditor({ section, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(testCasesDataSchema.parse(wrapper.data ?? {}));

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updateCase = (index: number, field: string, value: unknown) => {
    const updated = [...data.cases];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, cases: updated });
  };

  const addCase = () => {
    const nextId = `TC-${(data.cases.length + 1).toString().padStart(3, "0")}`;
    setData({
      ...data,
      cases: [
        ...data.cases,
        {
          caseId: nextId,
          scenario: "",
          inputProfile: "",
          expectedOutput: "",
          mappingRulesCovered: [],
          status: "pending",
          notes: "",
        },
      ],
    });
  };

  const removeCase = (index: number) => {
    setData({ ...data, cases: data.cases.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      {data.cases.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          No test cases
        </p>
      ) : (
        <div className="overflow-auto rounded-md border border-[#d9ded8]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#eef1ee] text-xs font-semibold uppercase text-[#66706a]">
              <tr>
                <th className="px-3 py-2">Case ID</th>
                <th className="px-3 py-2">Scenario</th>
                <th className="px-3 py-2">Input Profile</th>
                <th className="px-3 py-2">Expected Output</th>
                <th className="px-3 py-2">Mapped Rules</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Notes</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3e7e2] bg-white">
              {data.cases.map((tc, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[80px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={tc.caseId}
                      onChange={(e) => updateCase(i, "caseId", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[120px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={tc.scenario}
                      onChange={(e) => updateCase(i, "scenario", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={tc.inputProfile ?? ""}
                      onChange={(e) => updateCase(i, "inputProfile", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={tc.expectedOutput ?? ""}
                      onChange={(e) => updateCase(i, "expectedOutput", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full min-w-[100px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={(tc.mappingRulesCovered ?? []).join(", ")}
                      onChange={(e) =>
                        updateCase(
                          i,
                          "mappingRulesCovered",
                          e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className="h-8 w-full min-w-[90px] rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={tc.status ?? "pending"}
                      onChange={(e) => updateCase(i, "status", e.target.value)}
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
                      value={tc.notes ?? ""}
                      onChange={(e) => updateCase(i, "notes", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeCase(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                      aria-label="Remove test case"
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
          onClick={addCase}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68]"
        >
          <Plus size={13} />
          Add test case
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
