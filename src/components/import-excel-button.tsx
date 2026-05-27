"use client";

import { useRef, useState } from "react";
import { Upload, RefreshCw } from "lucide-react";
import clsx from "clsx";

interface ImportExcelButtonProps {
  className?: string;
  label?: string;
}

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

      const projectRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processId: `IMPORT-${Date.now()}`,
          name: file.name.replace(/\.xlsx?$/i, ""),
          description: "",
          sourceSystem: "",
          destinationSystem: "",
          owner: "",
          schedule: "",
          folder: null,
          status: "Draft",
        }),
      });
      if (!projectRes.ok) {
        sessionStorage.removeItem("pendingFmdFile");
        const text = await projectRes.text().catch(() => "Failed to create project");
        throw new Error(text);
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
