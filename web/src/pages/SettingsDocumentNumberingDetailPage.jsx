import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import { useToast } from "../components/Toast.jsx";
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

function SectionGroup({ title, description, children, className = "" }) {
  return (
    <section className={`rounded-box border border-base-300 bg-base-100 p-4 ${className}`}>
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SettingsDocumentNumberingDetailPage() {
  const { sequenceId } = useParams();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const isNew = !sequenceId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [entities, setEntities] = useState([]);
  const [draft, setDraft] = useState(emptyDraft());
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [activeTabId, setActiveTabId] = useState("details");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [listRes, metaRes] = await Promise.all([
        apiFetch("/settings/document-numbering"),
        apiFetch("/settings/document-numbering/meta"),
      ]);
      setItems(Array.isArray(listRes?.sequences) ? listRes.sequences : []);
      setEntities(Array.isArray(metaRes?.entities) ? metaRes.entities : []);
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
  }, [sequenceId]);

  const item = useMemo(() => items.find((entry) => entry.id === sequenceId) || null, [items, sequenceId]);

  useEffect(() => {
    if (item) {
      setDraft({
        ...emptyDraft(),
        ...item,
        trigger_status_values: Array.isArray(item.trigger_status_values) ? item.trigger_status_values : [],
      });
    } else if (isNew) {
      setDraft(emptyDraft());
    }
  }, [item, isNew]);

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
      pushToast("success", draft.id ? "Sequence updated." : "Sequence created.");
      await load();
      if (!draft.id && saved?.id) {
        navigate(`/settings/document-numbering/${saved.id}`, { replace: true });
      }
    } catch (err) {
      setError(err?.message || "Failed to save sequence");
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
      title=""
      subtitle=""
      tabs={[
        { id: "details", label: "Details" },
        { id: "preview", label: "Preview" },
        { id: "help", label: "Token Help" },
      ]}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      contentContainer={true}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {loading ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">Loading…</div>
      ) : !isNew && !item ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">Sequence not found.</div>
      ) : activeTabId === "details" ? (
        <div className="space-y-4">
          <SectionGroup title="Sequence details" description="Use stable internal codes and business-friendly names. Changes only affect future records.">
            {draft.id && Number(draft.assignment_count || 0) > 0 ? (
              <div className="mb-4 rounded-box border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
                This sequence is already in use on <span className="font-semibold">{draft.assignment_count}</span> record{Number(draft.assignment_count) === 1 ? "" : "s"}.
                Changes here only apply to future assignments. Historical document numbers are not renumbered.
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="form-control">
                <span className="label-text text-sm">Name</span>
                <input className="input input-bordered" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">Required. Use a clear business name like Quotes, Invoices, or Purchase Orders.</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Code</span>
                <input className="input input-bordered" value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} placeholder="sales.quote" disabled={saving} />
                <span className="label label-text-alt opacity-50">Required. Use a stable internal key. This is for admins, not end users.</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Target entity</span>
                <AppSelect
                  className="select select-bordered"
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
                  </AppSelect>
                <span className="label label-text-alt opacity-50">Required. Choose the record type that should receive this number.</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Number field</span>
                <AppSelect
                  className="select select-bordered"
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
                  </AppSelect>
                <span className="label label-text-alt opacity-50">Required. This field will store the generated document number on the record.</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Pattern</span>
                <input className="input input-bordered font-mono" value={draft.pattern} onChange={(event) => setDraft((current) => ({ ...current, pattern: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">Required. Combine text and tokens like {"{YYYY}"} or {"{SEQ:4}"} to control the final format.</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Sort order</span>
                <input className="input input-bordered" type="number" value={draft.sort_order} onChange={(event) => setDraft((current) => ({ ...current, sort_order: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">Optional. Lower numbers sort earlier when admins view these sequences.</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Scope</span>
                <AppSelect className="select select-bordered" value={draft.scope_type} onChange={(event) => setDraft((current) => ({ ...current, scope_type: event.target.value, scope_field_id: event.target.value === "entity" ? current.scope_field_id : "" }))} disabled={saving}>
                  {SCOPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">Choose whether one counter is shared globally, per entity value, or per workspace.</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Reset policy</span>
                <AppSelect className="select select-bordered" value={draft.reset_policy} onChange={(event) => setDraft((current) => ({ ...current, reset_policy: event.target.value }))} disabled={saving}>
                  {RESET_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">Choose how often the sequence counter starts again.</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">Assign on</span>
                <AppSelect className="select select-bordered" value={draft.assign_on} onChange={(event) => setDraft((current) => ({ ...current, assign_on: event.target.value, trigger_status_values: ["confirm", "issue"].includes(event.target.value) ? current.trigger_status_values : [] }))} disabled={saving}>
                  {ASSIGN_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">Choose when the number should be assigned during the record lifecycle.</span>
              </label>
              {draft.scope_type === "entity" ? (
                <label className="form-control">
                  <span className="label-text text-sm">Scope field</span>
                  <AppSelect
                    className="select select-bordered"
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
                  </AppSelect>
                  <span className="label label-text-alt opacity-50">Required for entity scope. Records with different values in this field get separate counters.</span>
                </label>
              ) : null}
              <label className="form-control">
                <span className="label-text text-sm">Description</span>
                <input className="input input-bordered" value={draft.description || ""} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">Optional. Add a short admin note about when this sequence should be used.</span>
              </label>
              <label className="form-control md:col-span-2">
                <span className="label-text text-sm">Notes</span>
                <textarea className="textarea textarea-bordered min-h-[6rem]" value={draft.notes || ""} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">Optional. Use this for implementation notes, migration details, or edge-case handling.</span>
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
              <div className="mt-4 rounded-box border border-base-300 bg-base-100 p-4">
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
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={saveDraft}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </SectionGroup>
        </div>
      ) : activeTabId === "preview" ? (
        <SectionGroup title="Live preview" description="Preview uses the current counter bucket and your current workspace context.">
          {preview ? <div className="rounded-box bg-base-100 px-4 py-3 font-mono text-sm">{preview}</div> : null}
          {previewError ? <div className="mt-2 text-sm text-warning">{previewError}</div> : null}
          {!preview && !previewError ? <div className="text-sm opacity-70">Complete the core fields to see a preview.</div> : null}
        </SectionGroup>
      ) : (
        <SectionGroup title="Token help" description="Keep patterns simple and stable. These tokens are supported in v1.">
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
        </SectionGroup>
      )}
    </TabbedPaneShell>
  );
}
