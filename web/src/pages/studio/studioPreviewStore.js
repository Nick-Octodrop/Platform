export function getStudioPreviewStorageKey(moduleId) {
  return `octo:studio-preview:${moduleId || "default"}`;
}

export function readStudioPreviewManifest(moduleId) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getStudioPreviewStorageKey(moduleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStudioPreviewManifest(moduleId, manifest) {
  if (typeof window === "undefined") return;
  try {
    if (!manifest) {
      window.sessionStorage.removeItem(getStudioPreviewStorageKey(moduleId));
      return;
    }
    window.sessionStorage.setItem(getStudioPreviewStorageKey(moduleId), JSON.stringify(manifest));
  } catch {
    // ignore storage failures
  }
}
