"use client";

import { useRef, useState } from "react";
import { Upload, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { extractError } from "@/lib/api-utils";

interface ImportExcelButtonProps {
  className?: string;
  label?: string;
}

const MAX_SESSION_IMPORT_BYTES = 4 * 1024 * 1024;

export function ImportExcelButton({
  className,
  label = "Import from Excel",
}: ImportExcelButtonProps) {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    e.target.value = "";
    try {
      if (file.size > MAX_SESSION_IMPORT_BYTES) {
        throw new Error("Workbook is too large for in-browser handoff. Use a smaller file or split the workbook before importing.");
      }

      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      sessionStorage.setItem("pendingFmdFile", JSON.stringify({
        name: file.name,
        type: file.type,
        base64,
      }));

      const fallbackMeta = {
        processId: `IMPORT-${Date.now()}`,
        name: file.name.replace(/\.xlsx?$/i, ""),
        description: "",
        sourceSystem: "",
        destinationSystem: "",
        owner: "",
        schedule: "",
      };

      let meta = fallbackMeta;
      try {
        const resolveForm = new FormData();
        resolveForm.append("file", file);
        resolveForm.append("useLlm", "false");
        const resolveRes = await fetch("/api/fmd/resolve", { method: "POST", body: resolveForm });
        if (resolveRes.ok) {
          const resolved = await resolveRes.json();
          const draftProject = resolved?.draft?.project;
          if (draftProject) {
            meta = {
              processId: draftProject.processId || fallbackMeta.processId,
              name: draftProject.name || fallbackMeta.name,
              description: draftProject.description || fallbackMeta.description,
              sourceSystem: draftProject.sourceSystem !== "Unknown source" ? draftProject.sourceSystem : fallbackMeta.sourceSystem,
              destinationSystem: draftProject.destinationSystem !== "Unknown destination" ? draftProject.destinationSystem : fallbackMeta.destinationSystem,
              owner: draftProject.owner !== "Unassigned" ? draftProject.owner : fallbackMeta.owner,
              schedule: draftProject.schedule || fallbackMeta.schedule,
            };
          }
        }
      } catch {
        // Resolve failed, use fallback metadata
      }

      const projectRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...meta,
          folder: null,
          status: "Draft",
        }),
      });
      if (!projectRes.ok) {
        sessionStorage.removeItem("pendingFmdFile");
        throw new Error(await extractError(projectRes));
      }
      const projectData = await projectRes.json();

      sessionStorage.setItem("pendingFmdTab", "fmd");
      window.location.href = `/?project=${projectData.project.id}`;
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
      setImporting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={importing}
        className={clsx(
          "inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium",
          importing ? "cursor-not-allowed bg-[#cfd6cf] text-[#66706a]" : "bg-[#e3f3ed] text-[#1b5e4a] hover:bg-[#cfe1d9]",
          className,
        )}
      >
        {importing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
        {importing ? "Creating project..." : label}
      </button>
      <input ref={fileRef} className="hidden" type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={importing} />
      {importError ? <p className="mt-1 text-xs text-[#9c2a2a]">{importError}</p> : null}
    </div>
  );
}
