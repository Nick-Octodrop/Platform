import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, getManifest } from "../api";
import FormViewRenderer from "../ui/FormViewRenderer.jsx";
import { useToast } from "../components/Toast.jsx";
import { loadEntityIndex } from "../data/entityIndex.js";
import { useModuleStore } from "../state/moduleStore.jsx";
import { getDevMode, subscribeDevMode } from "../dev/devMode.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { useAccessContext } from "../access.js";
import { applyComputedFields } from "../utils/computedFields.js";
import { getFieldValue } from "../ui/field_renderers.jsx";
import { normalizeManifestRecordPayload } from "../utils/formPayload.js";
import {
  buildFormDraftStorageKey,
  clearFormDraftSnapshot,
  formDraftValuesEqual,
  loadFormDraftSnapshot,
  resolvePersistedFormDraft,
  saveFormDraftSnapshot,
} from "../utils/formDraftPersistence.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { registerFormNavigationGuard } from "../navigation/formNavigationGuard.js";

export default function EntityRecordPage() {
  const { t, version } = useI18n();
  const { entity, id } = useParams();
  const navigate = useNavigate();
  const { modules } = useModuleStore();
  const { pushToast } = useToast();
  const [index, setIndex] = useState(null);
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState({});
  const [viewForm, setViewForm] = useState(null);
  const [fieldIndex, setFieldIndex] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [manifestError, setManifestError] = useState(null);
  const [showValidation, setShowValidation] = useState(false);
  const [autoSaveState, setAutoSaveState] = useState("idle");
  const [devMode, setDevMode] = useState(getDevMode());
  const [manifestHash, setManifestHash] = useState(null);
  const { hasCapability } = useAccessContext();
  const canWriteRecords = hasCapability("records.write");
  const isDirtyRef = React.useRef(false);
  const lastLoadedDraftKeyRef = React.useRef(null);
  const autoSaveTimerRef = React.useRef(null);
  const saveInFlightRef = React.useRef(false);
  const pendingAutoSaveRef = React.useRef(false);
  const pendingActivityCommitRef = React.useRef(null);
  const activeFieldSnapshotRef = React.useRef(null);
  const draftRef = React.useRef({});

  useEffect(() => {
    async function buildIndex() {
      const idx = await loadEntityIndex(modules);
      setIndex(idx);
    }
    buildIndex();
  }, [modules]);

  useEffect(() => {
    const handler = () => setDevMode(getDevMode());
    const unsubscribe = subscribeDevMode(handler);
    return unsubscribe;
  }, [fieldIndex]);

  const selected = index?.byId?.[entity] || null;
  const fullEntityId = selected?.entityFullId || null;
  const draftStorageKey = useMemo(
    () =>
      buildFormDraftStorageKey({
        scope: "entity-record",
        entityId: entity || "",
        recordId: id || "new",
        viewId: selected?.formViewId || "",
        routeKey: `module:${selected?.moduleId || ""}`,
      }),
    [entity, id, selected?.formViewId, selected?.moduleId]
  );
  const isDirty = useMemo(() => record != null && !formDraftValuesEqual(draft, record), [draft, record]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  function activityComparableValue(value) {
    if (value === "" || value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  function activityValuesEqual(left, right) {
    return activityComparableValue(left) === activityComparableValue(right);
  }

  function collectCommittedActivityFields(beforeRecord, afterRecord) {
    if (!beforeRecord || typeof beforeRecord !== "object" || !afterRecord || typeof afterRecord !== "object") return [];
    return Object.keys(fieldIndex || {}).filter((fieldId) => {
      const field = fieldIndex[fieldId];
      if (!field || field.type === "uuid" || fieldId === "id" || fieldId === "record_id") return false;
      const beforeValue = getFieldValue(beforeRecord, fieldId);
      const afterValue = getFieldValue(afterRecord, fieldId);
      return !activityValuesEqual(beforeValue, afterValue);
    });
  }

  function queueActivityCommit(beforeRecord) {
    if (!beforeRecord || typeof beforeRecord !== "object") return false;
    const afterRecord = draftRef.current || {};
    const fields = collectCommittedActivityFields(beforeRecord, afterRecord);
    if (fields.length === 0) return false;
    const pending = pendingActivityCommitRef.current || { beforeRecord: {}, fields: new Set() };
    for (const fieldId of fields) {
      if (!pending.fields.has(fieldId)) {
        pending.beforeRecord[fieldId] = getFieldValue(beforeRecord, fieldId);
      }
      pending.fields.add(fieldId);
    }
    pendingActivityCommitRef.current = pending;
    return true;
  }

  function queueActiveFieldCommit() {
    const snapshot = activeFieldSnapshotRef.current;
    if (!snapshot?.beforeRecord || typeof snapshot.beforeRecord !== "object") return false;
    return queueActivityCommit(snapshot.beforeRecord);
  }

  function handleActiveFieldSnapshotChange(snapshot) {
    activeFieldSnapshotRef.current = snapshot && typeof snapshot === "object" ? snapshot : null;
  }

  async function waitForSaveIdle(timeoutMs = 8000) {
    if (!saveInFlightRef.current) return true;
    const startedAt = Date.now();
    while (saveInFlightRef.current) {
      if (Date.now() - startedAt > timeoutMs) return false;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return true;
  }

  async function flushPendingActivityCommit() {
    const pending = pendingActivityCommitRef.current;
    if (!pending || !pending.fields || pending.fields.size === 0) return false;
    if (!selected || !id) return false;
    const fields = Array.from(pending.fields).filter(Boolean);
    const beforeRecord = pending.beforeRecord && typeof pending.beforeRecord === "object" ? pending.beforeRecord : {};
    pendingActivityCommitRef.current = null;
    try {
      const res = await apiFetch("/api/activity/change", {
        method: "POST",
        body: JSON.stringify({
          entity_id: selected.entityFullId || entity,
          record_id: id,
          before_record: beforeRecord,
          fields,
        }),
      });
      if (Array.isArray(res?.changes) && res.changes.length > 0 && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("octo:activity-mutated", {
            detail: { entityId: selected.entityFullId || entity, recordId: id },
          })
        );
      }
      return true;
    } catch (err) {
      console.warn("activity_commit_failed", err);
      return false;
    }
  }

  async function saveAndFlushCommittedChanges({ includeActiveField = false, showValidationErrors = false } = {}) {
    if (!canWriteRecords || !id || !record) return true;
    if (includeActiveField) {
      queueActiveFieldCommit();
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (saveInFlightRef.current) {
      pendingAutoSaveRef.current = true;
      const idle = await waitForSaveIdle();
      if (!idle) {
        setAutoSaveState("idle");
        return false;
      }
    }
    if (isDirtyRef.current) {
      saveInFlightRef.current = true;
      setAutoSaveState("saving");
      try {
        const saved = await handleSave({ silent: true, suppressActivity: true });
        setAutoSaveState(saved ? "saved" : "idle");
        if (!saved) return false;
      } finally {
        saveInFlightRef.current = false;
      }
    }
    if (pendingActivityCommitRef.current) {
      await flushPendingActivityCommit();
    }
    return true;
  }

  async function handleFieldCommit(commit) {
    if (!viewForm?.header?.auto_save || !canWriteRecords || !id || !record) return;
    if (!queueActivityCommit(commit?.beforeRecord)) return;
    if (saveInFlightRef.current) {
      pendingAutoSaveRef.current = true;
      return;
    }
    if (!isDirtyRef.current) {
      await flushPendingActivityCommit();
    }
  }

  useEffect(() => {
    async function load() {
      if (!entity || !id) return;
      if (!selected) {
        setError("Entity unavailable or disabled");
        return;
      }
      if (!selected.formViewId) {
        setManifestError("NO_FORM_VIEW");
        return;
      }
      if (record != null && isDirtyRef.current && lastLoadedDraftKeyRef.current === draftStorageKey) return;
      setLoading(true);
      try {
        const [res, manifestRes] = await Promise.all([
          apiFetch(`/records/${entity}/${id}`),
          getManifest(selected.moduleId),
        ]);
        setManifestHash(manifestRes.manifest_hash || null);
        const compiled = manifestRes.compiled;
        const view = compiled?.viewById?.get(selected.formViewId);
        const resolvedView = view || (manifestRes.manifest?.views || []).find((v) => v.id === selected.formViewId);
        setViewForm(resolvedView);
        const fieldMap = compiled?.fieldByEntity?.get(selected.entityFullId);
        const indexMap = fieldMap ? Object.fromEntries(fieldMap) : {};
        if (!fieldMap) {
          const entityDef = (manifestRes.manifest?.entities || []).find((e) => e.id === selected.entityFullId);
          for (const f of entityDef?.fields || []) indexMap[f.id] = f;
        }
        setFieldIndex(indexMap);
        const nextRecord = applyComputedFields(indexMap, res.record);
        const persisted = loadFormDraftSnapshot(draftStorageKey);
        const resolvedDraft = resolvePersistedFormDraft(nextRecord, persisted, (value) =>
          applyComputedFields(indexMap, value)
        );
        setDraft(resolvedDraft.draft);
        setRecord(resolvedDraft.initialDraft);
        lastLoadedDraftKeyRef.current = draftStorageKey;
        if (persisted?.dirty && !resolvedDraft.dirty) {
          clearFormDraftSnapshot(draftStorageKey);
        }
        setError(null);
        if (!resolvedView) {
          setManifestError("FORM_VIEW_MISSING");
        } else {
          setManifestError(null);
        }
      } catch (err) {
        setError(err.message || "Failed to load record");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [draftStorageKey, entity, id, selected?.entityFullId, selected?.moduleId, selected?.formViewId, version]);

  useEffect(() => {
    if (!draftStorageKey) return;
    if (!isDirty) {
      clearFormDraftSnapshot(draftStorageKey);
      return;
    }
    saveFormDraftSnapshot(draftStorageKey, {
      dirty: true,
      draft,
      record,
      updatedAt: Date.now(),
    });
  }, [draftStorageKey, draft, isDirty, record]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      queueActiveFieldCommit();
      if (!isDirtyRef.current && !pendingActivityCommitRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!id || !record) return undefined;
    return registerFormNavigationGuard(() =>
      saveAndFlushCommittedChanges({ includeActiveField: true, showValidationErrors: true })
    );
  }, [id, record, selected, fieldIndex, canWriteRecords]);

  async function navigateAfterSave(path) {
    const ok = await saveAndFlushCommittedChanges({ includeActiveField: true, showValidationErrors: true });
    if (!ok) return;
    navigate(path);
  }

  async function handleSave(options = {}) {
    if (!selected) return false;
    setShowValidation(true);
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const payload = normalizeManifestRecordPayload(fieldIndex, draftRef.current || {});
      const suppressActivity = options?.suppressActivity === true;
      const res = await apiFetch(`/records/${entity}/${id}`, {
        method: "PUT",
        body: JSON.stringify(
          suppressActivity
            ? { record: payload, _activity: { suppress_changes: true, suppress_chatter: true } }
            : payload
        ),
      });
      const saved = applyComputedFields(fieldIndex, res?.record || payload);
      setRecord(saved);
      setDraft(saved);
      clearFormDraftSnapshot(draftStorageKey);
      if (!silent) pushToast("success", t("common.saved"));
      return true;
    } catch (err) {
      setError(err.message || t("common.save_failed"));
      pushToast("error", err.message || t("common.save_failed"));
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (!viewForm?.header?.auto_save) return undefined;
    if (!canWriteRecords || !id || !record || !isDirty) return undefined;
    const debounceMs = Number(viewForm?.header?.auto_save_debounce_ms) || 750;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(async () => {
      if (saveInFlightRef.current) {
        pendingAutoSaveRef.current = true;
        return;
      }
      saveInFlightRef.current = true;
      setAutoSaveState("saving");
      try {
        const saved = await handleSave({ silent: true, suppressActivity: true });
        setAutoSaveState(saved ? "saved" : "idle");
        if (saved && !pendingAutoSaveRef.current) {
          await flushPendingActivityCommit();
        }
      } finally {
        saveInFlightRef.current = false;
        if (pendingAutoSaveRef.current) {
          pendingAutoSaveRef.current = false;
          saveInFlightRef.current = true;
          try {
            const saved = await handleSave({ silent: true, suppressActivity: true });
            setAutoSaveState(saved ? "saved" : "idle");
            if (saved) {
              await flushPendingActivityCommit();
            }
          } finally {
            saveInFlightRef.current = false;
          }
        }
      }
    }, debounceMs);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [canWriteRecords, draft, id, isDirty, record, viewForm?.header?.auto_save, viewForm?.header?.auto_save_debounce_ms]);

  if (!entity || !id) {
    return <div className="alert">{t("common.select_record")}</div>;
  }
  if (!selected) {
    return <div className="alert">{t("common.entity_unavailable")}</div>;
  }
  if (manifestError === "NO_FORM_VIEW") {
    return (
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="md:mt-4 rounded-box border border-base-300 bg-base-100 p-4 md:p-5">
            <h3 className="text-lg font-semibold">{t("common.no_form_view")}</h3>
            <div className="mt-1 text-sm opacity-70">{t("common.no_form_view_description")}</div>
            <button className="btn btn-ghost btn-sm mt-4" onClick={() => navigate(`/settings/diagnostics/${encodeURIComponent(selected.moduleId)}`)}>{t("common.open_diagnostics")}</button>
          </div>
        </div>
      </div>
    );
  }
  if (manifestError === "FORM_VIEW_MISSING") {
    return (
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="md:mt-4 rounded-box border border-base-300 bg-base-100 p-4 md:p-5">
            <h3 className="text-lg font-semibold">{t("common.form_view_missing")}</h3>
            <div className="mt-1 text-sm opacity-70">{t("common.form_view_missing_description")}</div>
            <button className="btn btn-ghost btn-sm mt-4" onClick={() => navigate(`/settings/diagnostics/${encodeURIComponent(selected.moduleId)}`)}>{t("common.open_diagnostics")}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={DESKTOP_PAGE_SHELL}>
      <div className={DESKTOP_PAGE_SHELL_BODY}>
        <div className="md:mt-4 flex flex-col gap-4 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">{selected.displayName}</h2>
            <button className="btn btn-sm" onClick={() => navigateAfterSave(`/data/${entity}`)}>{t("common.back")}</button>
          </div>
          {devMode && (
            <div className="rounded-box border border-base-300 bg-base-100 p-4">
              <h3 className="text-base font-semibold">Debug</h3>
              <div className="mt-2 text-sm opacity-70">Entity ID: {selected.entityId}</div>
              <div className="text-sm opacity-70">Module ID: {selected.moduleId}</div>
              <div className="text-sm opacity-70">Form View ID: {selected.formViewId || "—"}</div>
              <div className="text-sm opacity-70">Manifest Hash: {manifestHash || "—"}</div>
              <div className="text-sm opacity-70">Record ID: {id}</div>
              <div className="flex gap-2 mt-3">
                <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/apps/${selected.moduleId}`)}>Open module</button>
                <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/settings/diagnostics/${encodeURIComponent(selected.moduleId)}`)}>Open diagnostics</button>
              </div>
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
          {loading && <LoadingSpinner className="min-h-[20vh]" />}
          {viewForm && (
            <div className="rounded-box border border-base-300 bg-base-100 p-4 md:p-5">
              <FormViewRenderer
                view={viewForm}
                entityId={selected.entityId}
                recordId={id}
                fieldIndex={fieldIndex}
                record={draft}
                autoSaveState={autoSaveState}
                onChange={(next) => {
                  const computed = applyComputedFields(fieldIndex, next);
                  draftRef.current = computed;
                  setDraft(computed);
                }}
                onSave={() => handleSave()}
                readonly={!canWriteRecords}
                showValidation={showValidation}
                header={viewForm.header || null}
                onFieldCommit={handleFieldCommit}
                onActiveFieldSnapshotChange={handleActiveFieldSnapshotChange}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
