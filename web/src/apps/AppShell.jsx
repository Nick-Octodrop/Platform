import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiFetch, compileManifest, deleteRecord, getActiveWorkspaceId, getManifest, getPageBootstrap, runManifestAction, subscribeRecordMutations } from "../api";
import { realtimeEnabled, supabase } from "../supabase";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import FormViewRenderer from "../ui/FormViewRenderer.jsx";
import ContentBlocksRenderer from "../ui/ContentBlocksRenderer.jsx";
import { getFieldValue, renderField, setFieldValue } from "../ui/field_renderers.jsx";
import { useToast } from "../components/Toast.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import DaisyTooltip from "../components/DaisyTooltip.jsx";
import { PRIMARY_BUTTON, PRIMARY_BUTTON_SM, SOFT_BUTTON_SM, SOFT_BUTTON_XS } from "../components/buttonStyles.js";
import { buildRouteWithQuery, buildTargetRoute, deriveAppHomeRoute, resolveAppTarget, resolveRouteTarget } from "./appShellUtils.js";
import { evalCondition } from "../utils/conditions.js";
import { applyComputedFields } from "../utils/computedFields.js";
import {
  buildFormDraftStorageKey,
  clearFormDraftSnapshot,
  loadFormDraftSnapshot,
  saveFormDraftSnapshot,
} from "../utils/formDraftPersistence.js";
import { normalizeManifestRecordPayload } from "../utils/formPayload.js";
import { useAccessContext } from "../access.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { localizeManifest } from "../i18n/manifest.js";
import { translateRuntime } from "../i18n/runtime.js";

