export function parseTarget(target) {
  if (!target || typeof target !== "string") return null;
  if (target.startsWith("page:")) return { type: "page", id: target.slice(5) };
  if (target.startsWith("view:")) return { type: "view", id: target.slice(5) };
  return null;
}

export function resolveAppTarget(appHome, targetParam) {
  const target = targetParam || appHome || null;
  if (!target) {
    return { target: null, parsed: null, error: "MISSING_HOME" };
  }
  const parsed = parseTarget(target);
  if (!parsed) {
    return { target, parsed: null, error: "INVALID_TARGET" };
  }
  return { target, parsed, error: null };
}

export function buildTargetRoute(moduleId, target) {
  const parsed = parseTarget(target);
  if (!parsed) return null;
  if (parsed.type === "page") return `/apps/${moduleId}/page/${parsed.id}`;
  if (parsed.type === "view") return `/apps/${moduleId}/view/${parsed.id}`;
  return null;
}

export function resolveRouteTarget({ pageId, viewId }) {
  if (pageId) return { target: `page:${pageId}`, parsed: { type: "page", id: pageId }, error: null };
  if (viewId) return { target: `view:${viewId}`, parsed: { type: "view", id: viewId }, error: null };
  return { target: null, parsed: null, error: null };
}
