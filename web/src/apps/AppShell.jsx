import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiFetch, compileManifest, getManifest, getPageBootstrap } from "../api";
import { realtimeEnabled, supabase } from "../supabase";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
import FormViewRenderer from "../ui/FormViewRenderer.jsx";
import ContentBlocksRenderer from "../ui/ContentBlocksRenderer.jsx";
import { useToast } from "../components/Toast.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { PRIMARY_BUTTON, PRIMARY_BUTTON_SM, SOFT_BUTTON_SM, SOFT_BUTTON_XS } from "../components/buttonStyles.js";
import { buildTargetRoute, resolveAppTarget, resolveRouteTarget } from "./appShellUtils.js";
import { evalCondition } from "../utils/conditions.js";

function deriveRecordEntityId(entityId) {
  if (!entityId) return "";
  return entityId;
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

function resolveActionLabel(action, manifest, views) {
  if (!action || typeof action !== "object") return "Action";
  if (action.label) return action.label;
  const kind = action.kind;
  if (kind === "create_record" || kind === "open_form") return "New";
  if (kind === "update_record") return "Save";
  if (kind === "refresh") return "Refresh";
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
    return "Open";
  }
  return "Action";
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
  const navigate = useNavigate();
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
  const realtimeDebounceRef = useRef(null);
  const [errorFlash, setErrorFlash] = useState(null);
  const [errorFlashUntil, setErrorFlashUntil] = useState(0);
  const errorFlashTimerRef = useRef(null);

  const recordId = (previewMode ? previewSearchParams : searchParams).get("record");

  useEffect(() => {
    if (typeof performance !== "undefined" && performance.mark) {
      performance.mark("nav_start");
    }
  }, [moduleId, pageId, viewId, recordId]);

  useEffect(() => {
    async function loadManifest() {
      if (!moduleId) return;
      if (pageId || viewId) return;
      setLoading(true);
      try {
        if (manifestOverride) {
          setManifest(manifestOverride);
          setCompiled(compileManifest(manifestOverride));
          setError(null);
          return;
        }
        const res = await getManifest(moduleId);
        setManifest(res.manifest);
        setCompiled(res.compiled);
        setError(null);
      } catch (err) {
        setError(err.message || "Failed to load manifest");
      } finally {
        setLoading(false);
      }
    }
    loadManifest();
  }, [moduleId, manifestOverride, pageId, viewId]);

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
    let cancelled = false;
    async function loadBootstrap() {
      if (!moduleId || (!pageId && !viewId)) return;
      if (manifestOverride) {
        setManifest(manifestOverride);
        setCompiled(compileManifest(manifestOverride));
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
          setError(err.message || "Failed to load page");
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
  }, [moduleId, pageId, viewId, recordId, manifestOverride]);

  const appDef = manifest?.app || null;
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
    ? resolveAppTarget(previewTarget || defaultTarget, null)
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
    return new Promise((resolve) => {
      modalResolveRef.current = resolve;
      setModal({
        type: "confirm",
        title: options.title || "Confirm",
        body: options.body || "Are you sure?",
        confirmLabel: options.confirmLabel || "OK",
        cancelLabel: options.cancelLabel || "Cancel",
      });
    });
  }, []);

  const openPrompt = useCallback((options = {}) => {
    return new Promise((resolve) => {
      modalResolveRef.current = resolve;
      setModalInput(options.defaultValue ?? "");
      setModal({
        type: "prompt",
        title: options.title || "Input required",
        body: options.body || "",
        label: options.label || "",
        placeholder: options.placeholder || "",
        confirmLabel: options.confirmLabel || "OK",
        cancelLabel: options.cancelLabel || "Cancel",
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

  async function openCreateModal({ entityId, displayField, initialValue }) {
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
      pushToast("error", "No form view for this entity.");
      return null;
    }

    return new Promise((resolve) => {
      setCreateModal({
        entityId: resolvedEntityId,
        formViewId,
        displayField: resolvedDisplayField,
        initialValue,
        resolve,
        manifest: modalManifest,
        compiled: modalCompiled,
      });
    });
  }

  useEffect(() => {
    if (!createModal) return;
    const nextDraft = {};
    if (createModal.initialValue && createModal.displayField) {
      nextDraft[createModal.displayField] = createModal.initialValue;
    }
    setCreateDraft(nextDraft);
    setCreateInitialDraft(nextDraft);
    setCreateShowValidation(false);
  }, [createModal]);

  useEffect(() => {
    if (previewMode) {
      if (!previewTarget && defaultTarget) {
        setPreviewTarget(defaultTarget);
      }
      return;
    }
    if (!moduleId || pageId || viewId) return;
    if (!defaultTarget) return;
    const route = buildTargetRoute(moduleId, defaultTarget);
    if (!route) return;
    navigate(route, { replace: true });
  }, [moduleId, pageId, viewId, defaultTarget, navigate, previewMode, previewTarget]);

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

  function setTarget(next, opts = {}) {
    if (previewMode) {
      if (!previewAllowNav) return;
      setPreviewTarget(next);
      if (opts.recordId) {
        const params = new URLSearchParams(previewSearchParams.toString());
        const recordParam = opts.recordParamName || "record";
        params.set(recordParam, opts.recordId);
        setPreviewSearchParams(params);
      }
      if (!opts.recordId) {
        const params = new URLSearchParams(previewSearchParams.toString());
        const recordParam = opts.recordParamName || "record";
        params.delete(recordParam);
        setPreviewSearchParams(params);
      }
      return;
    }
    const route = buildTargetRoute(moduleId, next);
    if (!route) return;
    const params = opts.preserveParams ? new URLSearchParams(searchParams || "") : new URLSearchParams();
    const recordParam = opts.recordParamName || "record";
    if (opts.recordId) {
      params.set(recordParam, opts.recordId);
    }
    if (!opts.recordId) {
      params.delete(recordParam);
    }
    const suffix = params.toString();
    navigate(`${route}${suffix ? `?${suffix}` : ""}`);
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

  async function runAction(action) {
    if (previewMode && !previewAllowNav) {
      pushToast("info", "Preview mode: actions are disabled");
      return null;
    }
    if (!action?.id) {
      pushToast("error", "Action missing id");
      return null;
    }
    if (action.confirm && typeof action.confirm === "object") {
      const title = action.confirm.title || "Confirm";
      const body = action.confirm.body || "Are you sure?";
      const ok = await confirmDialog({ title, body });
      if (!ok) return null;
    }
    try {
      if (previewMode && previewAllowNav) {
        if (action.kind === "create_record") {
          const entityFullId = resolveEntityFullId(manifest, action.entity_id);
          const created = previewUpsert(entityFullId, null, action.defaults || {});
          if (created) {
            const defaultForm = resolveEntityDefaultFormPage(appDef?.defaults, entityFullId);
            if (defaultForm) {
              setTarget(defaultForm, { recordId: created.record_id });
            }
            pushToast("success", "Created (local preview)");
            return { record_id: created.record_id, record: created.record };
          }
        }
        if (action.kind === "update_record" && action.patch && typeof action.patch === "object") {
          const entityFullId = resolveEntityFullId(manifest, action.entity_id);
          const current = previewGet(entityFullId, recordId);
          const updated = previewUpsert(entityFullId, recordId, { ...(current?.record || {}), ...action.patch });
          if (updated) {
            pushToast("success", "Updated (local preview)");
            return { record_id: updated.record_id, record: updated.record };
          }
        }
        if (action.kind === "bulk_update" && action.patch && typeof action.patch === "object") {
          const entityFullId = resolveEntityFullId(manifest, action.entity_id);
          const ids = Array.isArray(selectedIds) ? selectedIds : [];
          for (const id of ids) {
            const current = previewGet(entityFullId, id);
            previewUpsert(entityFullId, id, { ...(current?.record || {}), ...action.patch });
          }
          pushToast("success", "Updated (local preview)");
          return { updated: true };
        }
      }
      const res = await apiFetch("/actions/run", {
        method: "POST",
        body: JSON.stringify({
          module_id: moduleId,
          action_id: action.id,
          context: {
            record_id: recordId,
            record_draft: recordDraft,
            selected_ids: selectedIds,
          },
        }),
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
        if (actionKind === "update_record" || actionKind === "bulk_update") {
          // Stay on the current page for updates to avoid losing page layout (chatter, grid, etc.)
          setRefreshTick((v) => v + 1);
        } else {
          const entityFullId = resolveEntityFullId(manifest, result.entity_id || action.entity_id);
          const defaultForm = resolveEntityDefaultFormPage(appDef?.defaults, entityFullId);
          if (defaultForm) {
            setTarget(defaultForm, { recordId: result.record_id });
          } else {
            const formView = getFormViewId(manifest, result.entity_id || action.entity_id);
            if (formView) {
              setTarget(`view:${formView}`, { recordId: result.record_id });
            }
          }
        }
      }
      if (actionKind === "update_record" && action.patch && typeof action.patch === "object") {
        setRecordDraft((prev) => ({ ...(prev || {}), ...action.patch }));
      }
      if (result.updated) {
        setRefreshTick((v) => v + 1);
      }
      pushToast("success", "Action complete");
      return result;
    } catch (err) {
      pushToast("error", err.message || "Action failed");
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
    if (["create_record", "update_record", "bulk_update"].includes(resolvedAction.kind)) {
      const missingRecord = resolvedAction.kind === "update_record" && !recordId;
      const missingSelection = resolvedAction.kind === "bulk_update" && (!selectedIds || selectedIds.length === 0);
      const disabled = !enabled || missingRecord || missingSelection;
      return (
        <button className={SOFT_BUTTON_SM} onClick={() => runAction(resolvedAction)} key={resolvedAction.id || label} disabled={disabled || previewMode}>
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
        canCreateLookup={(entityId) => {
          return true;
        }}
        onLookupCreate={openCreateModal}
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
      />
    );
  }

  const errorBanner =
    error || (errorFlash && Date.now() < errorFlashUntil ? errorFlash : null);

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {errorBanner && <div className="alert alert-error">{errorBanner}</div>}
        <LoadingSpinner className="min-h-[40vh]" />
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
    setCreateModal(null);
    resolve?.(result);
  }

  async function handleCreateSave(validationErrors) {
    setCreateShowValidation(true);
    if (validationErrors && Object.keys(validationErrors).length > 0) return;
    if (!createEntityId) return;
    if (createSaving) return;
    setCreateSaving(true);
    try {
      let payload = createDraft;
      if (payload && typeof payload === "object" && createFieldIndex) {
        payload = { ...payload };
        for (const [fieldId, field] of Object.entries(createFieldIndex)) {
          if (field?.type === "tags" && typeof payload[fieldId] === "string") {
            payload[fieldId] = payload[fieldId]
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
          }
        }
      }
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
      pushToast("success", "Created");
      closeCreateModal({ record_id: recordId, record, label });
    } catch (err) {
      pushToast("error", err?.message || "Create failed");
    } finally {
      setCreateSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {errorBanner && <div className="alert alert-error mb-3">{errorBanner}</div>}
      {previewMode && previewAllowNav && previewNavItems.length > 0 && (
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
        <div className="card bg-base-100 shadow mb-4">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">{activePage?.title || manifest?.module?.name || moduleId}</h2>
              </div>
              <div className="flex gap-2">
                {(activePage?.header?.actions || []).map(renderAction)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {active.type === "page" && activePage && (
          <div className="flex-1 min-h-0 overflow-hidden">
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
              externalRefreshTick={viewModesRefreshTick}
              previewMode={previewMode}
              bootstrap={bootstrap}
              bootstrapVersion={bootstrapVersion}
              bootstrapLoading={bootstrapLoading}
            />
          </div>
        )}

        {active.type === "view" && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="card bg-base-100 shadow h-full min-h-0">
              <div className="card-body h-full min-h-0 p-4">{renderView(activeViewId)}</div>
            </div>
          </div>
        )}
      </div>

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
                    className="input input-bordered w-full"
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
              <div className="mt-3 max-h-[70vh] overflow-auto">
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
                    onChange={(next) => setCreateDraft(next)}
                    onSave={handleCreateSave}
                    onDiscard={() => {
                      setCreateDraft(createInitialDraft);
                      setCreateShowValidation(false);
                    }}
                    isDirty={createIsDirty}
                    header={{ ...(createView?.header || {}), save_mode: "bottom", auto_save: false }}
                    primaryActions={[]}
                    secondaryActions={[]}
                    onActionClick={null}
                    readonly={false}
                    showValidation={createShowValidation}
                    applyDefaults
                    requiredFields={[]}
                    hiddenFields={[]}
                    previewMode={false}
                    hideHeader
                  />
                ) : (
                  <div className="alert alert-error">Form view not found.</div>
                )}
              </div>
              <div className="modal-action">
                <button
                  className="btn btn-ghost"
                  onClick={() => closeCreateModal(null)}
                  disabled={createSaving}
                >
                  Cancel
                </button>
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
    </div>
  );
}

function AppView({
  view,
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
  previewMode = false,
  previewAllowNav = false,
  previewStore = null,
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
  const autoSaveTimerRef = useRef(null);
  const saveInFlightRef = useRef(false);
  const pendingAutoSaveRef = useRef(false);
  const bootstrapUsedRef = useRef({ list: null, form: null });
  const perfMarkRef = useRef({ list: null, form: null });
  const openCreateModal = onLookupCreate;

  const kind = view.kind || view.type;
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const appDefaults = manifest?.app?.defaults || {};
  const rawViewEntity = view.entity || view.entity_id || view.entityId;
  const fallbackEntity = !rawViewEntity && typeof view.id === "string" ? view.id.split(".")[0] : null;
  const viewEntity = rawViewEntity || fallbackEntity;
  const entityFullId = resolveEntityFullId(manifest, viewEntity);
  const recordEntityId = recordContext?.entityId || entityFullId;
  const fieldIndex = buildFieldIndex(manifest, compiled, entityFullId);
  const entityDef = useMemo(() => (manifest?.entities || []).find((e) => e.id === entityFullId), [manifest, entityFullId]);
  const displayField = entityDef?.display_field;
  const listFieldIds = useMemo(() => {
    if (kind !== "list") return [];
    const cols = Array.isArray(view?.columns) ? view.columns : [];
    const ids = cols.map((c) => c.field_id).filter(Boolean);
    if (displayField) ids.push(displayField);
    return Array.from(new Set(ids));
  }, [kind, view, displayField]);
  const filterableFields = useMemo(() => {
    if (!entityDef || !Array.isArray(entityDef.fields)) return [];
    return entityDef.fields
      .filter((field) => field?.id && ["string", "text", "enum", "bool", "date", "datetime", "number"].includes(field.type))
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
        onFallback(`/data/${recordEntityId}/${row.record_id}`);
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

  async function handleHeaderAction(action) {
    if (!action) return;
    if (!(await confirmAction(action))) return;
    if (action.kind === "refresh") {
      // Run through the action pipeline so action.clicked triggers are emitted.
      if (onRunAction) {
        try {
          await onRunAction(action);
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
      const prevDraft = draft || {};
      const prevInitial = initialDraft || {};
      const optimistic = { ...prevDraft, ...action.patch };
      setDraft(optimistic);
      setInitialDraft({ ...prevInitial, ...action.patch });
      const run = onRunAction?.(action);
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
        });
      return;
    }
    onRunAction?.(action);
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

  const effectiveRecordId = recordContext?.recordId || recordId;

  useEffect(() => {
    if (kind === "form") {
      setShowValidation(false);
      if (!effectiveRecordId) {
        setDraft({});
        setInitialDraft({});
        setState({ status: "ok", error: null });
        return;
      }
      if (previewMode && previewStore) {
        const entry = previewStore.get(recordEntityId, effectiveRecordId);
        const next = entry?.record || {};
        setDraft(next);
        setInitialDraft(next);
        setState({ status: "ok", error: null });
        return;
      }
      if (previewMode) {
        setDraft(recordContext?.record || {});
        setInitialDraft(recordContext?.record || {});
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
        const next = bootstrapRecord?.record || {};
        setDraft(next);
        setInitialDraft(next);
        setState({ status: "ok", error: null });
        bootstrapUsedRef.current.form = bootstrapVersion;
        return;
      }
      if (bootstrapLoading) {
        setState({ status: "running", error: null });
        return;
      }
      const hasContext = Boolean(recordContext?.entityId);
      if (hasContext) {
        if (recordContext.recordLoading) {
          setState({ status: "running", error: null });
          return;
        }
        if (recordContext.recordError) {
          setState({ status: "error", error: recordContext.recordError });
          return;
        }
        const next = recordContext.record || {};
        setDraft(next);
        setInitialDraft(next);
        setState({ status: "ok", error: null });
        return;
      }
      setState({ status: "running", error: null });
      apiFetch(`/records/${recordEntityId}/${effectiveRecordId}`)
        .then((res) => {
          const next = res.record || {};
          setDraft(next);
          setInitialDraft(next);
          setState({ status: "ok", error: null });
        })
        .catch((err) => {
          const msg = err.code === "ENTITY_NOT_FOUND" ? "Entity not found" : err.code === "RECORD_NOT_FOUND" ? "Record not found" : err.message || "Failed to load record";
          console.warn("record_load_failed", { entity_id: recordEntityId, record_id: effectiveRecordId, code: err.code });
          setState({ status: "error", error: msg });
        });
    }
  }, [kind, recordEntityId, effectiveRecordId, recordContext, previewMode, previewStore?.version, bootstrapVersion, bootstrap, view?.id, bootstrapLoading]);

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
    setShowValidation(true);
    if (validationErrors && Object.keys(validationErrors).length > 0) return;
    if (saveInFlightRef.current && !opts.force) {
      pendingAutoSaveRef.current = true;
      return;
    }
    try {
      saveInFlightRef.current = true;
      let payload = draft;
      if (payload && typeof payload === "object") {
        payload = { ...payload };
        for (const [fieldId, field] of Object.entries(fieldIndex || {})) {
          if (field?.type === "tags" && typeof payload[fieldId] === "string") {
            payload[fieldId] = payload[fieldId]
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
          }
        }
      }
      if (previewMode && previewStore) {
        if (effectiveRecordId) {
          const updated = previewStore.upsert(recordEntityId, effectiveRecordId, payload);
          setInitialDraft(updated?.record || payload);
          pushToast("success", "Saved (local preview)");
        } else {
          const created = previewStore.upsert(recordEntityId, null, payload);
          const newId = created?.record_id;
          if (newId) {
            const formTarget = normalizeTarget(appDefaults?.entity_form_page);
            if (formTarget) {
              onNavigate(formTarget, { recordId: newId, preserveParams: true });
            } else {
              onNavigate(`view:${view.id}`, { recordId: newId });
            }
          }
          setInitialDraft(created?.record || payload);
          pushToast("success", "Created (local preview)");
        }
      } else if (effectiveRecordId) {
        await apiFetch(`/records/${recordEntityId}/${effectiveRecordId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        pushToast("success", "Saved");
        setInitialDraft(payload);
      } else {
        const res = await apiFetch(`/records/${recordEntityId}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const newId = res.record_id;
        if (newId) {
          const formTarget = normalizeTarget(appDefaults?.entity_form_page);
          if (formTarget) {
            onNavigate(formTarget, { recordId: newId, preserveParams: true });
          } else {
            onNavigate(`view:${view.id}`, { recordId: newId });
          }
        }
        pushToast("success", "Created");
        setInitialDraft(payload);
      }
    } catch (err) {
      pushToast("error", err.message || "Save failed");
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

  const isDirty = useMemo(() => {
    try {
      return JSON.stringify(draft || {}) !== JSON.stringify(initialDraft || {});
    } catch {
      return true;
    }
  }, [draft, initialDraft]);

  async function handleDiscard() {
    if (!effectiveRecordId) {
      if (isDirty) {
        if (!onConfirm) return;
        const ok = await onConfirm({ title: "Discard new record?", body: "This will lose any unsaved changes." });
        if (!ok) return;
      }
      const listTarget = resolveEntityDefaultHomePage(appDefaults, entityFullId) || (listViewId ? `view:${listViewId}` : null);
      if (listTarget) {
        onNavigate?.(listTarget, { preserveParams: true });
        return;
      }
    }
    setDraft(initialDraft || {});
    setShowValidation(false);
  }

  useEffect(() => {
    if (kind !== "form") return;
    if (previewMode) return;
    if (!view?.header?.auto_save) return;
    if (!effectiveRecordId) return;
    if (!isDirty) return;
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
  }, [kind, view?.header?.auto_save, view?.header?.auto_save_debounce_ms, effectiveRecordId, draft, isDirty]);

  if (state.error) return <div className="alert alert-error">{state.error}</div>;

  const transitionTargets = transitions.filter((t) => t?.from === currentStatus);

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
          <div className="text-xs opacity-60">Loading list…</div>
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
        const label = resolveActionLabel(resolved, manifest, views);
        const visible = resolved.visible_when ? evalCondition(resolved.visible_when, { record: contextRecord || {} }) : true;
        if (!visible) continue;
        let enabled = resolved.enabled_when ? evalCondition(resolved.enabled_when, { record: contextRecord || {} }) : true;
        if (resolved.kind === "bulk_update" && (!selectedIds || selectedIds.length === 0)) enabled = false;
        items.push({ action: resolved, label, enabled });
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
      const ok = await onConfirm({ title: "Delete records", body: `Delete ${selectedIds.length} record(s)?` });
      if (!ok) return;
      try {
        await Promise.all(
          selectedIds.map((rid) => apiFetch(`/records/${recordEntityId}/${rid}`, { method: "DELETE" }))
        );
        pushToast({ type: "success", message: `Deleted ${selectedIds.length} record(s)` });
        setSelectedIds([]);
        onRefresh?.();
      } catch (err) {
        pushToast({ type: "error", message: err?.message || "Bulk delete failed" });
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
      <div className="space-y-4">
        {hasHeader && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-[10rem]">
              {primaryActions.map((item) => (
                <button
                  key={`${item.action?.id || item.label}`}
                  className={PRIMARY_BUTTON_SM}
                  onClick={() => handleHeaderAction(item.action)}
                  disabled={!item.enabled}
                >
                  {item.label}
                </button>
              ))}
              <div className="text-lg font-semibold">{entityLabel}</div>
            </div>

            <div className="flex items-center justify-center flex-1 min-w-[16rem]">
              <div className="join">
                {searchConfig && (
                  <input
                    className="input input-bordered input-sm join-item w-full max-w-xs h-8 min-h-8"
                    placeholder={searchConfig.placeholder || "Search..."}
                    value={activeQuery}
                    onChange={(e) => updateSearchParams(e.target.value, activeFilterId)}
                  />
                )}
                {(filters.length > 0 || filterableFields.length > 0) && (
                  <div className="dropdown dropdown-end join-item">
                    <button className={SOFT_BUTTON_SM + " h-8 min-h-8 w-full"}>
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
                    <button className={SOFT_BUTTON_SM + " h-8 min-h-8 w-full"}>Bulk</button>
                    <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
                      {bulkActions.map((item) => (
                        <li key={`${item.action?.id || item.label}`}>
                          <button onClick={() => handleHeaderAction(item.action)} disabled={!item.enabled}>
                            {item.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 min-w-[10rem] justify-end">
              {selectedIds.length > 0 && (
                <button className={SOFT_BUTTON_SM} onClick={handleBulkDelete}>
                  Delete ({selectedIds.length})
                </button>
              )}
              {bulkActions.length > 0 && selectedIds.length > 0 && (
                <div className="dropdown dropdown-end">
                  <button className={SOFT_BUTTON_SM}>Bulk</button>
                  <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
                    {bulkActions.map((item) => (
                      <li key={`${item.action?.id || item.label}`}>
                        <button onClick={() => handleHeaderAction(item.action)} disabled={!item.enabled}>
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {secondaryActions.length > 0 && (
                <div className="dropdown dropdown-end">
                  <button className={SOFT_BUTTON_SM}>More</button>
                  <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-48 z-50">
                    {secondaryActions.map((item) => (
                      <li key={`${item.action?.id || item.label}`}>
                        <button onClick={() => handleHeaderAction(item.action)} disabled={!item.enabled}>
                          {item.label}
                        </button>
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
              <div key={`${flt.field_id}-${idx}`} className="badge badge-outline badge-lg gap-2">
                {flt.label || flt.field_id}: {String(flt.value)}
                <button className={SOFT_BUTTON_XS} onClick={() => removeClientFilter(idx)}>
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
        const label = resolveActionLabel(resolved, manifest, views);
        const visible = resolved.visible_when ? evalCondition(resolved.visible_when, { record: contextRecord || {} }) : true;
        if (!visible) continue;
        let enabled = resolved.enabled_when ? evalCondition(resolved.enabled_when, { record: contextRecord || {} }) : true;
        if (resolved.kind === "update_record" && !effectiveRecordId) enabled = false;
        items.push({ action: resolved, label, enabled });
      }
      return items;
    }

    const primaryActions = decorateActions(header?.primary_actions, draft);
    const secondaryActions = decorateActions(header?.secondary_actions, draft);
    const showFormSkeleton = state.status === "running" && Boolean(effectiveRecordId);
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        {state.status === "running" && (
          <div className="shrink-0 text-xs opacity-60">Loading record…</div>
        )}
        <div className="flex-1 min-h-0 overflow-hidden">
          {showFormSkeleton ? (
            <LoadingSpinner className="min-h-[30vh]" />
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
              onChange={(next) => setDraft(next)}
              onSave={handleSave}
              onDiscard={handleDiscard}
              isDirty={isDirty}
              header={header}
              primaryActions={primaryActions}
              secondaryActions={secondaryActions}
              onActionClick={handleHeaderAction}
              readonly={previewMode && !previewAllowNav}
              showValidation={showValidation}
              applyDefaults={!recordId}
              requiredFields={requiredByState}
              hiddenFields={recordContext?.hiddenFields}
              previewMode={previewMode && !previewAllowNav}
              canCreateLookup={canCreateLookup}
              onLookupCreate={onLookupCreate}
            />
          )}
        </div>
      </div>
    );
  }

  return <div className="alert alert-error">Unsupported view type: {kind}</div>;
}
