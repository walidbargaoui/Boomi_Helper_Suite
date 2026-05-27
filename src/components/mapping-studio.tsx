"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  FileInput,
  GitBranch,
  GitCompareArrows,
  Layers3,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import type { MappingIssue, MappingRule, Profile, ProfileField, Project } from "@/lib/domain";
import { qualityScore, validateMappingSet } from "@/lib/mapping-quality";
import { IssueRow, MappingTypePill, PanelHeader, StatusPill } from "@/components/atoms";
import { extractError } from "@/lib/api-utils";
import { useToast } from "@/components/toast";

type FieldDraft = {
  name: string;
  label: string;
  description: string;
  dataType: string;
  length: string;
  required: boolean;
  keyField: boolean;
  format: string;
  sample: string;
  parentPath: string;
};

type FieldEditorState =
  | { mode: "closed" }
  | { mode: "create"; profileId: string; draft: FieldDraft }
  | { mode: "edit"; profileId: string; fieldId: string; draft: FieldDraft };

type ImportState =
  | { mode: "closed" }
  | { mode: "open"; profileId: string };

function emptyFieldDraft(): FieldDraft {
  return {
    name: "",
    label: "",
    description: "",
    dataType: "String",
    length: "",
    required: false,
    keyField: false,
    format: "",
    sample: "",
    parentPath: "",
  };
}

function fieldToDraft(field: ProfileField): FieldDraft {
  return {
    name: field.name,
    label: field.label ?? "",
    description: field.description ?? "",
    dataType: field.dataType,
    length: field.length ?? "",
    required: field.required,
    keyField: field.keyField,
    format: field.format ?? "",
    sample: field.sample ?? "",
    parentPath: field.parentPath ?? "",
  };
}

function fieldDraftToPayload(draft: FieldDraft) {
  return {
    name: draft.name,
    label: draft.label || null,
    description: draft.description || null,
    dataType: draft.dataType,
    length: draft.length || null,
    required: draft.required,
    keyField: draft.keyField,
    format: draft.format || null,
    sample: draft.sample || null,
    parentPath: draft.parentPath || null,
  };
}

type FieldFilter = "all" | "required" | "unmapped" | "key" | "mismatch";

type DrawerDraft = {
  destinationFieldId: string;
  sourceFieldId: string;
  mappingType: MappingRule["mappingType"];
  expression: string;
  defaultValue: string;
  comment: string;
};

type DrawerState =
  | { mode: "closed" }
  | { mode: "edit"; ruleId: string; draft: DrawerDraft }
  | { mode: "create"; draft: DrawerDraft };

const mappingTypeOptions: Array<MappingRule["mappingType"]> = [
  "direct",
  "constant",
  "lookup",
  "function",
  "join",
];

const formatOptionsByType: Record<Profile["type"], string[]> = {
  "Flat File": ["TSV", "CSV", "Fixed Width", "Pipe", "JSON", "XML"],
  JSON: ["JSON"],
  XML: ["XML"],
  Database: ["Table", "View", "Stored Procedure"],
  API: ["REST", "SOAP", "OData", "GraphQL", "JSON", "XML"],
};

const profileTypeOptions: Profile["type"][] = ["Flat File", "JSON", "XML", "Database", "API"];

function defaultFormatForProfileType(type: Profile["type"]) {
  return formatOptionsByType[type]?.[0] ?? "";
}

function emptyDraft(destinationFieldId = ""): DrawerDraft {
  return {
    destinationFieldId,
    sourceFieldId: "",
    mappingType: "direct",
    expression: "",
    defaultValue: "",
    comment: "",
  };
}

function ruleToDraft(rule: MappingRule): DrawerDraft {
  return {
    destinationFieldId: rule.destinationFieldId,
    sourceFieldId: rule.sourceFieldId ?? "",
    mappingType: rule.mappingType,
    expression: rule.expression ?? "",
    defaultValue: rule.defaultValue ?? "",
    comment: rule.comment ?? "",
  };
}

function draftToPayload(draft: DrawerDraft) {
  return {
    destinationFieldId: draft.destinationFieldId,
    sourceFieldId: draft.mappingType === "constant" ? null : draft.sourceFieldId || null,
    mappingType: draft.mappingType,
    expression: draft.expression || null,
    defaultValue: draft.defaultValue || null,
    comment: draft.comment || null,
  };
}

function validateDraft(draft: DrawerDraft): string[] {
  const errors: string[] = [];
  if (!draft.destinationFieldId) errors.push("Choose a destination field.");
  if (draft.mappingType === "constant") {
    if (!draft.defaultValue.trim()) errors.push("Constant mappings require a default value.");
  } else if (!draft.sourceFieldId) {
    errors.push(`${draft.mappingType} mappings require a source field.`);
  }
  if ((draft.mappingType === "function" || draft.mappingType === "lookup") && !draft.comment.trim()) {
    errors.push("Add a comment so this rule documents itself in the FMD.");
  }
  return errors;
}