function deriveRecordEntityId(entityId) {
  if (!entityId) return "";
  return entityId;
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

function collectConditionMissingFields(condition, record, missing) {
  if (!condition || typeof condition !== "object") return;
  const op = condition.op;
  if (op === "exists") {
    const fieldId = condition.field;
    if (typeof fieldId === "string") {
      const value = getFieldValue(record || {}, fieldId);
      if (value === "" || value === null || value === undefined) {
        missing.add(fieldId);
      }
    }
    return;
  }
  if ((op === "and" || op === "or") && Array.isArray(condition.conditions)) {
    condition.conditions.forEach((child) => collectConditionMissingFields(child, record, missing));
    return;
  }
  if (op === "not" && condition.condition) {
    collectConditionMissingFields(condition.condition, record, missing);
  }
}

function explainActionDisabled(action, record, fieldIndex, { missingRecord = false, missingSelection = false } = {}) {
  if (missingRecord) return translateRuntime("common.save_record_first");
  if (missingSelection) return translateRuntime("common.select_records_first");
  const cond = action?.enabled_when;
  if (!cond) return null;
  const enabled = evalCondition(cond, { record: record || {} });
  if (enabled) return null;
  const missing = new Set();
  collectConditionMissingFields(cond, record || {}, missing);
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
  const [createModal, setCreateModal] = useState(null);
  const [createDraft, setCreateDraft] = useState({});
  const [createInitialDraft, setCreateInitialDraft] = useState({});
  const [createShowValidation, setCreateShowValidation] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
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
  const { hasCapability, isSuperadmin } = useAccessContext();
  const { version: i18nVersion } = useI18n();
  // Respect both platform/workspace permissions and optional per-page bootstrap overrides.
  const canWriteRecords = hasCapability("records.write") && bootstrap?.permissions?.records_write !== false;

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
      setCreateModal({
        entityId: resolvedEntityId,
        formViewId,
        displayField: resolvedDisplayField,
        initialValue,
        defaults: defaults && typeof defaults === "object" ? defaults : null,
        returnRoute: `${location.pathname}${location.search || ""}`,
        resolve,
        manifest: modalManifest,
        compiled: modalCompiled,
      });
    });
  }

  useEffect(() => {
    if (!createModal) return;
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
    setCreateDraft(computedDraft);
    setCreateInitialDraft(computedDraft);
    setCreateShowValidation(false);
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

  function setTarget(next, opts = {}) {
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
      if (typeof next === "string" && next) {
        params.set("preview_target", next);
      }
      setPreviewTarget(next);
      if (opts.recordId) {
        const recordParam = opts.recordParamName || "record";
        params.set(recordParam, opts.recordId);
      } else {
        const recordParam = opts.recordParamName || "record";
        params.delete(recordParam);
      }
      setSearchParams(params);
      return;
    }
    const route = buildTargetRoute(moduleId, next, { preserveFrameParams: false });
    if (!route) return;
    const params = opts.preserveParams ? new URLSearchParams(searchParams || "") : new URLSearchParams();
    const recordParam = opts.recordParamName || "record";
    if (opts.recordId) {
      params.set(recordParam, opts.recordId);
    }
    if (!opts.recordId) {
      params.delete(recordParam);
    }
    navigate(buildRouteWithQuery(route, params));
  }

  async function navigateToEntityRecord(entityRef, targetRecordId) {
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
      const res = await runManifestAction(moduleId, action.id, {
        record_id: contextRecordId,
        record_draft: contextRecordDraft,
        selected_ids: contextSelectedIds,
      });
      const result = res.result || {};
      const actionKind = action.kind;
      if (result.kind === "navigate" && result.target) {
        setTarget(result.target);
        return result;
      }
      if (result.kind === "open_form" && result.target) {
        const view = views.find((v) => v.id === result.target);
        const viewEntity = view?.entity || view?.entity_id || view?.entityId || result.entity_id || action.entity_id;
        const entityFullId = resolveEntityFullId(manifest, viewEntity);
        const defaultForm = resolveEntityDefaultFormPage(appDef?.defaults, entityFullId);
        if (defaultForm) {
          setTarget(defaultForm);
        } else {
          setTarget(`view:${result.target}`);
        }
        return result;
      }
      if (result.record_id) {
        if (actionKind === "transform_record") {
          const resultEntityId = result.entity_id || action.entity_id;
          if (resultEntityId) {
            await navigateToEntityRecord(resultEntityId, result.record_id);
          } else {
            setRefreshTick((v) => v + 1);
          }
          pushToast("success", translateRuntime("common.app_shell.action_complete"));
          return result;
        }
        if (actionKind === "update_record" || actionKind === "bulk_update") {
          // Stay on the current page for updates to avoid losing page layout (chatter, grid, etc.)
          setRefreshTick((v) => v + 1);
        } else {
          const resultEntityId = result.entity_id || action.entity_id;
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
      if (actionKind === "update_record" && resolvedPatch && typeof resolvedPatch === "object") {
        setRecordDraft((prev) => ({ ...(prev || {}), ...resolvedPatch }));
      }
      if (result.updated) {
        setRefreshTick((v) => v + 1);
      }
      pushToast("success", translateRuntime("common.app_shell.action_complete"));
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
    const visible = resolvedAction.visible_when ? evalCondition(resolvedAction.visible_when, { record: recordDraft }) : true;
    if (!visible) return null;
    const enabled = resolvedAction.enabled_when ? evalCondition(resolvedAction.enabled_when, { record: recordDraft }) : true;
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
        onFallback={(path) => navigate(path)}
        canCreateLookup={() => canWriteRecords}
        onLookupCreate={openCreateModal}
        canWriteRecords={canWriteRecords}
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
  const createIsDirty = JSON.stringify(createDraft) !== JSON.stringify(createInitialDraft);

  function closeCreateModal(result = null) {
    const resolve = createModal?.resolve;
    const returnRoute = createModal?.returnRoute || "";
    setCreateModal(null);
    if (!previewMode && returnRoute) {
      const currentRoute = `${location.pathname}${location.search || ""}`;
      if (currentRoute !== returnRoute) {
        navigate(returnRoute, { replace: true });
      }
    }
    resolve?.(result);
  }

  async function handleCreateSave(validationErrors) {
    setCreateShowValidation(true);
    if (validationErrors && Object.keys(validationErrors).length > 0) return;
    if (!createEntityId) return;
    if (createSaving) return;
    setCreateSaving(true);
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
      pushToast("error", err?.message || translateRuntime("common.create_failed"));
    } finally {
      setCreateSaving(false);
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

      {createModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="modal modal-open">
            <div className="modal-box max-w-4xl">
              <h3 className="font-bold text-lg">
                Create {createEntityDef?.label || humanizeEntityId(createEntityId)}
              </h3>
              <div className="mt-3 max-h-[70vh] overflow-y-auto overflow-x-hidden">
                {createView ? (
                  <FormViewRenderer
                    view={createView}
                    entityId={createEntityId}
                    recordId={null}
                    fieldIndex={createFieldIndex || {}}
                    record={createDraft}
                    entityLabel={createEntityDef?.label}
                    displayField={createEntityDef?.display_field}
                    autoSaveState="idle"
                    hasRecord={false}
                    onChange={(next) => setCreateDraft(applyComputedFields(createFieldIndex || {}, next))}
                    onSave={handleCreateSave}
                    onDiscard={() => closeCreateModal(null)}
                    isDirty={createIsDirty}
                    header={{ ...(createView?.header || {}), save_mode: "bottom", auto_save: false }}
                    primaryActions={[]}
                    secondaryActions={[]}
                    onActionClick={null}
                    readonly={!canWriteRecords}
                    showValidation={createShowValidation}
                    applyDefaults
                    requiredFields={[]}
                    hiddenFields={[]}
                    previewMode={false}
                    hideHeader
                    bottomActionsMode="sticky_right"
                  />
                ) : (
                  <div className="alert alert-error">Form view not found.</div>
                )}
              </div>
            </div>
            <button
              className="modal-backdrop"
              onClick={() => closeCreateModal(null)}
              aria-label="Close"
            />
          </div>,
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
  onSelectionChange,
  onRecordDraftChange,
  canCreateLookup,
  onLookupCreate,
  canWriteRecords = true,
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
  const actionRunningRef = useRef(false);
  const bootstrapUsedRef = useRef({ list: null, form: null });
  const perfMarkRef = useRef({ list: null, form: null });
  const openCreateModal = onLookupCreate;
  const [activeManifestModal, setActiveManifestModal] = useState(null);
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
      return await onRunAction(action, context);
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
      .filter((field) => field?.id && ["string", "text", "enum", "bool", "date", "datetime", "number", "user"].includes(field.type))
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
        onNavigate?.(openRecordTarget, { recordId: row.record_id, recordParamName: openRecordParam, preserveParams: true });
      } else {
        onFallback(`/data/${toRouteEntityId(recordEntityId)}/${row.record_id}`);
      }
    },
    [openRecordTarget, openRecordParam, onNavigate, onFallback, recordEntityId]
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

  async function confirmAction(action) {
    if (action?.confirm && typeof action.confirm === "object") {
      if (!onConfirm) return false;
      const title = action.confirm.title || "Confirm";
      const body = action.confirm.body || "Are you sure?";
      return await onConfirm({ title, body });
    }
    return true;
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
    setActiveManifestModal({
      id: def.id,
      title: def.title || def.label || "Modal",
      description: def.description || "",
      fields,
      actions: Array.isArray(def.actions) ? def.actions : [],
      draft: seeded,
      fieldIndex: modalFieldIndex,
      busy: false,
      error: "",
    });
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
    if (!(await confirmAction(resolvedAction))) return;
    const modalDraft = activeManifestModal.draft || {};
    const closeOnSuccess = resolvedAction.close_on_success !== false;
    if (resolvedAction.kind === "update_record" && resolvedAction.patch && typeof resolvedAction.patch === "object") {
      const resolvedPatch = resolveTemplateRefs(resolvedAction.patch, modalDraft);
      const prevDraft = draft || {};
      const prevInitial = initialDraft || {};
      const optimistic = { ...prevDraft, ...resolvedPatch };
      setDraft(optimistic);
      setInitialDraft({ ...prevInitial, ...resolvedPatch });
      setActiveManifestModal((prev) => (prev ? { ...prev, busy: true, error: "" } : prev));
      const run = onRunAction?.(resolvedAction, {
        recordId: effectiveRecordId,
        recordDraft: modalDraft,
        selectedIds,
        skipConfirm: true,
        inlineAction: !resolvedAction.id,
      });
      Promise.resolve(run)
        .then((result) => {
          if (!result) {
            setDraft(prevDraft);
            setInitialDraft(prevInitial);
            setActiveManifestModal((prev) => (prev ? { ...prev, busy: false } : prev));
            return;
          }
          if (result.record) {
            setDraft(result.record);
            setInitialDraft(result.record);
          }
          if (closeOnSuccess) setActiveManifestModal(null);
          else setActiveManifestModal((prev) => (prev ? { ...prev, busy: false } : prev));
        })
        .catch((err) => {
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

  async function handleHeaderAction(action) {
    if (!action) return;
    if (actionRunningRef.current) return;
    if (action.modal_id) {
      openManifestModal(action.modal_id, draft || {});
      return;
    }
    if (isWriteActionKind(action.kind) && !canWriteRecords) return;
    if (!(await confirmAction(action))) return;
    if (action.kind === "refresh") {
      // Run through the action pipeline so action.clicked triggers are emitted.
      if (onRunAction) {
        try {
          await runViewAction(action, {
            recordId: effectiveRecordId,
            recordDraft: draft || {},
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
      onNavigate?.(action.target);
      return;
    }
    if (action.kind === "open_form" && action.target) {
      const targetView = views.find((v) => v.id === action.target);
      const targetEntity = targetView?.entity || targetView?.entity_id || targetView?.entityId;
      const targetEntityFullId = resolveEntityFullId(manifest, targetEntity);
      const defaultForm = normalizeTarget(resolveEntityDefaultFormPage(appDefaults, targetEntityFullId));
      if (defaultForm) {
        onNavigate?.(defaultForm, { preserveParams: true });
      } else {
        onNavigate?.(`view:${action.target}`);
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
          onNavigate?.(defaultForm, { preserveParams: true });
        } else if (formViewId) {
          onNavigate?.(`view:${formViewId}`);
        }
        return;
      }
    }
    if (action.kind === "update_record" && action.patch && typeof action.patch === "object") {
      const resolvedPatch = resolveTemplateRefs(action.patch, draft || {});
      const prevDraft = draft || {};
      const prevInitial = initialDraft || {};
      const optimistic = { ...prevDraft, ...resolvedPatch };
      startActionPending(action);
      setDraft(optimistic);
      setInitialDraft({ ...prevInitial, ...resolvedPatch });
      const run = onRunAction?.(action, {
        recordId: effectiveRecordId,
        recordDraft: draft || {},
        selectedIds,
        skipConfirm: true,
      });
      Promise.resolve(run)
        .then((result) => {
          if (!result) {
            setDraft(prevDraft);
            setInitialDraft(prevInitial);
            return;
          }
          if (result.record) {
            setDraft(result.record);
            setInitialDraft(result.record);
          }
        })
        .catch(() => {
          setDraft(prevDraft);
          setInitialDraft(prevInitial);
        })
        .finally(() => {
          clearActionPending();
        });
      return;
    }
    try {
      return await runViewAction(action, {
        recordId: effectiveRecordId,
        recordDraft: draft || {},
        selectedIds,
        skipConfirm: true,
      });
    } catch (err) {
      console.warn("action_run_failed", err);
      pushToast("error", err?.message || translateRuntime("common.app_shell.action_failed"));
      return null;
    }
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
  const formDraftStorageKey = useMemo(
    () =>
      kind === "form" && !previewMode
        ? buildFormDraftStorageKey({
            scope: "app-shell",
            entityId: recordEntityId || "",
            recordId: effectiveRecordId || "new",
            viewId: view?.id || "",
            routeKey: `module:${moduleId || ""}`,
          })
        : null,
    [effectiveRecordId, kind, moduleId, previewMode, recordEntityId, view?.id]
  );
  const isDirty = useMemo(() => {
    try {
      return JSON.stringify(draft || {}) !== JSON.stringify(initialDraft || {});
    } catch {
      return true;
    }
  }, [draft, initialDraft]);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    setActiveManifestModal(null);
  }, [view?.id, effectiveRecordId]);

  const contextEntityId = recordContext?.entityId || null;
  const contextRecordLoading = Boolean(recordContext?.recordLoading);
  const contextRecordError = recordContext?.recordError || null;

  useEffect(() => {
    if (kind === "form") {
      if (isDirtyRef.current && formDraftStorageKey) return;
      setShowValidation(false);
      if (!effectiveRecordId) {
        const persisted = loadFormDraftSnapshot(formDraftStorageKey);
        const nextDraft = applyDraftComputed(
          persisted?.dirty && persisted?.draft && typeof persisted.draft === "object" ? persisted.draft : {}
        );
        setDraft(nextDraft);
        setInitialDraft(
          persisted?.dirty && persisted?.initialDraft && typeof persisted.initialDraft === "object"
            ? applyDraftComputed(persisted.initialDraft)
            : {}
        );
        setState({ status: "ok", error: null });
        return;
      }
      if (previewMode && previewStore) {
        const entry = previewStore.get(recordEntityId, effectiveRecordId);
        const next = applyDraftComputed(entry?.record || {});
        setDraft(next);
        setInitialDraft(next);
        setState({ status: "ok", error: null });
        return;
      }
      if (previewMode) {
        const next = applyDraftComputed(recordContext?.record || {});
        setDraft(next);
        setInitialDraft(next);
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
        const next = applyDraftComputed(
          persisted?.dirty && persisted?.draft && typeof persisted.draft === "object"
            ? persisted.draft
            : bootstrapRecord?.record || {}
        );
        setDraft(next);
        setInitialDraft(
          persisted?.dirty && persisted?.initialDraft && typeof persisted.initialDraft === "object"
            ? applyDraftComputed(persisted.initialDraft)
            : applyDraftComputed(bootstrapRecord?.record || {})
        );
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
        const next = applyDraftComputed(
          persisted?.dirty && persisted?.draft && typeof persisted.draft === "object"
            ? persisted.draft
            : recordContext?.record || {}
        );
        setDraft(next);
        setInitialDraft(
          persisted?.dirty && persisted?.initialDraft && typeof persisted.initialDraft === "object"
            ? applyDraftComputed(persisted.initialDraft)
            : applyDraftComputed(recordContext?.record || {})
        );
        setState({ status: "ok", error: null });
        return;
      }
      setState({ status: "running", error: null });
      apiFetch(`/records/${recordEntityId}/${effectiveRecordId}`)
        .then((res) => {
          const persisted = loadFormDraftSnapshot(formDraftStorageKey);
          const next = applyDraftComputed(
            persisted?.dirty && persisted?.draft && typeof persisted.draft === "object"
              ? persisted.draft
              : res.record || {}
          );
          setDraft(next);
          setInitialDraft(
            persisted?.dirty && persisted?.initialDraft && typeof persisted.initialDraft === "object"
              ? applyDraftComputed(persisted.initialDraft)
              : applyDraftComputed(res.record || {})
          );
          setState({ status: "ok", error: null });
        })
        .catch((err) => {
          const msg = err.code === "ENTITY_NOT_FOUND" ? "Entity not found" : err.code === "RECORD_NOT_FOUND" ? "Record not found" : err.message || "Failed to load record";
          console.warn("record_load_failed", { entity_id: recordEntityId, record_id: effectiveRecordId, code: err.code });
          setState({ status: "error", error: msg });
        });
    }
  }, [kind, recordEntityId, effectiveRecordId, contextEntityId, contextRecordLoading, contextRecordError, previewMode, previewStore?.version, bootstrapVersion, bootstrap, view?.id, bootstrapLoading, applyDraftComputed, formDraftStorageKey]);

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
      onRecordDraftChange(draft);
    }
  }, [draft, onRecordDraftChange]);

  async function handleSave(validationErrors, opts = {}) {
    if (!canWriteRecords) return;
    setShowValidation(true);
    if (validationErrors && Object.keys(validationErrors).length > 0) return;
    if (saveInFlightRef.current && !opts.force) {
      pendingAutoSaveRef.current = true;
      return;
    }
    try {
      saveInFlightRef.current = true;
      const payload = normalizeManifestRecordPayload(fieldIndex, draft);
      if (previewMode && previewStore) {
        if (effectiveRecordId) {
          const updated = previewStore.upsert(recordEntityId, effectiveRecordId, payload);
          setInitialDraft(updated?.record || payload);
          clearFormDraftSnapshot(formDraftStorageKey);
          pushToast("success", translateRuntime("common.saved_local_preview"));
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
          setInitialDraft(created?.record || payload);
          clearFormDraftSnapshot(formDraftStorageKey);
          pushToast("success", translateRuntime("common.created_local_preview"));
        }
      } else if (effectiveRecordId) {
        const res = await apiFetch(`/records/${recordEntityId}/${effectiveRecordId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        const savedRecord = applyDraftComputed(res?.record || payload);
        setDraft(savedRecord);
        setInitialDraft(savedRecord);
        clearFormDraftSnapshot(formDraftStorageKey);
        pushToast("success", translateRuntime("common.saved"));
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
            pushToast("success", translateRuntime("common.material_logged_and_closed"));
          } else {
            pushToast("success", translateRuntime("common.material_logged_finish_clockout"));
          }
          setInitialDraft(payload);
          return;
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
        pushToast("success", translateRuntime("common.created"));
        setInitialDraft(payload);
      }
    } catch (err) {
      pushToast("error", err.message || translateRuntime("common.save_failed"));
    } finally {
      saveInFlightRef.current = false;
      if (pendingAutoSaveRef.current) {
        pendingAutoSaveRef.current = false;
        if (kind === "form" && view?.header?.auto_save && effectiveRecordId) {
          const errors = computeValidationErrors(draft);
          if (Object.keys(errors).length === 0) {
            handleSave(errors, { force: true });
          }
        }
      }
    }
  }

  const refreshCurrentRecord = useCallback(async () => {
    if (!recordEntityId || !effectiveRecordId || previewMode) return;
    try {
      const res = await apiFetch(`/records/${recordEntityId}/${effectiveRecordId}`);
      const next = applyDraftComputed(res?.record || {});
      setDraft(next);
      setInitialDraft(next);
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
    if (kind !== "form" || previewMode || !isDirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [kind, previewMode, isDirty]);

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
    if (isFormFieldFocused) return;
    const debounceMs = Number(view?.header?.auto_save_debounce_ms) || 750;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const errors = computeValidationErrors(draft);
      if (Object.keys(errors).length > 0) return;
      if (saveInFlightRef.current) {
        pendingAutoSaveRef.current = true;
        return;
      }
      setAutoSaveState("saving");
      await handleSave(errors);
      setAutoSaveState("saved");
    }, debounceMs);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [kind, previewMode, canWriteRecords, view?.header?.auto_save, view?.header?.auto_save_debounce_ms, effectiveRecordId, draft, isDirty, isFormFieldFocused]);

  if (state.error) return <div className="alert alert-error">{state.error}</div>;

  const transitionTargets = transitions.filter((t) => t?.from === currentStatus);
  const modalReadonly = !canWriteRecords || activeManifestModal?.busy;
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
            {activeManifestModal.fields.map((fieldId) => {
              const field = activeManifestModal.fieldIndex?.[fieldId];
              if (!field) {
                return (
                  <div key={fieldId} className="text-xs text-error">
                    Missing field in modal: {fieldId}
                  </div>
                );
              }
              const value = getFieldValue(activeManifestModal.draft, fieldId);
              const isBooleanField = field?.type === "bool" || field?.type === "boolean";
              return (
                <fieldset key={fieldId} className="fieldset">
                  <legend
                    className={[
                      "fieldset-legend text-xs uppercase tracking-wide",
                      isBooleanField ? "select-none opacity-0 pointer-events-none" : "opacity-60",
                    ].join(" ")}
                    aria-hidden={isBooleanField ? "true" : undefined}
                  >
                    {field.label || field.id}
                  </legend>
                  {renderField(
                    field,
                    value,
                    (next) =>
                      setActiveManifestModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              draft: applyComputedFields(
                                prev.fieldIndex || {},
                                setFieldValue(prev.draft || {}, fieldId, next)
                              ),
                              error: "",
                            }
                          : prev
                      ),
                    modalReadonly,
                    activeManifestModal.draft || {}
                  )}
                </fieldset>
              );
            })}
            {activeManifestModal.error ? <div className="text-xs text-error">{activeManifestModal.error}</div> : null}
          </div>
          <div className="modal-action">
            {activeManifestModal.actions.map((action, idx) => {
              const resolvedAction = resolveModalAction(action);
              if (!resolvedAction) return null;
              const label = action?.label || resolveActionLabel(resolvedAction, manifest, views);
              const variant = action?.variant || "soft";
              const btnClass = variant === "primary" ? PRIMARY_BUTTON_SM : SOFT_BUTTON_SM;
              const enabled = resolvedAction.enabled_when
                ? evalCondition(resolvedAction.enabled_when, { record: activeManifestModal.draft || {} })
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
        const visible = resolved.visible_when ? evalCondition(resolved.visible_when, { record: contextRecord || {} }) : true;
        if (!visible) continue;
        let enabled = resolved.enabled_when ? evalCondition(resolved.enabled_when, { record: contextRecord || {} }) : true;
        const missingSelection = resolved.kind === "bulk_update" && (!selectedIds || selectedIds.length === 0);
        if (missingSelection) enabled = false;
        const reason = enabled ? null : explainActionDisabled(resolved, contextRecord || {}, fieldIndex, { missingSelection });
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
        const visible = resolved.visible_when ? evalCondition(resolved.visible_when, { record: contextRecord || {} }) : true;
        if (!visible) continue;
        let enabled = resolved.enabled_when ? evalCondition(resolved.enabled_when, { record: contextRecord || {} }) : true;
        const missingRecord = (resolved.kind === "update_record" || resolved.kind === "transform_record") && !effectiveRecordId;
        if (missingRecord) enabled = false;
        const reason = enabled ? null : explainActionDisabled(resolved, contextRecord || {}, fieldIndex, { missingRecord });
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
              record={draft}
              entityLabel={entityDef?.label}
              displayField={entityDef?.display_field}
              autoSaveState={autoSaveState}
              hasRecord={Boolean(effectiveRecordId)}
              onChange={(next) => setDraft(applyDraftComputed(next))}
              onSave={handleSave}
              onDiscard={handleDiscard}
              isDirty={isDirty}
              header={header}
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
              onFieldFocusChange={setIsFormFieldFocused}
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
                  externalRefreshTick={refreshTick}
                  previewMode={previewMode}
                  canWriteRecords={canWriteRecords}
                  bootstrap={bootstrap}
                  bootstrapVersion={bootstrapVersion}
                  bootstrapLoading={bootstrapLoading}
                  recordContext={nestedRecordContext}
                  onPageSectionLoadingChange={onPageSectionLoadingChange}
                />
              )}
            />
          )}
        </div>
      </div>
      {manifestModalNode}
      </>
    );
  }

  return (
    <>
      <div className="alert alert-error">Unsupported view type: {kind}</div>
      {manifestModalNode}
    </>
  );
}
