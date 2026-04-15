import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import { useToast } from "../components/Toast.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";

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
  const { t } = useI18n();
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
  const [selectedPatternFieldId, setSelectedPatternFieldId] = useState("");

  const scopeOptions = useMemo(
    () => [
      { value: "global", label: t("settings.document_numbering.detail.scope_options.global") },
      { value: "entity", label: t("settings.document_numbering.detail.scope_options.entity") },
      { value: "workspace", label: t("settings.document_numbering.detail.scope_options.workspace") },
    ],
    [t],
  );

  const resetOptions = useMemo(
    () => [
      { value: "never", label: t("settings.document_numbering.detail.reset_options.never") },
      { value: "yearly", label: t("settings.document_numbering.detail.reset_options.yearly") },
      { value: "monthly", label: t("settings.document_numbering.detail.reset_options.monthly") },
    ],
    [t],
  );

  const assignOptions = useMemo(
    () => [
      { value: "create", label: t("settings.document_numbering.detail.assign_options.create") },
      { value: "save", label: t("settings.document_numbering.detail.assign_options.save") },
      { value: "confirm", label: t("settings.document_numbering.detail.assign_options.confirm") },
      { value: "issue", label: t("settings.document_numbering.detail.assign_options.issue") },
      { value: "custom", label: t("settings.document_numbering.detail.assign_options.custom") },
    ],
    [t],
  );

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
      setError(err?.message || t("settings.document_numbering.load_failed"));
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

  useEffect(() => {
    setSelectedPatternFieldId("");
  }, [draft.target_entity_id]);

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

  const patternFields = useMemo(
    () =>
      (selectedEntity?.fields || []).filter((field) =>
        ["string", "text", "enum", "lookup", "user", "number", "date", "datetime"].includes(field.type),
      ),
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
        setPreviewError(err?.message || t("settings.document_numbering.preview_unavailable"));
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
      pushToast("success", draft.id ? t("settings.document_numbering.detail.updated") : t("settings.document_numbering.detail.created"));
      await load();
      if (!draft.id && saved?.id) {
        navigate(`/settings/document-numbering/${saved.id}`, { replace: true });
      }
    } catch (err) {
      setError(err?.message || t("settings.document_numbering.detail.save_failed"));
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

  function insertFieldToken() {
    if (!selectedPatternFieldId) return;
    const token = `{FIELD:${selectedPatternFieldId}}`;
    setDraft((current) => ({ ...current, pattern: `${current.pattern || ""}${token}` }));
  }

  return (
    <TabbedPaneShell
      title=""
      subtitle=""
      tabs={[
        { id: "details", label: t("settings.document_numbering.detail.tabs.details") },
        { id: "preview", label: t("settings.document_numbering.detail.tabs.preview") },
        { id: "help", label: t("settings.document_numbering.detail.tabs.help") },
      ]}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      contentContainer={true}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {loading ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">{t("common.loading")}</div>
      ) : !isNew && !item ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">{t("settings.document_numbering.detail.not_found")}</div>
      ) : activeTabId === "details" ? (
        <div className="space-y-4">
          <SectionGroup title={t("settings.document_numbering.detail.sequence_title")} description={t("settings.document_numbering.detail.sequence_description")}>
            {draft.id && Number(draft.assignment_count || 0) > 0 ? (
              <div className="mb-4 rounded-box border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
                {t("settings.document_numbering.detail.assignment_warning", { count: Number(draft.assignment_count || 0) })}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.name")}</span>
                <input className="input input-bordered" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.name_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.code")}</span>
                <input className="input input-bordered" value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} placeholder="sales.quote" disabled={saving} />
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.code_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.detail.target_entity")}</span>
                <AppSelect
                  className="select select-bordered"
                  value={draft.target_entity_id}
                  onChange={(event) => setDraft((current) => ({ ...current, target_entity_id: event.target.value, number_field_id: "", scope_field_id: "", trigger_status_values: [] }))}
                  disabled={saving}
                >
                  <option value="">{t("settings.document_numbering.detail.select_entity")}</option>
                  {entities.map((entity) => (
                    <option key={entity.entity_id} value={entity.entity_id}>
                      {entity.label || entity.entity_id}
                    </option>
                    ))}
                  </AppSelect>
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.target_entity_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.detail.number_field")}</span>
                <AppSelect
                  className="select select-bordered"
                  value={draft.number_field_id}
                  onChange={(event) => setDraft((current) => ({ ...current, number_field_id: event.target.value }))}
                  disabled={saving || !draft.target_entity_id}
                >
                  <option value="">{t("settings.document_numbering.detail.select_field")}</option>
                  {numberFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                    </option>
                    ))}
                  </AppSelect>
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.number_field_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.detail.pattern")}</span>
                <input className="input input-bordered font-mono" value={draft.pattern} onChange={(event) => setDraft((current) => ({ ...current, pattern: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.pattern_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.detail.field_token")}</span>
                <div className="flex gap-2">
                  <AppSelect
                    className="select select-bordered flex-1"
                    value={selectedPatternFieldId}
                    onChange={(event) => setSelectedPatternFieldId(event.target.value)}
                    disabled={saving || !draft.target_entity_id}
                  >
                    <option value="">{t("settings.document_numbering.detail.select_field_token")}</option>
                    {patternFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label}
                      </option>
                    ))}
                  </AppSelect>
                  <button className="btn btn-outline" type="button" onClick={insertFieldToken} disabled={saving || !selectedPatternFieldId}>
                    {t("settings.document_numbering.detail.insert_field_token")}
                  </button>
                </div>
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.field_token_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.detail.sort_order")}</span>
                <input className="input input-bordered" type="number" value={draft.sort_order} onChange={(event) => setDraft((current) => ({ ...current, sort_order: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.sort_order_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.detail.scope")}</span>
                <AppSelect className="select select-bordered" value={draft.scope_type} onChange={(event) => setDraft((current) => ({ ...current, scope_type: event.target.value, scope_field_id: event.target.value === "entity" ? current.scope_field_id : "" }))} disabled={saving}>
                  {scopeOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.scope_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.detail.reset_policy")}</span>
                <AppSelect className="select select-bordered" value={draft.reset_policy} onChange={(event) => setDraft((current) => ({ ...current, reset_policy: event.target.value }))} disabled={saving}>
                  {resetOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.reset_policy_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.document_numbering.assign_on")}</span>
                <AppSelect className="select select-bordered" value={draft.assign_on} onChange={(event) => setDraft((current) => ({ ...current, assign_on: event.target.value, trigger_status_values: ["confirm", "issue"].includes(event.target.value) ? current.trigger_status_values : [] }))} disabled={saving}>
                  {assignOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.assign_on_help")}</span>
              </label>
              {draft.scope_type === "entity" ? (
                <label className="form-control">
                  <span className="label-text text-sm">{t("settings.document_numbering.detail.scope_field")}</span>
                  <AppSelect
                    className="select select-bordered"
                    value={draft.scope_field_id}
                    onChange={(event) => setDraft((current) => ({ ...current, scope_field_id: event.target.value }))}
                    disabled={saving || !draft.target_entity_id}
                  >
                    <option value="">{t("settings.document_numbering.detail.select_field")}</option>
                    {scopeFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label}
                      </option>
                    ))}
                  </AppSelect>
                  <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.scope_field_help")}</span>
                </label>
              ) : null}
              <label className="form-control">
                <span className="label-text text-sm">{t("settings.access_policies.description")}</span>
                <input className="input input-bordered" value={draft.description || ""} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.description_help")}</span>
              </label>
              <label className="form-control md:col-span-2">
                <span className="label-text text-sm">{t("settings.document_numbering.detail.notes")}</span>
                <textarea className="textarea textarea-bordered min-h-[6rem]" value={draft.notes || ""} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
                <span className="label label-text-alt opacity-50">{t("settings.document_numbering.detail.notes_help")}</span>
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="flex items-center gap-3 rounded-box border border-base-300 bg-base-200/40 px-3 py-3 text-sm">
                <input type="checkbox" className="checkbox checkbox-sm" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} disabled={saving} />
                {t("common.active")}
              </label>
              <label className="flex items-center gap-3 rounded-box border border-base-300 bg-base-200/40 px-3 py-3 text-sm">
                <input type="checkbox" className="checkbox checkbox-sm" checked={draft.lock_after_assignment} onChange={(event) => setDraft((current) => ({ ...current, lock_after_assignment: event.target.checked }))} disabled={saving} />
                {t("settings.document_numbering.detail.lock_after_assignment")}
              </label>
              <label className="flex items-center gap-3 rounded-box border border-base-300 bg-base-200/40 px-3 py-3 text-sm">
                <input type="checkbox" className="checkbox checkbox-sm" checked={draft.allow_admin_override} onChange={(event) => setDraft((current) => ({ ...current, allow_admin_override: event.target.checked }))} disabled={saving} />
                {t("settings.document_numbering.detail.allow_admin_override")}
              </label>
            </div>

            {assignNeedsStatuses ? (
              <div className="mt-4 rounded-box border border-base-300 bg-base-100 p-4">
                <div className="text-sm font-medium">{t("settings.document_numbering.detail.trigger_statuses")}</div>
                <div className="mt-1 text-xs opacity-70">{t("settings.document_numbering.detail.trigger_statuses_help")}</div>
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
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </SectionGroup>
        </div>
      ) : activeTabId === "preview" ? (
        <SectionGroup title={t("settings.document_numbering.detail.live_preview")} description={t("settings.document_numbering.detail.live_preview_description")}>
          {preview ? <div className="rounded-box bg-base-100 px-4 py-3 font-mono text-sm">{preview}</div> : null}
          {previewError ? <div className="mt-2 text-sm text-warning">{previewError}</div> : null}
          {!preview && !previewError ? <div className="text-sm opacity-70">{t("settings.document_numbering.detail.preview_hint")}</div> : null}
        </SectionGroup>
      ) : (
        <SectionGroup title={t("settings.document_numbering.detail.token_help")} description={t("settings.document_numbering.detail.token_help_description")}>
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
              "{FIELD:invoice.state} = NSW",
              "{FIELD:contact.name} = ACMELTD",
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
