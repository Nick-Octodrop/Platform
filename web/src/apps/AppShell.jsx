import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiFetch, compileManifest, deleteRecord, getActiveWorkspaceId, getManifest, getPageBootstrap, runManifestAction, subscribeRecordMutations } from "../api";
import { realtimeEnabled, supabase } from "../supabase";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import FormViewRenderer from "../ui/FormViewRenderer.jsx";
import ContentBlocksRenderer from "../ui/ContentBlocksRenderer.jsx";
import { getFieldValue } from "../ui/field_renderers.jsx";
import { notifyAutomationRunsStarted } from "../components/BackgroundAutomationTracker.jsx";
import { useToast } from "../components/Toast.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import DaisyTooltip from "../components/DaisyTooltip.jsx";
import AppSelect from "../components/AppSelect.jsx";
import { PRIMARY_BUTTON, PRIMARY_BUTTON_SM, SOFT_BUTTON_SM, SOFT_BUTTON_XS } from "../components/buttonStyles.js";
import { buildRouteWithQuery, buildTargetRoute, deriveAppHomeRoute, resolveAppTarget, resolveRouteTarget } from "./appShellUtils.js";
import { evalCondition } from "../utils/conditions.js";
import { applyComputedFields } from "../utils/computedFields.js";
import {
  buildFormDraftStorageKey,
  clearFormDraftSnapshot,
  formDraftValuesEqual,
  loadFormDraftSnapshot,
  resolvePersistedFormDraft,
  saveFormDraftSnapshot,
} from "../utils/formDraftPersistence.js";
import { waitForPendingLineItemWrites } from "../utils/pendingLineItemWrites.js";
import { normalizeManifestRecordPayload } from "../utils/formPayload.js";
import { useAccessContext } from "../access.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { localizeManifest } from "../i18n/manifest.js";
import { translateRuntime } from "../i18n/runtime.js";
import { registerFormNavigationGuard, runFormNavigationGuard } from "../navigation/formNavigationGuard.js";

function deriveRecordEntityId(entityId) {
  if (!entityId) return "";
  return entityId;
}

function actionRequestsEmailCompose(action) {
  if (!action || typeof action !== "object") return false;
  if (action.email_compose === true || (action.email_compose && typeof action.email_compose === "object")) return true;
  const ui = action.ui && typeof action.ui === "object" ? action.ui : {};
  if (ui.mode === "compose_before_send") return true;
  if (ui.email_compose === true || (ui.email_compose && typeof ui.email_compose === "object")) return true;
  return false;
}

function splitEmailInput(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toRouteEntityId(entityId) {
  if (!entityId || typeof entityId !== "string") return "";
  return entityId.startsWith("entity.") ? entityId.slice("entity.".length) : entityId;
}

function entitiesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith("entity.") && a.slice("entity.".length) === b) return true;
  if (b.startsWith("entity.") && b.slice("entity.".length) === a) return true;
  return false;
}

function matchEntity(viewEntity, entityId, entityFullId) {
  if (!viewEntity) return false;
  if (viewEntity === entityFullId) return true;
  if (viewEntity === entityId) return true;
  if (entityFullId?.startsWith("entity.") && viewEntity === entityFullId.slice("entity.".length)) return true;
  if (viewEntity?.startsWith("entity.") && viewEntity === `entity.${entityId}`) return true;
  return false;
}

function resolveEntityFullId(manifest, viewEntity) {
  const entities = Array.isArray(manifest?.entities) ? manifest.entities : [];
  const match = entities.find((e) => e.id === viewEntity);
  if (match) return match.id;
  if (viewEntity && !viewEntity.startsWith("entity.")) {
    const prefixed = `entity.${viewEntity}`;
    const prefMatch = entities.find((e) => e.id === prefixed);
    return prefMatch ? prefMatch.id : viewEntity;
  }
  return viewEntity;
}

function resolveEntityDefaults(appDefaults, entityFullId) {
  if (!appDefaults || !appDefaults.entities) return null;
  const map = appDefaults.entities || {};
  const shortId = entityFullId?.startsWith("entity.") ? entityFullId.slice("entity.".length) : entityFullId;
  return map[entityFullId] || map[shortId] || null;
}

function resolveEntityDefaultFormPage(appDefaults, entityFullId) {
  const entityDefaults = resolveEntityDefaults(appDefaults, entityFullId);
  return entityDefaults?.entity_form_page || appDefaults?.entity_form_page || null;
}

function resolveEntityDefaultHomePage(appDefaults, entityFullId) {
  const entityDefaults = resolveEntityDefaults(appDefaults, entityFullId);
  return entityDefaults?.entity_home_page || appDefaults?.entity_home_page || null;
}

const FORM_RETURN_TO_PARAM = "return_to";
const FORM_RETURN_LABEL_PARAM = "return_label";
const FORM_DEFAULTS_PARAM = "defaults";

function stripFormReturnParams(path) {
  if (!path || typeof path !== "string") return "";
  const [basePath, rawQuery = ""] = path.split("?");
  const params = new URLSearchParams(rawQuery);
  params.delete(FORM_RETURN_TO_PARAM);
  params.delete(FORM_RETURN_LABEL_PARAM);
  params.delete(FORM_DEFAULTS_PARAM);
  const suffix = params.toString();
  return `${basePath}${suffix ? `?${suffix}` : ""}`;
}

function normalizeInternalReturnPath(path) {
  const value = String(path || "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return stripFormReturnParams(value);
}

function parseCreateDefaultsParam(searchParams) {
  const raw = searchParams?.get?.(FORM_DEFAULTS_PARAM);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatBackToEntityLabel(entityLabel) {
  const entity = String(entityLabel || "").trim() || translateRuntime("common.record");
  return translateRuntime("common.back_to_entity", { entity }, { defaultValue: `Back to ${entity}` });
}

function getFormViewId(manifest, viewEntity) {
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const entityFullId = resolveEntityFullId(manifest, viewEntity);
  const entityId = entityFullId?.startsWith("entity.") ? entityFullId.slice("entity.".length) : entityFullId;
  const form = views.find((v) => {
    const kind = v?.kind || v?.type;
    const ent = v?.entity || v?.entity_id || v?.entityId;
    return kind === "form" && matchEntity(ent, entityId, entityFullId);
  });
  return form?.id || null;
}

function getListViewId(manifest, viewEntity) {
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const entityFullId = resolveEntityFullId(manifest, viewEntity);
  const entityId = entityFullId?.startsWith("entity.") ? entityFullId.slice("entity.".length) : entityFullId;
  const list = views.find((v) => {
    const kind = v?.kind || v?.type;
    const ent = v?.entity || v?.entity_id || v?.entityId;
    return kind === "list" && matchEntity(ent, entityId, entityFullId);
  });
  return list?.id || null;
}

function matchEntityId(requested, declared) {
  if (requested === declared) return true;
  if (declared?.startsWith("entity.") && requested === declared.slice("entity.".length)) return true;
  if (requested?.startsWith("entity.") && requested.slice("entity.".length) === declared) return true;
  return false;
}

function findWorkflow(manifest, entityId) {
  const workflows = Array.isArray(manifest?.workflows) ? manifest.workflows : [];
  return workflows.find((wf) => wf?.entity && matchEntityId(entityId, wf.entity)) || null;
}

const PENDING_MATERIAL_GATE_KEY = "octo.pendingMaterialBeforeClockOut";

function readPendingMaterialGate() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_MATERIAL_GATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writePendingMaterialGate(payload) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_MATERIAL_GATE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}

function clearPendingMaterialGate() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_MATERIAL_GATE_KEY);
  } catch {
    // ignore storage failures
  }
}

function buildMaterialLogDefaultsFromTimeEntry(record = {}) {
  return {
    "material_log.project_id": record["time_entry.project_id"] ?? null,
    "material_log.site_id": record["time_entry.site_id"] ?? null,
    "material_log.work_item_id": record["time_entry.work_item_id"] ?? null,
    "material_log.log_date": record["time_entry.entry_date"] ?? null,
    "material_log.entered_by_worker_id": record["time_entry.worker_id"] ?? null,
    "material_log.status": "draft",
  };
}

function resolveActionLabel(action, manifest, views) {
  if (!action || typeof action !== "object") return translateRuntime("common.action");
  if (action.label) return action.label;
  const kind = action.kind;
  if (kind === "create_record" || kind === "open_form") return translateRuntime("common.create");
  if (kind === "update_record") return translateRuntime("common.save");
  if (kind === "refresh") return translateRuntime("common.refresh");
  if (kind === "navigate") {
    const target = action.target;
    const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
    if (typeof target === "string") {
      if (target.startsWith("page:")) {
        const pageId = target.slice("page:".length);
        const page = pages.find((p) => p?.id === pageId);
        if (page?.title) return page.title;
      }
      if (target.startsWith("view:")) {
        const viewId = target.slice("view:".length);
        const view = (views || []).find((v) => v?.id === viewId);
        if (view?.title) return view.title;
      }
      const page = pages.find((p) => p?.id === target);
      if (page?.title) return page.title;
    }
    return translateRuntime("common.open");
  }
  return translateRuntime("common.action");
}

function _conditionEvalContext(record, actor = null) {
  return { record: record || {}, actor: actor || {} };
}

function isEmptyFieldValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    return !value.some((item) => {
      if (typeof item === "string") return item.trim().length > 0;
      if (!item || typeof item !== "object") return false;
      return Boolean(item.id || item.attachment_id || item.storage_key || item.filename);
    });
  }
  if (value && typeof value === "object") {
    return !Boolean(value.id || value.attachment_id || value.storage_key || value.filename);
  }
  return value === "" || value === null || value === undefined;
}

function isValidationUiEnabled(config) {
  if (config === false) return false;
  if (config === true || config === undefined || config === null) return true;
  if (typeof config !== "object") return true;
  const mode = config.mode || config.behaviour || config.behavior;
  return mode !== "none" && config.enabled !== false;
}

function extractValidationFieldIds(errors, fieldIndex) {
  if (!Array.isArray(errors) || !fieldIndex) return [];
  const ids = [];
  for (const error of errors) {
    const path = typeof error?.path === "string" ? error.path : "";
    const fieldId = path && fieldIndex[path] ? path : null;
    if (!fieldId) continue;
    const field = fieldIndex[fieldId];
    if (!field || field.readonly === true || field.system === true || field.compute) continue;
    ids.push(fieldId);
  }
  return Array.from(new Set(ids));
}

function collectConditionMissingFields(condition, record, missing, actor = null) {
  if (!condition || typeof condition !== "object") return;
  const op = condition.op;
  if (op === "exists") {
    const fieldId = condition.field;
    if (typeof fieldId === "string") {
      const value = getFieldValue(record || {}, fieldId);
      if (isEmptyFieldValue(value)) {
        missing.add(fieldId);
      }
    }
    return;
  }
  if (typeof condition.field === "string" && ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"].includes(op)) {
    if (!evalCondition(condition, _conditionEvalContext(record, actor))) {
      missing.add(condition.field);
    }
    return;
  }
  if (op === "and" && Array.isArray(condition.conditions)) {
    condition.conditions.forEach((child) => {
      if (!evalCondition(child, _conditionEvalContext(record, actor))) {
        collectConditionMissingFields(child, record, missing, actor);
      }
    });
    return;
  }
  if (op === "or" && Array.isArray(condition.conditions)) {
    const children = condition.conditions.filter((child) => child && typeof child === "object");
    if (children.some((child) => evalCondition(child, _conditionEvalContext(record, actor)))) {
      return;
    }
    children.forEach((child) => collectConditionMissingFields(child, record, missing, actor));
    return;
  }
  if (op === "not" && condition.condition) {
    if (evalCondition(condition.condition, _conditionEvalContext(record, actor))) {
      collectConditionMissingFields(condition.condition, record, missing, actor);
    }
  }
}

function explainActionDisabled(action, record, fieldIndex, { missingRecord = false, missingSelection = false, actor = null } = {}) {
  if (missingRecord) return translateRuntime("common.save_record_first");
  if (missingSelection) return translateRuntime("common.select_records_first");
  const cond = action?.enabled_when;
  if (!cond) return null;
  const enabled = evalCondition(cond, _conditionEvalContext(record, actor));
  if (enabled) return null;
  const missing = new Set();
  collectConditionMissingFields(cond, record || {}, missing, actor);
  if (missing.size === 0) return translateRuntime("validation.requirements_not_met");
  const labels = Array.from(missing).map((fieldId) => fieldIndex?.[fieldId]?.label || fieldId);
  return translateRuntime("validation.missing_fields", { fields: labels.join(", ") });
}

function isWriteActionKind(kind) {
  // `open_form` is the primary "New" affordance for Studio modules.
  return kind === "create_record" || kind === "open_form" || kind === "update_record" || kind === "bulk_update" || kind === "transform_record";
}

