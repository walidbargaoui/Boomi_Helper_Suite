"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ExternalLink,
} from "lucide-react";
import type { FmdSection } from "@/lib/domain";
import { normalizeSectionType } from "@/lib/fmd-section-schemas";
import { getSectionTypeMeta } from "@/lib/fmd-section-registry";
import { validateFmdSection, parseFmdSectionContent } from "@/lib/fmd-section-helpers";

interface FmdContextPanelProps {
  section: FmdSection | null;
}

export function FmdContextPanel({ section }: FmdContextPanelProps) {
  if (!section) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-[#66706a]">
        Select a section to see details
      </div>
    );
  }

  const normalizedType = normalizeSectionType(section.sectionType);
  const meta = getSectionTypeMeta(normalizedType);
  const validation = validateFmdSection(section);
  const content = parseFmdSectionContent(section.content);

  return (
    <div className="flex h-full flex-col gap-3 p-3 text-xs">
      {/* Section info */}
      <div className="rounded-md border border-[#d9ded8] bg-white p-3">
        <p className="text-[10px] font-semibold uppercase text-[#66706a]">Section Info</p>
        <p className="mt-2 text-sm font-semibold">{meta?.displayLabel ?? section.sectionType}</p>
        <p className="mt-1 text-[#66706a]">{meta?.description ?? ""}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-md border border-[#cfd6cf] bg-[#fbfbfa] px-1.5 py-0.5 text-[10px] uppercase">
            {content.sourceMode}
          </span>
          {meta?.required ? (
            <span className="rounded-md border border-[#cfd6cf] bg-[#fbfbfa] px-1.5 py-0.5 text-[10px] uppercase">
              Required
            </span>
          ) : null}
        </div>
      </div>

      {/* Validation */}
      <div className="rounded-md border border-[#d9ded8] bg-white p-3">
        <p className="text-[10px] font-semibold uppercase text-[#66706a]">Validation</p>
        <div className="mt-2 space-y-1">
          {validation.errors.map((err, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[#9c2a2a]">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
          {validation.warnings.map((warn, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[#7a5211]">
              <Info size={12} className="mt-0.5 shrink-0" />
              <span>{warn}</span>
            </div>
          ))}
          {validation.errors.length === 0 && validation.warnings.length === 0 ? (
            <div className="flex items-center gap-1.5 text-[#298b68]">
              <CheckCircle2 size={12} />
              <span>No issues</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Linked entities */}
      {content.linkedEntities.length > 0 ? (
        <div className="rounded-md border border-[#d9ded8] bg-white p-3">
          <p className="text-[10px] font-semibold uppercase text-[#66706a]">Linked Data</p>
          <div className="mt-2 space-y-1">
            {content.linkedEntities.map((entity, i) => (
              <div key={`${entity.entityType}-${entity.entityId}-${i}`} className="flex items-center gap-1.5 text-[#66706a]">
                <ExternalLink size={10} className="shrink-0" />
                <span className="truncate">{entity.label ?? entity.entityType}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Stale state */}
      {content.staleState?.isStale ? (
        <div className="rounded-md border border-[#e8c8a8] bg-[#fff8e8] p-3 text-xs text-[#7a5211]">
          <p className="font-semibold">Stale data</p>
          <p className="mt-1">Last synced: {content.staleState.lastSyncedAt ?? "never"}</p>
        </div>
      ) : null}
    </div>
  );
}