export function MappingStudio({
  project,
  setProject,
  sourceProfile,
  destinationProfile,
  issues,
  selectedMappingSetIndex,
  setSelectedMappingSetIndex,
}: {
  project: Project;
  setProject: (project: Project) => void;
  sourceProfile: Profile;
  destinationProfile: Profile;
  issues: MappingIssue[];
  selectedMappingSetIndex: number;
  setSelectedMappingSetIndex: (index: number) => void;
}) {
  const [drawer, setDrawer] = useState<DrawerState>({ mode: "closed" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [destSearch, setDestSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<FieldFilter>("all");
  const [destFilter, setDestFilter] = useState<FieldFilter>("all");
  const [formatSaving, setFormatSaving] = useState<"source" | "destination" | null>(null);
  const [fieldEditor, setFieldEditor] = useState<FieldEditorState>({ mode: "closed" });
  const [importState, setImportState] = useState<ImportState>({ mode: "closed" });
  // Local optimistic state for the Reviewed checkbox. Bypasses the parent project
  // state for display until the PATCH settles, so the controlled-input render
  // can't snap back to the old value while we wait for setProject to propagate.
  const [pendingReviewed, setPendingReviewed] = useState<Record<string, boolean>>({});
  const [focusedRuleIndex, setFocusedRuleIndex] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const tableParentRef = useRef<HTMLDivElement | null>(null);
  const toast = useToast();

  const mappingSet = project.mappingSets[selectedMappingSetIndex] ?? project.mappingSets[0];
  const rules = useMemo(() => mappingSet?.rules ?? [], [mappingSet]);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualRow = useVirtualizer({
    count: rules.length,
    getScrollElement: () => tableParentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  useEffect(() => {
    if (focusedRuleIndex >= 0 && focusedRuleIndex < rules.length) {
      rowRefs.current[focusedRuleIndex]?.focus();
    }
  }, [focusedRuleIndex, rules.length]);
  const score = qualityScore(issues);
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  const sourceById = useMemo(
    () => new Map(sourceProfile.fields.map((field) => [field.id, field])),
    [sourceProfile.fields],
  );
  const destinationById = useMemo(
    () => new Map(destinationProfile.fields.map((field) => [field.id, field])),
    [destinationProfile.fields],
  );

  const destinationsWithRule = useMemo(() => new Set(rules.map((rule) => rule.destinationFieldId)), [rules]);
  const sourcesUsed = useMemo(
    () => new Set(rules.map((rule) => rule.sourceFieldId).filter(Boolean) as string[]),
    [rules],
  );
  const mismatchDestinationIds = useMemo(
    () => new Set(issues.filter((issue) => issue.id.startsWith("type-mismatch-") && issue.fieldId).map((issue) => issue.fieldId!)),
    [issues],
  );
  const mismatchSourceIds = useMemo(() => {
    const set = new Set<string>();
    for (const issue of issues) {
      if (!issue.id.startsWith("type-mismatch-") || !issue.ruleId) continue;
      const rule = rules.find((candidate) => candidate.id === issue.ruleId);
      if (rule?.sourceFieldId) set.add(rule.sourceFieldId);
    }
    return set;
  }, [issues, rules]);

  const unmappedRequiredDestIds = useMemo(
    () => new Set(issues.filter((issue) => issue.id.startsWith("unmapped-required-") && issue.fieldId).map((issue) => issue.fieldId!)),
    [issues],
  );

  // Group issues by ruleId so each row can show its own indicator instead of
  // forcing the user to cross-reference the top banner with the row IDs.
  const issuesByRuleId = useMemo(() => {
    const map = new Map<string, MappingIssue[]>();
    for (const issue of issues) {
      if (!issue.ruleId) continue;
      const bucket = map.get(issue.ruleId) ?? [];
      bucket.push(issue);
      map.set(issue.ruleId, bucket);
    }
    return map;
  }, [issues]);

  function filterFields(
    fields: ProfileField[],
    role: "source" | "destination",
    search: string,
    filter: FieldFilter,
  ) {
    const term = search.trim().toLowerCase();
    return fields.filter((field) => {
      if (term) {
        const haystack = `${field.name} ${field.label ?? ""} ${field.description ?? ""} ${field.dataType}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      switch (filter) {
        case "required":
          return field.required;
        case "key":
          return field.keyField;
        case "unmapped":
          return role === "destination" ? !destinationsWithRule.has(field.id) : !sourcesUsed.has(field.id);
        case "mismatch":
          return role === "destination" ? mismatchDestinationIds.has(field.id) : mismatchSourceIds.has(field.id);
        default:
          return true;
      }
    });
  }

  const visibleSource = filterFields(sourceProfile.fields, "source", sourceSearch, sourceFilter);
  const visibleDest = filterFields(destinationProfile.fields, "destination", destSearch, destFilter);

  function replaceRules(nextRules: MappingRule[]) {
    // Write to the SELECTED mapping set, not always mappingSets[0]. Previously
    // index === 0 was hard-coded which meant rule edits in any non-first set
    // never updated visible state — controlled checkboxes snapped back to their
    // old `checked` prop value, causing the "rapid check then uncheck" flicker
    // on the Reviewed column.
    setProject({
      ...project,
      mappingSets: project.mappingSets.map((set, index) =>
        index === selectedMappingSetIndex ? { ...set, rules: nextRules } : set,
      ),
    });
  }

  function updateProfileInProject(updated: Profile) {
    setProject({
      ...project,
      profiles: project.profiles.map((profile) => (profile.id === updated.id ? updated : profile)),
    });
  }

  function applyFieldsToProfile(profileId: string, fields: ProfileField[]) {
    setProject({
      ...project,
      profiles: project.profiles.map((profile) =>
        profile.id === profileId ? { ...profile, fields } : profile,
      ),
    });
  }

  async function handleFieldSave() {
    if (fieldEditor.mode === "closed") return;
    const draft = fieldEditor.draft;
    if (!draft.name.trim()) {
      setSaveError("Field name is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = fieldDraftToPayload(draft);
      const profile = project.profiles.find((p) => p.id === fieldEditor.profileId);
      if (!profile) throw new Error("Profile not found");
      if (fieldEditor.mode === "create") {
        const response = await fetch(`/api/profiles/${fieldEditor.profileId}/fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await extractError(response));
        const data = (await response.json()) as { field: RawField };
        applyFieldsToProfile(fieldEditor.profileId, [...profile.fields, rawToField(data.field)]);
      } else {
        const response = await fetch(`/api/profile-fields/${fieldEditor.fieldId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await extractError(response));
        const data = (await response.json()) as { field: RawField };
        applyFieldsToProfile(
          fieldEditor.profileId,
          profile.fields.map((field) => (field.id === fieldEditor.fieldId ? rawToField(data.field) : field)),
        );
      }
      setFieldEditor({ mode: "closed" });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save field.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFieldDelete(profileId: string, fieldId: string) {
    const profile = project.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const field = profile.fields.find((f) => f.id === fieldId);
    if (!field) return;
    const confirmed = await toast.confirm(`Delete field "${field.name}"?`);
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/profile-fields/${fieldId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await extractError(response));
      applyFieldsToProfile(profileId, profile.fields.filter((f) => f.id !== fieldId));

      const nextRules = rules
        .filter((rule) => rule.destinationFieldId !== fieldId)
        .map((rule) =>
          rule.sourceFieldId === fieldId ? { ...rule, sourceFieldId: undefined } : rule,
        );
      if (nextRules.length !== rules.length) {
        replaceRules(nextRules);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete field.");
    }
  }

  async function handleImportFields(profileId: string, payload: {
    kind: "csv" | "json" | "xml";
    payload: string;
    delimiter?: string;
    hasHeader?: boolean;
  }) {
    const profile = project.profiles.find((p) => p.id === profileId);
    if (!profile) throw new Error("Profile not found");
    const response = await fetch(`/api/profiles/${profileId}/fields`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await extractError(response));
    const data = (await response.json()) as { fields: RawField[] };
    applyFieldsToProfile(profileId, [...profile.fields, ...data.fields.map(rawToField)]);
  }

  async function handleSaveDraft() {
    if (drawer.mode === "closed") return;
    const errors = validateDraft(drawer.draft);
    if (errors.length > 0) {
      setSaveError(errors.join(" "));
      return;
    }
    setSaving(true);
    setSaveError(null);

    try {
      const payload = draftToPayload(drawer.draft);
      if (drawer.mode === "create") {
        const response = await fetch(`/api/mapping-sets/${mappingSet.id}/rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await extractError(response));
        const data = (await response.json()) as { rule: RawRule };
        replaceRules([...rules, rawToRule(data.rule)]);
      } else {
        const response = await fetch(
          `/api/mapping-sets/${mappingSet.id}/rules/${drawer.ruleId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!response.ok) throw new Error(await extractError(response));
        const data = (await response.json()) as { rule: RawRule };
        replaceRules(rules.map((rule) => (rule.id === drawer.ruleId ? rawToRule(data.rule) : rule)));
      }
      setDrawer({ mode: "closed" });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save rule.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleReviewed(rule: MappingRule, next: boolean) {
    // Immediately reflect the new state in pendingReviewed — this is what the
    // controlled checkbox renders against, so it can't flicker back to the old
    // value while the PATCH is in flight.
    setPendingReviewed((prev) => ({ ...prev, [rule.id]: next }));
    try {
      const response = await fetch(`/api/mapping-sets/${mappingSet.id}/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed: next }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const data = (await response.json()) as { rule: { reviewed?: boolean } };
      // Commit the server's value to project state.
      replaceRules(rules.map((r) => (r.id === rule.id ? { ...r, reviewed: data.rule.reviewed === true } : r)));
      // Drop the local override now that project state matches.
      setPendingReviewed((prev) => {
        const copy = { ...prev };
        delete copy[rule.id];
        return copy;
      });
    } catch (error) {
      // Rollback the local override; project state never changed.
      setPendingReviewed((prev) => {
        const copy = { ...prev };
        delete copy[rule.id];
        return copy;
      });
      setSaveError(error instanceof Error ? error.message : "Failed to update review state.");
    }
  }

  async function handleDeleteRule(ruleId: string) {
    const rule = rules.find((candidate) => candidate.id === ruleId);
    const destination = rule ? destinationById.get(rule.destinationFieldId) : undefined;
    const label = destination?.label ?? destination?.name ?? "this mapping";

    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch(`/api/mapping-sets/${mappingSet.id}/rules/${ruleId}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error(await extractError(response));
        replaceRules(rules.filter((candidate) => candidate.id !== ruleId));
        if (drawer.mode === "edit" && drawer.ruleId === ruleId) setDrawer({ mode: "closed" });
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Failed to delete rule.");
      }
    }, 5000);

    toast.addToast({
      message: `Deleting mapping for ${label}…`,
      type: "info",
      duration: 5000,
      action: { label: "Undo", onAction: () => clearTimeout(timeoutId) },
    });
  }

  async function patchProfile(profile: Profile, patch: { type?: Profile["type"]; format?: string }) {
    const role = profile.role;
    const previous = { type: profile.type, format: profile.format };
    const optimistic = {
      ...profile,
      ...(patch.type ? { type: patch.type } : {}),
      ...(patch.format ? { format: patch.format } : {}),
    };
    updateProfileInProject(optimistic);
    setFormatSaving(role);
    setSaveError(null);
    try {
      const response = await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await extractError(response));
    } catch (error) {
      updateProfileInProject({ ...profile, type: previous.type, format: previous.format });
      setSaveError(error instanceof Error ? error.message : "Failed to save profile.");
    } finally {
      setFormatSaving(null);
    }
  }

  function handleFormatChange(profile: Profile, format: string) {
    return patchProfile(profile, { format });
  }

  function handleTypeChange(profile: Profile, nextType: Profile["type"]) {
    const validFormats = formatOptionsByType[nextType] ?? [];
    const format = validFormats.includes(profile.format) ? profile.format : defaultFormatForProfileType(nextType);
    return patchProfile(profile, { type: nextType, format });
  }

  function openCreate(destinationFieldId = "") {
    setSaveError(null);
    setDrawer({ mode: "create", draft: emptyDraft(destinationFieldId) });
  }

  function openEdit(rule: MappingRule) {
    setSaveError(null);
    setDrawer({ mode: "edit", ruleId: rule.id, draft: ruleToDraft(rule) });
  }

  return (
    <div className="p-5">
      {errorIssues.length > 0 ? (
        <div className="mb-4 rounded-md border border-[#f3c5c5] bg-[#fdecec] p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-[#9c2a2a]" />
            <p className="text-sm font-semibold text-[#9c2a2a]">
              {errorIssues.length} blocking mapping {errorIssues.length === 1 ? "issue" : "issues"}
            </p>
          </div>
          <ul className="mt-2 list-disc pl-6 text-xs leading-5 text-[#7a2424]">
            {errorIssues.slice(0, 5).map((issue) => (
              <li key={issue.id}>
                <span className="font-semibold">{issue.title}:</span> {issue.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_1fr]">
        <div className="space-y-5">
          <ProfilePanel
            icon={Layers3}
            title={sourceProfile.name || "Source Profile"}
            subtitle="Source"
            profile={sourceProfile}
            search={sourceSearch}
            setSearch={setSourceSearch}
            filter={sourceFilter}
            setFilter={setSourceFilter}
            visibleFields={visibleSource}
            formatBusy={formatSaving === "source"}
            onFormatChange={(format) => handleFormatChange(sourceProfile, format)}
            onTypeChange={(type) => handleTypeChange(sourceProfile, type)}
            onAddField={() => setFieldEditor({ mode: "create", profileId: sourceProfile.id, draft: emptyFieldDraft() })}
            onEditField={(field) =>
              setFieldEditor({ mode: "edit", profileId: sourceProfile.id, fieldId: field.id, draft: fieldToDraft(field) })
            }
            onDeleteField={(field) => handleFieldDelete(sourceProfile.id, field.id)}
            onImport={() => setImportState({ mode: "open", profileId: sourceProfile.id })}
          />
          <ProfilePanel
            icon={Database}
            title={destinationProfile.name || "Destination Profile"}
            subtitle="Destination"
            profile={destinationProfile}
            search={destSearch}
            setSearch={setDestSearch}
            filter={destFilter}
            setFilter={setDestFilter}
            visibleFields={visibleDest}
            formatBusy={formatSaving === "destination"}
            onFormatChange={(format) => handleFormatChange(destinationProfile, format)}
            onTypeChange={(type) => handleTypeChange(destinationProfile, type)}
            onAddField={() => setFieldEditor({ mode: "create", profileId: destinationProfile.id, draft: emptyFieldDraft() })}
            onEditField={(field) =>
              setFieldEditor({ mode: "edit", profileId: destinationProfile.id, fieldId: field.id, draft: fieldToDraft(field) })
            }
            onDeleteField={(field) => handleFieldDelete(destinationProfile.id, field.id)}
            onImport={() => setImportState({ mode: "open", profileId: destinationProfile.id })}
            errorFieldIds={unmappedRequiredDestIds}
          />
        </div>

        <div className="min-w-0 space-y-5">
          <div className="panel min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PanelHeader icon={GitCompareArrows} title={mappingSet.name} action={mappingSet.status} />
                {project.mappingSets.length > 1 ? (
                  <select
                    value={selectedMappingSetIndex}
                    onChange={(e) => setSelectedMappingSetIndex(Number(e.target.value))}
                    className="h-8 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68]"
                  >
                    {project.mappingSets.map((ms, idx) => (
                      <option key={ms.id} value={idx}>{ms.name}</option>
                    ))}
                  </select>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusPill label={`${score}% quality`} tone={score >= 80 ? "green" : score >= 50 ? "amber" : "red"} />
                <StatusPill
                  label={`${errorIssues.length} errors`}
                  tone={errorIssues.length === 0 ? "green" : "red"}
                />
                <StatusPill label={`${warningCount} warnings`} tone={warningCount === 0 ? "green" : "amber"} />
                <button
                  type="button"
                  onClick={() => openCreate()}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d]"
                >
                  <Plus size={16} />
                  Add Mapping
                </button>
              </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-md border border-[#d9ded8]">
              <div className="overflow-auto" style={{ maxHeight: "60vh" }} ref={tableParentRef}>
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="bg-[#eef1ee] text-xs uppercase text-[#66706a]">
                    <tr>
                      <th className="w-[4%] px-3 py-2 text-center" title="Mapping quality status"></th>
                      <th className="w-[17%] px-3 py-2">Source</th>
                      <th className="w-[3%] px-3 py-2"></th>
                      <th className="w-[19%] px-3 py-2">Destination</th>
                      <th className="w-[10%] px-3 py-2">Mode</th>
                      <th className="w-[16%] px-3 py-2">Logic</th>
                      <th className="w-[15%] px-3 py-2">Comment</th>
                      <th className="w-[7%] px-3 py-2 text-center">Reviewed</th>
                      <th className="w-[9%] px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e3e7e2] bg-white">
                    {rules.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-sm text-[#66706a]">
                          No mapping rules yet. Use <span className="font-semibold">Add Mapping</span> to start.
                        </td>
                      </tr>
                    ) : (
                      <>
                        {virtualRow.getVirtualItems().map((virtualItem) => {
                          const index = virtualItem.index;
                          const rule = rules[index];
                          if (!rule) return null;
                          const source = rule.sourceFieldId ? sourceById.get(rule.sourceFieldId) : undefined;
                          const destination = destinationById.get(rule.destinationFieldId);
                          const ruleIssues = issuesByRuleId.get(rule.id) ?? [];
                          const hasError = ruleIssues.some((issue) => issue.severity === "error");
                          const hasWarning = ruleIssues.some((issue) => issue.severity === "warning");
                          const issueTooltip = ruleIssues
                            .map((issue) => `${issue.severity === "error" ? "✗" : issue.severity === "warning" ? "!" : "i"} ${issue.title}: ${issue.detail}`)
                            .join("\n\n");
                          const rowBg = hasError
                            ? "bg-[#fdf3f3] hover:bg-[#fce9e9]"
                            : hasWarning
                            ? "bg-[#fcf5e6] hover:bg-[#f9eed1]"
                            : "hover:bg-[#f5f8f5]";
                          const leftBorder = hasError
                            ? "border-l-4 border-l-[#b83b3b]"
                            : hasWarning
                            ? "border-l-4 border-l-[#b77816]"
                            : "border-l-4 border-l-transparent";

                          function handleKeyDown(e: React.KeyboardEvent) {
                            if (e.key === "j" || e.key === "ArrowDown") {
                              e.preventDefault();
                              setFocusedRuleIndex(Math.min(index + 1, rules.length - 1));
                            } else if (e.key === "k" || e.key === "ArrowUp") {
                              e.preventDefault();
                              setFocusedRuleIndex(Math.max(index - 1, 0));
                            } else if (e.key === "Enter") {
                              e.preventDefault();
                              openEdit(rule);
                            } else if (e.key === "x") {
                              e.preventDefault();
                              handleDeleteRule(rule.id);
                            }
                          }

                          return (
                            <tr
                              key={rule.id}
                              ref={(el) => { rowRefs.current[index] = el; }}
                              tabIndex={0}
                              onKeyDown={handleKeyDown}
                              className={clsx(
                                "cursor-pointer align-top outline-none",
                                focusedRuleIndex === index ? "ring-2 ring-inset ring-[#298b68]" : "focus:ring-2 focus:ring-inset focus:ring-[#298b68]",
                                rowBg,
                                leftBorder,
                              )}
                              onClick={() => openEdit(rule)}
                            >
                              <td className="px-3 py-3 text-center" title={issueTooltip || "No issues"}>
                                {hasError ? (
                                  <XCircle size={16} className="inline text-[#b83b3b]" />
                                ) : hasWarning ? (
                                  <AlertTriangle size={16} className="inline text-[#b77816]" />
                                ) : (
                                  <CheckCircle2 size={16} className="inline text-[#9fb7aa]" />
                                )}
                              </td>
                              <td className="px-3 py-3">
                                <p className="truncate font-medium">{source?.name ?? "Fixed value"}</p>
                                <p className="truncate text-xs text-[#66706a]">{source?.dataType ?? rule.defaultValue}</p>
                              </td>
                              <td className="px-3 py-3 text-[#298b68]">
                                <ArrowRight size={16} />
                              </td>
                              <td className="px-3 py-3">
                                <p className="truncate font-medium">{destination?.name ?? "(missing field)"}</p>
                                <p className="truncate text-xs text-[#66706a]">
                                  {destination?.dataType}
                                  {destination?.required ? " · mandatory" : ""}
                                </p>
                              </td>
                              <td className="px-3 py-3">
                                <MappingTypePill type={rule.mappingType} />
                              </td>
                              <td className="px-3 py-3">
                                <p className="line-clamp-2 text-xs text-[#4a524d]">
                                  {rule.expression ?? rule.defaultValue ?? "direct"}
                                </p>
                              </td>
                              <td className="px-3 py-3">
                                <p className="line-clamp-3 text-xs text-[#4a524d]">{rule.comment}</p>
                              </td>
                              <td className="px-3 py-3 text-center" onClick={(event) => event.stopPropagation()}>
                                {(() => {
                                  const displayed = pendingReviewed[rule.id] ?? rule.reviewed === true;
                                  return (
                                    <input
                                      type="checkbox"
                                      checked={displayed}
                                      onChange={(event) => toggleReviewed(rule, event.target.checked)}
                                      title={displayed ? "Reviewed — unchecking returns to pending" : "Mark as reviewed before publish"}
                                      className="h-4 w-4 cursor-pointer accent-[#298b68]"
                                    />
                                  );
                                })()}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    className="grid h-7 w-7 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee]"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openEdit(rule);
                                    }}
                                    title="Edit"
                                    aria-label="Edit"
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className="grid h-7 w-7 place-items-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleDeleteRule(rule.id);
                                    }}
                                    title="Delete"
                                    aria-label="Delete"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
            <div className="panel">
              <PanelHeader
                icon={GitBranch}
                title="Transform Nodes"
                action={`${mappingSet.transformNodes.length}`}
              />
              <div className="mt-4 space-y-3">
                {mappingSet.transformNodes.map((node) => (
                  <div key={node.id} className="rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-3">
                    <p className="text-sm font-semibold">{node.label}</p>
                    <p className="mt-1 text-xs text-[#66706a]">
                      {Object.entries(node.config).map(([key, value]) => `${key}: ${value}`).join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <PanelHeader icon={AlertTriangle} title="Quality Checks" action={`${issues.length}`} />
              <div className="mt-4 space-y-2">
                {issues.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {fieldEditor.mode !== "closed" ? (
        <FieldEditorDrawer
          state={fieldEditor}
          onChange={(draft) => setFieldEditor({ ...fieldEditor, draft })}
          onClose={() => setFieldEditor({ mode: "closed" })}
          onSave={handleFieldSave}
          saving={saving}
          error={saveError}
        />
      ) : null}

      {importState.mode === "open" ? (
        <FieldImportDrawer
          onClose={() => setImportState({ mode: "closed" })}
          onImport={async (payload) => {
            await handleImportFields(importState.profileId, payload);
            setImportState({ mode: "closed" });
          }}
        />
      ) : null}

      {drawer.mode !== "closed" ? (
        <RuleEditorDrawer
          drawer={drawer}
          setDrawer={setDrawer}
          sourceProfile={sourceProfile}
          destinationProfile={destinationProfile}
          saving={saving}
          saveError={saveError}
          onSave={handleSaveDraft}
          onClose={() => setDrawer({ mode: "closed" })}
          onDelete={drawer.mode === "edit" ? () => handleDeleteRule(drawer.ruleId) : undefined}
        />
      ) : null}
    </div>
  );
}

function ProfilePanel({
  icon: Icon,
  title,
  subtitle,
  profile,
  search,
  setSearch,
  filter,
  setFilter,
  visibleFields,
  formatBusy,
  onFormatChange,
  onTypeChange,
  onAddField,
  onEditField,
  onDeleteField,
  onImport,
  errorFieldIds,
}: {
  icon: typeof Layers3;
  title: string;
  subtitle?: string;
  profile: Profile;
  search: string;
  setSearch: (value: string) => void;
  filter: FieldFilter;
  setFilter: (filter: FieldFilter) => void;
  visibleFields: ProfileField[];
  formatBusy: boolean;
  onFormatChange: (format: string) => void;
  onTypeChange: (type: Profile["type"]) => void;
  onAddField: () => void;
  onEditField: (field: ProfileField) => void;
  onDeleteField: (field: ProfileField) => void;
  onImport: () => void;
  errorFieldIds?: Set<string>;
}) {
  const formatOptions = formatOptionsByType[profile.type] ?? [profile.format];
  const formatChoices = Array.from(new Set(formatOptions.includes(profile.format) ? formatOptions : [profile.format, ...formatOptions]));

  return (
    <div className="panel">
      <PanelHeader icon={Icon} title={title} action={profile.type} />
      {subtitle ? (
        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-[#66706a]">{subtitle}</p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-semibold uppercase text-[#66706a]">Type</label>
          <select
            value={profile.type}
            onChange={(event) => onTypeChange(event.target.value as Profile["type"])}
            disabled={formatBusy}
            className="mt-2 h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68] disabled:opacity-60"
          >
            {profileTypeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase text-[#66706a]">Format</label>
          <select
            value={profile.format}
            onChange={(event) => onFormatChange(event.target.value)}
            disabled={formatBusy}
            className="mt-2 h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68] disabled:opacity-60"
          >
            {formatChoices.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-md border border-[#cfd6cf] bg-white px-2">
        <Search size={14} className="text-[#66706a]" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search fields"
          className="h-8 flex-1 bg-transparent text-sm outline-none"
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {(["all", "required", "unmapped", "key", "mismatch"] as FieldFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={clsx(
              "rounded-md border px-2 py-1 text-xs",
              filter === value
                ? "border-[#298b68] bg-[#e3f3ed] text-[#1b5e4a]"
                : "border-[#cfd6cf] bg-white text-[#4a524d] hover:border-[#9fb7aa]",
            )}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-1">
        <button
          type="button"
          onClick={onAddField}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs hover:border-[#298b68]"
        >
          <Plus size={12} />
          Add field
        </button>
        <button
          type="button"
          onClick={onImport}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs hover:border-[#298b68]"
        >
          <FileInput size={12} />
          Import
        </button>
      </div>

      <div className="mt-3 space-y-2 overflow-auto pr-1">
        {visibleFields.map((field) => (
          <div
            key={field.id}
            className={clsx(
              "group rounded-md border bg-white p-3",
              errorFieldIds?.has(field.id) ? "border-[#ef4444]" : "border-[#d9ded8]",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <p className="truncate text-sm font-medium">{field.name}</p>
                  {errorFieldIds?.has(field.id) ? (
                    <AlertTriangle size={12} className="shrink-0 text-[#ef4444]" aria-label="Required field has no mapping" />
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-[#66706a]">
                  {field.dataType}
                  {field.required ? " · req" : ""}
                  {field.keyField ? " · key" : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onEditField(field)}
                  className="grid h-6 w-6 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee]"
                  title="Edit field"
                  aria-label="Edit field"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteField(field)}
                  className="grid h-6 w-6 place-items-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                  title="Delete field"
                  aria-label="Delete field"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {visibleFields.length === 0 ? (
          <p className="rounded-md border border-dashed border-[#cfd6cf] p-3 text-center text-xs text-[#66706a]">
            No fields match.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FieldEditorDrawer({
  state,
  onChange,
  onClose,
  onSave,
  saving,
  error,
}: {
  state: Exclude<FieldEditorState, { mode: "closed" }>;
  onChange: (draft: FieldDraft) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const draft = state.draft;
  const inputClass =
    "h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]";

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="w-full max-w-[460px] overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d9ded8] px-5 py-4">
          <p className="text-sm font-semibold">{state.mode === "create" ? "New field" : "Edit field"}</p>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee]"
            title="Close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Label (optional)">
            <input
              value={draft.label}
              onChange={(event) => onChange({ ...draft, label: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={draft.description}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange({ ...draft, description: event.target.value })}
              className={`${inputClass} min-h-[60px]`}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data type">
              <input
                value={draft.dataType}
                onChange={(event) => onChange({ ...draft, dataType: event.target.value })}
                placeholder="String / Integer / Date"
                className={inputClass}
              />
            </Field>
            <Field label="Length">
              <input
                value={draft.length}
                onChange={(event) => onChange({ ...draft, length: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Format">
              <input
                value={draft.format}
                onChange={(event) => onChange({ ...draft, format: event.target.value })}
                placeholder="e.g. yyyy-MM-dd"
                className={inputClass}
              />
            </Field>
            <Field label="Sample">
              <input
                value={draft.sample}
                onChange={(event) => onChange({ ...draft, sample: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Parent path">
            <input
              value={draft.parentPath}
              onChange={(event) => onChange({ ...draft, parentPath: event.target.value })}
              placeholder="record or record.items"
              className={inputClass}
            />
          </Field>
          <div className="flex items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(event) => onChange({ ...draft, required: event.target.checked })}
              />
              Required
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.keyField}
                onChange={(event) => onChange({ ...draft, keyField: event.target.checked })}
              />
              Key field
            </label>
          </div>
          {error ? (
            <div className="rounded-md border border-[#f3c5c5] bg-[#fdecec] p-3 text-xs text-[#7a2424]">{error}</div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#d9ded8] px-5 py-3">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md border border-[#cfd6cf] bg-white px-3 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-60"
          >
            {saving ? "Saving…" : state.mode === "create" ? "Create field" : "Save changes"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function FieldImportDrawer({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (payload: { kind: "csv" | "json" | "xml"; payload: string; delimiter?: string; hasHeader?: boolean }) => Promise<void>;
}) {
  const [kind, setKind] = useState<"csv" | "json" | "xml">("csv");
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!text.trim()) {
      setError("Paste a sample first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onImport(
        kind === "csv"
          ? { kind, payload: text, delimiter: delimiter || undefined, hasHeader }
          : { kind, payload: text },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import fields.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="w-full max-w-[520px] overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d9ded8] px-5 py-4">
          <p className="text-sm font-semibold">Import fields</p>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee]" title="Close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="flex gap-2">
            {(["csv", "json", "xml"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={clsx(
                  "h-8 flex-1 rounded-md border px-2 text-xs uppercase",
                  kind === option
                    ? "border-[#298b68] bg-[#e3f3ed] text-[#1b5e4a]"
                    : "border-[#cfd6cf] bg-white text-[#4a524d]",
                )}
              >
                {option}
              </button>
            ))}
          </div>
          {kind === "csv" ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Delimiter (auto if blank)">
                <input
                  value={delimiter}
                  onChange={(event) => setDelimiter(event.target.value)}
                  placeholder="\t or , or ;"
                  className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                />
              </Field>
              <Field label="Has header row">
                <label className="inline-flex h-9 items-center gap-2 text-sm">
                  <input type="checkbox" checked={hasHeader} onChange={(event) => setHasHeader(event.target.checked)} />
                  First row contains column names
                </label>
              </Field>
            </div>
          ) : null}
          <Field label={`${kind.toUpperCase()} sample`}>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                kind === "csv"
                  ? "name,type,required\nu_company,String,true"
                  : kind === "json"
                  ? '{"order": {"id": "123", "amount": 100.5}}'
                  : "<order><id>123</id></order>"
              }
              className="min-h-[200px] w-full rounded-md border border-[#cfd6cf] bg-white px-3 py-2 font-mono text-xs outline-none focus:border-[#298b68]"
            />
          </Field>
          {error ? (
            <div className="rounded-md border border-[#f3c5c5] bg-[#fdecec] p-3 text-xs text-[#7a2424]">{error}</div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#d9ded8] px-5 py-3">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md border border-[#cfd6cf] bg-white px-3 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-60"
          >
            {busy ? "Importing…" : "Import fields"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function RuleEditorDrawer({
  drawer,
  setDrawer,
  sourceProfile,
  destinationProfile,
  saving,
  saveError,
  onSave,
  onClose,
  onDelete,
}: {
  drawer: Exclude<DrawerState, { mode: "closed" }>;
  setDrawer: (state: DrawerState) => void;
  sourceProfile: Profile;
  destinationProfile: Profile;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const draft = drawer.draft;
  const validationErrors = validateDraft(draft);

  function updateDraft(patch: Partial<DrawerDraft>) {
    setDrawer({ ...drawer, draft: { ...draft, ...patch } });
  }

  return (
    <div className="fixed inset-0 z-30 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="w-full max-w-[460px] overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d9ded8] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[#66706a]">
              {drawer.mode === "create" ? "New Mapping Rule" : "Edit Mapping Rule"}
            </p>
            <p className="text-sm font-semibold">{sourceProfile.name} → {destinationProfile.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee]"
            title="Close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <Field label="Destination field">
            <select
              value={draft.destinationFieldId}
              onChange={(event) => updateDraft({ destinationFieldId: event.target.value })}
              className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
            >
              <option value="">Select destination…</option>
              {destinationProfile.fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                  {field.required ? " (required)" : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Mapping mode">
            <select
              value={draft.mappingType}
              onChange={(event) =>
                updateDraft({ mappingType: event.target.value as MappingRule["mappingType"] })
              }
              className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
            >
              {mappingTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          {draft.mappingType !== "constant" ? (
            <Field label="Source field">
              <select
                value={draft.sourceFieldId}
                onChange={(event) => updateDraft({ sourceFieldId: event.target.value })}
                className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
              >
                <option value="">Select source…</option>
                {sourceProfile.fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name} ({field.dataType})
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {(draft.mappingType === "function" || draft.mappingType === "lookup" || draft.mappingType === "join") ? (
            <Field label="Expression">
              <textarea
                value={draft.expression}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  updateDraft({ expression: event.target.value })
                }
                placeholder="e.g. lookup(item_code) or normalizeDate(source, 'yyyy/MM/dd')"
                className="min-h-[72px] w-full rounded-md border border-[#cfd6cf] bg-white px-3 py-2 text-sm outline-none focus:border-[#298b68]"
              />
            </Field>
          ) : null}

          <Field label="Default / fixed value">
            <input
              type="text"
              value={draft.defaultValue}
              onChange={(event) => updateDraft({ defaultValue: event.target.value })}
              placeholder={draft.mappingType === "constant" ? "Required" : "Used when source is null"}
              className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
            />
          </Field>

          <Field label="Comment (FMD documentation)">
            <textarea
              value={draft.comment}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateDraft({ comment: event.target.value })}
              placeholder="Why this mapping exists, business rule references, edge cases."
              className="min-h-[80px] w-full rounded-md border border-[#cfd6cf] bg-white px-3 py-2 text-sm outline-none focus:border-[#298b68]"
            />
          </Field>

          {validationErrors.length > 0 ? (
            <div className="rounded-md border border-[#f3c5c5] bg-[#fdecec] p-3 text-xs text-[#7a2424]">
              <p className="font-semibold">Fix before saving:</p>
              <ul className="mt-1 list-disc pl-5">
                {validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {saveError ? (
            <div className="rounded-md border border-[#f3c5c5] bg-[#fdecec] p-3 text-xs text-[#7a2424]">
              {saveError}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#d9ded8] px-5 py-3">
          <div>
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[#cfd6cf] bg-white px-3 text-sm text-[#9c2a2a] hover:border-[#9c2a2a]"
              >
                <Trash2 size={14} />
                Delete
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md border border-[#cfd6cf] bg-white px-3 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || validationErrors.length > 0}
              className="inline-flex h-9 items-center rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : drawer.mode === "create" ? "Create rule" : "Save changes"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-[#66706a]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

type RawRule = {
  id: string;
  sourceFieldId: string | null;
  destinationFieldId: string;
  mappingType: string;
  expression: string | null;
  defaultValue: string | null;
  comment: string | null;
  qualityStatus: string;
  reviewed?: boolean;
};

type RawField = {
  id: string;
  parentPath: string | null;
  name: string;
  label: string | null;
  description: string | null;
  dataType: string;
  length: string | null;
  required: boolean;
  keyField: boolean;
  format: string | null;
  sample: string | null;
  ordinal: number;
};

function rawToField(raw: RawField): ProfileField {
  return {
    id: raw.id,
    parentPath: raw.parentPath ?? undefined,
    name: raw.name,
    label: raw.label ?? undefined,
    description: raw.description ?? undefined,
    dataType: raw.dataType,
    length: raw.length ?? undefined,
    required: raw.required,
    keyField: raw.keyField,
    format: raw.format ?? undefined,
    sample: raw.sample ?? undefined,
    ordinal: raw.ordinal,
  };
}

function rawToRule(raw: RawRule): MappingRule {
  return {
    id: raw.id,
    sourceFieldId: raw.sourceFieldId ?? undefined,
    destinationFieldId: raw.destinationFieldId,
    mappingType: raw.mappingType as MappingRule["mappingType"],
    expression: raw.expression ?? undefined,
    defaultValue: raw.defaultValue ?? undefined,
    comment: raw.comment ?? undefined,
    qualityStatus: raw.qualityStatus as MappingRule["qualityStatus"],
    reviewed: raw.reviewed === true,
  };
}

export { validateMappingSet };
