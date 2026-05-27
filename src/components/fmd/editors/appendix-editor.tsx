"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { FmdSection, Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { appendixDataSchema } from "@/lib/fmd-section-schemas";

type Data = z.infer<typeof appendixDataSchema>;

interface EditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

export function AppendixEditor({ section, onSave, saving }: EditorProps) {
  const wrapper = parseFmdSectionContent(section.content);
  const [data, setData] = useState<Data>(appendixDataSchema.parse(wrapper.data ?? {}));
  const [newRef, setNewRef] = useState("");
  const [newTerm, setNewTerm] = useState("");
  const [newDef, setNewDef] = useState("");

  const handleSave = () => {
    onSave({ ...wrapper, data } as unknown as Record<string, unknown>);
  };

  const addReference = () => {
    const val = newRef.trim();
    if (!val) return;
    setData({ ...data, references: [...data.references, val] });
    setNewRef("");
  };

  const removeReference = (index: number) => {
    setData({ ...data, references: data.references.filter((_, i) => i !== index) });
  };

  const addGlossaryEntry = () => {
    const term = newTerm.trim();
    const def = newDef.trim();
    if (!term || !def) return;
    setData({ ...data, glossary: { ...data.glossary, [term]: def } });
    setNewTerm("");
    setNewDef("");
  };

  const removeGlossaryEntry = (term: string) => {
    const updated = { ...data.glossary };
    delete updated[term];
    setData({ ...data, glossary: updated });
  };

  return (
    <div className="space-y-6">
      {/* References */}
      <div className="rounded-md border border-[#d9ded8] bg-white p-3">
        <label className="text-xs font-semibold uppercase text-[#66706a]">References</label>
        {data.references.length === 0 ? (
          <p className="mt-2 text-xs text-[#66706a]">No references listed</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {data.references.map((ref, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md bg-[#fbfbfa] px-2 py-1 text-xs">
                <span className="min-w-0 flex-1">{ref}</span>
                <button
                  type="button"
                  onClick={() => removeReference(i)}
                  className="shrink-0 text-[#9c2a2a] hover:text-[#7a2424]"
                  aria-label="Remove reference"
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
            placeholder="Add reference…"
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addReference();
            }}
          />
          <button
            type="button"
            onClick={addReference}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#cfd6cf] bg-white text-[#4a524d] hover:border-[#298b68]"
            aria-label="Add reference"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Glossary */}
      <div className="rounded-md border border-[#d9ded8] bg-white p-3">
        <label className="text-xs font-semibold uppercase text-[#66706a]">Glossary</label>
        {Object.keys(data.glossary).length === 0 ? (
          <p className="mt-2 text-xs text-[#66706a]">No glossary entries</p>
        ) : (
          <div className="mt-2 space-y-1">
            {Object.entries(data.glossary).map(([term, def]) => (
              <div
                key={term}
                className="flex items-start gap-2 rounded-md bg-[#fbfbfa] px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1">
                  <strong>{term}:</strong> {def}
                </span>
                <button
                  type="button"
                  onClick={() => removeGlossaryEntry(term)}
                  className="shrink-0 text-[#9c2a2a] hover:text-[#7a2424]"
                  aria-label={`Remove glossary entry ${term}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <input
            className="h-8 w-2/5 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
            placeholder="Term…"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
          />
          <input
            className="h-8 flex-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
            placeholder="Definition…"
            value={newDef}
            onChange={(e) => setNewDef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addGlossaryEntry();
            }}
          />
          <button
            type="button"
            onClick={addGlossaryEntry}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#cfd6cf] bg-white text-[#4a524d] hover:border-[#298b68]"
            aria-label="Add glossary entry"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Workbook Evidence */}
      <div className="rounded-md border border-[#d9ded8] bg-white p-3">
        <label className="text-xs font-semibold uppercase text-[#66706a]">Workbook Evidence</label>
        <textarea
          className="mt-1 min-h-[80px] w-full resize-y rounded-md border border-[#cfd6cf] bg-[#f5f7f5] px-3 py-2 text-sm text-[#66706a] outline-none"
          value={data.workbookEvidence ?? ""}
          readOnly
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
