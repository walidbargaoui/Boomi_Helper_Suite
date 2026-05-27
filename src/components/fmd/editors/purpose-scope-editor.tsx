"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { purposeScopeDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof purposeScopeDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

const listFields: Array<{ key: "inScope" | "outOfScope" | "assumptions" | "dependencies"; label: string }> = [
  { key: "inScope", label: "In Scope" },
  { key: "outOfScope", label: "Out of Scope" },
  { key: "assumptions", label: "Assumptions" },
  { key: "dependencies", label: "Dependencies" },
];

export function PurposeScopeEditor({ section, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(purposeScopeDataSchema.parse(wrapper.data ?? {}));
  const [newItems, setNewItems] = useState<Record<string, string>>({
    inScope: "",
    outOfScope: "",
    assumptions: "",
    dependencies: "",
  });


  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updatePurpose = (value: string) => {
    setData({ ...data, purpose: value });
  };

  const addListItem = (key: "inScope" | "outOfScope" | "assumptions" | "dependencies") => {
    const value = newItems[key]?.trim();
    if (!value) return;
    setData({ ...data, [key]: [...data[key], value] });
    setNewItems({ ...newItems, [key]: "" });
  };

  const removeListItem = (key: "inScope" | "outOfScope" | "assumptions" | "dependencies", index: number) => {
    setData({ ...data, [key]: data[key].filter((_, i) => i !== index) });
  };

  const updateQuestion = (index: number, field: string, value: string) => {
    const updated = [...data.openQuestions];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, openQuestions: updated });
  };

  const addQuestion = () => {
    setData({
      ...data,
      openQuestions: [...data.openQuestions, { question: "", owner: "", status: "", dueDate: "" }],
    });
  };

  const removeQuestion = (index: number) => {
    setData({ ...data, openQuestions: data.openQuestions.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-6">
      {/* Purpose */}
      <div>
        <label className="text-xs font-semibold uppercase text-[#66706a]">Purpose</label>
        <textarea
          className="mt-1 h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 py-2 text-sm outline-none focus:border-[#298b68] min-h-[80px] resize-y"
          value={data.purpose ?? ""}
          onChange={(e) => updatePurpose(e.target.value)}
        />
      </div>

      {/* Bullet lists */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {listFields.map(({ key, label }) => (
          <div key={key} className="rounded-md border border-[#d9ded8] bg-white p-3">
            <label className="text-xs font-semibold uppercase text-[#66706a]">{label}</label>
            {data[key].length === 0 ? (
              <p className="mt-2 text-xs text-[#66706a]">None listed</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data[key].map((item, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-md bg-[#fbfbfa] px-2 py-1 text-xs">
                    <span className="min-w-0 flex-1">{item}</span>
                    <button
                      type="button"
                      onClick={() => removeListItem(key, i)}
                      className="shrink-0 text-[#9c2a2a] hover:text-[#7a2424]"
                      aria-label={`Remove ${label} item`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <input
                className="h-8 flex-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                placeholder={`Add ${label.toLowerCase()}…`}
                value={newItems[key] ?? ""}
                onChange={(e) => setNewItems({ ...newItems, [key]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addListItem(key);
                }}
              />
              <button
                type="button"
                onClick={() => addListItem(key)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#cfd6cf] bg-white text-[#4a524d] hover:border-[#298b68]"
                aria-label={`Add ${label}`}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Open Questions */}
      <div>
        <label className="text-xs font-semibold uppercase text-[#66706a]">Open Questions</label>
        {data.openQuestions.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-[#cfd6cf] p-3 text-xs text-[#66706a]">
            No open questions
          </p>
        ) : (
          <div className="mt-2 overflow-auto rounded-md border border-[#d9ded8]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#eef1ee] text-xs font-semibold uppercase text-[#66706a]">
                <tr>
                  <th className="px-3 py-2">Question</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Due Date</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e7e2] bg-white">
                {data.openQuestions.map((q, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">
                      <input
                        className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                        value={q.question}
                        onChange={(e) => updateQuestion(i, "question", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                        value={q.owner ?? ""}
                        onChange={(e) => updateQuestion(i, "owner", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                        value={q.status ?? ""}
                        onChange={(e) => updateQuestion(i, "status", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="date"
                        className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                        value={q.dueDate ?? ""}
                        onChange={(e) => updateQuestion(i, "dueDate", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => removeQuestion(i)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                        aria-label="Remove question"
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
        <button
          type="button"
          onClick={addQuestion}
          className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68]"
        >
          <Plus size={13} />
          Add question
        </button>
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
