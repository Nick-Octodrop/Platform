import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { apiFetch, getManifest } from "../api";
import FormViewRenderer from "../ui/FormViewRenderer.jsx";
import { useModuleStore } from "../state/moduleStore.jsx";
import { useToast } from "../components/Toast.jsx";
import { loadEntityIndex } from "../data/entityIndex.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { applyComputedFields } from "../utils/computedFields.js";
import { normalizeManifestRecordPayload } from "../utils/formPayload.js";
import {
  buildFormDraftStorageKey,
  clearFormDraftSnapshot,
  loadFormDraftSnapshot,
  saveFormDraftSnapshot,
} from "../utils/formDraftPersistence.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function EntityCreatePage({ entityId }) {
  const { t, version } = useI18n();
  const params = useParams();
  const location = useLocation();
  const routeEntity = params.entity;
  const isDataRoute = location.pathname.startsWith("/data/");
  const navigate = useNavigate();
  const { modules } = useModuleStore();
  const { pushToast } = useToast();
  const [manifest, setManifest] = useState(null);
  const [viewForm, setViewForm] = useState(null);
  const [fieldIndex, setFieldIndex] = useState({});
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [error, setError] = useState(null);
  const [indexEntry, setIndexEntry] = useState(null);
  const draftStorageKey = useMemo(
    () =>
      buildFormDraftStorageKey({
        scope: "entity-create",
        entityId: routeEntity || entityId || "",
        recordId: "new",
        viewId: indexEntry?.formViewId || "",
        routeKey: location.pathname || "",
      }),
    [entityId, indexEntry?.formViewId, location.pathname, routeEntity]
  );
  const isDirty = useMemo(() => {
    try {
      return JSON.stringify(draft || {}) !== JSON.stringify({});
    } catch {
      return true;
    }
  }, [draft]);

  useEffect(() => {
    async function buildIndex() {
      const idx = await loadEntityIndex(modules);
      const entry = routeEntity ? idx.byId?.[routeEntity] : null;
      setIndexEntry(entry || null);
    }
    buildIndex();
  }, [modules, routeEntity]);

  useEffect(() => {
    async function load() {
      if (!(isDataRoute && indexEntry)) return;
      setLoading(true);
      try {
        const moduleId = indexEntry?.moduleId;
        const formViewId = indexEntry?.formViewId;
        const entityFullId = indexEntry?.entityFullId;
        const manifestRes = await getManifest(moduleId);
        setManifest(manifestRes.manifest);
        const compiled = manifestRes.compiled;
        const view = compiled?.viewById?.get(formViewId);
        setViewForm(view || (manifestRes.manifest?.views || []).find((v) => v.id === formViewId));
        const fieldMap = compiled?.fieldByEntity?.get(entityFullId);
        const index = fieldMap ? Object.fromEntries(fieldMap) : {};
        if (!fieldMap) {
          const entity = (manifestRes.manifest?.entities || []).find((e) => e.id === entityFullId);
          for (const f of entity?.fields || []) index[f.id] = f;
        }
        setFieldIndex(index);
        const persisted = loadFormDraftSnapshot(draftStorageKey);
        if (persisted?.dirty && persisted?.draft && typeof persisted.draft === "object") {
          setDraft(applyComputedFields(index, persisted.draft));
        }
        setError(null);
      } catch (err) {
        setError(err.message || "Failed to load form");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [draftStorageKey, indexEntry, isDataRoute, version]);

  useEffect(() => {
    if (!draftStorageKey) return;
    const hasMeaningfulDraft =
      draft &&
      typeof draft === "object" &&
      Object.entries(draft).some(([, value]) => value !== null && value !== undefined && value !== "");
    if (!hasMeaningfulDraft) {
      clearFormDraftSnapshot(draftStorageKey);
      return;
    }
    saveFormDraftSnapshot(draftStorageKey, {
      dirty: true,
      draft,
      updatedAt: Date.now(),
    });
  }, [draftStorageKey, draft]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  async function handleSave() {
    if (!(isDataRoute && indexEntry)) return;
    setShowValidation(true);
    setLoading(true);
    try {
      const endpoint = `/records/${routeEntity}`;
      const payload = normalizeManifestRecordPayload(fieldIndex, draft);
      const res = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const newId = res.record_id || res.job_id;
      clearFormDraftSnapshot(draftStorageKey);
      pushToast("success", t("common.created"));
      if (newId) {
        if (isDataRoute && routeEntity) {
          navigate(`/data/${routeEntity}/${newId}`);
        } else {
          navigate(`/data/${routeEntity}/${newId}`);
        }
      } else {
        if (isDataRoute && routeEntity) {
          navigate(`/data/${routeEntity}`);
        } else {
          navigate(`/data/${routeEntity}`);
        }
      }
    } catch (err) {
      setError(err.message || t("common.create_failed"));
      pushToast("error", err.message || t("common.create_failed"));
    } finally {
      setLoading(false);
    }
  }

  if (isDataRoute && routeEntity && !indexEntry) {
    return <div className="alert alert-error">{t("common.entity_unavailable")}</div>;
  }

  const displayName = indexEntry?.displayName || routeEntity;

  return (
    <div className={DESKTOP_PAGE_SHELL}>
      <div className={DESKTOP_PAGE_SHELL_BODY}>
        <div className="md:mt-4 flex flex-col gap-4 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">{t("common.new_record_named", { name: displayName })}</h2>
            <button className="btn btn-sm" type="button" onClick={() => navigate(`/data/${routeEntity}`)}>
              {t("common.back")}
            </button>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          {loading && <LoadingSpinner className="min-h-[20vh]" />}
          {manifest && viewForm && (
            <div className="rounded-box border border-base-300 bg-base-100 p-4 md:p-5">
              <FormViewRenderer
                view={viewForm}
                entityId={routeEntity}
                recordId={null}
                fieldIndex={fieldIndex}
                record={draft}
                onChange={(next) => setDraft(applyComputedFields(fieldIndex, next))}
                onSave={handleSave}
                readonly={false}
                showValidation={showValidation}
                applyDefaults={true}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
