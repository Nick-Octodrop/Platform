export function parseTarget(target) {
  if (!target || typeof target !== "string") return null;
  if (target.startsWith("page:")) return { type: "page", id: target.slice(5) };
  if (target.startsWith("view:")) return { type: "view", id: target.slice(5) };
  return null;
}

const OCTO_AI_FRAME_QUERY_KEYS = [
  "octo_ai_frame",
  "octo_ai_embed",
  "octo_ai_embed_nav",
  "octo_ai_sandbox",
  "octo_ai_live",
  "octo_ai_session",
  "octo_ai_workspace",
];

function coerceSearchParams(searchLike) {
  if (searchLike instanceof URLSearchParams) return new URLSearchParams(searchLike.toString());
  if (typeof searchLike === "string") {
    const raw = searchLike.startsWith("?") ? searchLike.slice(1) : searchLike;
    return new URLSearchParams(raw);
  }
  if (typeof window !== "undefined") {
    return new URLSearchParams(window.location.search || "");
  }
  return new URLSearchParams();
}

export function extractOctoAiFrameParams(searchLike = null) {
  const source = coerceSearchParams(searchLike);
  const next = new URLSearchParams();
  for (const key of OCTO_AI_FRAME_QUERY_KEYS) {
    const value = source.get(key);
    if (typeof value === "string" && value) next.set(key, value);
  }
  return next;
}

export function appendOctoAiFrameParams(path, searchLike = null) {
  if (!path || typeof path !== "string") return path;
  const frameParams = extractOctoAiFrameParams(searchLike);
  if ([...frameParams.keys()].length === 0) return path;
  const [basePath, rawQuery = ""] = path.split("?");
  const merged = new URLSearchParams(rawQuery);
  for (const [key, value] of frameParams.entries()) {
    if (!merged.has(key)) merged.set(key, value);
  }
  const suffix = merged.toString();
  return `${basePath}${suffix ? `?${suffix}` : ""}`;
}

export function buildRouteWithQuery(path, searchParams, options = {}) {
  if (!path || typeof path !== "string") return path;
  const preserveFrameParams = options.preserveFrameParams !== false;
  const [basePath, rawQuery = ""] = path.split("?");
  const merged = new URLSearchParams(rawQuery);
  if (preserveFrameParams) {
    for (const [key, value] of extractOctoAiFrameParams(options.searchLike).entries()) {
      if (!merged.has(key)) merged.set(key, value);
    }
  }
  const extra = coerceSearchParams(searchParams);
  for (const [key, value] of extra.entries()) {
    merged.set(key, value);
  }
  const suffix = merged.toString();
  return `${basePath}${suffix ? `?${suffix}` : ""}`;
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

export function buildTargetRoute(moduleId, target, options = {}) {
  const parsed = parseTarget(target);
  if (!parsed) return null;
  let route = null;
  if (parsed.type === "page") route = `/apps/${moduleId}/page/${parsed.id}`;
  if (parsed.type === "view") route = `/apps/${moduleId}/view/${parsed.id}`;
  if (!route) return null;
  return options.preserveFrameParams === false ? route : appendOctoAiFrameParams(route, options.searchLike);
  return null;
}

export function resolveRouteTarget({ pageId, viewId }) {
  if (pageId) return { target: `page:${pageId}`, parsed: { type: "page", id: pageId }, error: null };
  if (viewId) return { target: `view:${viewId}`, parsed: { type: "view", id: viewId }, error: null };
  return { target: null, parsed: null, error: null };
}
