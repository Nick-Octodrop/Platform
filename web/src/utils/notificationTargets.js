import { getManifest, getModules } from "../api.js";
import { buildRouteWithQuery, buildTargetRoute } from "../apps/appShellUtils.js";

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
  const match = entities.find((entity) => entity.id === viewEntity);
  if (match) return match.id;
  if (viewEntity && !viewEntity.startsWith("entity.")) {
    const prefixed = `entity.${viewEntity}`;
    const prefMatch = entities.find((entity) => entity.id === prefixed);
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

function getFormViewId(manifest, viewEntity) {
  const views = Array.isArray(manifest?.views) ? manifest.views : [];
  const entityFullId = resolveEntityFullId(manifest, viewEntity);
  const entityId = entityFullId?.startsWith("entity.") ? entityFullId.slice("entity.".length) : entityFullId;
  const form = views.find((view) => {
    const kind = view?.kind || view?.type;
    const declaredEntity = view?.entity || view?.entity_id || view?.entityId;
    return kind === "form" && matchEntity(declaredEntity, entityId, entityFullId);
  });
  return form?.id || null;
}

function normalizeSourceEvent(sourceEvent) {
  const source = sourceEvent && typeof sourceEvent === "object" ? sourceEvent : {};
  const sourceEntityRaw = typeof source?.entity_id === "string" ? source.entity_id.trim() : "";
  const sourceRecordId = typeof source?.record_id === "string" ? source.record_id.trim() : "";
  const sourceEntity = sourceEntityRaw.startsWith("entity.") ? sourceEntityRaw.slice(7) : sourceEntityRaw;
  const sourceTarget = sourceEntity && sourceRecordId ? `/data/${sourceEntity}/${sourceRecordId}` : "";
  return { sourceEntityRaw, sourceEntity, sourceRecordId, sourceTarget };
}

export function normalizeNotificationTarget(target, sourceEvent) {
  const raw = typeof target === "string" ? target.trim() : "";
  const { sourceEntityRaw, sourceEntity, sourceRecordId, sourceTarget } = normalizeSourceEvent(sourceEvent);
  let normalized = raw || sourceTarget || "/home";
  if (normalized.includes("{{trigger.entity_id}}")) {
    normalized = normalized.replaceAll("{{trigger.entity_id}}", sourceEntityRaw || sourceEntity);
  }
  if (normalized.includes("{{trigger.record_id}}")) {
    normalized = normalized.replaceAll("{{trigger.record_id}}", sourceRecordId);
  }
  const legacyEntityMatch = normalized.match(/^\/data\/entity\.([^/]+)\/(.+)$/i);
  if (legacyEntityMatch) {
    normalized = `/data/${legacyEntityMatch[1]}/${legacyEntityMatch[2]}`;
  }
  const recordMatch = normalized.match(/^\/data\/([^/]+)\/(.+)$/i);
  if (recordMatch) {
    const entityPart = (recordMatch[1] || "").replace(/^entity\./i, "");
    const recordPart = (recordMatch[2] || "").trim();
    if (!entityPart || !recordPart || recordPart === "record_id" || recordPart.includes("{{") || recordPart.includes("}}")) {
      return sourceTarget || "/home";
    }
    return `/data/${entityPart}/${recordPart}`;
  }
  if (normalized.includes("{{") || normalized.includes("}}")) {
    return sourceTarget || "/home";
  }
  return normalized;
}

export function isExternalNotificationTarget(target, sourceEvent) {
  return /^https?:\/\//i.test(normalizeNotificationTarget(target, sourceEvent));
}

export async function resolveNotificationTarget(target, sourceEvent) {
  const normalized = normalizeNotificationTarget(target, sourceEvent);
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const recordMatch = normalized.match(/^\/data\/([^/]+)\/(.+)$/i);
  if (!recordMatch) return normalized;

  const entityPart = (recordMatch[1] || "").replace(/^entity\./i, "");
  const recordId = (recordMatch[2] || "").trim();
  if (!entityPart || !recordId) return normalized;

  const targetEntityFullId = entityPart.startsWith("entity.") ? entityPart : `entity.${entityPart}`;
  try {
    const modulesRes = await getModules();
    const modules = Array.isArray(modulesRes?.modules)
      ? modulesRes.modules
      : Array.isArray(modulesRes)
        ? modulesRes
        : [];
    for (const mod of modules) {
      const moduleId = mod?.module_id || mod?.id || mod?.moduleId;
      if (!moduleId) continue;
      let manifestRes;
      try {
        manifestRes = await getManifest(moduleId);
      } catch {
        continue;
      }
      const manifest = manifestRes?.manifest;
      const entities = Array.isArray(manifest?.entities) ? manifest.entities : [];
      const matchedEntity = entities.find((entity) => entitiesMatch(entity?.id, targetEntityFullId));
      if (!matchedEntity) continue;

      const entityFullId = matchedEntity.id;
      const defaultForm = resolveEntityDefaultFormPage(manifest?.app?.defaults || {}, entityFullId);
      if (defaultForm) {
        const route = buildTargetRoute(moduleId, defaultForm, { preserveFrameParams: false });
        if (route) {
          const params = new URLSearchParams();
          params.set("record", recordId);
          return buildRouteWithQuery(route, params, { preserveFrameParams: false });
        }
      }

      const formViewId = getFormViewId(manifest, entityFullId);
      if (formViewId) {
        const route = buildTargetRoute(moduleId, `view:${formViewId}`, { preserveFrameParams: false });
        if (route) {
          const params = new URLSearchParams();
          params.set("record", recordId);
          return buildRouteWithQuery(route, params, { preserveFrameParams: false });
        }
      }
    }
  } catch {
    // Fall through to generic route below.
  }

  return `/data/${toRouteEntityId(targetEntityFullId)}/${recordId}`;
}
