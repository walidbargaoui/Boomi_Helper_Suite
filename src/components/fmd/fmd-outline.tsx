"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { Eye, EyeOff, FileSpreadsheet, FileText, Target, ArrowLeftRight, Network, Layers, List, GitCompare, Wand2, Workflow, ShieldAlert, Server, FlaskConical, ClipboardCheck, Cpu, Paperclip, Archive, Plus, CheckCircle2, AlertTriangle, ChevronUp, ChevronDown } from "lucide-react";
import type { FmdSectionType } from "@/lib/fmd-section-schemas";
import { normalizeSectionType } from "@/lib/fmd-section-schemas";
import { getSectionTypeMeta, getAllSectionTypes } from "@/lib/fmd-section-registry";
import { validateFmdSection, parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import type { FmdSection } from "@/lib/domain";

const iconMap: Record<string, typeof FileSpreadsheet> = {
  FileText, Target, ArrowLeftRight, Network, Layers, List, GitCompare,
  Wand2, Workflow, ShieldAlert, Server, FlaskConical, ClipboardCheck, Cpu, Paperclip, Archive, FileSpreadsheet,
};

interface FmdOutlineProps {
  sections: FmdSection[];
  activeSectionId: string | null;
  onSelectSection: (id: string) => void;
  onAddSection: (type: FmdSectionType) => void;
  onReorder: (orderedIds: string[]) => void;
  onToggleExportEnabled: (sectionId: string) => void;
}

export function FmdOutline({ sections, activeSectionId, onSelectSection, onAddSection, onReorder, onToggleExportEnabled }: FmdOutlineProps) {
  const sorted = useMemo(
    () => [...sections].sort((a, b) => a.sortOrder - b.sortOrder),
    [sections],
  );

  const sortedIds = useMemo(() => sorted.map((s) => s.id), [sorted]);

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const newOrder = [...sortedIds];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    onReorder(newOrder);
  }

  function handleMoveDown(index: number) {
    if (index >= sortedIds.length - 1) return;
    const newOrder = [...sortedIds];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    onReorder(newOrder);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[#d9ded8] px-3 py-2">
        <p className="text-xs font-semibold uppercase text-[#66706a]">
          Sections ({sorted.length})
        </p>
        <div className="relative group">
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee] hover:text-[#1b1f23]"
            aria-label="Add section"
          >
            <Plus size={14} />
          </button>
          <div className="absolute left-0 top-full z-50 mt-1 hidden w-56 rounded-lg border border-[#d9ded8] bg-white shadow-lg group-focus-within:block group-hover:block">
            <div className="max-h-64 overflow-auto p-2">
              {getAllSectionTypes()
                .filter((meta) => meta.sectionType !== "legacy")
                .map((meta) => (
                  <button
                    key={meta.sectionType}
                    type="button"
                    onClick={() => onAddSection(meta.sectionType)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[#eef1ee]"
                  >
                    <span className="text-[#66706a] text-[10px]">
                      {meta.required ? "REQ" : "opt"}
                    </span>
                    <span>{meta.displayLabel}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {sorted.map((section, index) => (
          <OutlineItem
            key={section.id}
            section={section}
            active={section.id === activeSectionId}
            onSelect={() => onSelectSection(section.id)}
            onMoveUp={() => handleMoveUp(index)}
            onMoveDown={() => handleMoveDown(index)}
            onToggleExportEnabled={() => onToggleExportEnabled(section.id)}
            isFirst={index === 0}
            isLast={index === sorted.length - 1}
          />
        ))}
        {sorted.length === 0 && (
          <div className="flex items-center justify-center p-6 text-xs text-[#66706a]">
            No sections yet. Click + to add one.
          </div>
        )}
      </div>
    </div>
  );
}

function OutlineItem({
  section,
  active,
  onSelect,
  onMoveUp,
  onMoveDown,
  onToggleExportEnabled,
  isFirst,
  isLast,
}: {
  section: FmdSection;
  active: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleExportEnabled: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const normalizedType = normalizeSectionType(section.sectionType);
  const meta = getSectionTypeMeta(normalizedType);
  const Icon = iconMap[meta?.icon ?? "FileSpreadsheet"] ?? FileSpreadsheet;
  const validation = validateFmdSection(section);
  const content = parseFmdSectionContent(section.content);
  const hasIssues = !validation.valid || validation.warnings.length > 0;

  return (
    <div
      className={clsx(
        "group flex items-center border-l-2 transition",
        active
          ? "border-l-[#298b68] bg-[#e3f3ed]"
          : "border-l-transparent hover:bg-[#f5f7f5]",
      )}
    >
      <div className="flex shrink-0 flex-col opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          disabled={isFirst}
          className="grid h-4 w-5 place-items-center text-[#66706a] hover:text-[#1b1f23] disabled:opacity-30"
          aria-label="Move section up"
        >
          <ChevronUp size={11} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          disabled={isLast}
          className="grid h-4 w-5 place-items-center text-[#66706a] hover:text-[#1b1f23] disabled:opacity-30"
          aria-label="Move section down"
        >
          <ChevronDown size={11} />
        </button>
      </div>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <Icon size={14} className="shrink-0 text-[#66706a]" />
        <span className="min-w-0 flex-1 truncate font-medium">{section.title}</span>
        <div className="flex shrink-0 items-center gap-1">
          {content.sourceMode === "derived" && (
            <span className="text-[10px] text-[#66706a]">auto</span>
          )}
          {content.sourceMode === "manual" && (
            <span className="text-[10px] text-[#298b68]">manual</span>
          )}
          {hasIssues ? (
            <AlertTriangle size={12} className="text-[#b77816]" />
          ) : (
            <CheckCircle2 size={12} className="text-[#298b68]" />
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleExportEnabled(); }}
        className="shrink-0 rounded p-1 text-[#66706a] hover:text-[#1b1f23]"
        aria-label={content.exportEnabled ? "Exclude from export" : "Include in export"}
      >
        {content.exportEnabled ? <Eye size={12} /> : <EyeOff size={12} className="text-[#b77816]" />}
      </button>
    </div>
  );
}
