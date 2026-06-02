"use client";

import { useState } from "react";
import {
  Database,
  Plus,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { Project } from "@/lib/domain";
import { StatusPill, WorkspacePanel, InfoRow } from "@/components/atoms";
import { extractError } from "@/lib/api-utils";
import { useToast } from "@/components/toast";
import { Labeled, inputClass } from "@/components/workspace-app";

// ─── Companion-aligned profile type definitions ──────────────────────────

const COMPANION_PROFILE_TYPES = [
  { value: "Flat File", label: "Flat File (CSV/TSV/Fixed-width)", componentType: "profile.flatfile" },
  { value: "JSON", label: "JSON", componentType: "profile.json" },
  { value: "XML", label: "XML", componentType: "profile.xml" },
  { value: "Database", label: "Database", componentType: "profile.db" },
] as const;

const FORMAT_OPTIONS: Record<string, string[]> = {
  "Flat File": ["CSV", "TSV", "Pipe-delimited", "Star-delimited", "Fixed-width"],
  "JSON": ["JSON"],
  "XML": ["XML"],
  "Database": ["SQL", "JDBC"],
};

const DATA_TYPES = [
  "character",
  "number",
  "datetime",
  "boolean",
] as const;

function defaultFormat(type: string): string {
  return FORMAT_OPTIONS[type]?.[0] ?? type;
}

function nullableText(value?: string): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

type FieldDraft = {
  name: string;
  dataType: string;
  required: boolean;
  keyField: boolean;
  length?: string;
  format?: string;
  label?: string;
  description?: string;
  sample?: string;
  parentPath?: string;
};

function emptyFieldDraft(): FieldDraft {
  return { name: "", dataType: "character", required: false, keyField: false };
}

export function ProfilesTab({
  project,
  setProject,
}: {
  project: Project;
  setProject: (project: Project) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editProfileId, setEditProfileId] = useState<string | null>(null);
  const [showFieldEditor, setShowFieldEditor] = useState<{
    profileId: string;
    fieldId?: string;
    draft: FieldDraft;
  } | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    name: "",
    role: "source" as "source" | "destination",
    type: "Flat File",
    format: "CSV",
    rootPath: "",
  });

  const profiles = project.profiles ?? [];

  // ── Profile CRUD ───────────────────────────────────────────────────────

  async function createProfile() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileDraft.name,
          role: profileDraft.role,
          type: profileDraft.type,
          format: profileDraft.format || defaultFormat(profileDraft.type),
          rootPath: nullableText(profileDraft.rootPath),
        }),
      });
      if (!res.ok) throw new Error(await extractError(res));
      const data = await res.json();
      setProject({ ...project, profiles: [...profiles, data.profile] });
      setShowCreate(false);
      setProfileDraft({ name: "", role: "source", type: "Flat File", format: "CSV", rootPath: "" });
      toast.addToast({ message: "Profile created", type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function updateProfile(profileId: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileDraft.name,
          type: profileDraft.type,
          format: profileDraft.format || defaultFormat(profileDraft.type),
          rootPath: nullableText(profileDraft.rootPath),
        }),
      });
      if (!res.ok) throw new Error(await extractError(res));
      const data = await res.json();
      setProject({
        ...project,
        profiles: profiles.map((p) => (p.id === profileId ? data.profile : p)),
      });
      setEditProfileId(null);
      toast.addToast({ message: "Profile updated", type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function deleteProfile(profileId: string) {
    const confirmed = await toast.confirm("Delete this profile and all its fields?");
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/profiles/${profileId}${project.id ? `?projectId=${project.id}` : ""}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await extractError(res));
      setProject({
        ...project,
        profiles: profiles.filter((p) => p.id !== profileId),
      });
      if (expandedProfile === profileId) setExpandedProfile(null);
      toast.addToast({ message: "Profile deleted", type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  // ── Field CRUD ─────────────────────────────────────────────────────────

  async function saveField() {
    if (!showFieldEditor) return;
    const { profileId, fieldId, draft } = showFieldEditor;
    setBusy(true); setError(null);
    try {
      const isCreate = !fieldId;
      const url = isCreate
        ? `/api/profiles/${profileId}/fields`
        : `/api/profile-fields/${fieldId}`;
      const method = isCreate ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          dataType: draft.dataType,
          required: draft.required,
          keyField: draft.keyField,
          length: draft.length || undefined,
          format: draft.format || undefined,
          label: draft.label || undefined,
          description: draft.description || undefined,
          sample: draft.sample || undefined,
          parentPath: nullableText(draft.parentPath),
        }),
      });
      if (!res.ok) throw new Error(await extractError(res));
      const data = await res.json();
      const updatedProfiles = profiles.map((p) => {
        if (p.id !== profileId) return p;
        if (isCreate) {
          return { ...p, fields: [...p.fields, data.field] };
        }
        return {
          ...p,
          fields: p.fields.map((f) => (f.id === fieldId ? data.field : f)),
        };
      });
      setProject({ ...project, profiles: updatedProfiles });
      setShowFieldEditor(null);
      toast.addToast({ message: isCreate ? "Field added" : "Field updated", type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function deleteField(profileId: string, fieldId: string) {
    const confirmed = await toast.confirm("Delete this field?");
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/profile-fields/${fieldId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await extractError(res));
      const updatedProfiles = profiles.map((p) => {
        if (p.id !== profileId) return p;
        return { ...p, fields: p.fields.filter((f) => f.id !== fieldId) };
      });
      setProject({ ...project, profiles: updatedProfiles });
      toast.addToast({ message: "Field deleted", type: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  function getComponentType(type: string): string {
    return COMPANION_PROFILE_TYPES.find((t) => t.value === type)?.componentType ?? "profile.json";
  }

  function profileRolePill(role: string) {
    return role === "source"
      ? <StatusPill label="SOURCE" tone="green" />
      : <StatusPill label="DESTINATION" tone="gray" />;
  }

  return (
    <WorkspacePanel>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Profiles</h2>
            <p className="text-xs text-[#66706a] mt-0.5">
              Manage Boomi profiles aligned with Companion reference schemas
            </p>
          </div>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d]"
            onClick={() => {
              setShowCreate(true);
              setProfileDraft({ name: "", role: "source", type: "Flat File", format: defaultFormat("Flat File"), rootPath: "" });
            }}
            type="button"
          >
            <Plus size={16} /> New Profile
          </button>
        </div>

        {error ? (
          <div className="flex gap-2 rounded-md border border-[#f0c7c7] bg-[#fff8f8] p-3 text-sm text-[#9c2a2a]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
          </div>
        ) : null}

        {profiles.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#cfd6cf] bg-[#fbfbfa] p-8 text-center">
            <Database size={40} className="mx-auto mb-3 text-[#9fb7aa]" />
            <p className="text-sm font-semibold text-[#111714]">No profiles yet</p>
            <p className="mt-1 text-sm text-[#66706a]">Create source and destination profiles with fields matching your integration data.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.map((profile) => (
              <div key={profile.id} className="rounded-md border border-[#d9ded8] bg-white overflow-hidden">
                {/* Profile header */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#fbfbfa] border-b border-[#e1e6e1]">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      className="text-sm font-medium text-[#111714] hover:text-[#298b68] truncate"
                      onClick={() => setExpandedProfile(expandedProfile === profile.id ? null : profile.id)}
                      type="button"
                    >
                      {profile.name}
                    </button>
                    {profileRolePill(profile.role)}
                    <StatusPill label={getComponentType(profile.type)} tone="gray" />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-[#66706a] mr-2">{profile.fields?.length ?? 0} fields</span>
                    <button
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs font-medium text-[#111714] hover:bg-[#eef1ee]"
                      onClick={() => {
                        setEditProfileId(profile.id);
                        setProfileDraft({
                          name: profile.name,
                          role: profile.role,
                          type: profile.type,
                          format: profile.format,
                          rootPath: profile.rootPath ?? "",
                        });
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-[#d9ded8] bg-white px-2 text-xs font-medium text-[#9c2a2a] hover:bg-[#fdf3f3]"
                      onClick={() => deleteProfile(profile.id)}
                      type="button"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Expanded: profile details + fields */}
                {expandedProfile === profile.id ? (
                  <div className="px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <InfoRow label="Type" value={profile.type} />
                      <InfoRow label="Format" value={profile.format} />
                      <InfoRow label="Companion" value={getComponentType(profile.type)} />
                      <InfoRow label="Root Path" value={profile.rootPath ?? "-"} />
                    </div>

                    {/* Fields table */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-[#66706a] uppercase">Fields</p>
                        <button
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-[#1b5e4a] px-2 text-xs font-medium text-white hover:bg-[#164d3d]"
                          onClick={() => setShowFieldEditor({
                            profileId: profile.id,
                            draft: emptyFieldDraft(),
                          })}
                          type="button"
                        >
                          <Plus size={12} /> Add Field
                        </button>
                      </div>
                      {profile.fields.length === 0 ? (
                        <p className="text-xs text-[#66706a] italic">No fields defined. Add fields to this profile.</p>
                      ) : (
                        <div className="overflow-auto rounded-md border border-[#e1e6e1]">
                          <table className="w-full text-xs">
                            <thead className="bg-[#fbfbfa]">
                              <tr>
                                <th className="text-left px-3 py-2 font-semibold text-[#66706a]">#</th>
                                <th className="text-left px-3 py-2 font-semibold text-[#66706a]">Name</th>
                                <th className="text-left px-3 py-2 font-semibold text-[#66706a]">Type</th>
                                <th className="text-left px-3 py-2 font-semibold text-[#66706a]">Req</th>
                                <th className="text-left px-3 py-2 font-semibold text-[#66706a]">Key</th>
                                <th className="text-left px-3 py-2 font-semibold text-[#66706a]">Parent Path</th>
                                <th className="text-left px-3 py-2 font-semibold text-[#66706a]">Mappable</th>
                                <th className="text-right px-3 py-2 font-semibold text-[#66706a]"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {profile.fields
                                .sort((a, b) => a.ordinal - b.ordinal)
                                .map((field) => (
                                  <tr key={field.id} className="border-t border-[#f0f2f0] hover:bg-[#fbfbfa]">
                                    <td className="px-3 py-1.5 text-[#66706a]">{field.ordinal}</td>
                                    <td className="px-3 py-1.5 font-medium">{field.name}</td>
                                    <td className="px-3 py-1.5 text-[#66706a]">{field.dataType}</td>
                                    <td className="px-3 py-1.5">{field.required ? <CheckCircle2 size={12} className="text-[#298b68]" /> : "-"}</td>
                                    <td className="px-3 py-1.5">{field.keyField ? <CheckCircle2 size={12} className="text-[#b77816]" /> : "-"}</td>
                                    <td className="px-3 py-1.5 text-[#66706a] font-mono text-[10px]">{field.parentPath ?? "-"}</td>
                                    <td className="px-3 py-1.5">
                                      {field.parentPath && !field.parentPath.endsWith("[]")
                                        ? <span className="text-[#66706a]">container</span>
                                        : <span className="text-[#298b68]">leaf</span>
                                      }
                                    </td>
                                    <td className="px-3 py-1.5 text-right">
                                      <button
                                        className="text-[10px] text-[#66706a] hover:text-[#111714] mr-2"
                                        onClick={() => setShowFieldEditor({
                                          profileId: profile.id,
                                          fieldId: field.id,
                                          draft: {
                                            name: field.name,
                                            dataType: field.dataType,
                                            required: field.required,
                                            keyField: field.keyField,
                                            length: field.length,
                                            format: field.format,
                                            label: field.label,
                                            description: field.description,
                                            sample: field.sample,
                                            parentPath: field.parentPath,
                                          },
                                        })}
                                        type="button"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="text-[10px] text-[#9c2a2a] hover:text-[#c42a2a]"
                                        onClick={() => deleteField(profile.id, field.id)}
                                        type="button"
                                      >
                                        Del
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Create Profile Drawer */}
        {showCreate ? (
          <DrawerShell onClose={() => { setShowCreate(false); setError(null); }}>
            <DrawerBody>
              <h3 className="text-sm font-semibold">New Profile</h3>
              <div className="mt-4 space-y-3">
                <Labeled label="Name">
                  <input className={inputClass} value={profileDraft.name} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} placeholder="e.g. Order Source Profile" />
                </Labeled>
                <Labeled label="Role">
                  <select className={inputClass} value={profileDraft.role} onChange={(e) => setProfileDraft({ ...profileDraft, role: e.target.value as "source" | "destination" })}>
                    <option value="source">Source</option>
                    <option value="destination">Destination</option>
                  </select>
                </Labeled>
                <Labeled label="Type (Companion-aligned)">
                  <select className={inputClass} value={profileDraft.type} onChange={(e) => {
                    const t = e.target.value;
                    setProfileDraft({ ...profileDraft, type: t, format: defaultFormat(t) });
                  }}>
                    {COMPANION_PROFILE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Format">
                  <select className={inputClass} value={profileDraft.format} onChange={(e) => setProfileDraft({ ...profileDraft, format: e.target.value })}>
                    {(FORMAT_OPTIONS[profileDraft.type] ?? [profileDraft.type]).map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Root Path (optional)">
                  <input className={inputClass} value={profileDraft.rootPath} onChange={(e) => setProfileDraft({ ...profileDraft, rootPath: e.target.value })} placeholder="e.g. /response/data" />
                </Labeled>
              </div>
            </DrawerBody>
            <DrawerFooter onCancel={() => { setShowCreate(false); setError(null); }} onSave={createProfile} busy={busy} saveLabel="Create" />
          </DrawerShell>
        ) : null}

        {/* Edit Profile Drawer */}
        {editProfileId ? (
          <DrawerShell onClose={() => { setEditProfileId(null); setError(null); }}>
            <DrawerBody>
              <h3 className="text-sm font-semibold">Edit Profile</h3>
              <div className="mt-4 space-y-3">
                <Labeled label="Name">
                  <input className={inputClass} value={profileDraft.name} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} />
                </Labeled>
                <Labeled label="Type (Companion-aligned)">
                  <select className={inputClass} value={profileDraft.type} onChange={(e) => {
                    const t = e.target.value;
                    setProfileDraft({ ...profileDraft, type: t, format: defaultFormat(t) });
                  }}>
                    {COMPANION_PROFILE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Format">
                  <select className={inputClass} value={profileDraft.format} onChange={(e) => setProfileDraft({ ...profileDraft, format: e.target.value })}>
                    {(FORMAT_OPTIONS[profileDraft.type] ?? [profileDraft.type]).map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Root Path (optional)">
                  <input className={inputClass} value={profileDraft.rootPath} onChange={(e) => setProfileDraft({ ...profileDraft, rootPath: e.target.value })} />
                </Labeled>
              </div>
            </DrawerBody>
            <DrawerFooter onCancel={() => { setEditProfileId(null); setError(null); }} onSave={() => updateProfile(editProfileId)} busy={busy} saveLabel="Save" />
          </DrawerShell>
        ) : null}

        {/* Field Editor Drawer */}
        {showFieldEditor ? (
          <DrawerShell onClose={() => { setShowFieldEditor(null); setError(null); }}>
            <DrawerBody>
              <h3 className="text-sm font-semibold">{showFieldEditor.fieldId ? "Edit Field" : "New Field"}</h3>
              <div className="mt-4 space-y-3">
                <Labeled label="Name *">
                  <input className={inputClass} value={showFieldEditor.draft.name} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, name: e.target.value } })} placeholder="Field name" />
                </Labeled>
                <Labeled label="Data Type">
                  <select className={inputClass} value={showFieldEditor.draft.dataType} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, dataType: e.target.value } })}>
                    {DATA_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                    <option value="integer">integer</option>
                    <option value="decimal">decimal</option>
                  </select>
                </Labeled>
                <Labeled label="Label (optional)">
                  <input className={inputClass} value={showFieldEditor.draft.label ?? ""} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, label: e.target.value } })} placeholder="Human-readable label" />
                </Labeled>
                <Labeled label="Description">
                  <input className={inputClass} value={showFieldEditor.draft.description ?? ""} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, description: e.target.value } })} placeholder="Field description" />
                </Labeled>
                <div className="grid grid-cols-2 gap-3">
                  <Labeled label="Length">
                    <input className={inputClass} value={showFieldEditor.draft.length ?? ""} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, length: e.target.value } })} placeholder="e.g. 255" />
                  </Labeled>
                  <Labeled label="Format">
                    <input className={inputClass} value={showFieldEditor.draft.format ?? ""} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, format: e.target.value } })} placeholder="e.g. yyyy-MM-dd" />
                  </Labeled>
                </div>
                <Labeled label="Sample Value">
                  <input className={inputClass} value={showFieldEditor.draft.sample ?? ""} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, sample: e.target.value } })} placeholder="Sample data" />
                </Labeled>
                <Labeled label="Parent Path (for nested fields)">
                  <input className={inputClass} value={showFieldEditor.draft.parentPath ?? ""} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, parentPath: e.target.value } })} placeholder="Root/Object" />
                </Labeled>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={showFieldEditor.draft.required} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, required: e.target.checked } })} />
                    Required
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={showFieldEditor.draft.keyField} onChange={(e) => setShowFieldEditor({ ...showFieldEditor, draft: { ...showFieldEditor.draft, keyField: e.target.checked } })} />
                    Key Field
                  </label>
                </div>
              </div>
            </DrawerBody>
            <DrawerFooter onCancel={() => { setShowFieldEditor(null); setError(null); }} onSave={saveField} busy={busy} saveLabel={showFieldEditor.fieldId ? "Update" : "Create"} />
          </DrawerShell>
        ) : null}
      </div>
    </WorkspacePanel>
  );
}

// ─── Shared drawer primitives ─────────────────────────────────────────────

function DrawerShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-lg flex flex-col">
        {children}
      </div>
    </div>
  );
}

function DrawerBody({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-auto p-6">{children}</div>;
}

function DrawerFooter({ onCancel, onSave, busy, saveLabel }: { onCancel: () => void; onSave: () => void; busy: boolean; saveLabel: string }) {
  return (
    <div className="border-t border-[#e1e6e1] p-4 flex justify-end gap-2">
      <button className="inline-flex h-9 items-center rounded-md border border-[#cfd6cf] bg-white px-4 text-sm font-medium text-[#111714] hover:bg-[#eef1ee]" onClick={onCancel} type="button">Cancel</button>
      <button className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-4 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-50" onClick={onSave} disabled={busy} type="button">
        {busy ? <RefreshCw size={14} className="animate-spin" /> : null} {saveLabel}
      </button>
    </div>
  );
}