function collectFormPageIds(appDefaults) {
  const ids = new Set();
  if (!appDefaults || typeof appDefaults !== "object") return ids;
  const normalize = (v) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) return "";
    return s.startsWith("page:") ? s.slice("page:".length) : s;
  };
  if (typeof appDefaults.entity_form_page === "string" && appDefaults.entity_form_page.trim()) {
    const id = normalize(appDefaults.entity_form_page);
    if (id) ids.add(id);
  }
  const entities = appDefaults.entities && typeof appDefaults.entities === "object" ? appDefaults.entities : null;
  if (entities) {
    for (const entDefaults of Object.values(entities)) {
      if (!entDefaults || typeof entDefaults !== "object") continue;
      if (typeof entDefaults.entity_form_page === "string" && entDefaults.entity_form_page.trim()) {
        const id = normalize(entDefaults.entity_form_page);
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

function buildFieldIndex(manifest, compiled, entityFullId) {
  const fieldMap = compiled?.fieldByEntity?.get(entityFullId);
  if (fieldMap) return Object.fromEntries(fieldMap);
  const entity = (manifest?.entities || []).find((e) => e.id === entityFullId);
  const index = {};
  for (const f of entity?.fields || []) {
    if (f?.id) index[f.id] = f;
  }
  return index;
}

function humanizeEntityId(entityId) {
  if (!entityId) return "";
  const raw = entityId.startsWith("entity.") ? entityId.slice("entity.".length) : entityId;
  return raw
    .replace(/[_\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function getByPath(data, path) {
  if (!data || typeof data !== "object" || typeof path !== "string") return undefined;
  if (path in data) return data[path];
  const parts = path.split(".");
  let cur = data;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in cur) cur = cur[part];
    else return undefined;
  }
  return cur;
}

function resolveTemplateRefs(value, record) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplateRefs(item, record));
  if (value && typeof value === "object") {
    if (typeof value.ref === "string") {
      if (value.ref === "$record.id") return record?.id ?? null;
      if (value.ref.startsWith("$record.")) return getByPath(record, value.ref.slice("$record.".length));
      return getByPath(record, value.ref);
    }
    const next = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = resolveTemplateRefs(nested, record);
    }
    return next;
  }
  return value;
}

export default function AppShell({
  previewMode = false,
  previewAllowNav = false,
  manifestOverride = null,
  moduleIdOverride = null,
} = {}) {
  const { moduleId: routeModuleId, pageId, viewId } = useParams();
  const moduleId = moduleIdOverride || routeModuleId;
  const [searchParams, setSearchParams] = useSearchParams();
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewSearchParams, setPreviewSearchParams] = useState(new URLSearchParams());
  const [previewStoreVersion, setPreviewStoreVersion] = useState(0);
  const previewStoreRef = useRef({ entities: new Map() });
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { pushToast } = useToast();
  const [manifest, setManifest] = useState(null);
  const [compiled, setCompiled] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [viewModesRefreshTick, setViewModesRefreshTick] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [recordDraft, setRecordDraft] = useState({});
  const [modal, setModal] = useState(null);
  const [modalInput, setModalInput] = useState("");
  const modalResolveRef = useRef(null);
  const [createModals, setCreateModals] = useState([]);
  const [bootstrap, setBootstrap] = useState(null);
  const [bootstrapVersion, setBootstrapVersion] = useState(0);
  const [workspaceKey, setWorkspaceKey] = useState(() => getActiveWorkspaceId());
  const pageSectionLoadingKeysRef = useRef(new Set());
  const [pageSectionLoadingCount, setPageSectionLoadingCount] = useState(0);
  const [awaitingPageReady, setAwaitingPageReady] = useState(true);
  const realtimeDebounceRef = useRef(null);
  const mutationDebounceRef = useRef(null);
  const [errorFlash, setErrorFlash] = useState(null);
  const [errorFlashUntil, setErrorFlashUntil] = useState(0);
  const errorFlashTimerRef = useRef(null);
  const [globalActionState, setGlobalActionState] = useState({ status: "idle", label: null, kind: null });
  const previewRouteTarget = previewMode ? (searchParams.get("preview_target") || null) : null;

  const recordId = (previewMode ? previewSearchParams : searchParams).get("record");
  const { actor: currentActor, hasCapability, isSuperadmin } = useAccessContext();
  const { version: i18nVersion } = useI18n();
  // Respect both platform/workspace permissions and optional per-page bootstrap overrides.
  const canWriteRecords = hasCapability("records.write") && bootstrap?.permissions?.records_write !== false;

  const registerNavigationGuard = useCallback((guard) => {
    return registerFormNavigationGuard(guard);
  }, []);

  async function runNavigationGuard() {
    try {
      return await runFormNavigationGuard();
    } catch (err) {
      console.warn("navigation_guard_failed", err);
      pushToast("error", err?.message || translateRuntime("common.save_failed"));
      return false;
    }
  }

  useEffect(() => {
    if (moduleId === "octo_ai" && !isSuperadmin) {
      navigate("/home", { replace: true });
    }
  }, [isSuperadmin, moduleId, navigate]);

  useLayoutEffect(() => {
    if (manifestOverride) return;
    setLoading(true);
    setBootstrapLoading(Boolean(pageId || viewId));
    pageSectionLoadingKeysRef.current = new Set();
    setPageSectionLoadingCount(0);
    setAwaitingPageReady(true);
    setManifest(null);
    setCompiled(null);
    setBootstrap(null);
    setBootstrapVersion((v) => v + 1);
    setError(null);
    setSelectedIds([]);
    setRecordDraft({});
  }, [moduleId, pageId, viewId, recordId, workspaceKey, manifestOverride, i18nVersion]);

  const handlePageSectionLoadingChange = useCallback((key, isLoading) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return;
    const next = new Set(pageSectionLoadingKeysRef.current);
    if (isLoading) next.add(safeKey);
    else next.delete(safeKey);
    pageSectionLoadingKeysRef.current = next;
    setPageSectionLoadingCount(next.size);
  }, []);

  useEffect(() => {
    if (typeof performance !== "undefined" && performance.mark) {
      performance.mark("nav_start");
    }
  }, [moduleId, pageId, viewId, recordId]);

  useEffect(() => {
    function handleWorkspaceChanged() {
      setWorkspaceKey(getActiveWorkspaceId());
    }
    if (typeof window === "undefined") return undefined;
    window.addEventListener("octo:workspace-changed", handleWorkspaceChanged);
    return () => window.removeEventListener("octo:workspace-changed", handleWorkspaceChanged);
  }, []);

  useEffect(() => {
    async function loadManifest() {
      if (!moduleId) return;
      if (pageId || viewId) return;
      setLoading(true);
      try {
        if (manifestOverride) {
          const localizedManifest = await localizeManifest(manifestOverride);
          setManifest(localizedManifest);
          setCompiled(compileManifest(localizedManifest));
          setError(null);
          return;
        }
        const res = await getManifest(moduleId);
        setManifest(res.manifest);
        setCompiled(res.compiled);
        setError(null);
      } catch (err) {
        setError(err.message || translateRuntime("common.load_failed"));
      } finally {
        setLoading(false);
      }
    }
    loadManifest();
  }, [moduleId, manifestOverride, pageId, viewId, workspaceKey, i18nVersion]);

  useEffect(() => {
    if (!error) return;
    const holdMs = 2000;
    const until = Date.now() + holdMs;
    setErrorFlash(error);
    setErrorFlashUntil(until);
    if (errorFlashTimerRef.current) {
      clearTimeout(errorFlashTimerRef.current);
    }
    errorFlashTimerRef.current = setTimeout(() => {
      setErrorFlashUntil(0);
    }, holdMs);
    return () => {
      if (errorFlashTimerRef.current) {
        clearTimeout(errorFlashTimerRef.current);
        errorFlashTimerRef.current = null;
      }
    };
  }, [error]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const body = document.body;
    const previousCursor = body.style.cursor;
    if (globalActionState.status === "running") {
      body.style.cursor = "progress";
    }
    return () => {
      body.style.cursor = previousCursor;
    };
  }, [globalActionState.status]);

  useEffect(() => {
    let cancelled = false;
    async function loadBootstrap() {
      if (!moduleId || (!pageId && !viewId)) return;
      if (manifestOverride) {
        const localizedManifest = await localizeManifest(manifestOverride);
        if (cancelled) return;
        setManifest(localizedManifest);
        setCompiled(compileManifest(localizedManifest));
        setBootstrap(null);
        setBootstrapVersion((v) => v + 1);
        setError(null);
        return;
      }
      setLoading(true);
      setBootstrapLoading(true);
      try {
        const res = await getPageBootstrap({
          moduleId,
          pageId,
          viewId,
          recordId,
        });
        if (cancelled) return;
        setManifest(res.manifest);
        setCompiled(res.compiled || compileManifest(res.manifest));
        setBootstrap({
          viewId: res.view_id,
          pageId: res.page_id,
          list: res.list,
          record: res.record,
          moduleId,
          manifestHash: res.manifest_hash,
          version: Date.now(),
        });
        setBootstrapVersion((v) => v + 1);
        if (typeof performance !== "undefined" && performance.mark) {
          performance.mark("bootstrap_loaded");
        }
        setError(null);
      } catch (err) {
        if (!cancelled) {
          try {
            const fallback = await getManifest(moduleId);
            if (cancelled) return;
            setManifest(fallback.manifest);
            setCompiled(fallback.compiled || compileManifest(fallback.manifest));
            setBootstrap(null);
            setBootstrapVersion((v) => v + 1);
            setError(null);
          } catch {
            if (!cancelled) {
              setError(err.message || "Failed to load page");
            }
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setBootstrapLoading(false);
        }
      }
    }
    loadBootstrap();
    return () => {
      cancelled = true;
    };
  }, [moduleId, pageId, viewId, recordId, manifestOverride, workspaceKey, i18nVersion]);

  const appDef = manifest?.app || null;
  const formPageIds = useMemo(() => collectFormPageIds(appDef?.defaults), [appDef?.defaults]);
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const actionsList = Array.isArray(manifest?.actions) ? manifest.actions : [];
  const actionsMap = useMemo(() => {
    const map = new Map();
    for (const action of actionsList) {
      if (action?.id) map.set(action.id, action);
    }
    return map;
  }, [actionsList]);

  const defaultTarget = appDef?.home || null;
  const routeResolved = resolveRouteTarget({ pageId, viewId });
  const resolved = previewMode
    ? resolveAppTarget(previewRouteTarget || previewTarget || defaultTarget, null)
    : (routeResolved.parsed ? routeResolved : resolveAppTarget(defaultTarget, null));
  const activeTarget = resolved.target;
  let active = resolved.parsed;
  let activePage = active?.type === "page" ? pages.find((p) => p.id === active.id) : null;
  let activeViewId = active?.type === "view" ? active.id : null;

  // Recover from stale targets (for example preview placeholders) by falling back
  // to app.home/first page/first view when the requested target no longer exists.
  if (active?.type === "page" && !activePage) {
    const fallbackTargets = [defaultTarget, pages[0]?.id ? `page:${pages[0].id}` : null, views[0]?.id ? `view:${views[0].id}` : null]
      .filter(Boolean);
    for (const target of fallbackTargets) {
      const parsed = resolveAppTarget(target, null)?.parsed;
      if (!parsed) continue;
      if (parsed.type === "page") {
        const page = pages.find((p) => p.id === parsed.id);
        if (page) {
          active = parsed;
          activePage = page;
          activeViewId = null;
          break;
        }
      } else if (parsed.type === "view") {
        const view = views.find((v) => v.id === parsed.id);
        if (view) {
          active = parsed;
          activePage = null;
          activeViewId = parsed.id;
          break;
        }
      }
    }
  }

  const openConfirm = useCallback((options = {}) => {
    // Guard against re-entrant confirms that can happen when an action is triggered twice quickly.
    if (modalResolveRef.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      modalResolveRef.current = resolve;
      setModal({
        type: "confirm",
        title: options.title || translateRuntime("common.confirm"),
        body: options.body || translateRuntime("common.are_you_sure"),
        confirmLabel: options.confirmLabel || translateRuntime("common.ok"),
        cancelLabel: options.cancelLabel || translateRuntime("common.cancel"),
      });
    });
  }, []);

  const openPrompt = useCallback((options = {}) => {
    // Prevent stacking prompt dialogs on top of an active modal.
    if (modalResolveRef.current) return Promise.resolve(null);
    return new Promise((resolve) => {
      modalResolveRef.current = resolve;
      setModalInput(options.defaultValue ?? "");
      setModal({
        type: "prompt",
        title: options.title || translateRuntime("common.input_required"),
        body: options.body || "",
        label: options.label || "",
        placeholder: options.placeholder || "",
        confirmLabel: options.confirmLabel || translateRuntime("common.ok"),
        cancelLabel: options.cancelLabel || translateRuntime("common.cancel"),
      });
    });
  }, []);

  const closeModal = useCallback((result) => {
    const resolve = modalResolveRef.current;
    modalResolveRef.current = null;
    setModal(null);
    resolve?.(result);
  }, []);

  const confirmDialog = useCallback(
    async (options = {}) => {
      return await openConfirm(options);
    },
    [openConfirm]
  );

  const promptDialog = useCallback(
    async (options = {}) => {
      return await openPrompt(options);
    },
    [openPrompt]
  );

  async function openCreateModal({ entityId, displayField, initialValue, defaults }) {
    if (previewMode) return null;
    const entityFullId = entityId?.startsWith("entity.") ? entityId : `entity.${entityId}`;
    const entityShortId = entityId?.startsWith("entity.") ? entityId.slice("entity.".length) : entityId;
    let formViewId = getFormViewId(manifest, entityId);
    let modalManifest = manifest;
    let modalCompiled = compiled;
    let resolvedEntityId = entityId;
    let resolvedDisplayField = displayField;

    if (!formViewId) {
      try {
        const registry = await apiFetch("/studio2/registry");
        const modules = Array.isArray(registry?.modules) ? registry.modules : [];
        for (const mod of modules) {
          const modEntities = Array.isArray(mod?.entities) ? mod.entities : [];
          const entityEntry = modEntities.find((e) => matchEntity(e?.id, entityShortId, entityFullId));
          if (!entityEntry) continue;
          const modManifestRes = await getManifest(mod.module_id);
          modalManifest = modManifestRes.manifest;
          modalCompiled = modManifestRes.compiled || compileManifest(modManifestRes.manifest);
          resolvedEntityId = entityEntry.id || entityFullId;
          resolvedDisplayField = resolvedDisplayField || entityEntry.display_field;
          formViewId = getFormViewId(modalManifest, resolvedEntityId);
          if (formViewId) break;
        }
      } catch {
        // fall through to error below
      }
    }

    if (!formViewId) {
      try {
        const modulesRes = await apiFetch("/modules");
        const modules = Array.isArray(modulesRes?.modules) ? modulesRes.modules : modulesRes;
        if (Array.isArray(modules)) {
          for (const mod of modules) {
            const moduleId = mod?.module_id || mod?.id || mod?.moduleId;
            if (!moduleId) continue;
            let modManifestRes;
            try {
              modManifestRes = await getManifest(moduleId);
            } catch {
              continue;
            }
            const modManifest = modManifestRes?.manifest;
            const modEntities = Array.isArray(modManifest?.entities) ? modManifest.entities : [];
            const entityEntry = modEntities.find((e) => matchEntity(e?.id, entityShortId, entityFullId));
            if (!entityEntry) continue;
            const candidateFormViewId = getFormViewId(modManifest, entityEntry.id || entityFullId);
            if (!candidateFormViewId) continue;
            modalManifest = modManifest;
            modalCompiled = modManifestRes.compiled || compileManifest(modManifest);
            resolvedEntityId = entityEntry.id || entityFullId;
            resolvedDisplayField = resolvedDisplayField || entityEntry.display_field;
            formViewId = candidateFormViewId;
            break;
          }
        }
      } catch {
        // fall through to error below
      }
    }

    if (!formViewId) {
      pushToast("error", translateRuntime("common.app_shell.no_form_view_for_entity"));
      return null;
    }

    return new Promise((resolve) => {
      setCreateModals((prev) => [
        ...prev,
        {
          key: `create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          entityId: resolvedEntityId,
          formViewId,
          displayField: resolvedDisplayField,
          initialValue,
          defaults: defaults && typeof defaults === "object" ? defaults : null,
          returnRoute: `${location.pathname}${location.search || ""}`,
          resolve,
          manifest: modalManifest,
          compiled: modalCompiled,
          draft: {},
          initialDraft: {},
          showValidation: false,
          saving: false,
          error: "",
          initialized: false,
        },
      ]);
    });
  }

  const createModal = createModals.length ? createModals[createModals.length - 1] : null;

  function updateCreateModalByKey(key, updater) {
    setCreateModals((prev) =>
      prev.map((item) => {
        if (!item || item.key !== key) return item;
        return typeof updater === "function" ? updater(item) : updater;
      })
    );
  }

  useEffect(() => {
    if (!createModal) return;
    if (createModal.initialized) return;
    const nextDraft = createModal.defaults && typeof createModal.defaults === "object"
      ? { ...createModal.defaults }
      : {};
    if (createModal.initialValue && createModal.displayField) {
      nextDraft[createModal.displayField] = createModal.initialValue;
    }
    const modalFieldIndex = buildFieldIndex(
      createModal?.manifest || manifest,
      createModal?.compiled || compiled,
      createModal?.entityId || null
    );
    const computedDraft = applyComputedFields(modalFieldIndex || {}, nextDraft);
    updateCreateModalByKey(createModal.key, (current) => ({
      ...current,
      draft: computedDraft,
      initialDraft: computedDraft,
      showValidation: false,
      saving: false,
      initialized: true,
    }));
  }, [createModal, manifest, compiled]);

  useEffect(() => {
    if (previewMode) {
      if (!previewAllowNav) return;
      const nextTarget = previewRouteTarget || defaultTarget || null;
      if (!previewRouteTarget && defaultTarget) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("preview_target", defaultTarget);
        setSearchParams(params, { replace: true });
        return;
      }
      if (nextTarget && nextTarget !== previewTarget) {
        setPreviewTarget(nextTarget);
      }
      return;
    }
    if (!moduleId || pageId || viewId) return;
    if (!defaultTarget) return;
    const route =
      deriveAppHomeRoute(moduleId, manifest, {
        target: defaultTarget,
        preserveFrameParams: true,
        searchLike: searchParams,
      }) || buildTargetRoute(moduleId, defaultTarget);
    if (!route) return;
    navigate(route, { replace: true });
  }, [moduleId, pageId, viewId, defaultTarget, manifest, navigate, previewAllowNav, previewMode, previewRouteTarget, previewTarget, searchParams, setSearchParams]);

  useEffect(() => {
    if (!previewMode) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("preview_target");
    params.delete("octo_ai_frame");
    params.delete("octo_ai_embed");
    params.delete("octo_ai_embed_nav");
    params.delete("octo_ai_sandbox");
    params.delete("octo_ai_live");
    params.delete("octo_ai_session");
    params.delete("octo_ai_workspace");
    const nextString = params.toString();
    const currentString = previewSearchParams.toString();
    if (nextString !== currentString) {
      setPreviewSearchParams(params);
    }
  }, [previewMode, previewSearchParams, searchParams]);

  useEffect(() => {
    if (!supabase || !realtimeEnabled) return;
    const channel = supabase
      .channel("octo_records_generic_all")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "records_generic" },
        () => {
          if (realtimeDebounceRef.current) {
            clearTimeout(realtimeDebounceRef.current);
          }
          realtimeDebounceRef.current = setTimeout(() => {
            setRefreshTick((v) => v + 1);
            setViewModesRefreshTick((v) => v + 1);
          }, 300);
        }
      )
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (previewMode) return undefined;
    const unsubscribe = subscribeRecordMutations(() => {
      if (mutationDebounceRef.current) {
        clearTimeout(mutationDebounceRef.current);
      }
      mutationDebounceRef.current = setTimeout(() => {
        setRefreshTick((v) => v + 1);
        setViewModesRefreshTick((v) => v + 1);
      }, 75);
    });
    return () => {
      if (mutationDebounceRef.current) {
        clearTimeout(mutationDebounceRef.current);
      }
      unsubscribe();
    };
  }, [previewMode]);

  async function setTarget(next, opts = {}) {
    if (!opts.skipFormGuard && !(await runNavigationGuard())) return;
    // Prevent "create new record" navigation for read-only users.
    // Opening existing records passes `opts.recordId`, so it is unaffected.
    if (!canWriteRecords && !opts.recordId) {
      const target = typeof next === "string" ? next : "";
      const pageId = target.startsWith("page:") ? target.slice("page:".length) : target;
      if (pageId && formPageIds.has(pageId)) {
        pushToast("error", translateRuntime("common.app_shell.write_access_required"));
        return;
      }
    }
    if (previewMode) {
      if (!previewAllowNav) return;
      const params = new URLSearchParams(searchParams.toString());
      if (!opts.preserveReturnContext && !opts.returnToCurrent && !opts.returnTo) {
        params.delete(FORM_RETURN_TO_PARAM);
        params.delete(FORM_RETURN_LABEL_PARAM);
      }
      if (typeof next === "string" && next) {
        params.set("preview_target", next);
      }
      setPreviewTarget(next);
      if (opts.recordId) {
        const recordParam = opts.recordParamName || "record";
        params.set(recordParam, opts.recordId);
        params.delete(FORM_DEFAULTS_PARAM);
      } else {
        const recordParam = opts.recordParamName || "record";
        params.delete(recordParam);
        const createDefaults = opts.createDefaults || opts.defaults || null;
        if (createDefaults && typeof createDefaults === "object" && Object.keys(createDefaults).length > 0) {
          params.set(FORM_DEFAULTS_PARAM, JSON.stringify(createDefaults));
        } else if (!opts.preserveParams) {
          params.delete(FORM_DEFAULTS_PARAM);
        }
      }
      const returnTo = opts.returnTo || (opts.returnToCurrent ? stripFormReturnParams(`${location.pathname}${location.search || ""}`) : null);
      if (returnTo) {
        params.set(FORM_RETURN_TO_PARAM, returnTo);
        if (opts.returnLabel) params.set(FORM_RETURN_LABEL_PARAM, String(opts.returnLabel));
        else params.delete(FORM_RETURN_LABEL_PARAM);
      }
      setSearchParams(params);
      return;
    }
    const routeModuleId = opts.moduleId || moduleId;
    const route = buildTargetRoute(routeModuleId, next, { preserveFrameParams: false });
    if (!route) return;
    const params = opts.preserveParams ? new URLSearchParams(searchParams || "") : new URLSearchParams();
    if (!opts.preserveReturnContext && !opts.returnToCurrent && !opts.returnTo) {
      params.delete(FORM_RETURN_TO_PARAM);
      params.delete(FORM_RETURN_LABEL_PARAM);
    }
    const recordParam = opts.recordParamName || "record";
    if (opts.recordId) {
      params.set(recordParam, opts.recordId);
      params.delete(FORM_DEFAULTS_PARAM);
    }
    if (!opts.recordId) {
      params.delete(recordParam);
      const createDefaults = opts.createDefaults || opts.defaults || null;
      if (createDefaults && typeof createDefaults === "object" && Object.keys(createDefaults).length > 0) {
        params.set(FORM_DEFAULTS_PARAM, JSON.stringify(createDefaults));
      } else if (!opts.preserveParams) {
        params.delete(FORM_DEFAULTS_PARAM);
      }
    }
    const returnTo = opts.returnTo || (opts.returnToCurrent ? stripFormReturnParams(`${location.pathname}${location.search || ""}`) : null);
    if (returnTo) {
      params.set(FORM_RETURN_TO_PARAM, returnTo);
      if (opts.returnLabel) params.set(FORM_RETURN_LABEL_PARAM, String(opts.returnLabel));
      else params.delete(FORM_RETURN_LABEL_PARAM);
    }
    navigate(buildRouteWithQuery(route, params));
  }

  async function navigateToEntityRecord(entityRef, targetRecordId) {
    if (!(await runNavigationGuard())) return false;
    const targetEntityFullId = resolveEntityFullId(manifest, entityRef);
    if (!targetEntityFullId || !targetRecordId) return false;

    // 1) If entity has an explicit entity-level page default in current module, use it.
    // Do not fall back to app-wide defaults here, as that can route to the wrong entity form.
    const localEntityDefaults = resolveEntityDefaults(appDef?.defaults, targetEntityFullId);
    const localDefaultForm = localEntityDefaults?.entity_form_page || null;
    if (localDefaultForm) {
      setTarget(localDefaultForm, { recordId: targetRecordId });
      return true;
    }

    // 2) Resolve owning module and form page from installed modules/manifests.
    try {
      const modulesRes = await apiFetch("/modules");
      const modules = Array.isArray(modulesRes?.modules) ? modulesRes.modules : Array.isArray(modulesRes) ? modulesRes : [];
      for (const mod of modules) {
        const modId = mod?.module_id || mod?.id || mod?.moduleId;
        if (!modId) continue;
        let modManifestRes;
        try {
          modManifestRes = await getManifest(modId);
        } catch {
          continue;
        }
        const modManifest = modManifestRes?.manifest;
        const modEntities = Array.isArray(modManifest?.entities) ? modManifest.entities : [];
        const matchedEntity = modEntities.find((e) => entitiesMatch(e?.id, targetEntityFullId));
        if (!matchedEntity) continue;

        const modEntityFullId = matchedEntity.id;
        const modDefaultForm = resolveEntityDefaultFormPage(modManifest?.app?.defaults || {}, modEntityFullId);
        if (modDefaultForm) {
          const route = buildTargetRoute(modId, modDefaultForm, { preserveFrameParams: false });
          if (route) {
            const params = new URLSearchParams();
            params.set("record", targetRecordId);
            navigate(buildRouteWithQuery(route, params));
            return true;
          }
        }

        const modFormView = getFormViewId(modManifest, modEntityFullId);
        if (modFormView) {
          const route = buildTargetRoute(modId, `view:${modFormView}`, { preserveFrameParams: false });
          if (route) {
            const params = new URLSearchParams();
            params.set("record", targetRecordId);
            navigate(buildRouteWithQuery(route, params));
            return true;
          }
        }
      }
    } catch {
      // fallback below
    }

    // 3) Final fallback: generic record page.
    navigate(buildRouteWithQuery(`/data/${toRouteEntityId(targetEntityFullId)}/${targetRecordId}`, new URLSearchParams()));
    return false;
  }

  async function guardedFallbackNavigate(path, options = {}) {
    if (!options.skipFormGuard && !(await runNavigationGuard())) return;
    navigate(path, options);
  }

  function resolveAction(action) {
    if (!action || typeof action !== "object") return null;
    if (action.action_id) {
      const base = actionsMap.get(action.action_id);
      if (!base) return null;
      return { ...base, ...action, id: base.id };
    }
    return action;
  }

  function getPreviewEntityStore(entityId) {
    if (!entityId) return null;
    const store = previewStoreRef.current;
    if (!store.entities.has(entityId)) {
      store.entities.set(entityId, { records: new Map(), order: [] });
    }
    return store.entities.get(entityId);
  }

  function makeLocalId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `local_${crypto.randomUUID()}`;
    }
    return `local_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  function previewUpsert(entityId, recordId, record) {
    const store = getPreviewEntityStore(entityId);
    if (!store) return null;
    const id = recordId || makeLocalId();
    const entry = { record_id: id, record: { ...(record || {}), id } };
    if (!store.records.has(id)) {
      store.order.unshift(id);
    }
    store.records.set(id, entry);
    setPreviewStoreVersion((v) => v + 1);
    return entry;
  }

  function previewGet(entityId, recordId) {
    const store = getPreviewEntityStore(entityId);
    if (!store) return null;
    return store.records.get(recordId) || null;
  }

  function previewList(entityId) {
    const store = getPreviewEntityStore(entityId);
    if (!store) return [];
    return store.order.map((id) => store.records.get(id)).filter(Boolean);
  }

  async function runAction(action, runtimeContext = {}) {
    if (isWriteActionKind(action?.kind) && !canWriteRecords) {
      pushToast("error", translateRuntime("common.app_shell.write_access_required"));
      return null;
    }
    if (previewMode && !previewAllowNav) {
      pushToast("info", translateRuntime("common.app_shell.preview_mode_actions_disabled"));
      return null;
    }
    const inlineAction = Boolean(runtimeContext?.inlineAction);
    if (!action?.id && !inlineAction) {
      pushToast("error", translateRuntime("common.app_shell.action_missing_id"));
      return null;
    }
    const contextRecordId = runtimeContext?.recordId || recordId;
    const contextSelectedIds = Array.isArray(runtimeContext?.selectedIds) ? runtimeContext.selectedIds : selectedIds;
    const contextRecordDraft = runtimeContext?.recordDraft && typeof runtimeContext.recordDraft === "object"
      ? runtimeContext.recordDraft
      : recordDraft;
    const actionModuleId = runtimeContext?.moduleId || moduleId;
    const contextEntityId =
      runtimeContext?.entityId ||
      runtimeContext?.recordEntityId ||
      resolveEntityFullId(manifest, action?.entity_id) ||
      null;
    const resolvedDefaults = action?.defaults && typeof action.defaults === "object"
      ? resolveTemplateRefs(action.defaults, contextRecordDraft || {})
      : action?.defaults;
    const resolvedPatch = action?.patch && typeof action.patch === "object"
      ? resolveTemplateRefs(action.patch, contextRecordDraft || {})
      : action?.patch;
    const skipConfirm = Boolean(runtimeContext?.skipConfirm);
    const skipMaterialGate = Boolean(runtimeContext?.skipMaterialGate);
    const isTimeEntryCloseAction =
      action?.id === "action.time_entry_close" &&
      resolveEntityFullId(manifest, action?.entity_id) === "entity.time_entry";
    if (isMobile && !skipMaterialGate && isTimeEntryCloseAction && contextRecordId) {
      const materialLogForm =
        resolveEntityDefaultFormPage(appDef?.defaults, "entity.material_log") ||
        (getFormViewId(manifest, "entity.material_log") ? `view:${getFormViewId(manifest, "entity.material_log")}` : null);
      if (materialLogForm) {
        writePendingMaterialGate({
          timeEntryId: contextRecordId,
          timeEntryDraft: contextRecordDraft || {},
          materialDraft: buildMaterialLogDefaultsFromTimeEntry(contextRecordDraft || {}),
        });
        pushToast("info", translateRuntime("common.app_shell.log_material_before_clocking_out"));
        setTarget(materialLogForm, { preserveParams: true });
        return { kind: "navigate", target: materialLogForm, gated: true };
      }
    }
    if (!skipConfirm && action.confirm && typeof action.confirm === "object") {
      const title = action.confirm.title || "Confirm";
      const body = action.confirm.body || "Are you sure?";
      const ok = await confirmDialog({ title, body });
      if (!ok) return null;
    }
    const flushCurrentFormSave =
      typeof runtimeContext?.flushPendingFormSave === "function" ? runtimeContext.flushPendingFormSave : null;
    if (["update_record", "transform_record"].includes(action?.kind || "") && flushCurrentFormSave) {
      const saved = await flushCurrentFormSave();
      if (!saved) return null;
    }
    if (!previewMode && contextRecordId && contextEntityId) {
      const lineWrites = await waitForPendingLineItemWrites({
        parentEntityId: contextEntityId,
        parentRecordId: contextRecordId,
        timeoutMs: 20000,
      });
      if (!lineWrites.ok) {
        const message = lineWrites.timedOut || lineWrites.pending > 0
          ? "Line items are still saving. Try again in a moment."
          : translateRuntime("common.failed_to_add_line_item");
        pushToast("error", message);
        return null;
      }
    }
    try {
      if (previewMode && previewAllowNav) {
        if (action.kind === "create_record") {
          const entityFullId = resolveEntityFullId(manifest, action.entity_id);
          const created = previewUpsert(entityFullId, null, resolvedDefaults || {});
          if (created) {
            const defaultForm = resolveEntityDefaultFormPage(appDef?.defaults, entityFullId);
            if (defaultForm) {
              setTarget(defaultForm, { recordId: created.record_id });
            }
            pushToast("success", translateRuntime("common.created_local_preview"));
            return { record_id: created.record_id, record: created.record };
          }
        }
        if (action.kind === "update_record" && resolvedPatch && typeof resolvedPatch === "object") {
          const entityFullId = resolveEntityFullId(manifest, action.entity_id);
          const current = previewGet(entityFullId, contextRecordId);
          const updated = previewUpsert(entityFullId, contextRecordId, { ...(current?.record || {}), ...resolvedPatch });
          if (updated) {
            pushToast("success", translateRuntime("common.saved_local_preview"));
            return { record_id: updated.record_id, record: updated.record };
          }
        }
        if (action.kind === "bulk_update" && resolvedPatch && typeof resolvedPatch === "object") {
          const entityFullId = resolveEntityFullId(manifest, action.entity_id);
          const ids = Array.isArray(contextSelectedIds) ? contextSelectedIds : [];
          for (const id of ids) {
            const current = previewGet(entityFullId, id);
            previewUpsert(entityFullId, id, { ...(current?.record || {}), ...resolvedPatch });
          }
          pushToast("success", translateRuntime("common.saved_local_preview"));
          return { updated: true };
        }
      }
      if (inlineAction) {
        if (action.kind === "update_record" && resolvedPatch && typeof resolvedPatch === "object") {
          const entityFullId = resolveEntityFullId(manifest, action.entity_id);
          if (!entityFullId || !contextRecordId) {
            pushToast("error", translateRuntime("common.app_shell.action_missing_record_context"));
            return null;
          }
          const payload = { ...(contextRecordDraft || {}), ...resolvedPatch };
          const res = await apiFetch(`/records/${entityFullId}/${contextRecordId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          setRecordDraft(res?.record || payload);
          setRefreshTick((v) => v + 1);
          pushToast("success", translateRuntime("common.app_shell.action_complete"));
          return { updated: true, record_id: contextRecordId, record: res?.record || payload };
        }
        pushToast("error", translateRuntime("common.app_shell.inline_action_kind_not_supported"));
        return null;
      }
      const res = await runManifestAction(actionModuleId, action.id, {
        record_id: contextRecordId,
        record_draft: contextRecordDraft,
        selected_ids: contextSelectedIds,
        email_compose: runtimeContext?.emailCompose || undefined,
      });
      const result = res.result || {};
      const automationRuns = Array.isArray(result?.automation_runs)
        ? result.automation_runs
        : Array.isArray(res?.automation_runs)
          ? res.automation_runs
          : [];
      const actionStartedAutomation = automationRuns.length > 0;
      if (actionStartedAutomation) {
        notifyAutomationRunsStarted(automationRuns, {
          id: action.id,
          module_id: actionModuleId,
          kind: result.kind || action.kind,
          label: resolveActionLabel(action, manifest, views),
          action_label: action.action_label || action.label || null,
        });
      }
      const pushActionCompleteToast = () => {
        if (actionStartedAutomation) return;
        pushToast("success", translateRuntime("common.app_shell.action_complete"));
      };
      const actionKind = action.kind;
      if (result.kind === "navigate" && result.target) {
        setTarget(result.target, { moduleId: actionModuleId });
        return result;
      }
      if (result.kind === "open_form" && result.target) {
        const view = views.find((v) => v.id === result.target);
        const viewEntity = view?.entity || view?.entity_id || view?.entityId || result.entity_id || action.entity_id;
        const entityFullId = resolveEntityFullId(manifest, viewEntity);
        const defaultForm = resolveEntityDefaultFormPage(appDef?.defaults, entityFullId);
        if (defaultForm) {
          setTarget(defaultForm, { moduleId: actionModuleId });
        } else {
          setTarget(`view:${result.target}`, { moduleId: actionModuleId });
        }
        return result;
      }
      if (result.record_id) {
        if (actionKind === "transform_record") {
          if (action?.stay_on_source_record === true || runtimeContext?.stayOnSourceRecord === true) {
            if (typeof runtimeContext?.refreshCurrentRecord === "function") {
              await runtimeContext.refreshCurrentRecord();
            }
            setRefreshTick((v) => v + 1);
          } else {
            const resultEntityId = result.entity_id || action.entity_id;
            if (resultEntityId) {
              await navigateToEntityRecord(resultEntityId, result.record_id);
            } else {
              setRefreshTick((v) => v + 1);
            }
          }
          pushActionCompleteToast();
          return result;
        }
        if (actionKind === "update_record" || actionKind === "bulk_update") {
          // Stay on the current page for updates to avoid losing page layout (chatter, grid, etc.)
          setRefreshTick((v) => v + 1);
        } else {
          const resultEntityId = result.entity_id || action.entity_id;
          if (actionModuleId !== moduleId) {
            await navigateToEntityRecord(resultEntityId, result.record_id);
          } else {
            const entityFullId = resolveEntityFullId(manifest, resultEntityId);
            const defaultForm = resolveEntityDefaultFormPage(appDef?.defaults, entityFullId);
            if (defaultForm) {
              setTarget(defaultForm, { recordId: result.record_id });
            } else {
              const formView = getFormViewId(manifest, resultEntityId);
              if (formView) {
                setTarget(`view:${formView}`, { recordId: result.record_id });
              }
            }
          }
        }
      }
      if (actionKind === "update_record" && resolvedPatch && typeof resolvedPatch === "object") {
        setRecordDraft((prev) => ({ ...(prev || {}), ...resolvedPatch }));
      }
      if (result.updated) {
        setRefreshTick((v) => v + 1);
      }
      pushActionCompleteToast();
      return result;
    } catch (err) {
      pushToast("error", err.message || translateRuntime("common.app_shell.action_failed"));
      return null;
    }
  }

  async function confirmAction(action) {
    if (action.confirm && typeof action.confirm === "object") {
      const title = action.confirm.title || "Confirm";
      const body = action.confirm.body || "Are you sure?";
      return await confirmDialog({ title, body });
    }
    return true;
  }

  function renderAction(action) {
    const resolvedAction = resolveAction(action);
    if (!resolvedAction || !resolvedAction.kind) return null;
    if (isWriteActionKind(resolvedAction.kind) && !canWriteRecords) return null;
    const label = resolveActionLabel(resolvedAction, manifest, views);
    const visible = resolvedAction.visible_when ? evalCondition(resolvedAction.visible_when, _conditionEvalContext(recordDraft, currentActor)) : true;
    if (!visible) return null;
    const enabled = resolvedAction.enabled_when ? evalCondition(resolvedAction.enabled_when, _conditionEvalContext(recordDraft, currentActor)) : true;
    if (resolvedAction.kind === "refresh") {
      return (
        <button
          className={SOFT_BUTTON_SM}
          onClick={async () => {
            if (!(await confirmAction(resolvedAction))) return;
            setRefreshTick((v) => v + 1);
          }}
          key={resolvedAction.id || label}
          disabled={!enabled || (previewMode && !previewAllowNav)}
        >
          {label}
        </button>
      );
    }
    if (resolvedAction.kind === "navigate" && resolvedAction.target) {
      if (!canWriteRecords) {
        const target = resolvedAction.target;
        const pageId = target.startsWith("page:") ? target.slice("page:".length) : target;
        if (pageId && formPageIds.has(pageId)) return null;
      }
      return (
        <button
          className={SOFT_BUTTON_SM}
          onClick={async () => {
            if (!(await confirmAction(resolvedAction))) return;
            setTarget(resolvedAction.target);
          }}
          key={resolvedAction.id || label}
          disabled={!enabled || (previewMode && !previewAllowNav)}
        >
          {label}
        </button>
      );
    }
    if (resolvedAction.kind === "open_form" && resolvedAction.target) {
      return (
        <button
          className={PRIMARY_BUTTON_SM}
          onClick={async () => {
            if (!(await confirmAction(resolvedAction))) return;
            const view = views.find((v) => v.id === resolvedAction.target);
            const viewEntity = view?.entity || view?.entity_id || view?.entityId;
            const entityFullId = resolveEntityFullId(manifest, viewEntity);
            const defaultForm = resolveEntityDefaultFormPage(appDef?.defaults, entityFullId);
            if (defaultForm) {
              setTarget(defaultForm);
            } else {
              setTarget(`view:${resolvedAction.target}`);
            }
          }}
          key={resolvedAction.id || label}
          disabled={!enabled || (previewMode && !previewAllowNav)}
        >
          {label}
        </button>
      );
    }
    if (["create_record", "update_record", "bulk_update", "transform_record"].includes(resolvedAction.kind)) {
      const missingRecord = (resolvedAction.kind === "update_record" || resolvedAction.kind === "transform_record") && !recordId;
      const missingSelection = resolvedAction.kind === "bulk_update" && (!selectedIds || selectedIds.length === 0);
      const disabled = !enabled || missingRecord || missingSelection;
      return (
        <button className={SOFT_BUTTON_SM} onClick={() => runAction(resolvedAction)} key={resolvedAction.id || label} disabled={disabled || previewMode || actionRunning}>
          {actionRunning && actionState.label === label ? <span className="loading loading-spinner loading-xs" /> : null}
          {label}
        </button>
      );
    }
    return null;
  }

  function renderView(viewId, recordContext = null, preview = previewMode, options = {}) {
    const view = views.find((v) => v.id === viewId);
    if (!view) {
      return <div className="alert alert-error">View not found: {viewId}</div>;
    }
    const effectiveSearchParams = previewMode ? previewSearchParams : searchParams;
    const effectiveSetSearchParams = previewMode
      ? (next) => setPreviewSearchParams(new URLSearchParams(next))
      : setSearchParams;
    const showViewTitle = options?.showViewTitle !== false;
    return (
      <AppView
        view={view}
        manifest={manifest}
        compiled={compiled}
        recordId={recordId}
        recordContext={recordContext}
        showViewTitle={showViewTitle}
        refreshTick={refreshTick}
        bootstrap={bootstrap}
        bootstrapVersion={bootstrapVersion}
        bootstrapLoading={bootstrapLoading}
        onNavigate={setTarget}
        onRefresh={() => setRefreshTick((v) => v + 1)}
        onRunAction={runAction}
        onConfirm={confirmDialog}
        onPrompt={promptDialog}
        actionsMap={actionsMap}
        searchParams={effectiveSearchParams}
        setSearchParams={effectiveSetSearchParams}
        onSelectionChange={setSelectedIds}
        onRecordDraftChange={setRecordDraft}
        onFallback={guardedFallbackNavigate}
        onRegisterNavigationGuard={registerNavigationGuard}
        canCreateLookup={() => canWriteRecords}
        onLookupCreate={openCreateModal}
        canWriteRecords={canWriteRecords}
        currentActor={currentActor}
        previewMode={preview}
        previewAllowNav={previewAllowNav}
        previewStore={
          previewMode && previewAllowNav
            ? {
                list: previewList,
                get: previewGet,
                upsert: previewUpsert,
                version: previewStoreVersion,
              }
            : null
        }
        moduleId={moduleId}
        renderAnyView={renderView}
        onActionStateChange={setGlobalActionState}
        onPageSectionLoadingChange={handlePageSectionLoadingChange}
      />
    );
  }

  const errorBanner =
    error || (errorFlash && Date.now() < errorFlashUntil ? errorFlash : null);

  // Avoid flashing fallback errors before the first manifest/bootstrap response arrives.
  const awaitingInitialLoad = Boolean(moduleId) && !manifest && !error;

  useEffect(() => {
    if (loading || awaitingInitialLoad || !awaitingPageReady) return undefined;
    let timer = null;
    const settlePageReady = () => {
      if (!loading && !awaitingInitialLoad && pageSectionLoadingKeysRef.current.size === 0) {
        setAwaitingPageReady(false);
      }
    };
    if (typeof window !== "undefined") {
      // Give child sections a moment to register their own loading state before
      // the shell drops the page-level spinner. This avoids the empty-shell flash
      // followed by a second wave of section loaders.
      timer = window.setTimeout(settlePageReady, 120);
    } else {
      settlePageReady();
    }
    return () => {
      if (timer != null && typeof window !== "undefined") {
        window.clearTimeout(timer);
      }
    };
  }, [loading, awaitingInitialLoad, awaitingPageReady, pageSectionLoadingCount]);

  const showInitialPageOverlay =
    !loading &&
    !awaitingInitialLoad &&
    awaitingPageReady;

  if (loading || awaitingInitialLoad) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-base-200">
        {errorBanner && <div className="alert alert-error">{errorBanner}</div>}
        <LoadingSpinner className="flex-1 min-h-0 w-full" />
      </div>
    );
  }
  if (error && !manifest) return <div className="alert alert-error">{error}</div>;
  if (!appDef) return <div className="alert alert-error">Module has no app definition.</div>;
  if (resolved.error === "MISSING_HOME") return <div className="alert alert-error">App home is not configured.</div>;
  if (!active) return <div className="alert alert-error">Invalid app target.</div>;
  if (active.type === "page" && !activePage) {
    return <div className="alert alert-error">Page not found in manifest: {active.id}</div>;
  }
  if (active.type === "view" && !views.find((v) => v.id === active.id)) {
    return <div className="alert alert-error">View not found in manifest: {active.id}</div>;
  }

  const previewNavItems = previewMode && previewAllowNav
    ? (appDef?.nav || [])
        .flatMap((group) => {
          if (!group || !Array.isArray(group.items)) return [];
          return group.items.map((item) => ({ label: item.label, to: item.to }));
        })
        .filter((item) => item?.label && item?.to)
    : [];
  const showInlinePreviewNav = !(previewMode && previewAllowNav && searchParams.get("octo_ai_frame") === "1");

  const createManifest = createModal?.manifest || manifest;
  const createCompiled = createModal?.compiled || compiled;
  const createView = createModal ? (createManifest?.views || []).find((v) => v.id === createModal.formViewId) : null;
  const createEntityId = createModal?.entityId || null;
  const createFieldIndex = createModal ? buildFieldIndex(createManifest, createCompiled, createEntityId) : null;
  const createEntityDef = createModal
    ? (createManifest?.entities || []).find((e) => e.id === createEntityId)
    : null;
  const createDraft = createModal?.draft || {};
  const createInitialDraft = createModal?.initialDraft || {};
  const createShowValidation = Boolean(createModal?.showValidation);
  const createSaving = Boolean(createModal?.saving);
  const createIsDirty = !formDraftValuesEqual(createDraft, createInitialDraft);

  function closeCreateModal(result = null) {
    const resolve = createModal?.resolve;
    const returnRoute = createModal?.returnRoute || "";
    setCreateModals((prev) => prev.slice(0, -1));
    if (!previewMode && returnRoute) {
      const currentRoute = `${location.pathname}${location.search || ""}`;
      if (currentRoute !== returnRoute) {
        navigate(returnRoute, { replace: true });
      }
    }
    resolve?.(result);
  }

  async function handleCreateSave(validationErrors) {
    if (!createModal) return;
    updateCreateModalByKey(createModal.key, (current) => ({ ...current, showValidation: true }));
    if (validationErrors && Object.keys(validationErrors).length > 0) return;
    if (!createEntityId) return;
    if (createSaving) return;
    updateCreateModalByKey(createModal.key, (current) => ({ ...current, saving: true, error: "" }));
    try {
      const payload = normalizeManifestRecordPayload(createFieldIndex, createDraft);
      const res = await apiFetch(`/records/${createEntityId}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const recordId = res?.record_id;
      const record = res?.record || payload;
      const label =
        (createModal?.displayField && record?.[createModal.displayField]) ||
        recordId ||
        "";
      pushToast("success", translateRuntime("common.created"));
      closeCreateModal({ record_id: recordId, record, label });
    } catch (err) {
      updateCreateModalByKey(createModal.key, (current) => ({
        ...current,
        error: err?.message || translateRuntime("common.create_failed"),
      }));
    } finally {
      if (createModal) {
        updateCreateModalByKey(createModal.key, (current) => ({ ...current, saving: false }));
      }
    }
  }

  const mobileRecordPage = Boolean(
    isMobile &&
    active?.type === "page" &&
    Array.isArray(activePage?.content) &&
    activePage.content.some((block) => block?.kind === "record")
  );
  const mobilePageLayout = Boolean(isMobile && active?.type === "page");

  return (
    <div className={mobilePageLayout ? "relative flex h-full min-h-full flex-col overflow-hidden" : "relative flex flex-col h-full min-h-0 overflow-hidden"}>
      <div className={`flex flex-1 min-h-0 flex-col ${showInitialPageOverlay ? "opacity-0 pointer-events-none" : ""}`}>
        {errorBanner && <div className="alert alert-error mb-3">{errorBanner}</div>}
        {previewMode && previewAllowNav && showInlinePreviewNav && previewNavItems.length > 0 && (
          <div className="mb-3">
            <div className="tabs tabs-bordered">
              {previewNavItems.map((item) => {
                const isActive = active?.type === "page" && active?.id && item.to === `page:${active.id}`;
                return (
                  <button
                    key={item.to}
                    className={`tab ${isActive ? "tab-active" : ""}`}
                    onClick={() => setTarget(item.to)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {active.type === "page" && activePage?.header?.variant !== "none" && (
          <div className={`card bg-base-100 shadow mb-4 ${isMobile ? "rounded-none" : ""}`}>
            <div className="card-body">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-xl sm:text-2xl font-semibold">{activePage?.title || manifest?.module?.name || moduleId}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(activePage?.header?.actions || []).map(renderAction)}
                </div>
              </div>
            </div>
          </div>
        )}

        <div
          className={
            mobilePageLayout
              ? "flex-1 h-full min-h-0 flex flex-col overflow-y-auto overflow-x-hidden"
              : "flex-1 min-h-0 overflow-hidden flex flex-col"
          }
        >
          {active.type === "page" && activePage && (
            <div
              className={
                mobilePageLayout
                  ? `flex-1 h-full min-h-0 overflow-visible`
                  : "flex-1 min-h-0 overflow-hidden"
              }
            >
              <ContentBlocksRenderer
                blocks={activePage.content || []}
                renderView={renderView}
                recordId={recordId}
                searchParams={searchParams}
                setSearchParams={setSearchParams}
                manifest={manifest}
                moduleId={moduleId}
                actionsMap={actionsMap}
                onNavigate={setTarget}
                onRunAction={runAction}
                onConfirm={confirmDialog}
                onPrompt={promptDialog}
                onLookupCreate={openCreateModal}
                onFallback={guardedFallbackNavigate}
                externalRefreshTick={viewModesRefreshTick}
                previewMode={previewMode}
                canWriteRecords={canWriteRecords}
                bootstrap={bootstrap}
                bootstrapVersion={bootstrapVersion}
                bootstrapLoading={bootstrapLoading}
                onPageSectionLoadingChange={handlePageSectionLoadingChange}
              />
            </div>
          )}

          {active.type === "view" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <div className={`card bg-base-100 shadow h-full min-h-0 ${isMobile ? "rounded-none" : ""}`}>
                <div className={`card-body h-full min-h-0 ${isMobile ? "p-4" : "p-3 sm:p-4"}`}>{renderView(activeViewId)}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showInitialPageOverlay ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-base-200">
          <LoadingSpinner className="min-h-0" />
        </div>
      ) : null}

      {modal &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="modal modal-open">
            <div className="modal-box">
              <h3 className="font-bold text-lg">{modal.title}</h3>
              {modal.body && <p className="py-2 text-sm opacity-70">{modal.body}</p>}
              {modal.type === "prompt" && (
                <div className="mt-3">
                  {modal.label && <div className="text-xs opacity-60 mb-1">{modal.label}</div>}
                  <input
                    className="input input-bordered input-sm w-full"
                    placeholder={modal.placeholder}
                    value={modalInput}
                    onChange={(e) => setModalInput(e.target.value)}
                  />
                </div>
              )}
              <div className="modal-action">
                <button
                  className="btn btn-ghost"
                  onClick={() => closeModal(modal.type === "confirm" ? false : null)}
                >
                  {modal.cancelLabel || "Cancel"}
                </button>
                <button
                  className={PRIMARY_BUTTON}
                  onClick={() => closeModal(modal.type === "confirm" ? true : modalInput)}
                >
                  {modal.confirmLabel || "OK"}
                </button>
              </div>
            </div>
            <button
              className="modal-backdrop"
              onClick={() => closeModal(modal.type === "confirm" ? false : null)}
              aria-label="Close"
            />
          </div>,
          document.body
        )}

      {createModals.length > 0 &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {createModals.map((modalEntry, index) => {
              const isTop = index === createModals.length - 1;
              const modalManifest = modalEntry?.manifest || manifest;
              const modalCompiled = modalEntry?.compiled || compiled;
              const modalEntityId = modalEntry?.entityId || null;
              const modalView = (modalManifest?.views || []).find((view) => view.id === modalEntry?.formViewId) || null;
              const modalFieldIndex = buildFieldIndex(modalManifest, modalCompiled, modalEntityId);
              const modalEntityDef = (modalManifest?.entities || []).find((entity) => entity.id === modalEntityId) || null;
              const modalDraft = modalEntry?.draft || {};
              const modalInitialDraft = modalEntry?.initialDraft || {};
              const modalIsDirty = !formDraftValuesEqual(modalDraft, modalInitialDraft);
              return (
                <div
                  key={modalEntry.key}
                  className="fixed inset-0 flex items-center justify-center px-3 py-3 sm:px-4 sm:py-4"
                  style={{ zIndex: 320 + index * 10 }}
                >
                  <button
                    type="button"
                    className="absolute inset-0 bg-base-content/40"
                    onClick={() => {
                      if (isTop) closeCreateModal(null);
                    }}
                    aria-label="Close"
                  />
                  <div className="relative flex h-full max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl">
                    <div className="shrink-0 border-b border-base-300 px-4 py-3">
                      <h3 className="font-bold text-lg">
                        Create {modalEntityDef?.label || humanizeEntityId(modalEntityId)}
                      </h3>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
                      {modalView ? (
                        <>
                          {modalEntry?.error ? <div className="alert alert-error mb-3">{modalEntry.error}</div> : null}
                          <FormViewRenderer
                            view={modalView}
                            entityId={modalEntityId}
                            recordId={null}
                            fieldIndex={modalFieldIndex || {}}
                            entityDefs={modalManifest?.entities || []}
                            record={modalDraft}
                            entityLabel={modalEntityDef?.label}
                            displayField={modalEntityDef?.display_field}
                            autoSaveState="idle"
                            hasRecord={false}
                            onChange={(next) =>
                              updateCreateModalByKey(modalEntry.key, (current) => ({
                                ...current,
                                draft: applyComputedFields(modalFieldIndex || {}, next),
                                error: "",
                              }))
                            }
                            onSave={handleCreateSave}
                            onDiscard={() => closeCreateModal(null)}
                            isDirty={modalIsDirty}
                            header={{ ...(modalView?.header || {}), save_mode: "bottom", auto_save: false }}
                            primaryActions={[]}
                            secondaryActions={[]}
                            onActionClick={null}
                            readonly={!canWriteRecords || modalEntry?.saving}
                            showValidation={Boolean(modalEntry?.showValidation)}
                            applyDefaults
                            requiredFields={[]}
                            hiddenFields={[]}
                            previewMode={false}
                            hideHeader
                            hideStatusBar
                            bottomActionsMode="sticky_right"
                          />
                        </>
                      ) : (
                        <div className="alert alert-error">Form view not found.</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </>,
          document.body
        )}

      {globalActionState.status === "running" ? (
        <div className="absolute inset-0 z-[260] flex items-center justify-center bg-base-100/60">
          <LoadingSpinner className="min-h-0" />
        </div>
      ) : null}
    </div>
  );
}

function AppView({
  view,
  moduleId,
  manifest,
  compiled,
  recordId,
  recordContext,
  showViewTitle = true,
  refreshTick,
  bootstrap,
  bootstrapVersion = 0,
  bootstrapLoading = false,
  onNavigate,
  onRefresh,
  onRunAction,
  onConfirm,
  onPrompt,
  actionsMap,
  searchParams,
  setSearchParams,
  onFallback,
  onRegisterNavigationGuard,
  onSelectionChange,
  onRecordDraftChange,
  canCreateLookup,
  onLookupCreate,
  canWriteRecords = true,
  currentActor = null,
  previewMode = false,
  previewAllowNav = false,
  previewStore = null,
  renderAnyView = null,
  onActionStateChange = null,
  onPageSectionLoadingChange = null,
}) {
  const { pushToast } = useToast();
  const [records, setRecords] = useState([]);
  const [draft, setDraft] = useState({});
  const [initialDraft, setInitialDraft] = useState({});
  const [showValidation, setShowValidation] = useState(false);
  const [state, setState] = useState({ status: "idle", error: null });
  const [selectedIds, setSelectedIds] = useState([]);
  const [clientFilters, setClientFilters] = useState([]);
  const [autoSaveState, setAutoSaveState] = useState("idle");
  const [actionState, setActionState] = useState({ status: "idle", label: null, kind: null });
  const [isFormFieldFocused, setIsFormFieldFocused] = useState(false);
  const autoSaveTimerRef = useRef(null);
  const saveInFlightRef = useRef(false);
  const pendingAutoSaveRef = useRef(false);
  const pendingActivityCommitRef = useRef(null);
  const activeFieldSnapshotRef = useRef(null);
  const draftRef = useRef({});
  const initialDraftRef = useRef({});
  const actionRunningRef = useRef(false);
  const bootstrapUsedRef = useRef({ list: null, form: null });
  const perfMarkRef = useRef({ list: null, form: null });
  const openCreateModal = onLookupCreate;
  const [activeManifestModal, setActiveManifestModal] = useState(null);
  const [emailComposeModal, setEmailComposeModal] = useState(null);
  const actionRunning = actionState.status === "running";
  const idleActionState = { status: "idle", label: null, kind: null };

  function startActionPending(action) {
    actionRunningRef.current = true;
    const nextState = {
      status: "running",
      label: resolveActionLabel(action, manifest, views),
      kind: action?.kind || null,
    };
    setActionState(nextState);
    onActionStateChange?.(nextState);
    return nextState;
  }

  function clearActionPending() {
    actionRunningRef.current = false;
    setActionState(idleActionState);
    onActionStateChange?.(idleActionState);
  }

  async function runViewAction(action, context = {}) {
    if (!onRunAction) return null;
    const shouldShowActionPending = isWriteActionKind(action?.kind) || action?.kind === "transform_record";
    if (shouldShowActionPending) startActionPending(action);
    try {
      return await onRunAction(action, {
        ...context,
        entityId: context?.entityId || recordEntityId,
        flushPendingFormSave,
        refreshCurrentRecord,
      });
    } finally {
      if (shouldShowActionPending) clearActionPending();
    }
  }

  const kind = view.kind || view.type;
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const manifestModals = Array.isArray(manifest?.modals) ? manifest.modals : [];
  const modalById = useMemo(() => {
    const next = new Map();
    for (const modal of manifestModals) {
      if (!modal || typeof modal !== "object" || !modal.id) continue;
      next.set(modal.id, modal);
    }
    return next;
  }, [manifestModals]);
  const appDefaults = manifest?.app?.defaults || {};
  const rawViewEntity = view.entity || view.entity_id || view.entityId;
  const fallbackEntity = !rawViewEntity && typeof view.id === "string" ? view.id.split(".")[0] : null;
  const viewEntity = rawViewEntity || fallbackEntity;
  const entityFullId = resolveEntityFullId(manifest, viewEntity);
  const recordEntityId = recordContext?.entityId || entityFullId;
  const fieldIndex = useMemo(() => buildFieldIndex(manifest, compiled, entityFullId), [manifest, compiled, entityFullId]);
  const applyDraftComputed = useCallback((next) => applyComputedFields(fieldIndex, next || {}), [fieldIndex]);
  const entityDef = useMemo(() => (manifest?.entities || []).find((e) => e.id === entityFullId), [manifest, entityFullId]);
  const recordEntityDef = useMemo(
    () => (manifest?.entities || []).find((e) => e.id === recordEntityId) || entityDef || null,
    [manifest, recordEntityId, entityDef]
  );
  const currentEntityLabel = recordEntityDef?.label || humanizeEntityId(recordEntityId || entityFullId) || translateRuntime("common.record");
  const recordContextEntityFullId = recordContext?.entityId ? resolveEntityFullId(manifest, recordContext.entityId) : null;
  const recordContextEntityDef = useMemo(
    () => (manifest?.entities || []).find((e) => e.id === recordContextEntityFullId) || null,
    [manifest, recordContextEntityFullId]
  );
  const recordContextReturnLabel = recordContext?.recordId
    ? recordContextEntityDef?.label || humanizeEntityId(recordContextEntityFullId) || null
    : null;
  const displayField = entityDef?.display_field;
  const listFieldIds = useMemo(() => {
    if (kind !== "list") return [];
    const cols = Array.isArray(view?.columns) ? view.columns : [];
    const ids = cols.map((c) => c.field_id).filter(Boolean);
    for (const col of cols) {
      const field = fieldIndex[col?.field_id];
      if (field?.type !== "number" || !field?.format) continue;
      if (typeof field.format.currency_field === "string" && field.format.currency_field) {
        ids.push(field.format.currency_field);
      }
      if (typeof field.format.unit_field === "string" && field.format.unit_field) {
        ids.push(field.format.unit_field);
      }
    }
    if (displayField) ids.push(displayField);
    return Array.from(new Set(ids));
  }, [kind, view, displayField, fieldIndex]);
  const filterableFields = useMemo(() => {
    if (!entityDef || !Array.isArray(entityDef.fields)) return [];
    return entityDef.fields
      .filter((field) => field?.id && ["string", "text", "rich_text", "enum", "bool", "date", "datetime", "number", "user"].includes(field.type))
      .map((field) => ({
        id: field.id,
        label: field.label || field.id,
        type: field.type,
        options: Array.isArray(field.options) ? field.options : [],
      }));
  }, [entityDef]);
  const listCreateBehavior = kind === "list" ? view?.create_behavior || "open_form" : "open_form";
  const listRequiresFormCreate = useMemo(() => {
    if (kind !== "list" || !entityDef || !Array.isArray(entityDef.fields)) return false;
    return entityDef.fields.some((field) => {
      if (!field?.id) return false;
      if (!field?.required) return false;
      if (field?.readonly) return false;
      if (field?.system) return false;
      return !Object.prototype.hasOwnProperty.call(field, "default");
    });
  }, [kind, entityDef]);
  const formViewId = getFormViewId(manifest, viewEntity);
  const listViewId = getListViewId(manifest, viewEntity);
  const workflow = findWorkflow(manifest, entityFullId);
  const statusField = workflow?.status_field || null;
  const states = Array.isArray(workflow?.states) ? workflow.states : [];
  const transitions = Array.isArray(workflow?.transitions) ? workflow.transitions : [];
  const currentStatus = statusField ? draft?.[statusField] : null;
  const openRecordTarget =
    view?.header?.open_record_target ||
    view?.open_record?.to ||
    resolveEntityDefaultFormPage(appDefaults, entityFullId) ||
    (formViewId ? `view:${formViewId}` : null);
  const openRecordParam = view?.open_record?.param || "record";
  const requiredByState = useMemo(() => {
    if (!workflow || !currentStatus) return [];
    const required = [];
    for (const s of states) {
      if (s?.id === currentStatus && Array.isArray(s.required_fields)) {
        required.push(...s.required_fields);
      }
    }
    if (workflow.required_fields_by_state && Array.isArray(workflow.required_fields_by_state[currentStatus])) {
      required.push(...workflow.required_fields_by_state[currentStatus]);
    }
    return Array.from(new Set(required));
  }, [workflow, currentStatus, states]);

  const handleToggleSelect = useCallback((recordId, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(recordId);
      else next.delete(recordId);
      return Array.from(next);
    });
  }, []);

  const handleToggleAll = useCallback(
    (checked, ids) => {
      if (!checked) {
        setSelectedIds([]);
        return;
      }
      const allIds = Array.isArray(ids) ? ids : records.map((r) => r.record_id || r.record?.id).filter(Boolean);
      setSelectedIds(allIds);
    },
    [records]
  );

  const handleSelectRow = useCallback(
    (row) => {
      if (openRecordTarget) {
        onNavigate?.(openRecordTarget, {
          recordId: row.record_id,
          recordParamName: openRecordParam,
          preserveParams: true,
          returnToCurrent: Boolean(recordContextReturnLabel),
          returnLabel: recordContextReturnLabel || undefined,
        });
      } else {
        onFallback(`/data/${toRouteEntityId(recordEntityId)}/${row.record_id}`);
      }
    },
    [openRecordTarget, openRecordParam, onNavigate, onFallback, recordEntityId, recordContextReturnLabel]
  );

  function computeValidationErrors(nextDraft) {
    if (kind !== "form") return {};
    const sections = Array.isArray(view?.sections) ? view.sections : [];
    const errors = {};
    const requiredByStatus = new Set(Array.isArray(requiredByState) ? requiredByState : []);
    for (const fieldId of sections.flatMap((s) => s.fields || [])) {
      const field = fieldIndex[fieldId];
      if (!field) continue;
      const requiredWhen = field?.required_when;
      const requiredByCondition = requiredWhen ? evalCondition(requiredWhen, { record: nextDraft || {} }) : false;
      const isRequired = field?.required || requiredByStatus.has(fieldId) || requiredByCondition;
      if (!isRequired) continue;
      const value = nextDraft?.[fieldId];
      const hasDefault = Object.prototype.hasOwnProperty.call(field, "default");
      const isSystem = Boolean(field.system);
      if ((value === "" || value === null || value === undefined) && !hasDefault && !isSystem) {
        errors[fieldId] = "Required";
      }
    }
    return errors;
  }

  function resolveHeaderAction(action) {
    if (!action || typeof action !== "object") return null;
    if (action.action_id) {
      const base = actionsMap?.get(action.action_id);
      if (!base) return null;
      return { ...base, ...action, id: base.id };
    }
    return action;
  }

  function resolveModalAction(action) {
    if (!action || typeof action !== "object") return null;
    if (action.action_id) {
      const base = actionsMap?.get(action.action_id);
      if (!base) return null;
      return { ...base, ...action, id: base.id };
    }
    return action;
  }

  function computeManifestModalMissingFieldIds({ fields = [], showMissingOnly = false, missingFieldsActionId = null } = {}, record = {}) {
    if (!showMissingOnly) return null;
    if (missingFieldsActionId) {
      const sourceAction = resolveModalAction({ action_id: missingFieldsActionId });
      const condition = sourceAction?.enabled_when;
      if (condition) {
        const missing = new Set();
        if (!evalCondition(condition, _conditionEvalContext(record || {}, currentActor))) {
          collectConditionMissingFields(condition, record || {}, missing, currentActor);
        }
        return fields.filter((fieldId) => missing.has(fieldId));
      }
    }
    return fields.filter((fieldId) => isEmptyFieldValue(getFieldValue(record || {}, fieldId)));
  }

  function getActionValidationFieldIds(action, contextRecord = draft || {}) {
    if (!action?.enabled_when || !isValidationUiEnabled(action.validation_ui ?? action.validationUi)) return [];
    if (evalCondition(action.enabled_when, _conditionEvalContext(contextRecord || {}, currentActor))) return [];
    const missing = new Set();
    collectConditionMissingFields(action.enabled_when, contextRecord || {}, missing, currentActor);
    return Array.from(missing).filter((fieldId) => {
      const field = fieldIndex?.[fieldId];
      return field && field.readonly !== true && field.system !== true && !field.compute && isEmptyFieldValue(getFieldValue(contextRecord || {}, fieldId));
    });
  }

  async function hydrateMissingValidationAttachments(action, contextRecord = draft || {}) {
    const missingFieldIds = getActionValidationFieldIds(action, contextRecord);
    if (!effectiveRecordId || missingFieldIds.length === 0) return contextRecord || {};
    const attachmentFieldIds = missingFieldIds.filter((fieldId) => fieldIndex?.[fieldId]?.type === "attachments");
    if (attachmentFieldIds.length === 0) return contextRecord || {};
    const entityIdForAttachments =
      resolveEntityFullId(manifest, action?.entity_id) ||
      recordEntityId ||
      entityFullId;
    if (!entityIdForAttachments) return contextRecord || {};
    const patch = {};
    await Promise.all(
      attachmentFieldIds.map(async (fieldId) => {
        try {
          const purpose = `field:${fieldId}`;
          const res = await apiFetch(
            `/records/${encodeURIComponent(entityIdForAttachments)}/${encodeURIComponent(effectiveRecordId)}/attachments?purpose=${encodeURIComponent(purpose)}`,
            { cacheTtl: 0 }
          );
          const attachments = Array.isArray(res?.attachments) ? res.attachments : [];
          if (attachments.length > 0) patch[fieldId] = attachments;
        } catch {
          // Validation can still open normally if the attachment lookup fails.
        }
      })
    );
    if (Object.keys(patch).length === 0) return contextRecord || {};
    const nextDraft = applyDraftComputed({ ...(contextRecord || {}), ...patch });
    draftRef.current = applyDraftComputed({ ...(draftRef.current || {}), ...patch });
    setDraft((prev) => applyDraftComputed({ ...(prev || {}), ...patch }));
    setInitialDraft((prev) => applyDraftComputed({ ...(prev || {}), ...patch }));
    return nextDraft;
  }

  function openValidationFieldsModal({
    fieldIds,
    errors = [],
    title = "Complete Required Fields",
    description = "Complete the missing or invalid fields, then continue.",
    source = null,
    contextRecord = draft || {},
  } = {}) {
    const fields = Array.from(new Set((fieldIds || []).filter((fieldId) => fieldIndex?.[fieldId])));
    if (fields.length === 0) return false;
    const seeded = applyDraftComputed({ ...(draftRef.current || contextRecord || {}), ...(contextRecord || {}) });
    setActiveManifestModal({
      id: `validation.${Date.now()}`,
      title,
      description,
      fields,
      actions: [],
      draft: seeded,
      fieldIndex,
      entityId: recordEntityId || entityFullId,
      showMissingOnly: true,
      missingFieldsActionId: null,
      missingFieldIds: fields,
      saveProgress: Boolean(effectiveRecordId),
      validationSource: source,
      validationErrors: Array.isArray(errors) ? errors : [],
      busy: false,
      error: "",
      savedAt: null,
    });
    return true;
  }

  function openActionValidationModal(action, contextRecord = draft || {}) {
    const fields = getActionValidationFieldIds(action, contextRecord);
    if (fields.length === 0) return false;
    const label = resolveActionLabel(action, manifest, views);
    const validationUi = action?.validation_ui ?? action?.validationUi;
    const configuredTitle = validationUi && typeof validationUi === "object" && typeof validationUi.title === "string" ? validationUi.title : "";
    const configuredDescription = validationUi && typeof validationUi === "object" && typeof validationUi.description === "string" ? validationUi.description : "";
    return openValidationFieldsModal({
      fieldIds: fields,
      title: configuredTitle || "Complete Required Fields",
      description: configuredDescription || (label ? `Complete the required fields before running ${label}.` : "Complete the required fields before continuing."),
      source: { type: "action", action },
      contextRecord,
    });
  }

  function openValidationModalFromError(err, source = null, contextRecord = draft || {}) {
    if (!isValidationUiEnabled(source?.validationUi ?? source?.validation_ui ?? source?.action?.validation_ui ?? source?.action?.validationUi)) return false;
    const errors = Array.isArray(err?.errors) ? err.errors : [];
    const fields = extractValidationFieldIds(errors, fieldIndex);
    if (fields.length === 0) return false;
    return openValidationFieldsModal({
      fieldIds: fields,
      errors,
      title: "Fix Validation Issues",
      description: "Some required or invalid fields need attention before this can continue.",
      source,
      contextRecord,
    });
  }

  function syncValidationModalDraftToForm(modal = activeManifestModal) {
    if (!modal?.validationSource) return draftRef.current || draft || {};
    const patch = {};
    for (const fieldId of modal.fields || []) {
      if (!fieldId || !modal.fieldIndex?.[fieldId]) continue;
      patch[fieldId] = getFieldValue(modal.draft || {}, fieldId);
    }
    const next = applyDraftComputed({ ...(draftRef.current || draft || {}), ...patch });
    draftRevisionRef.current += 1;
    draftRef.current = next;
    setDraft(next);
    return next;
  }

  async function confirmAction(action) {
    if (action?.confirm && typeof action.confirm === "object") {
      if (!onConfirm) return false;
      const title = action.confirm.title || "Confirm";
      const body = action.confirm.body || "Are you sure?";
      return await onConfirm({ title, body });
    }
    return true;
  }

  async function openEmailComposeAction(action, options = {}) {
    const actionModuleId = action?.moduleId || moduleId;
    const contextDraft = options?.recordDraft && typeof options.recordDraft === "object" ? options.recordDraft : draft || {};
    const contextRecordId = options?.recordId || effectiveRecordId;
    const contextSelectedIds = Array.isArray(options?.selectedIds) ? options.selectedIds : selectedIds;
    const contextEntityId =
      options?.entityId ||
      options?.recordEntityId ||
      resolveEntityFullId(manifest, action?.entity_id) ||
      null;
    if (["update_record", "transform_record"].includes(action?.kind || "")) {
      const saved = await flushPendingFormSave();
      if (!saved) return null;
    }
    if (!previewMode && contextRecordId && contextEntityId) {
      const lineWrites = await waitForPendingLineItemWrites({
        parentEntityId: contextEntityId,
        parentRecordId: contextRecordId,
        timeoutMs: 20000,
      });
      if (!lineWrites.ok) {
        const message = lineWrites.timedOut || lineWrites.pending > 0
          ? "Line items are still saving. Try again in a moment."
          : translateRuntime("common.failed_to_add_line_item");
        pushToast("error", message);
        return null;
      }
    }
    setEmailComposeModal({
      status: "loading",
      action,
      moduleId: actionModuleId,
      recordId: contextRecordId,
      recordDraft: contextDraft,
      selectedIds: contextSelectedIds,
      title: action?.confirm?.title || resolveActionLabel(action, manifest, views),
      error: null,
    });
    try {
      const res = await apiFetch("/actions/email-compose/preview", {
        method: "POST",
        body: JSON.stringify({
          module_id: actionModuleId,
          action_id: action.id,
          context: {
            record_id: contextRecordId,
            record_draft: contextDraft,
            selected_ids: contextSelectedIds,
            entity_id: contextEntityId,
          },
        }),
      });
      const compose = res?.compose || {};
      setEmailComposeModal((prev) => ({
        ...(prev || {}),
        status: "ready",
        compose,
        selectedAttachmentIds: new Set(compose.selected_attachment_ids || []),
        toText: (compose.to || []).join(", "),
        ccText: (compose.cc || []).join(", "),
        bccText: (compose.bcc || []).join(", "),
        subject: compose.subject || "",
        bodyHtml: compose.body_html || "",
        bodyText: compose.body_text || "",
        bodyMode: compose.template_id && compose.body_html ? "html" : "plain",
        error: null,
      }));
      return res;
    } catch (err) {
      setEmailComposeModal((prev) => ({
        ...(prev || {}),
        status: "error",
        error: err?.message || translateRuntime("common.app_shell.action_failed"),
      }));
      return null;
    }
  }

  async function confirmEmailComposeSend() {
    const modal = emailComposeModal;
    if (!modal || modal.status !== "ready") return;
    const compose = modal.compose || {};
    const selectedAttachmentIds = Array.from(modal.selectedAttachmentIds || []);
    if (compose.require_attachments && selectedAttachmentIds.length === 0) {
      setEmailComposeModal((prev) => (prev ? { ...prev, error: "Select at least one attachment before sending." } : prev));
      return;
    }
    setEmailComposeModal((prev) => (prev ? { ...prev, status: "sending", error: null } : prev));
    const useTemplateBody = modal.bodyMode !== "plain" && Boolean(compose.template_id && modal.bodyHtml);
    const result = await runViewAction(modal.action, {
      moduleId: modal.moduleId,
      recordId: modal.recordId,
      recordDraft: modal.recordDraft,
      selectedIds: modal.selectedIds,
      skipConfirm: true,
      emailCompose: {
        step_id: compose.step_id,
        inputs: {
          to: splitEmailInput(modal.toText),
          cc: splitEmailInput(modal.ccText),
          bcc: splitEmailInput(modal.bccText),
          template_id: useTemplateBody ? compose.template_id : null,
          subject: modal.subject,
          body_html: useTemplateBody ? modal.bodyHtml : "",
          body_text: modal.bodyText,
          attachment_ids: selectedAttachmentIds,
          replace_recipients: true,
          replace_attachments: true,
        },
      },
    });
    if (result) {
      setEmailComposeModal(null);
    } else {
      setEmailComposeModal((prev) => (prev ? { ...prev, status: "ready", error: "Email send action did not complete." } : prev));
    }
  }

  function normalizeTarget(target, defaultPrefix = "page:") {
    if (!target || typeof target !== "string") return null;
    if (target.startsWith("page:") || target.startsWith("view:")) return target;
    return `${defaultPrefix}${target}`;
  }

  function openManifestModal(modalId, contextRecord = draft || {}) {
    const def = modalById.get(modalId);
    if (!def) {
      pushToast("error", translateRuntime("common.app_shell.modal_not_found", { id: modalId }));
      return;
    }
    const modalEntity = def.entity_id || recordEntityId || entityFullId;
    const modalEntityFullId = resolveEntityFullId(manifest, modalEntity);
    const modalFieldIndex = buildFieldIndex(manifest, compiled, modalEntityFullId);
    const fields = Array.isArray(def.fields) ? def.fields.filter((fieldId) => typeof fieldId === "string") : [];
    const defaultValues = def.defaults && typeof def.defaults === "object" ? resolveTemplateRefs(def.defaults, contextRecord || {}) : {};
    const seeded = { ...(contextRecord || {}), ...(defaultValues || {}) };
    const showMissingOnly = Boolean(def.show_missing_only || def.showMissingOnly);
    const missingFieldsActionId =
      def.missing_fields_action_id || def.missingFieldsActionId || def.show_missing_only_from_action || null;
    const missingFieldIds = computeManifestModalMissingFieldIds({ fields, showMissingOnly, missingFieldsActionId }, seeded);
    setActiveManifestModal({
      id: def.id,
      title: def.title || def.label || "Modal",
      description: def.description || "",
      fields,
      actions: Array.isArray(def.actions) ? def.actions : [],
      draft: seeded,
      fieldIndex: modalFieldIndex,
      entityId: modalEntityFullId,
      showMissingOnly,
      missingFieldsActionId,
      missingFieldIds,
      saveProgress: Boolean(def.save_progress || def.saveProgress),
      busy: false,
      error: "",
      savedAt: null,
    });
  }

  function resolveCompletedMissingOnlyModalAction(modalId, contextRecord = draft || {}) {
    const def = modalById.get(modalId);
    if (!def || !Boolean(def.show_missing_only || def.showMissingOnly)) return null;
    const actionId = def.missing_fields_action_id || def.missingFieldsActionId || def.show_missing_only_from_action || null;
    if (!actionId) return null;
    const sourceAction = resolveModalAction({ action_id: actionId });
    const condition = sourceAction?.enabled_when;
    if (!condition) return null;
    const complete = evalCondition(condition, _conditionEvalContext(contextRecord || {}, currentActor));
    return complete ? { ...sourceAction, modal_id: null } : null;
  }

  async function runManifestModalAction(action) {
    if (!activeManifestModal) return;
    const resolvedAction = resolveModalAction(action);
    if (!resolvedAction) return;
    if (resolvedAction.kind === "close_modal") {
      setActiveManifestModal(null);
      return;
    }
    if (isWriteActionKind(resolvedAction.kind) && !canWriteRecords) return;
    const modalActsAsConfirmation = Boolean(
      activeManifestModal.validationSource ||
      activeManifestModal.showMissingOnly ||
      activeManifestModal.missingFieldsActionId
    );
    if (!modalActsAsConfirmation && !(await confirmAction(resolvedAction))) return;
    const modalDraft = activeManifestModal.draft || {};
    const closeOnSuccess = resolvedAction.close_on_success !== false;
    if (resolvedAction.kind === "update_record" && resolvedAction.patch && typeof resolvedAction.patch === "object") {
      const resolvedPatch = resolveTemplateRefs(resolvedAction.patch, modalDraft);
      const prevDraft = draft || {};
      const prevInitial = initialDraft || {};
      const optimistic = applyDraftComputed({ ...prevDraft, ...resolvedPatch });
      const writeSeq = beginRecordWriteGuard(resolvedPatch);
      draftRevisionRef.current += 1;
      invalidatePendingRecordLoads();
      draftRef.current = optimistic;
      setDraft(optimistic);
      setInitialDraft(applyDraftComputed({ ...prevInitial, ...resolvedPatch }));
      setActiveManifestModal((prev) => (prev ? { ...prev, busy: true, error: "" } : prev));
      const run = onRunAction?.(resolvedAction, {
        recordId: effectiveRecordId,
        recordDraft: modalDraft,
        selectedIds,
        skipConfirm: true,
        inlineAction: !resolvedAction.id,
        flushPendingFormSave,
      });
      Promise.resolve(run)
        .then((result) => {
          if (latestWriteSeqRef.current !== writeSeq) return;
          if (!result) {
            clearRecordWriteGuard(writeSeq);
            draftRef.current = prevDraft;
            setDraft(prevDraft);
            setInitialDraft(prevInitial);
            setActiveManifestModal((prev) => (prev ? { ...prev, busy: false } : prev));
            return;
          }
          if (result.record) {
            const next = applyDraftComputed(result.record);
            finishRecordWriteGuard(writeSeq, next);
            applyLoadedDraft(next);
          } else {
            finishRecordWriteGuard(writeSeq, optimistic);
            applyLoadedDraft(optimistic);
          }
          if (closeOnSuccess) setActiveManifestModal(null);
          else setActiveManifestModal((prev) => (prev ? { ...prev, busy: false } : prev));
        })
        .catch((err) => {
          if (latestWriteSeqRef.current !== writeSeq) return;
          clearRecordWriteGuard(writeSeq);
          draftRef.current = prevDraft;
          setDraft(prevDraft);
          setInitialDraft(prevInitial);
          setActiveManifestModal((prev) =>
            prev ? { ...prev, busy: false, error: err?.message || translateRuntime("common.app_shell.action_failed") } : prev
          );
        });
      return;
    }
    setActiveManifestModal((prev) => (prev ? { ...prev, busy: true, error: "" } : prev));
    const result = await runViewAction(resolvedAction, {
      recordId: effectiveRecordId,
      recordDraft: modalDraft,
      selectedIds,
      skipConfirm: true,
    });
    if (result && closeOnSuccess) {
      setActiveManifestModal(null);
      return;
    }
    setActiveManifestModal((prev) => (prev ? { ...prev, busy: false } : prev));
  }

  function buildManifestModalProgressPatch(modal = activeManifestModal) {
    if (!modal?.saveProgress || !Array.isArray(modal.fields) || modal.fields.length === 0) return {};
    const modalDraft = modal.draft || {};
    const baseDraft = initialDraftRef.current || initialDraft || {};
    const patch = {};
    for (const fieldId of modal.fields) {
      if (!fieldId || typeof fieldId !== "string") continue;
      const field = modal.fieldIndex?.[fieldId];
      if (!field || field.readonly === true || field.system === true || field.compute) continue;
      const nextValue = getFieldValue(modalDraft, fieldId);
      const currentValue = getFieldValue(baseDraft, fieldId);
      if (!formDraftValuesEqual({ value: nextValue }, { value: currentValue })) {
        patch[fieldId] = nextValue;
      }
    }
    return patch;
  }

  async function handleManifestModalSaveProgress() {
    const modal = activeManifestModal;
    if (!modal?.saveProgress || modal.busy || !effectiveRecordId || !canWriteRecords) return;
    const modalEntityId = modal.entityId || recordEntityId;
    if (!modalEntityId) return;
    const rawPatch = buildManifestModalProgressPatch(modal);
    const patch = normalizeManifestRecordPayload(modal.fieldIndex || fieldIndex, rawPatch);
    if (Object.keys(patch).length === 0) {
      setActiveManifestModal((prev) => (prev ? { ...prev, error: "", savedAt: Date.now() } : prev));
      return;
    }

    const prevDraft = draftRef.current || draft || {};
    const prevInitial = initialDraftRef.current || initialDraft || {};
    const optimistic = applyDraftComputed({ ...prevDraft, ...patch });
    const optimisticInitial = applyDraftComputed({ ...prevInitial, ...patch });
    const writeSeq = beginRecordWriteGuard(patch);
    draftRevisionRef.current += 1;
    invalidatePendingRecordLoads();
    draftRef.current = optimistic;
    setDraft(optimistic);
    setInitialDraft(optimisticInitial);
    setActiveManifestModal((prev) => (prev ? { ...prev, busy: true, error: "", savedAt: null } : prev));

    try {
      let savedRecord = null;
      if (previewMode && previewStore) {
        const updated = previewStore.upsert(modalEntityId, effectiveRecordId, optimistic);
        savedRecord = updated?.record || optimistic;
      } else {
        const res = await apiFetch(`/records/${modalEntityId}/${effectiveRecordId}`, {
          method: "PUT",
          body: JSON.stringify({
            record: patch,
            _activity: { suppress_changes: true, suppress_chatter: true },
            _validation: { mode: "patch" },
          }),
        });
        savedRecord = res?.record || optimistic;
      }
      const serverRecord = applyDraftComputed(savedRecord || optimistic);
      const persistedPatch = {};
      for (const fieldId of Object.keys(patch)) {
        persistedPatch[fieldId] = getFieldValue(serverRecord, fieldId);
      }
      const next = applyDraftComputed({ ...(draftRef.current || optimistic), ...persistedPatch });
      const nextInitial = applyDraftComputed({ ...(initialDraftRef.current || optimisticInitial), ...persistedPatch });
      if (latestWriteSeqRef.current === writeSeq) {
        if (!finishRecordWriteGuard(writeSeq, next)) clearRecordWriteGuard(writeSeq);
        draftRef.current = next;
        setDraft(next);
        setInitialDraft(nextInitial);
      }
      setActiveManifestModal((prev) => {
        if (!prev) return prev;
        const nextModalDraft = applyComputedFields(prev.fieldIndex || {}, { ...(prev.draft || {}), ...next });
        const missingFieldIds = computeManifestModalMissingFieldIds(prev, nextModalDraft);
        return {
          ...prev,
          draft: nextModalDraft,
          missingFieldIds,
          busy: false,
          error: "",
          savedAt: Date.now(),
        };
      });
    } catch (err) {
      if (latestWriteSeqRef.current === writeSeq) {
        clearRecordWriteGuard(writeSeq);
        draftRef.current = prevDraft;
        setDraft(prevDraft);
        setInitialDraft(prevInitial);
      }
      setActiveManifestModal((prev) =>
        prev ? { ...prev, busy: false, error: err?.message || translateRuntime("common.save_failed") } : prev
      );
    }
  }

  async function handleValidationModalContinue() {
    const modal = activeManifestModal;
    const source = modal?.validationSource;
    if (!modal || !source || modal.busy) return;
    const nextDraft = syncValidationModalDraftToForm(modal);
    setActiveManifestModal((prev) => (prev ? { ...prev, busy: true, error: "" } : prev));
    try {
      let ok = false;
      if (source.type === "save") {
        ok = await handleSave(null, { force: true });
      } else if (source.type === "action" && source.action) {
        const result = await handleHeaderAction(
          { ...source.action },
          { recordDraft: nextDraft, validationRetry: true, skipConfirm: true }
        );
        ok = Boolean(result);
      }
      if (ok) {
        setActiveManifestModal(null);
      } else {
        setActiveManifestModal((prev) => (prev ? { ...prev, busy: false } : prev));
      }
    } catch (err) {
      if (openValidationModalFromError(err, source, nextDraft)) return;
      setActiveManifestModal((prev) =>
        prev ? { ...prev, busy: false, error: err?.message || translateRuntime("common.app_shell.action_failed") } : prev
      );
    }
  }

  async function handleHeaderAction(action, options = {}) {
    if (!action) return;
    if (actionRunningRef.current) return;
    let contextDraft = options?.recordDraft && typeof options.recordDraft === "object" ? options.recordDraft : draft || {};
    if (action.modal_id) {
      const completedModalAction = resolveCompletedMissingOnlyModalAction(action.modal_id, contextDraft);
      if (completedModalAction) {
        action = { ...completedModalAction, moduleId: action?.moduleId || completedModalAction.moduleId };
      } else {
        openManifestModal(action.modal_id, contextDraft);
        return;
      }
    } else if (!options?.validationRetry) {
      contextDraft = await hydrateMissingValidationAttachments(action, contextDraft);
      if (openActionValidationModal(action, contextDraft)) return;
    }
    const actionModuleId = action?.moduleId || moduleId;
    if (isWriteActionKind(action.kind) && !canWriteRecords) return;
    if (!options?.emailComposeConfirmed && actionRequestsEmailCompose(action)) {
      return await openEmailComposeAction(action, {
        moduleId: actionModuleId,
        recordId: effectiveRecordId,
        recordDraft: contextDraft,
        selectedIds,
      });
    }
    if (!options?.skipConfirm && !(await confirmAction(action))) return;
    if (action.kind === "refresh") {
      // Run through the action pipeline so action.clicked triggers are emitted.
      if (onRunAction) {
        try {
          await runViewAction(action, {
            recordId: effectiveRecordId,
            recordDraft: contextDraft,
            selectedIds,
            skipConfirm: true,
          });
        } catch (err) {
          console.warn("action_run_failed", err);
        }
      }
      onRefresh?.();
      return;
    }
    if (action.kind === "navigate" && action.target) {
      onNavigate?.(action.target, { moduleId: actionModuleId });
      return;
    }
    if (action.kind === "open_form" && action.target) {
      const targetView = views.find((v) => v.id === action.target);
      const targetEntity = targetView?.entity || targetView?.entity_id || targetView?.entityId;
      const targetEntityFullId = resolveEntityFullId(manifest, targetEntity);
      const defaultForm = normalizeTarget(resolveEntityDefaultFormPage(appDefaults, targetEntityFullId));
      const returnOptions = effectiveRecordId
        ? { returnToCurrent: true, returnLabel: currentEntityLabel }
        : {};
      if (defaultForm) {
        onNavigate?.(defaultForm, { moduleId: actionModuleId, preserveParams: true, ...returnOptions });
      } else {
        onNavigate?.(`view:${action.target}`, { moduleId: actionModuleId, ...returnOptions });
      }
      return;
    }
    if (action.kind === "create_record") {
      const shouldOpenForm = listCreateBehavior !== "create_record" || listRequiresFormCreate;
      if (shouldOpenForm) {
        const targetEntity = action.entity_id || viewEntity;
        const targetEntityFullId = resolveEntityFullId(manifest, targetEntity);
        const defaultForm = normalizeTarget(resolveEntityDefaultFormPage(appDefaults, targetEntityFullId));
        if (defaultForm) {
          onNavigate?.(defaultForm, { moduleId: actionModuleId, preserveParams: true });
        } else if (formViewId) {
          onNavigate?.(`view:${formViewId}`, { moduleId: actionModuleId });
        }
        return;
      }
    }
    if (action.kind === "update_record" && action.patch && typeof action.patch === "object") {
      const resolvedPatch = resolveTemplateRefs(action.patch, contextDraft);
      const prevDraft = draftRef.current || contextDraft || {};
      const prevInitial = initialDraft || {};
      const optimistic = applyDraftComputed({ ...prevDraft, ...resolvedPatch });
      const writeSeq = beginRecordWriteGuard(resolvedPatch);
      startActionPending(action);
      draftRevisionRef.current += 1;
      invalidatePendingRecordLoads();
      draftRef.current = optimistic;
      setDraft(optimistic);
      setInitialDraft(applyDraftComputed({ ...prevInitial, ...resolvedPatch }));
      const run = onRunAction?.(action, {
        moduleId: actionModuleId,
        recordId: effectiveRecordId,
        recordDraft: contextDraft,
        selectedIds,
        skipConfirm: true,
      });
      return await Promise.resolve(run)
        .then((result) => {
          if (latestWriteSeqRef.current !== writeSeq) return;
          if (!result) {
            clearRecordWriteGuard(writeSeq);
            draftRef.current = prevDraft;
            setDraft(prevDraft);
            setInitialDraft(prevInitial);
            return null;
          }
          if (result.record) {
            const next = applyDraftComputed(result.record);
            finishRecordWriteGuard(writeSeq, next);
            applyLoadedDraft(next);
          } else {
            finishRecordWriteGuard(writeSeq, optimistic);
            applyLoadedDraft(optimistic);
          }
          return result;
        })
        .catch((err) => {
          if (latestWriteSeqRef.current !== writeSeq) return;
          clearRecordWriteGuard(writeSeq);
          draftRef.current = prevDraft;
          setDraft(prevDraft);
          setInitialDraft(prevInitial);
          if (openValidationModalFromError(err, { type: "action", action }, contextDraft)) return null;
          pushToast("error", err?.message || translateRuntime("common.app_shell.action_failed"));
          return null;
        })
        .finally(() => {
          clearActionPending();
        });
    }
    try {
      return await runViewAction(action, {
        moduleId: actionModuleId,
        recordId: effectiveRecordId,
        recordDraft: contextDraft,
        selectedIds,
        skipConfirm: true,
      });
    } catch (err) {
      console.warn("action_run_failed", err);
      if (openValidationModalFromError(err, { type: "action", action }, contextDraft)) return null;
      pushToast("error", err?.message || translateRuntime("common.app_shell.action_failed"));
      return null;
    }
  }

  async function flushPendingFormSave() {
    if (kind !== "form" || previewMode || !effectiveRecordId) return true;
    return await saveAndFlushCommittedChanges({ includeActiveField: true, showValidationErrors: true });
  }

  useEffect(() => {
    if (kind === "list") {
      if (previewMode && previewStore) {
        setRecords(previewStore.list(recordEntityId) || []);
        setSelectedIds([]);
        setState({ status: "ok", error: null });
        return;
      }
      if (previewMode) {
        setRecords([]);
        setSelectedIds([]);
        setState({ status: "ok", error: null });
        return;
      }
      const bootstrapList = bootstrap?.list;
      const bootstrapMatches =
        bootstrapList &&
        bootstrap?.viewId === view?.id &&
        bootstrapList?.entity_id === recordEntityId &&
        bootstrapUsedRef.current.list !== bootstrapVersion;
      if (bootstrapMatches) {
        setRecords(bootstrapList.records || []);
        setSelectedIds([]);
        setState({ status: "ok", error: null });
        bootstrapUsedRef.current.list = bootstrapVersion;
        return;
      }
      if (bootstrapLoading) {
        setState({ status: "running", error: null });
        return;
      }
      setState({ status: "running", error: null });
      const listFieldsParam = listFieldIds.length ? `?fields=${encodeURIComponent(listFieldIds.join(","))}` : "";
      apiFetch(`/records/${recordEntityId}${listFieldsParam}`)
        .then((res) => {
          setRecords(res.records || []);
          setSelectedIds([]);
          setState({ status: "ok", error: null });
        })
        .catch((err) => {
          const msg = err.code === "ENTITY_NOT_FOUND" ? "Entity not found" : err.message || "Failed to load records";
          console.warn("records_load_failed", { entity_id: recordEntityId, code: err.code });
          setState({ status: "error", error: msg });
        });
    }
  }, [kind, recordEntityId, refreshTick, listFieldIds, previewMode, previewStore?.version, bootstrapVersion, bootstrap, view?.id, bootstrapLoading]);

  useEffect(() => {
    if (kind !== "list" || previewMode) return undefined;
    return subscribeRecordMutations((detail) => {
      if (!detail || !entitiesMatch(detail.entityId, recordEntityId)) return;
      const ids = Array.isArray(detail.recordIds)
        ? detail.recordIds.map((value) => String(value || "")).filter(Boolean)
        : detail.recordId
          ? [String(detail.recordId)]
          : [];
      const nextRecord = detail.record && typeof detail.record === "object" ? detail.record : null;
      if (detail.operation === "delete" && ids.length > 0) {
        const idSet = new Set(ids);
        setRecords((prev) =>
          Array.isArray(prev) ? prev.filter((row) => !idSet.has(String(row?.record_id || row?.record?.id || ""))) : prev
        );
        setSelectedIds((prev) => prev.filter((id) => !idSet.has(String(id || ""))));
        return;
      }
      if ((detail.operation === "update" || detail.operation === "action") && ids.length > 0 && nextRecord) {
        const targetId = ids[0];
        setRecords((prev) =>
          Array.isArray(prev)
            ? prev.map((row) => {
                const rowId = String(row?.record_id || row?.record?.id || "");
                if (rowId !== targetId) return row;
                return {
                  ...row,
                  record: { ...(row?.record || {}), ...nextRecord },
                };
              })
            : prev
        );
        return;
      }
      if (detail.operation === "create" && ids.length > 0 && nextRecord) {
        const targetId = ids[0];
        setRecords((prev) => {
          const rows = Array.isArray(prev) ? prev : [];
          if (rows.some((row) => String(row?.record_id || row?.record?.id || "") === targetId)) return rows;
          return [{ record_id: targetId, record: nextRecord }, ...rows];
        });
      }
    });
  }, [kind, previewMode, recordEntityId]);

  const effectiveRecordId = recordContext?.recordId || recordId;
  const createDefaultsParam = !effectiveRecordId ? searchParams?.get?.(FORM_DEFAULTS_PARAM) || "" : "";
  const createReturnToParam = !effectiveRecordId ? searchParams?.get?.(FORM_RETURN_TO_PARAM) || "" : "";
  const createDefaults = useMemo(() => parseCreateDefaultsParam(searchParams), [createDefaultsParam, searchParams]);
  const formDraftStorageKey = useMemo(
    () =>
      kind === "form" && !previewMode
        ? buildFormDraftStorageKey({
            scope: "app-shell",
            entityId: recordEntityId || "",
            recordId: effectiveRecordId || "new",
            viewId: view?.id || "",
            routeKey: `module:${moduleId || ""}${!effectiveRecordId ? `:create:${createReturnToParam}:${createDefaultsParam}` : ""}`,
          })
        : null,
    [createDefaultsParam, createReturnToParam, effectiveRecordId, kind, moduleId, previewMode, recordEntityId, view?.id]
  );
  const isDirty = useMemo(() => !formDraftValuesEqual(draft, initialDraft), [draft, initialDraft]);
  const isDirtyRef = useRef(false);
  const draftNotifyTimerRef = useRef(null);
  const lastLoadedDraftKeyRef = useRef(null);
  const draftRevisionRef = useRef(0);
  const recordLoadSeqRef = useRef(0);
  const latestWriteSeqRef = useRef(0);
  const pendingWriteGuardRef = useRef(null);

  useEffect(() => {
    if (kind !== "form" || previewMode || !effectiveRecordId) return undefined;
    return subscribeRecordMutations((detail) => {
      if (!detail || !entitiesMatch(detail.entityId, recordEntityId)) return;
      const ids = Array.isArray(detail.recordIds)
        ? detail.recordIds.map((value) => String(value || "")).filter(Boolean)
        : detail.recordId
          ? [String(detail.recordId)]
          : [];
      if (!ids.includes(String(effectiveRecordId))) return;
      if (isDirtyRef.current || saveInFlightRef.current || actionRunningRef.current) return;
      invalidatePendingRecordLoads();
      setRefreshTick((value) => value + 1);
    });
  }, [kind, previewMode, recordEntityId, effectiveRecordId]);

  function invalidatePendingRecordLoads() {
    recordLoadSeqRef.current += 1;
  }

  function compactWritePatch(patch) {
    if (!patch || typeof patch !== "object") return {};
    const compact = {};
    Object.entries(patch).forEach(([key, value]) => {
      if (key === "id" || key === "record_id") return;
      compact[key] = value;
    });
    return compact;
  }

  function recordMatchesPatch(record, patch) {
    if (!patch || typeof patch !== "object") return true;
    if (!record || typeof record !== "object") return false;
    return Object.entries(patch).every(([key, value]) => record[key] === value);
  }

  function recordMatchesWriteGuard(record) {
    const guard = pendingWriteGuardRef.current;
    return recordMatchesPatch(record, guard?.patch);
  }

  function currentWriteGuardPatch() {
    const patch = pendingWriteGuardRef.current?.patch;
    return patch && typeof patch === "object" ? { ...patch } : null;
  }

  function beginRecordWriteGuard(patch) {
    const seq = latestWriteSeqRef.current + 1;
    latestWriteSeqRef.current = seq;
    pendingWriteGuardRef.current = {
      seq,
      patch: compactWritePatch(patch),
      startedAt: Date.now(),
    };
    invalidatePendingRecordLoads();
    return seq;
  }

  function finishRecordWriteGuard(seq, record = null) {
    if (latestWriteSeqRef.current !== seq) return false;
    if (record && typeof record === "object" && !recordMatchesWriteGuard(record)) return false;
    if (pendingWriteGuardRef.current?.seq === seq) {
      pendingWriteGuardRef.current = null;
    }
    return true;
  }

  function clearRecordWriteGuard(seq) {
    if (pendingWriteGuardRef.current?.seq === seq) {
      pendingWriteGuardRef.current = null;
    }
  }

  function canApplyServerRecord(record) {
    if (isDirtyRef.current || saveInFlightRef.current || actionRunningRef.current) return false;
    return recordMatchesWriteGuard(record);
  }

  const applyUserDraftChange = useCallback((next) => {
    const computed = applyDraftComputed(next);
    draftRevisionRef.current += 1;
    invalidatePendingRecordLoads();
    draftRef.current = computed;
    setDraft(computed);
  }, [applyDraftComputed]);

  function applyLoadedDraft(nextDraft, nextInitial = nextDraft) {
    const computedDraft = applyDraftComputed(nextDraft);
    const computedInitial = applyDraftComputed(nextInitial);
    draftRef.current = computedDraft;
    setDraft(computedDraft);
    setInitialDraft(computedInitial);
  }

  const applyOptimisticRecordPatch = useCallback((patch) => {
    const compactPatch = compactWritePatch(patch);
    const entries = Object.entries(compactPatch);
    if (entries.length === 0) return;
    invalidatePendingRecordLoads();
    setDraft((prev) => {
      const base = prev && typeof prev === "object" ? prev : {};
      if (entries.every(([key, value]) => base[key] === value)) return prev;
      const next = applyDraftComputed({ ...base, ...compactPatch });
      draftRef.current = next;
      return next;
    });
    setInitialDraft((prev) => {
      const base = prev && typeof prev === "object" ? prev : {};
      if (entries.every(([key, value]) => base[key] === value)) return prev;
      return applyDraftComputed({ ...base, ...compactPatch });
    });
  }, [applyDraftComputed]);

  function applyServerLoadedDraft(nextDraft, nextInitial = nextDraft) {
    if (!canApplyServerRecord(nextDraft)) return false;
    applyLoadedDraft(nextDraft, nextInitial);
    return true;
  }

  function canApplyRecordLoad(loadSeq, draftRevisionAtStart, record = null, writeGuardPatchAtStart = null) {
    return (
      recordLoadSeqRef.current === loadSeq &&
      draftRevisionRef.current === draftRevisionAtStart &&
      recordMatchesPatch(record, writeGuardPatchAtStart) &&
      canApplyServerRecord(record)
    );
  }

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    initialDraftRef.current = initialDraft;
  }, [initialDraft]);

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
    if (!recordEntityId || !effectiveRecordId || previewMode) return false;
    const fields = Array.from(pending.fields).filter(Boolean);
    const beforeRecord = pending.beforeRecord && typeof pending.beforeRecord === "object" ? pending.beforeRecord : {};
    pendingActivityCommitRef.current = null;
    try {
      const res = await apiFetch("/api/activity/change", {
        method: "POST",
        body: JSON.stringify({
          entity_id: recordEntityId,
          record_id: effectiveRecordId,
          before_record: beforeRecord,
          fields,
        }),
      });
      if (Array.isArray(res?.changes) && res.changes.length > 0 && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("octo:activity-mutated", {
            detail: { entityId: recordEntityId, recordId: effectiveRecordId },
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
    if (kind !== "form" || previewMode || !effectiveRecordId || !recordEntityId) return true;
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
      const errors = computeValidationErrors(draftRef.current || {});
      if (Object.keys(errors).length > 0) {
        if (showValidationErrors) setShowValidation(true);
        setAutoSaveState("idle");
        pushToast("error", translateRuntime("common.save_failed"));
        return false;
      }
      setAutoSaveState("saving");
      const saved = await handleSave(null, { force: true, silent: true, suppressActivity: true });
      setAutoSaveState(saved && !isDirtyRef.current ? "saved" : "idle");
      if (!saved) return false;
    }
    if (pendingActivityCommitRef.current) {
      await flushPendingActivityCommit();
    }
    return true;
  }

  async function handleFieldCommit(commit) {
    if (kind !== "form" || previewMode || !view?.header?.auto_save || !effectiveRecordId || !recordEntityId) return;
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
    if (!onRegisterNavigationGuard || kind !== "form" || previewMode || !effectiveRecordId) return undefined;
    return onRegisterNavigationGuard(() => saveAndFlushCommittedChanges({ includeActiveField: true, showValidationErrors: true }));
  }, [onRegisterNavigationGuard, kind, previewMode, effectiveRecordId, recordEntityId, fieldIndex]);

  useEffect(() => {
    return () => {
      if (draftNotifyTimerRef.current) {
        clearTimeout(draftNotifyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setActiveManifestModal(null);
  }, [view?.id, effectiveRecordId]);

  const contextEntityId = recordContext?.entityId || null;
  const contextRecordLoading = Boolean(recordContext?.recordLoading);
  const contextRecordError = recordContext?.recordError || null;

  useEffect(() => {
    if (kind === "form") {
      if (isDirtyRef.current && formDraftStorageKey && lastLoadedDraftKeyRef.current === formDraftStorageKey) return;
      setShowValidation(false);
      if (!effectiveRecordId) {
        const persisted = loadFormDraftSnapshot(formDraftStorageKey);
        const resolvedDraft = resolvePersistedFormDraft(createDefaults, persisted, applyDraftComputed);
        applyLoadedDraft(resolvedDraft.draft, resolvedDraft.initialDraft);
        lastLoadedDraftKeyRef.current = formDraftStorageKey;
        if (persisted?.dirty && !resolvedDraft.dirty && formDraftStorageKey) {
          clearFormDraftSnapshot(formDraftStorageKey);
        }
        setState({ status: "ok", error: null });
        return;
      }
      if (previewMode && previewStore) {
        const entry = previewStore.get(recordEntityId, effectiveRecordId);
        const next = applyDraftComputed(entry?.record || {});
        applyLoadedDraft(next);
        lastLoadedDraftKeyRef.current = formDraftStorageKey;
        setState({ status: "ok", error: null });
        return;
      }
      if (previewMode) {
        const next = applyDraftComputed(recordContext?.record || {});
        applyLoadedDraft(next);
        lastLoadedDraftKeyRef.current = formDraftStorageKey;
        setState({ status: "ok", error: null });
        return;
      }
      const bootstrapRecord = bootstrap?.record;
      const bootstrapMatches =
        bootstrapRecord &&
        bootstrap?.viewId === view?.id &&
        bootstrapRecord?.entity_id === recordEntityId &&
        bootstrapRecord?.record_id === effectiveRecordId &&
        bootstrapUsedRef.current.form !== bootstrapVersion;
      if (bootstrapMatches) {
        const persisted = loadFormDraftSnapshot(formDraftStorageKey);
        const baseRecord = bootstrapRecord?.record || {};
        const resolvedDraft = resolvePersistedFormDraft(baseRecord, persisted, applyDraftComputed);
        applyServerLoadedDraft(resolvedDraft.draft, resolvedDraft.initialDraft);
        lastLoadedDraftKeyRef.current = formDraftStorageKey;
        if (persisted?.dirty && !resolvedDraft.dirty && formDraftStorageKey) {
          clearFormDraftSnapshot(formDraftStorageKey);
        }
        setState({ status: "ok", error: null });
        bootstrapUsedRef.current.form = bootstrapVersion;
        return;
      }
      if (bootstrapLoading) {
        setState({ status: "running", error: null });
        return;
      }
      const hasContext = Boolean(contextEntityId);
      if (hasContext) {
        if (contextRecordLoading) {
          setState({ status: "running", error: null });
          return;
        }
        if (contextRecordError) {
          setState({ status: "error", error: contextRecordError });
          return;
        }
        const persisted = loadFormDraftSnapshot(formDraftStorageKey);
        const baseRecord = recordContext?.record || {};
        const resolvedDraft = resolvePersistedFormDraft(baseRecord, persisted, applyDraftComputed);
        applyServerLoadedDraft(resolvedDraft.draft, resolvedDraft.initialDraft);
        lastLoadedDraftKeyRef.current = formDraftStorageKey;
        if (persisted?.dirty && !resolvedDraft.dirty && formDraftStorageKey) {
          clearFormDraftSnapshot(formDraftStorageKey);
        }
        setState({ status: "ok", error: null });
        return;
      }
      setState({ status: "running", error: null });
      const loadSeq = ++recordLoadSeqRef.current;
      const draftRevisionAtStart = draftRevisionRef.current;
      const writeGuardPatchAtStart = currentWriteGuardPatch();
      apiFetch(`/records/${recordEntityId}/${effectiveRecordId}`, { cacheTtl: 0 })
        .then((res) => {
          const persisted = loadFormDraftSnapshot(formDraftStorageKey);
          const baseRecord = res.record || {};
          const resolvedDraft = resolvePersistedFormDraft(baseRecord, persisted, applyDraftComputed);
          if (!canApplyRecordLoad(loadSeq, draftRevisionAtStart, resolvedDraft.draft, writeGuardPatchAtStart)) return;
          applyLoadedDraft(resolvedDraft.draft, resolvedDraft.initialDraft);
          lastLoadedDraftKeyRef.current = formDraftStorageKey;
          if (persisted?.dirty && !resolvedDraft.dirty && formDraftStorageKey) {
            clearFormDraftSnapshot(formDraftStorageKey);
          }
          setState({ status: "ok", error: null });
        })
        .catch((err) => {
          const msg = err.code === "ENTITY_NOT_FOUND" ? "Entity not found" : err.code === "RECORD_NOT_FOUND" ? "Record not found" : err.message || "Failed to load record";
          console.warn("record_load_failed", { entity_id: recordEntityId, record_id: effectiveRecordId, code: err.code });
          setState({ status: "error", error: msg });
        });
    }
  }, [kind, recordEntityId, effectiveRecordId, contextEntityId, contextRecordLoading, contextRecordError, previewMode, previewStore?.version, bootstrapVersion, bootstrap, view?.id, bootstrapLoading, applyDraftComputed, formDraftStorageKey, createDefaults, refreshTick]);

  useEffect(() => {
    if (kind !== "form" || effectiveRecordId || recordEntityId !== "entity.material_log") return;
    const pending = readPendingMaterialGate();
    if (!pending?.timeEntryId || !pending?.materialDraft || typeof pending.materialDraft !== "object") return;
    setDraft((prev) => {
      const current = prev && typeof prev === "object" ? prev : {};
      return { ...pending.materialDraft, ...current };
    });
    setInitialDraft((prev) => {
      const current = prev && typeof prev === "object" ? prev : {};
      return { ...pending.materialDraft, ...current };
    });
  }, [kind, effectiveRecordId, recordEntityId]);

  useEffect(() => {
    if (typeof onSelectionChange === "function") {
      onSelectionChange(selectedIds);
    }
  }, [selectedIds, onSelectionChange]);

  useEffect(() => {
    if (kind !== "list") return;
    if (state.status !== "ok") return;
    if (perfMarkRef.current.list === refreshTick) return;
    if (typeof performance !== "undefined" && performance.mark) {
      performance.mark("list_rendered");
    }
    perfMarkRef.current.list = refreshTick;
  }, [kind, state.status, refreshTick]);

  useEffect(() => {
    if (kind !== "form") return;
    if (state.status !== "ok") return;
    const key = effectiveRecordId || "new";
    if (perfMarkRef.current.form === key) return;
    if (typeof performance !== "undefined" && performance.mark) {
      performance.mark("form_rendered");
    }
    perfMarkRef.current.form = key;
  }, [kind, state.status, effectiveRecordId]);

  useEffect(() => {
    if (typeof onRecordDraftChange === "function") {
      if (draftNotifyTimerRef.current) {
        clearTimeout(draftNotifyTimerRef.current);
      }
      draftNotifyTimerRef.current = window.setTimeout(() => {
        draftNotifyTimerRef.current = null;
        if (typeof React.startTransition === "function") {
          React.startTransition(() => onRecordDraftChange(draft));
        } else {
          onRecordDraftChange(draft);
        }
      }, 80);
    }
    return () => {
      if (draftNotifyTimerRef.current) {
        clearTimeout(draftNotifyTimerRef.current);
        draftNotifyTimerRef.current = null;
      }
    };
  }, [draft, onRecordDraftChange]);

  async function handleSave(validationErrors, opts = {}) {
    if (!canWriteRecords) return false;
    setShowValidation(true);
    const liveDraft = draftRef.current || {};
    const nextValidationErrors =
      validationErrors && typeof validationErrors === "object" ? validationErrors : computeValidationErrors(liveDraft);
    if (nextValidationErrors && Object.keys(nextValidationErrors).length > 0) {
      if (isValidationUiEnabled(view?.header?.validation_ui ?? view?.header?.validationUi)) {
        openValidationFieldsModal({
          fieldIds: Object.keys(nextValidationErrors),
          errors: Object.entries(nextValidationErrors).map(([path, message]) => ({
            code: "REQUIRED_FIELD",
            path,
            message: typeof message === "string" ? message : "Required",
          })),
          title: "Complete Required Fields",
          description: effectiveRecordId
            ? "Complete the missing fields before saving this record."
            : "Complete the missing fields before creating this record.",
          source: { type: "save", validationUi: view?.header?.validation_ui ?? view?.header?.validationUi },
          contextRecord: liveDraft,
        });
      }
      return false;
    }
    const silent = opts.silent === true;
    const suppressActivity = opts.suppressActivity === true;
    if (saveInFlightRef.current && !opts.force) {
      pendingAutoSaveRef.current = true;
      return false;
    }
    let writeSeq = null;
    let saveSucceeded = false;
    const saveRevisionAtStart = draftRevisionRef.current;
    try {
      saveInFlightRef.current = true;
      invalidatePendingRecordLoads();
      const payload = normalizeManifestRecordPayload(fieldIndex, liveDraft);
      if (!previewMode && effectiveRecordId) {
        writeSeq = beginRecordWriteGuard(payload);
      }
      if (previewMode && previewStore) {
        if (effectiveRecordId) {
          const updated = previewStore.upsert(recordEntityId, effectiveRecordId, payload);
          applyLoadedDraft(updated?.record || payload);
          clearFormDraftSnapshot(formDraftStorageKey);
          if (!silent) pushToast("success", translateRuntime("common.saved_local_preview"));
        } else {
          const created = previewStore.upsert(recordEntityId, null, payload);
          const newId = created?.record_id;
          if (newId) {
            const formTarget = normalizeTarget(resolveEntityDefaultFormPage(appDefaults, recordEntityId));
            if (formTarget) {
              onNavigate(formTarget, { recordId: newId, preserveParams: true });
            } else {
              onNavigate(`view:${view.id}`, { recordId: newId });
            }
          }
          applyLoadedDraft(created?.record || payload);
          clearFormDraftSnapshot(formDraftStorageKey);
          if (!silent) pushToast("success", translateRuntime("common.created_local_preview"));
        }
      } else if (effectiveRecordId) {
        const res = await apiFetch(`/records/${recordEntityId}/${effectiveRecordId}`, {
          method: "PUT",
          body: JSON.stringify(
            suppressActivity
              ? { record: payload, _activity: { suppress_changes: true, suppress_chatter: true } }
              : payload
          ),
        });
        const savedRecord = applyDraftComputed(res?.record || payload);
        if (!finishRecordWriteGuard(writeSeq, savedRecord)) {
          clearRecordWriteGuard(writeSeq);
        }
        if (draftRevisionRef.current === saveRevisionAtStart) {
          applyLoadedDraft(savedRecord);
          clearFormDraftSnapshot(formDraftStorageKey);
        } else {
          setInitialDraft(savedRecord);
        }
        if (!silent) pushToast("success", translateRuntime("common.saved"));
      } else {
        const res = await apiFetch(`/records/${recordEntityId}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const newId = res.record_id;
        const pendingMaterialGate =
          recordEntityId === "entity.material_log" && !effectiveRecordId ? readPendingMaterialGate() : null;
        if (pendingMaterialGate?.timeEntryId) {
          const closeAction = actionsMap?.get("action.time_entry_close");
          let closeResult = null;
          if (closeAction) {
            closeResult = await onRunAction?.(closeAction, {
              recordId: pendingMaterialGate.timeEntryId,
              recordDraft: pendingMaterialGate.timeEntryDraft || {},
              skipConfirm: true,
              skipMaterialGate: true,
            });
          }
          clearPendingMaterialGate();
          clearFormDraftSnapshot(formDraftStorageKey);
          const timeEntryFormTarget = normalizeTarget(resolveEntityDefaultFormPage(appDefaults, "entity.time_entry"));
          if (timeEntryFormTarget) {
            onNavigate(timeEntryFormTarget, { recordId: pendingMaterialGate.timeEntryId, preserveParams: true });
          }
          if (closeResult) {
            if (!silent) pushToast("success", translateRuntime("common.material_logged_and_closed"));
          } else {
            if (!silent) pushToast("success", translateRuntime("common.material_logged_finish_clockout"));
          }
          applyLoadedDraft(payload);
          return true;
        }
        if (newId) {
          const formTarget = normalizeTarget(resolveEntityDefaultFormPage(appDefaults, recordEntityId));
          if (formTarget) {
            onNavigate(formTarget, { recordId: newId, preserveParams: true });
          } else {
            onNavigate(`view:${view.id}`, { recordId: newId });
          }
        }
        clearFormDraftSnapshot(formDraftStorageKey);
        if (!silent) pushToast("success", translateRuntime("common.created"));
        applyLoadedDraft(payload);
      }
      saveSucceeded = true;
      return true;
    } catch (err) {
      if (writeSeq !== null) clearRecordWriteGuard(writeSeq);
      if (openValidationModalFromError(err, { type: "save", validationUi: view?.header?.validation_ui ?? view?.header?.validationUi }, draftRef.current || liveDraft)) return false;
      pushToast("error", err.message || translateRuntime("common.save_failed"));
      return false;
    } finally {
      saveInFlightRef.current = false;
      if (pendingAutoSaveRef.current) {
        pendingAutoSaveRef.current = false;
        if (kind === "form" && view?.header?.auto_save && effectiveRecordId) {
          const errors = computeValidationErrors(draftRef.current || {});
          if (Object.keys(errors).length === 0) {
            await handleSave(null, { force: true, silent: true, suppressActivity: true });
          }
        }
      } else if (saveSucceeded && pendingActivityCommitRef.current) {
        if (suppressActivity) {
          await flushPendingActivityCommit();
        } else {
          pendingActivityCommitRef.current = null;
        }
      }
    }
  }

  const refreshCurrentRecord = useCallback(async () => {
    if (!recordEntityId || !effectiveRecordId || previewMode) return;
    const loadSeq = ++recordLoadSeqRef.current;
    const draftRevisionAtStart = draftRevisionRef.current;
    const writeGuardPatchAtStart = currentWriteGuardPatch();
    try {
      const res = await apiFetch(`/records/${recordEntityId}/${effectiveRecordId}`, { cacheTtl: 0 });
      const next = applyDraftComputed(res?.record || {});
      if (!canApplyRecordLoad(loadSeq, draftRevisionAtStart, next, writeGuardPatchAtStart)) return;
      applyLoadedDraft(next);
    } catch {
      // Keep the current draft if the parent refetch fails.
    }
  }, [recordEntityId, effectiveRecordId, previewMode, applyDraftComputed]);

  useEffect(() => {
    if (kind !== "form" || previewMode || !formDraftStorageKey) return;
    if (!isDirty) {
      clearFormDraftSnapshot(formDraftStorageKey);
      return;
    }
    saveFormDraftSnapshot(formDraftStorageKey, {
      dirty: true,
      draft,
      initialDraft,
      updatedAt: Date.now(),
    });
  }, [kind, previewMode, formDraftStorageKey, isDirty, draft, initialDraft]);

  useEffect(() => {
    if (kind !== "form" || previewMode) return undefined;
    const onBeforeUnload = (event) => {
      queueActiveFieldCommit();
      if (!isDirtyRef.current && !pendingActivityCommitRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [kind, previewMode, fieldIndex]);

  async function handleDiscard() {
    if (!effectiveRecordId) {
      if (isDirty) {
        if (!onConfirm) return;
        const ok = await onConfirm({
          title: translateRuntime("common.discard_new_record"),
          body: translateRuntime("common.discard_new_record_body"),
        });
        if (!ok) return;
      }
      const listTarget = resolveEntityDefaultHomePage(appDefaults, entityFullId) || (listViewId ? `view:${listViewId}` : null);
      if (listTarget) {
        clearFormDraftSnapshot(formDraftStorageKey);
        onNavigate?.(listTarget, { preserveParams: true });
        return;
      }
    }
    setDraft(initialDraft || {});
    clearFormDraftSnapshot(formDraftStorageKey);
    setShowValidation(false);
  }

  useEffect(() => {
    if (kind !== "form") return;
    if (previewMode) return;
    if (!canWriteRecords) return;
    if (!view?.header?.auto_save) return;
    if (!effectiveRecordId) return;
    if (!isDirty) return;
    const debounceMs = Number(view?.header?.auto_save_debounce_ms) || 750;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const errors = computeValidationErrors(draftRef.current || {});
      if (Object.keys(errors).length > 0) return;
      if (saveInFlightRef.current) {
        pendingAutoSaveRef.current = true;
        return;
      }
      setAutoSaveState("saving");
      const saved = await handleSave(null, { silent: true, suppressActivity: true });
      setAutoSaveState(saved && !isDirtyRef.current ? "saved" : "idle");
    }, debounceMs);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [kind, previewMode, canWriteRecords, view?.header?.auto_save, view?.header?.auto_save_debounce_ms, effectiveRecordId, draft, isDirty]);

  if (state.error) return <div className="alert alert-error">{state.error}</div>;

  const transitionTargets = transitions.filter((t) => t?.from === currentStatus);
  const modalReadonly = !canWriteRecords || activeManifestModal?.busy;
  const modalMissingFieldSet =
    activeManifestModal?.showMissingOnly && Array.isArray(activeManifestModal?.missingFieldIds)
      ? new Set(activeManifestModal.missingFieldIds)
      : null;
  const modalHiddenFields = activeManifestModal?.showMissingOnly
    ? activeManifestModal.fields.filter((fieldId) => {
        if (modalMissingFieldSet) return !modalMissingFieldSet.has(fieldId);
        return !isEmptyFieldValue(getFieldValue(activeManifestModal.draft || {}, fieldId));
      })
    : [];
  const modalVisibleFields = activeManifestModal
    ? activeManifestModal.fields.filter((fieldId) => !modalHiddenFields.includes(fieldId))
    : [];
  const modalProgressPatch = activeManifestModal?.saveProgress ? buildManifestModalProgressPatch(activeManifestModal) : {};
  const modalProgressDirty = Object.keys(modalProgressPatch).length > 0;
  const modalProgressSaved = Boolean(activeManifestModal?.savedAt) && !modalProgressDirty;
  const modalProgressLabel = modalProgressSaved ? "Progress Saved" : "Save Progress";
  const modalFormView =
    activeManifestModal && activeManifestModal.fields.length > 0
      ? {
          id: `${activeManifestModal.id || "manifest_modal"}.form`,
          kind: "form",
          entity: activeManifestModal.entityId,
          sections: [
            {
              id: "fields",
              title: "",
              hideTitle: true,
              fields: activeManifestModal.fields,
            },
          ],
          header: {
            save_mode: "none",
            auto_save: false,
          },
        }
      : null;
  const manifestModalNode =
    activeManifestModal &&
    createPortal(
      <div className="modal modal-open">
        <div className="modal-box max-w-2xl">
          <h3 className="font-bold text-lg">{activeManifestModal.title}</h3>
          {activeManifestModal.description ? (
            <p className="py-2 text-sm opacity-70">{activeManifestModal.description}</p>
          ) : null}
          <div className="space-y-3">
            {modalFormView && modalVisibleFields.length > 0 ? (
              <FormViewRenderer
                view={modalFormView}
                entityId={activeManifestModal.entityId}
                recordId={effectiveRecordId}
                fieldIndex={activeManifestModal.fieldIndex || {}}
                entityDefs={manifest?.entities || []}
                record={activeManifestModal.draft || {}}
                autoSaveState="idle"
                hasRecord={Boolean(effectiveRecordId)}
                onChange={(next) =>
                  setActiveManifestModal((prev) => {
                    if (!prev) return prev;
                    const nextModalDraft = applyComputedFields(prev.fieldIndex || {}, next || {});
                    const missingFieldIds = computeManifestModalMissingFieldIds(prev, nextModalDraft);
                    return {
                      ...prev,
                      draft: nextModalDraft,
                      missingFieldIds,
                      error: "",
                      savedAt: null,
                    };
                  })
                }
                onSave={null}
                onDiscard={null}
                isDirty={false}
                header={modalFormView.header}
                primaryActions={[]}
                secondaryActions={[]}
                onActionClick={null}
                readonly={modalReadonly}
                showValidation={false}
                applyDefaults={false}
                requiredFields={[]}
                hiddenFields={modalHiddenFields}
                previewMode={false}
                canCreateLookup={(lookupEntityId) => canWriteRecords && Boolean(canCreateLookup?.(lookupEntityId))}
                onLookupCreate={onLookupCreate}
                syncAttachmentValues
                hideHeader
              />
            ) : activeManifestModal.fields.length > 0 ? (
              <div className="alert alert-success text-sm">
                All required fields in this gate are complete. You can continue.
              </div>
            ) : null}
            {activeManifestModal.error ? <div className="text-xs text-error">{activeManifestModal.error}</div> : null}
          </div>
          <div className="modal-action">
            {activeManifestModal.saveProgress && modalVisibleFields.length > 0 ? (
              <button
                className={SOFT_BUTTON_SM}
                disabled={modalReadonly || !effectiveRecordId || !modalProgressDirty}
                onClick={handleManifestModalSaveProgress}
              >
                {activeManifestModal.busy ? <span className="loading loading-spinner loading-xs" /> : null}
                {modalProgressLabel}
              </button>
            ) : null}
            {activeManifestModal.validationSource ? (
              <>
                <button
                  className="btn btn-ghost"
                  disabled={activeManifestModal.busy}
                  onClick={() => setActiveManifestModal(null)}
                >
                  Cancel
                </button>
                <button
                  className={PRIMARY_BUTTON_SM}
                  disabled={modalReadonly || (activeManifestModal.validationSource.type === "save" && !canWriteRecords)}
                  onClick={handleValidationModalContinue}
                >
                  {activeManifestModal.busy ? <span className="loading loading-spinner loading-xs" /> : null}
                  {activeManifestModal.validationSource.type === "save"
                    ? effectiveRecordId
                      ? "Save Record"
                      : "Create Record"
                    : "Continue"}
                </button>
              </>
            ) : null}
            {activeManifestModal.actions.map((action, idx) => {
              const resolvedAction = resolveModalAction(action);
              if (!resolvedAction) return null;
              const label = action?.label || resolveActionLabel(resolvedAction, manifest, views);
              const variant = action?.variant || "soft";
              const btnClass = variant === "primary" ? PRIMARY_BUTTON_SM : SOFT_BUTTON_SM;
              const enabled = resolvedAction.enabled_when
                ? evalCondition(resolvedAction.enabled_when, _conditionEvalContext(activeManifestModal.draft || {}, currentActor))
                : true;
              return (
                <button
                  key={`${resolvedAction.id || label}-${idx}`}
                  className={btnClass}
                  disabled={!enabled || modalReadonly || (isWriteActionKind(resolvedAction.kind) && !canWriteRecords)}
                  onClick={() => runManifestModalAction(action)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <button
          className="modal-backdrop"
          onClick={() => {
            if (!activeManifestModal.busy) setActiveManifestModal(null);
          }}
          aria-label="Close"
        />
      </div>,
      document.body
    );
  const emailComposeHasTemplate = Boolean(emailComposeModal?.compose?.template_id && emailComposeModal?.bodyHtml);
  const emailComposeBodyMode = emailComposeHasTemplate && emailComposeModal?.bodyMode !== "plain" ? "html" : "plain";
  const emailComposeSendTypeOptions = emailComposeHasTemplate
    ? [
        { value: "html", label: "Template" },
        { value: "plain", label: "Plain text" },
      ]
    : [{ value: "plain", label: "Plain text" }];
  const emailComposeNode =
    emailComposeModal &&
    createPortal(
      <div className="modal modal-open">
        <div className="modal-box flex max-h-[calc(100dvh-2rem)] w-11/12 max-w-5xl flex-col overflow-hidden">
          <div className="shrink-0">
            <h3 className="font-bold text-lg">{emailComposeModal.title || "Send Email"}</h3>
            {emailComposeModal.compose?.automation_name ? (
              <p className="mt-1 text-xs opacity-60">{emailComposeModal.compose.automation_name}</p>
            ) : null}
          </div>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
            {emailComposeModal.status === "loading" ? (
              <LoadingSpinner className="min-h-[20vh]" />
            ) : emailComposeModal.status === "error" ? (
              <div className="alert alert-error text-sm">{emailComposeModal.error || "Email preview failed."}</div>
            ) : (
              <>
                {emailComposeModal.error ? <div className="alert alert-error text-sm">{emailComposeModal.error}</div> : null}
                <div className="space-y-5">
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">Details</div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="form-control md:col-span-2">
                        <span className="label label-text">To</span>
                        <input
                          className="input input-bordered input-sm"
                          value={emailComposeModal.toText || ""}
                          onChange={(event) => setEmailComposeModal((prev) => (prev ? { ...prev, toText: event.target.value } : prev))}
                        />
                      </label>
                      <label className="form-control">
                        <span className="label label-text">Cc</span>
                        <input
                          className="input input-bordered input-sm"
                          value={emailComposeModal.ccText || ""}
                          onChange={(event) => setEmailComposeModal((prev) => (prev ? { ...prev, ccText: event.target.value } : prev))}
                        />
                      </label>
                      <label className="form-control">
                        <span className="label label-text">Bcc</span>
                        <input
                          className="input input-bordered input-sm"
                          value={emailComposeModal.bccText || ""}
                          onChange={(event) => setEmailComposeModal((prev) => (prev ? { ...prev, bccText: event.target.value } : prev))}
                        />
                      </label>
                      <label className="form-control">
                        <span className="label label-text">Subject</span>
                        <input
                          className="input input-bordered input-sm"
                          value={emailComposeModal.subject || ""}
                          onChange={(event) => setEmailComposeModal((prev) => (prev ? { ...prev, subject: event.target.value } : prev))}
                        />
                      </label>
                      <label className="form-control">
                        <span className="label label-text">Send Type</span>
                        <AppSelect
                          className="select select-bordered select-sm"
                          value={emailComposeBodyMode}
                          disabled={emailComposeModal.status === "sending"}
                          onChange={(event) => setEmailComposeModal((prev) => (prev ? { ...prev, bodyMode: event.target.value } : prev))}
                        >
                          {emailComposeSendTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </AppSelect>
                      </label>
                    </div>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">Preview</div>
                      <div className="text-xs opacity-60">
                        {emailComposeBodyMode === "html" ? "Template" : "Plain text"}
                      </div>
                    </div>
                    <div className="min-h-56 overflow-hidden rounded-box border border-base-300 bg-base-100">
                      {emailComposeBodyMode === "html" ? (
                        <iframe
                          title="Email preview"
                          className="h-72 w-full bg-base-100"
                          sandbox=""
                          srcDoc={emailComposeModal.bodyHtml}
                        />
                      ) : emailComposeModal.compose?.allow_edit_body ? (
                        <textarea
                          className="textarea min-h-56 w-full rounded-none border-0 text-sm leading-6 text-base-content focus:outline-none"
                          value={emailComposeModal.bodyText || ""}
                          onChange={(event) => setEmailComposeModal((prev) => (prev ? { ...prev, bodyText: event.target.value } : prev))}
                        />
                      ) : (
                        <div className="min-h-56 overflow-auto whitespace-pre-wrap p-4 text-sm leading-6 text-base-content">
                          {emailComposeModal.bodyText || ""}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">Attachments</div>
                      <div className="text-xs opacity-60">{(emailComposeModal.selectedAttachmentIds || new Set()).size} selected</div>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-box border border-base-300">
                      {(emailComposeModal.compose?.attachments || []).length === 0 ? (
                        <div className="p-3 text-sm opacity-60">No attachments available.</div>
                      ) : (
                        (emailComposeModal.compose?.attachments || []).map((attachment) => {
                          const selected = emailComposeModal.selectedAttachmentIds?.has(attachment.id);
                          const required = Boolean(attachment.required);
                          return (
                            <label key={attachment.id} className="flex cursor-pointer items-start gap-3 border-b border-base-200 p-3 last:border-b-0">
                              <input
                                type="checkbox"
                                className="checkbox checkbox-sm mt-1"
                                checked={Boolean(selected)}
                                disabled={emailComposeModal.status === "sending"}
                                onChange={(event) =>
                                  setEmailComposeModal((prev) => {
                                    if (!prev) return prev;
                                    const next = new Set(prev.selectedAttachmentIds || []);
                                    if (event.target.checked) next.add(attachment.id);
                                    else next.delete(attachment.id);
                                    return { ...prev, selectedAttachmentIds: next, error: null };
                                  })
                                }
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium" title={attachment.filename || "Attachment"}>
                                  {attachment.filename || "Attachment"}
                                </span>
                                <span className="block truncate text-xs opacity-60">
                                  {[attachment.mime_type, attachment.source, required ? "required" : null].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="modal-action shrink-0">
            <button
              className="btn btn-ghost"
              disabled={emailComposeModal.status === "sending"}
              onClick={() => setEmailComposeModal(null)}
            >
              Cancel
            </button>
            <button
              className={PRIMARY_BUTTON_SM}
              disabled={emailComposeModal.status !== "ready"}
              onClick={confirmEmailComposeSend}
            >
              {emailComposeModal.status === "sending" ? <span className="loading loading-spinner loading-xs" /> : null}
              Send
            </button>
          </div>
        </div>
        <button
          className="modal-backdrop"
          onClick={() => {
            if (emailComposeModal.status !== "sending") setEmailComposeModal(null);
          }}
          aria-label="Close"
        />
      </div>,
      document.body
    );

  if (kind === "list") {
    const header = view.header || null;
    const searchConfig = header?.search?.enabled ? header.search : null;
    const activeQuery = searchParams?.get("q") || "";
    const activeFilterId = searchParams?.get("filter") || "";
    const filters = Array.isArray(header?.filters) ? header.filters : [];
    const selectedFilter = filters.find((f) => f?.id === activeFilterId) || null;

    if (state.status === "running") {
      return (
        <div className="space-y-2">
          <div className="text-xs opacity-60">{translateRuntime("common.loading_list")}</div>
          <ListViewRenderer
            view={view}
            fieldIndex={fieldIndex}
            records={[]}
            header={view.header || null}
            searchQuery={activeQuery}
            searchFields={header?.search?.fields || []}
            onSearchChange={(q) => {
              const params = new URLSearchParams(searchParams || "");
              if (q) params.set("q", q);
              else params.delete("q");
              setSearchParams(params);
            }}
            filters={filters}
            activeFilter={selectedFilter}
            onFilterChange={(id) => {
              const params = new URLSearchParams(searchParams || "");
              if (id) params.set("filter", id);
              else params.delete("filter");
              setSearchParams(params);
            }}
            primaryActions={[]}
            secondaryActions={[]}
            bulkActions={[]}
            onActionClick={handleHeaderAction}
            hideHeader={false}
          />
        </div>
      );
    }

    function updateSearchParams(nextQuery, nextFilter) {
      if (!setSearchParams) return;
      const params = new URLSearchParams(searchParams || "");
      if (nextQuery) params.set("q", nextQuery);
      else params.delete("q");
      if (nextFilter) params.set("filter", nextFilter);
      else params.delete("filter");
      params.delete("record");
      setSearchParams(params, { replace: true });
    }

    function decorateActions(actions, contextRecord) {
      const items = [];
      for (const action of actions || []) {
        const resolved = resolveHeaderAction(action);
        if (!resolved || !resolved.kind) continue;
        if (isWriteActionKind(resolved.kind) && !canWriteRecords) continue;
        const label = resolveActionLabel(resolved, manifest, views);
        const visible = resolved.visible_when ? evalCondition(resolved.visible_when, _conditionEvalContext(contextRecord || {}, currentActor)) : true;
        if (!visible) continue;
        let enabled = resolved.enabled_when ? evalCondition(resolved.enabled_when, _conditionEvalContext(contextRecord || {}, currentActor)) : true;
        if (!enabled && resolved.modal_id) enabled = true;
        const missingSelection = resolved.kind === "bulk_update" && (!selectedIds || selectedIds.length === 0);
        if (missingSelection) enabled = false;
        const reason = enabled ? null : explainActionDisabled(resolved, contextRecord || {}, fieldIndex, { missingSelection, actor: currentActor });
        items.push({ action: resolved, label, enabled, reason });
      }
      return items;
    }

    const primaryActions = decorateActions(header?.primary_actions, {});
    const secondaryActions = decorateActions(header?.secondary_actions, {});
    const bulkActions = decorateActions(header?.bulk_actions, {});
    const hasHeader = Boolean(header && (primaryActions.length || secondaryActions.length || searchConfig || filters.length || bulkActions.length));

    async function handleBulkDelete() {
      if (!recordEntityId || selectedIds.length === 0) return;
      if (!onConfirm) return;
      const ok = await onConfirm({
        title: translateRuntime("common.delete_records"),
        body: translateRuntime("common.delete_records_body", { count: selectedIds.length }),
      });
      if (!ok) return;
      const deletingIds = [...selectedIds];
      setRecords((prev) => prev.filter((row) => !deletingIds.includes(row.record_id)));
      setSelectedIds([]);
      try {
        await Promise.all(
          deletingIds.map((rid) => deleteRecord(recordEntityId, rid))
        );
        pushToast({ type: "success", message: translateRuntime("common.app_shell.deleted_records_count", { count: deletingIds.length }) });
        onRefresh?.();
      } catch (err) {
        onRefresh?.();
        pushToast({ type: "error", message: err?.message || translateRuntime("common.app_shell.bulk_delete_failed") });
      }
    }

    async function addClientFilter(field) {
      if (!field) return;
      if (!onPrompt) return;
      let value = "";
      if (field.type === "enum") {
        const values = field.options.map((opt) => (typeof opt === "string" ? opt : opt.value)).filter(Boolean);
        value = await onPrompt({
          title: `Filter ${field.label}`,
          body: `Allowed values: ${values.join(", ")}`,
          defaultValue: values[0] || "",
        });
      } else if (field.type === "bool") {
        value = await onPrompt({
          title: `Filter ${field.label}`,
          body: "Enter true or false",
          defaultValue: "true",
        });
      } else {
        value = await onPrompt({
          title: `Filter ${field.label}`,
          defaultValue: "",
        });
      }
      if (value === null || value === "") return;
      const op = field.type === "string" || field.type === "text" ? "contains" : "eq";
      setClientFilters((prev) => [
        ...prev,
        {
          field_id: field.id,
          label: field.label,
          op,
          value,
        },
      ]);
    }

    function removeClientFilter(idx) {
      setClientFilters((prev) => prev.filter((_, i) => i !== idx));
    }

    const entityLabel = entityDef?.label || humanizeEntityId(entityFullId) || view.title || view.id;

    return (
      <>
      <div className="space-y-4">
        {hasHeader && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-[10rem]">
              {primaryActions.map((item) => (
                item.reason ? (
                  <DaisyTooltip key={`${item.action?.id || item.label}`} label={item.reason} placement="bottom">
                    <span className="inline-flex">
                      <button
                        className={PRIMARY_BUTTON_SM}
                        onClick={() => handleHeaderAction(item.action)}
                        disabled={!item.enabled || actionRunning}
                      >
                        {actionRunning && actionState.label === item.label ? <span className="loading loading-spinner loading-xs" /> : null}
                        {item.label}
                      </button>
                    </span>
                  </DaisyTooltip>
                ) : (
                  <button
                    key={`${item.action?.id || item.label}`}
                    className={PRIMARY_BUTTON_SM}
                    onClick={() => handleHeaderAction(item.action)}
                    disabled={!item.enabled || actionRunning}
                  >
                    {actionRunning && actionState.label === item.label ? <span className="loading loading-spinner loading-xs" /> : null}
                    {item.label}
                  </button>
                )
              ))}
              <div className="text-lg font-semibold">{entityLabel}</div>
            </div>

            <div className="flex items-center justify-center flex-1 min-w-[16rem]">
              <div className="join">
                {searchConfig && (
                  <input
                    className="input input-bordered input-sm join-item toolbar-search-input w-full max-w-xs"
                    placeholder={searchConfig.placeholder || "Search..."}
                    value={activeQuery}
                    onChange={(e) => updateSearchParams(e.target.value, activeFilterId)}
                  />
                )}
                {(filters.length > 0 || filterableFields.length > 0) && (
                  <div className="dropdown dropdown-end join-item">
                    <button className={SOFT_BUTTON_SM + " w-full"}>
                      {selectedFilter?.label || "Filter"}
                    </button>
                    <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-64 z-50">
                      {filters.map((flt) => (
                        <li key={flt.id}>
                          <button onClick={() => updateSearchParams(activeQuery, flt.id)}>{flt.label || flt.id}</button>
                        </li>
                      ))}
                      {filters.length > 0 && filterableFields.length > 0 && <li className="menu-title">Custom</li>}
                      {filterableFields.map((field) => (
                        <li key={field.id}>
                          <button onClick={() => addClientFilter(field)}>{field.label}</button>
                        </li>
                      ))}
                      {filters.length > 0 && (
                        <li>
                          <button onClick={() => updateSearchParams(activeQuery, "")}>Clear</button>
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                {bulkActions.length > 0 && selectedIds.length > 0 && (
                  <div className="dropdown dropdown-end join-item">
                    <button className={SOFT_BUTTON_SM + " w-full"}>Bulk</button>
                    <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
                      {bulkActions.map((item) => (
                        <li key={`${item.action?.id || item.label}`}>
                          {item.reason ? (
                            <DaisyTooltip label={item.reason} placement="left">
                              <span className="block">
                                <button onClick={() => handleHeaderAction(item.action)} disabled={!item.enabled || actionRunning}>
                                  {item.label}
                                </button>
                              </span>
                            </DaisyTooltip>
                          ) : (
                            <button onClick={() => handleHeaderAction(item.action)} disabled={!item.enabled || actionRunning}>
                              {item.label}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 min-w-[10rem] justify-end">
              {canWriteRecords && selectedIds.length > 0 && (
                <button className={SOFT_BUTTON_SM} onClick={handleBulkDelete}>
                  {translateRuntime("common.delete_count", { count: selectedIds.length })}
                </button>
              )}
              {bulkActions.length > 0 && selectedIds.length > 0 && (
                <div className="dropdown dropdown-end">
                  <button className={SOFT_BUTTON_SM} disabled={actionRunning}>Bulk</button>
                  <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
                    {bulkActions.map((item) => (
                      <li key={`${item.action?.id || item.label}`}>
                        {item.reason ? (
                          <DaisyTooltip label={item.reason} placement="left">
                            <span className="block">
                              <button onClick={() => handleHeaderAction(item.action)} disabled={!item.enabled || actionRunning}>
                                {item.label}
                              </button>
                            </span>
                          </DaisyTooltip>
                        ) : (
                          <button onClick={() => handleHeaderAction(item.action)} disabled={!item.enabled || actionRunning}>
                            {item.label}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {secondaryActions.length > 0 && (
                <div className="dropdown dropdown-end">
                  <button className={SOFT_BUTTON_SM} disabled={actionRunning}>More</button>
                  <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-48 z-50">
                    {secondaryActions.map((item) => (
                      <li key={`${item.action?.id || item.label}`}>
                        {item.reason ? (
                          <DaisyTooltip label={item.reason} placement="left">
                            <span className="block">
                              <button onClick={() => handleHeaderAction(item.action)} disabled={!item.enabled || actionRunning}>
                                {item.label}
                              </button>
                            </span>
                          </DaisyTooltip>
                        ) : (
                          <button onClick={() => handleHeaderAction(item.action)} disabled={!item.enabled || actionRunning}>
                            {item.label}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {clientFilters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {clientFilters.map((flt, idx) => (
            <div key={`${flt.field_id}-${idx}`} className="badge badge-outline badge-lg badge-dismissible">
              {flt.label || flt.field_id}: {String(flt.value)}
              <button className="badge-remove" onClick={() => removeClientFilter(idx)} aria-label={`Remove ${flt.label || flt.field_id}`}>
                ×
              </button>
            </div>
            ))}
          </div>
        )}

        <ListViewRenderer
          view={view}
          fieldIndex={fieldIndex}
          records={records}
          header={header}
          hideHeader={hasHeader}
          searchQuery={activeQuery}
          searchFields={Array.isArray(searchConfig?.fields) ? searchConfig.fields : []}
          filters={filters}
          activeFilter={selectedFilter}
          clientFilters={clientFilters}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onToggleAll={handleToggleAll}
          onSelectRow={handleSelectRow}
        />
      </div>
      {manifestModalNode}
      {emailComposeNode}
      </>
    );
  }

  if (kind === "form") {
    const header = view.header || null;
    const saveMode = header?.save_mode || "bottom";
    const showTopSave = saveMode === "top" || saveMode === "both";

    function decorateActions(actions, contextRecord) {
      const items = [];
      for (const action of actions || []) {
        const resolved = resolveHeaderAction(action);
        if (!resolved || !resolved.kind) continue;
        if (isWriteActionKind(resolved.kind) && !canWriteRecords) continue;
        const label = resolveActionLabel(resolved, manifest, views);
        const visible = resolved.visible_when ? evalCondition(resolved.visible_when, _conditionEvalContext(contextRecord || {}, currentActor)) : true;
        if (!visible) continue;
        let enabled = resolved.enabled_when ? evalCondition(resolved.enabled_when, _conditionEvalContext(contextRecord || {}, currentActor)) : true;
        if (!enabled && (resolved.modal_id || getActionValidationFieldIds(resolved, contextRecord || {}).length > 0)) enabled = true;
        const missingRecord = (resolved.kind === "update_record" || resolved.kind === "transform_record") && !effectiveRecordId;
        if (missingRecord) enabled = false;
        const reason = enabled ? null : explainActionDisabled(resolved, contextRecord || {}, fieldIndex, { missingRecord, actor: currentActor });
        items.push({ action: resolved, label, enabled, reason });
      }
      return items;
    }

    const primaryActions = decorateActions(header?.primary_actions, draft);
    const secondaryRawActions = decorateActions(header?.secondary_actions, draft);
    const secondaryActions = (() => {
      if (!statusField) return secondaryRawActions;
      const chosenByStatusValue = new Map();
      for (const item of secondaryRawActions) {
        const action = item?.action;
        if (!action || action.kind !== "update_record" || typeof action.patch !== "object" || !action.patch) continue;
        const target = action.patch[statusField];
        if (target === undefined || target === null || target === "") continue;
        const existing = chosenByStatusValue.get(target);
        if (!existing) {
          chosenByStatusValue.set(target, item);
          continue;
        }
        const existingIsGeneric = /^set:\s/i.test(String(existing.label || ""));
        const currentIsGeneric = /^set:\s/i.test(String(item.label || ""));
        if (existingIsGeneric && !currentIsGeneric) {
          chosenByStatusValue.set(target, item);
        }
      }
      return secondaryRawActions.filter((item) => {
        const action = item?.action;
        if (!action || action.kind !== "update_record" || typeof action.patch !== "object" || !action.patch) return true;
        const target = action.patch[statusField];
        if (target === undefined || target === null || target === "") return true;
        // Hide no-op status actions (e.g. "Set: Active" when status is already Active).
        if (currentStatus !== undefined && currentStatus !== null && target === currentStatus) return false;
        return chosenByStatusValue.get(target) === item;
      });
    })();
    const explicitReturnTo = normalizeInternalReturnPath(searchParams?.get(FORM_RETURN_TO_PARAM));
    const explicitReturnLabel = String(searchParams?.get(FORM_RETURN_LABEL_PARAM) || "").trim();
    const returnControl = explicitReturnTo
      ? {
          label: formatBackToEntityLabel(explicitReturnLabel || currentEntityLabel),
          onClick: () => onFallback?.(explicitReturnTo),
        }
      : null;
    const showFormSkeleton = state.status === "running" && Boolean(effectiveRecordId);
    return (
      <>
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">
          {showFormSkeleton ? (
            <LoadingSpinner className="h-full min-h-0 w-full" />
          ) : (
            <FormViewRenderer
              view={view}
              entityId={recordEntityId}
              recordId={effectiveRecordId || null}
              fieldIndex={fieldIndex}
              entityDefs={manifest?.entities || []}
              record={draft}
              entityLabel={entityDef?.label}
              displayField={entityDef?.display_field}
              autoSaveState={autoSaveState}
              hasRecord={Boolean(effectiveRecordId)}
              onChange={applyUserDraftChange}
              onSave={handleSave}
              onDiscard={handleDiscard}
              isDirty={isDirty}
              header={header}
              returnControl={returnControl}
              primaryActions={primaryActions}
              secondaryActions={secondaryActions}
              onActionClick={handleHeaderAction}
              actionBusy={actionRunning}
              actionBusyLabel={actionState.label}
              readonly={!canWriteRecords || (previewMode && !previewAllowNav)}
              showValidation={showValidation}
              applyDefaults={!recordId}
              requiredFields={requiredByState}
              hiddenFields={recordContext?.hiddenFields}
              previewMode={previewMode && !previewAllowNav}
              canCreateLookup={(lookupEntityId) => canWriteRecords && Boolean(canCreateLookup?.(lookupEntityId))}
              onLookupCreate={onLookupCreate}
              onRefreshRecord={refreshCurrentRecord}
              onOptimisticRecordPatch={applyOptimisticRecordPatch}
              onFieldFocusChange={setIsFormFieldFocused}
              onFieldCommit={handleFieldCommit}
              onActiveFieldSnapshotChange={handleActiveFieldSnapshotChange}
              externalRefreshTick={refreshTick}
              renderBlocks={(blocks, nestedRecordContext = null) => (
                <ContentBlocksRenderer
                  blocks={blocks}
                  renderView={renderAnyView}
                  recordId={nestedRecordContext?.recordId || effectiveRecordId || null}
                  searchParams={searchParams}
                  setSearchParams={setSearchParams}
                  manifest={manifest}
                  moduleId={moduleId}
                  actionsMap={actionsMap}
                  onNavigate={onNavigate}
                  onRunAction={onRunAction}
                  onConfirm={onConfirm}
                  onPrompt={onPrompt}
                  onLookupCreate={onLookupCreate}
                  onFallback={onFallback}
                  externalRefreshTick={refreshTick}
                  previewMode={previewMode}
                  canWriteRecords={canWriteRecords}
                  bootstrap={bootstrap}
                  bootstrapVersion={bootstrapVersion}
                  bootstrapLoading={bootstrapLoading}
                  recordContext={nestedRecordContext}
                  onPageSectionLoadingChange={nestedRecordContext?.suppressPageSectionLoading ? null : onPageSectionLoadingChange}
                />
              )}
            />
          )}
        </div>
      </div>
      {manifestModalNode}
      {emailComposeNode}
      </>
    );
  }

  return (
    <>
      <div className="alert alert-error">Unsupported view type: {kind}</div>
      {manifestModalNode}
      {emailComposeNode}
    </>
  );
}
