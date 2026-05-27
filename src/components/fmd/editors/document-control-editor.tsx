"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { documentControlDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof documentControlDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

export function DocumentControlEditor({ section, project, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(documentControlDataSchema.parse(wrapper.data ?? {}));

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const updateRevision = (index: number, field: string, value: string) => {
    const updated = [...data.revisions];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, revisions: updated });
  };

  const addRevision = () => {
    const today = new Date().toISOString().slice(0, 10);
    const latestVersion = data.revisions.length > 0 ? data.revisions[0].version : "0.0";
    const nextVersion = String(Number.parseFloat(latestVersion) + 1).replace(/\.(\d)$/, ".$1");
    setData({
      ...data,
      revisions: [
        { version: nextVersion, date: today, author: project.owner || "", changeSummary: "" },
        ...data.revisions,
      ],
    });
  };

  const removeRevision = (index: number) => {
    setData({ ...data, revisions: data.revisions.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      {data.revisions.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cfd6cf] p-4 text-center text-sm text-[#66706a]">
          No revisions yet
        </p>
      ) : (
        <div className="overflow-auto rounded-md border border-[#d9ded8]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#eef1ee] text-xs font-semibold uppercase text-[#66706a]">
              <tr>
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Author</th>
                <th className="px-3 py-2">Reviewer</th>
                <th className="px-3 py-2">Change Summary</th>
                <th className="px-3 py-2">Status</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3e7e2] bg-white">
              {data.revisions.map((rev, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={rev.version}
                      onChange={(e) => updateRevision(i, "version", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="date"
                      className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={rev.date}
                      onChange={(e) => updateRevision(i, "date", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={rev.author}
                      onChange={(e) => updateRevision(i, "author", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={rev.reviewer ?? ""}
                      onChange={(e) => updateRevision(i, "reviewer", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <textarea
                      className="min-h-[60px] w-full resize-y rounded-md border border-[#cfd6cf] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#298b68]"
                      value={rev.changeSummary}
                      onChange={(e) => updateRevision(i, "changeSummary", e.target.value)}
                      rows={2}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="h-8 w-full rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                      value={rev.status ?? ""}
                      onChange={(e) => updateRevision(i, "status", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeRevision(i)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                      aria-label="Delete revision"
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
          onClick={addRevision}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-2.5 text-xs text-[#4a524d] hover:border-[#298b68]"
        >
          <Plus size={13} />
          Add revision
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
