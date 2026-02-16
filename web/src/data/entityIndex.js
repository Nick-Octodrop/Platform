import { getManifest } from "../api";

let cacheKey = null;
let cacheIndex = null;

function titleCase(text) {
  return text
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((t) => t[0].toUpperCase() + t.slice(1))
    .join(" ");
}

function deriveEntityId(fullId) {
  if (!fullId) return "";
  if (fullId.startsWith("entity.")) return fullId.slice("entity.".length);
  return fullId;
}

function displayFromFullId(fullId) {
  if (!fullId) return "";
  const trimmed = fullId.startsWith("entity.") ? fullId.slice("entity.".length) : fullId;
  const parts = trimmed.split(".");
  return titleCase(parts[parts.length - 1]);
}

function viewMatchesEntity(viewEntity, entityId, entityFullId) {
  if (!viewEntity) return false;
  return viewEntity === entityId || viewEntity === entityFullId || viewEntity === `entity.${entityId}`;
}

function buildKey(modules) {
  const enabled = modules.filter((m) => m.enabled).map((m) => `${m.module_id}:${m.current_hash || ""}`);
  enabled.sort();
  return enabled.join("|");
}

export async function loadEntityIndex(modules) {
  const key = buildKey(modules);
  if (cacheKey === key && cacheIndex) return cacheIndex;

  const enabledModules = modules.filter((m) => m.enabled);
  const byId = {};
  const byModule = {};
  for (const mod of enabledModules) {
    let manifestRes;
    try {
      manifestRes = await getManifest(mod.module_id);
    } catch {
      continue;
    }
    const manifest = manifestRes.manifest || {};
    const moduleName = manifest.module?.name || mod.name || mod.module_id;
    const entities = Array.isArray(manifest.entities) ? manifest.entities : [];
    const views = Array.isArray(manifest.views) ? manifest.views : [];

    byModule[mod.module_id] = {
      moduleId: mod.module_id,
      moduleName: moduleName,
      entities: [],
    };

    for (const entity of entities) {
      const entityFullId = entity?.id || "";
      const entityId = deriveEntityId(entityFullId);
      if (!entityId) continue;

      const displayName = entity?.label || entity?.name || displayFromFullId(entityFullId);
      const listView = views.find((v) => {
        const kind = v?.type || v?.kind;
        const ent = v?.entity || v?.entity_id || v?.entityId;
        return kind === "list" && viewMatchesEntity(ent, entityId, entityFullId);
      });
      const formView = views.find((v) => {
        const kind = v?.type || v?.kind;
        const ent = v?.entity || v?.entity_id || v?.entityId;
        return kind === "form" && viewMatchesEntity(ent, entityId, entityFullId);
      });

      const entry = {
        entityId,
        entityFullId,
        moduleId: mod.module_id,
        moduleName,
        displayName,
        listViewId: listView?.id || null,
        formViewId: formView?.id || null,
      };
      byId[entityId] = entry;
      byModule[mod.module_id].entities.push(entry);
    }
  }

  const index = { byId, byModule };
  cacheKey = key;
  cacheIndex = index;
  return index;
}

export function getEntityIndexSnapshot() {
  return cacheIndex;
}

export function getDefaultOpenRoute(moduleId, index) {
  return `/apps/${moduleId}`;
}

export function resolveModuleName(moduleId, moduleRecord) {
  return moduleRecord?.name || titleCase(moduleId);
}
