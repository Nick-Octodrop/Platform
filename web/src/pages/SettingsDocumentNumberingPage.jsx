import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";

const SCOPE_OPTIONS = [
  { value: "global", label: "Global" },
  { value: "entity", label: "Entity" },
  { value: "workspace", label: "Workspace" },
];

const RESET_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "yearly", label: "Yearly" },
  { value: "monthly", label: "Monthly" },
];

const ASSIGN_OPTIONS = [
  { value: "create", label: "On Create" },
  { value: "save", label: "On Save" },
  { value: "confirm", label: "On Confirm Status" },
  { value: "issue", label: "On Issue Status" },
  { value: "custom", label: "Custom / Manual Later" },
];

function emptyDraft() {
  return {
    id: "",
    code: "",
    name: "",
    target_entity_id: "",
    number_field_id: "",
    description: "",
    pattern: "DOC-{YYYY}-{SEQ:4}",
    scope_type: "global",
    scope_field_id: "",
    reset_policy: "yearly",
    assign_on: "create",
    trigger_status_values: [],
    is_active: true,
    lock_after_assignment: true,
    allow_admin_override: false,
    notes: "",
    sort_order: 100,
  };
}

function Section({ title, description, children, tone = "bg-base-100" }) {
  return (
    <div className={`rounded-box border border-base-300 ${tone} p-4`}>
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function SettingsDocumentNumberingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [items, setItems] = useState([]);
  const [entities, setEntities] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(emptyDraft());
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [listRes, metaRes] = await Promise.all([
        apiFetch("/settings/document-numbering"),
        apiFetch("/settings/document-numbering/meta"),
      ]);
      const nextItems = Array.isArray(listRes?.sequences) ? listRes.sequences : [];
      const nextEntities = Array.isArray(metaRes?.entities) ? metaRes.entities : [];
      setItems(nextItems);
      setEntities(nextEntities);
      setSelectedId((prev) => (prev && nextItems.some((item) => item.id === prev) ? prev : ""));
    } catch (err) {
      setItems([]);
      setEntities([]);
      setError(err?.message || "Failed to load document numbering settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  useEffect(() => {
    if (selectedItem) {
      setDraft({
        ...emptyDraft(),
        ...selectedItem,
        trigger_status_values: Array.isArray(selectedItem.trigger_status_values) ? selectedItem.trigger_status_values : [],
      });
    } else {
      setDraft(emptyDraft());
    }
  }, [selectedItem]);

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.entity_id === draft.target_entity_id) || null,
    [entities, draft.target_entity_id],
  );

  const numberFields = useMemo(
    () => (selectedEntity?.fields || []).filter((field) => ["string", "text"].includes(field.type)),
    [selectedEntity],
  );

  const scopeFields = useMemo(
    () => (selectedEntity?.fields || []).filter((field) => ["string", "text", "enum", "lookup", "user"].includes(field.type)),
    [selectedEntity],
  );

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      if (!draft.code || !draft.name || !draft.target_entity_id || !draft.number_field_id || !draft.pattern) {
        if (!alive) return;
        setPreview("");
        setPreviewError("");
        return;
      }
      try {
        const response = await apiFetch("/settings/document-numbering/preview", {
          method: "POST",
          body: draft,
        });
        if (!alive) return;
        setPreview(response?.preview || "");
        setPreviewError("");
      } catch (err) {
        if (!alive) return;
        setPreview("");
        setPreviewError(err?.message || "Preview unavailable");
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [draft]);

  async function saveDraft() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = draft.id
        ? await apiFetch(`/settings/document-numbering/${encodeURIComponent(draft.id)}`, {
            method: "PATCH",
            body: draft,
          })
        : await apiFetch("/settings/document-numbering", {
            method: "POST",
            body: draft,
          });
      const saved = response?.sequence || null;
      setNotice(draft.id ? "Sequence updated." : "Sequence created.");
      await load();
      if (saved?.id) {
        setSelectedId(saved.id);
      }
    } catch (err) {
      setError(err?.message || "Failed to save sequence");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft() {
    if (!draft.id) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/settings/document-numbering/${encodeURIComponent(draft.id)}`, {
        method: "DELETE",
      });
      setNotice("Sequence deleted.");
      setSelectedId("");
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete sequence");
    } finally {
      setSaving(false);
    }
  }

  function toggleStatusValue(value) {
    setDraft((current) => ({
      ...current,
      trigger_status_values: current.trigger_status_values.includes(value)
        ? current.trigger_status_values.filter((item) => item !== value)
        : [...current.trigger_status_values, value],
    }));
  }

  const assignNeedsStatuses = ["confirm", "issue"].includes(draft.assign_on);

  return (
    <TabbedPaneShell
      title="Document Numbering"
      subtitle="Reusable, workspace-scoped numbering for quotes, orders, invoices, and any other business records."
      tabs={[]}
      rightActions={(
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-ghost" type="button" disabled={loading || saving} onClick={load}>
            Refresh
          </button>
          <button
            className="btn btn-sm"
            type="button"
            disabled={saving}
            onClick={() => {
              setSelectedId("");
              setDraft(emptyDraft());
              setError("");
              setNotice("");
            }}
          >
            New Sequence
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        {error ? <div className="alert alert-error text-sm">{error}</div> : null}
        {notice ? <div className="alert alert-success text-sm">{notice}</div> : null}

        <Section
          title="How it works"
          description="Sequences are assigned from the shared record lifecycle. Patterns are configurable, counters are safe, and historical numbers are not renumbered."
          tone="bg-base-200/40"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">Scope</div>
              <div className="mt-1 text-sm font-medium">Global, workspace, or entity-scoped counters</div>
            </div>
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">Reset</div>
              <div className="mt-1 text-sm font-medium">Never, yearly, or monthly reset buckets</div>
            </div>
            <div className="rounded-box bg-base-100 p-3">
              <div className="text-xs uppercase tracking-wide opacity-60">Assign On</div>
              <div className="mt-1 text-sm font-medium">Create, save, or a workflow status milestone</div>
            </div>
          </div>
        </Section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Section title="Sequences" description="Pick a definition to edit it or create a new one.">
            {loading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : items.length ? (
              <div className="space-y-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`w-full rounded-box border px-3 py-3 text-left ${selectedId === item.id ? "border-primary bg-base-200" : "border-base-300 bg-base-100"}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-sm">{item.name || item.code}</div>
                      <div className={`badge badge-sm ${item.is_active ? "badge-success" : "badge-ghost"}`}>{item.is_active ? "Active" : "Inactive"}</div>
                    </div>
                    <div className="mt-1 text-xs opacity-70">{item.code}</div>
                    <div className="mt-2 text-xs opacity-70">
                      {item.target_entity_id} · {item.assign_on} · {item.reset_policy}
                    </div>
                    <div className="mt-2 text-xs opacity-70">
                      {Number(item.assignment_count || 0) > 0 ? `${item.assignment_count} assigned record${Number(item.assignment_count) === 1 ? "" : "s"}` : "Unused"}
                    </div>
                    <div className="mt-2 text-xs font-mono opacity-80">{item.next_value_preview || item.preview_error || "Preview unavailable"}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm opacity-70">No numbering definitions yet.</div>
            )}
          </Section>

          <div className="space-y-4 xl:col-span-8">
            <Section title={draft.id ? "Edit Sequence" : "New Sequence"} description="Use stable internal codes and business-friendly names. Changes only affect future records.">
              {draft.id && Number(draft.assignment_count || 0) > 0 ? (
                <div className="mb-4 rounded-box border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
                  This sequence is already in use on <span className="font-semibold">{draft.assignment_count}</span> record{Number(draft.assignment_count) === 1 ? "" : "s"}.
                  Changes here only apply to future assignments. Historical document numbers are not renumbered.
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <label className="form-control md:col-span-4">
                  <span className="label-text text-sm">Name</span>
                  <input className="input input-bordered input-sm" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} disabled={saving} />
                </label>
                <label className="form-control md:col-span-4">
                  <span className="label-text text-sm">Code</span>
                  <input className="input input-bordered input-sm" value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} placeholder="sales.quote" disabled={saving} />
                </label>
                <label className="form-control md:col-span-4">
                  <span className="label-text text-sm">Target entity</span>
                  <select
                    className="select select-bordered select-sm"
                    value={draft.target_entity_id}
                    onChange={(event) => setDraft((current) => ({ ...current, target_entity_id: event.target.value, number_field_id: "", scope_field_id: "", trigger_status_values: [] }))}
                    disabled={saving}
                  >
                    <option value="">Select entity</option>
                    {entities.map((entity) => (
                      <option key={entity.entity_id} value={entity.entity_id}>
                        {entity.label || entity.entity_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-control md:col-span-4">
                  <span className="label-text text-sm">Number field</span>
                  <select
                    className="select select-bordered select-sm"
                    value={draft.number_field_id}
                    onChange={(event) => setDraft((current) => ({ ...current, number_field_id: event.target.value }))}
                    disabled={saving || !draft.target_entity_id}
                  >
                    <option value="">Select field</option>
                    {numberFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-control md:col-span-4">
                  <span className="label-text text-sm">Pattern</span>
                  <input className="input input-bordered input-sm font-mono" value={draft.pattern} onChange={(event) => setDraft((current) => ({ ...current, pattern: event.target.value }))} disabled={saving} />
                </label>
                <label className="form-control md:col-span-4">
                  <span className="label-text text-sm">Sort order</span>
                  <input className="input input-bordered input-sm" type="number" value={draft.sort_order} onChange={(event) => setDraft((current) => ({ ...current, sort_order: event.target.value }))} disabled={saving} />
                </label>
                <label className="form-control md:col-span-4">
                  <span className="label-text text-sm">Scope</span>
                  <select className="select select-bordered select-sm" value={draft.scope_type} onChange={(event) => setDraft((current) => ({ ...current, scope_type: event.target.value, scope_field_id: event.target.value === "entity" ? current.scope_field_id : "" }))} disabled={saving}>
                    {SCOPE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-control md:col-span-4">
                  <span className="label-text text-sm">Reset policy</span>
                  <select className="select select-bordered select-sm" value={draft.reset_policy} onChange={(event) => setDraft((current) => ({ ...current, reset_policy: event.target.value }))} disabled={saving}>
                    {RESET_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-control md:col-span-4">
                  <span className="label-text text-sm">Assign on</span>
                  <select className="select select-bordered select-sm" value={draft.assign_on} onChange={(event) => setDraft((current) => ({ ...current, assign_on: event.target.value, trigger_status_values: ["confirm", "issue"].includes(event.target.value) ? current.trigger_status_values : [] }))} disabled={saving}>
                    {ASSIGN_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                {draft.scope_type === "entity" ? (
                  <label className="form-control md:col-span-6">
                    <span className="label-text text-sm">Scope field</span>
                    <select
                      className="select select-bordered select-sm"
                      value={draft.scope_field_id}
                      onChange={(event) => setDraft((current) => ({ ...current, scope_field_id: event.target.value }))}
                      disabled={saving || !draft.target_entity_id}
                    >
                      <option value="">Select field</option>
                      {scopeFields.map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                    <span className="label-text-alt opacity-70 mt-1">Used to split counters and resolve the {`{ENTITY}`} token.</span>
                  </label>
                ) : null}
                <label className="form-control md:col-span-6">
                  <span className="label-text text-sm">Description</span>
                  <input className="input input-bordered input-sm" value={draft.description || ""} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} disabled={saving} />
                </label>
                <label className="form-control md:col-span-12">
                  <span className="label-text text-sm">Notes</span>
                  <textarea className="textarea textarea-bordered min-h-[6rem]" value={draft.notes || ""} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
                </label>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="flex items-center gap-3 rounded-box border border-base-300 bg-base-200/40 px-3 py-3 text-sm">
                  <input type="checkbox" className="checkbox checkbox-sm" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} disabled={saving} />
                  Active
                </label>
                <label className="flex items-center gap-3 rounded-box border border-base-300 bg-base-200/40 px-3 py-3 text-sm">
                  <input type="checkbox" className="checkbox checkbox-sm" checked={draft.lock_after_assignment} onChange={(event) => setDraft((current) => ({ ...current, lock_after_assignment: event.target.checked }))} disabled={saving} />
                  Lock after assignment
                </label>
                <label className="flex items-center gap-3 rounded-box border border-base-300 bg-base-200/40 px-3 py-3 text-sm">
                  <input type="checkbox" className="checkbox checkbox-sm" checked={draft.allow_admin_override} onChange={(event) => setDraft((current) => ({ ...current, allow_admin_override: event.target.checked }))} disabled={saving} />
                  Allow admin override
                </label>
              </div>

              {assignNeedsStatuses ? (
                <div className="mt-4 rounded-box border border-base-300 bg-base-200/40 p-3">
                  <div className="text-sm font-medium">Trigger statuses</div>
                  <div className="mt-1 text-xs opacity-70">Choose the workflow statuses that should assign the number.</div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {(selectedEntity?.status_values || []).map((status) => (
                      <label key={status.id} className="flex items-center gap-3 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={draft.trigger_status_values.includes(status.id)}
                          onChange={() => toggleStatusValue(status.id)}
                          disabled={saving}
                        />
                        <span>{status.label}</span>
                      </label>
                    ))}
                  </div>
                  {!selectedEntity?.status_values?.length ? <div className="mt-3 text-xs text-warning">This entity does not expose workflow states yet.</div> : null}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={saveDraft}>
                  {saving ? "Saving..." : draft.id ? "Save Changes" : "Create Sequence"}
                </button>
                {draft.id ? (
                  <button className="btn btn-error btn-outline btn-sm" type="button" disabled={saving} onClick={deleteDraft}>
                    Delete
                  </button>
                ) : null}
              </div>
            </Section>

            <Section title="Live preview" description="Preview uses the current counter bucket and your current workspace context. Future changes do not renumber historical records." tone="bg-base-200/40">
              {preview ? <div className="rounded-box bg-base-100 px-4 py-3 font-mono text-sm">{preview}</div> : null}
              {previewError ? <div className="mt-2 text-sm text-warning">{previewError}</div> : null}
              {!preview && !previewError ? <div className="text-sm opacity-70">Complete the core fields to see a preview.</div> : null}
              {draft.id && Number(draft.assignment_count || 0) > 0 && draft.last_assigned_at ? (
                <div className="mt-3 text-xs opacity-70">
                  Last assigned: {new Date(draft.last_assigned_at).toLocaleString()}
                </div>
              ) : null}
            </Section>

            <Section title="Token help" description="Keep patterns simple and stable. These tokens are supported in v1." tone="bg-base-200/40">
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  "{YYYY} = 2026",
                  "{YY} = 26",
                  "{MM} = 04",
                  "{DD} = 02",
                  "{SEQ} = 18",
                  "{SEQ:4} = 0018",
                  "{ENTITY} = NL",
                  "{WORKSPACE} = OCTODROP",
                  "{MODEL} = INVOICE",
                ].map((item) => (
                  <div key={item} className="rounded-box bg-base-100 px-3 py-2 font-mono text-sm">
                    {item}
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </TabbedPaneShell>
  );
}
