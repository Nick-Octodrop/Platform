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

const FORM_RETURN_TO_PARAM = "return_to";
const FORM_RETURN_LABEL_PARAM = "return_label";
const FORM_DEFAULTS_PARAM = "defaults";

function normalizeInternalReturnPath(path) {
  const value = String(path || "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  const [basePath, rawQuery = ""] = value.split("?");
  const params = new URLSearchParams(rawQuery);
  params.delete(FORM_RETURN_TO_PARAM);
  params.delete(FORM_RETURN_LABEL_PARAM);
  params.delete(FORM_DEFAULTS_PARAM);
  const suffix = params.toString();
  return `${basePath}${suffix ? `?${suffix}` : ""}`;
}

function parseCreateDefaults(search) {
  const raw = new URLSearchParams(search || "").get(FORM_DEFAULTS_PARAM);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildCreatedRecordPath(entityId, recordId, { returnTo = "", returnLabel = "" } = {}) {
  const params = new URLSearchParams();
  if (returnTo) params.set(FORM_RETURN_TO_PARAM, returnTo);
  if (returnLabel) params.set(FORM_RETURN_LABEL_PARAM, returnLabel);
  const suffix = params.toString();
  return `/data/${entityId}/${recordId}${suffix ? `?${suffix}` : ""}`;
}

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
  const createDefaults = useMemo(() => parseCreateDefaults(location.search), [location.search]);
  const returnTo = useMemo(() => normalizeInternalReturnPath(new URLSearchParams(location.search).get(FORM_RETURN_TO_PARAM)), [location.search]);
  const returnLabel = useMemo(() => String(new URLSearchParams(location.search).get(FORM_RETURN_LABEL_PARAM) || "").trim(), [location.search]);
  const draftStorageKey = useMemo(
    () =>
      buildFormDraftStorageKey({
        scope: "entity-create",
        entityId: routeEntity || entityId || "",
        recordId: "new",
        viewId: indexEntry?.formViewId || "",
        routeKey: `${location.pathname || ""}${location.search || ""}`,
      }),
    [entityId, indexEntry?.formViewId, location.pathname, location.search, routeEntity]
  );
  const hasMeaningfulDraft = useMemo(
    () =>
      Boolean(
        draft &&
          typeof draft === "object" &&
          Object.entries(draft).some(([, value]) => value !== null && value !== undefined && value !== "")
      ),
    [draft]
  );
  const isDirty = hasMeaningfulDraft;

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
        } else if (createDefaults && Object.keys(createDefaults).length > 0) {
          setDraft(applyComputedFields(index, createDefaults));
        } else {
          setDraft(applyComputedFields(index, {}));
        }
        setShowValidation(false);
        setError(null);
      } catch (err) {
        setError(err.message || "Failed to load form");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [createDefaults, draftStorageKey, indexEntry, isDataRoute, version]);

  useEffect(() => {
    if (!draftStorageKey) return;
    if (!hasMeaningfulDraft) {
      clearFormDraftSnapshot(draftStorageKey);
      return;
    }
    saveFormDraftSnapshot(draftStorageKey, {
      dirty: true,
      draft,
      updatedAt: Date.now(),
    });
  }, [draftStorageKey, draft, hasMeaningfulDraft]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  async function handleSave(validationErrors = {}) {
    if (!(isDataRoute && indexEntry)) return false;
    setShowValidation(true);
    if (validationErrors && Object.keys(validationErrors).length > 0) {
      return false;
    }
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
          navigate(buildCreatedRecordPath(routeEntity, newId, { returnTo, returnLabel }));
        } else {
          navigate(buildCreatedRecordPath(routeEntity, newId, { returnTo, returnLabel }));
        }
      } else {
        if (isDataRoute && routeEntity) {
          navigate(returnTo || `/data/${routeEntity}`);
        } else {
          navigate(returnTo || `/data/${routeEntity}`);
        }
      }
      return true;
    } catch (err) {
      setError(err.message || t("common.create_failed"));
      pushToast("error", err.message || t("common.create_failed"));
      return false;
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
            <button className="btn btn-sm" type="button" onClick={() => navigate(returnTo || `/data/${routeEntity}`)}>
              {returnLabel ? `Back to ${returnLabel}` : t("common.back")}
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
                header={viewForm.header || null}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
