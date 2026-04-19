function normalizeArtifactType(artifactType) {
  if (typeof artifactType !== "string" || !artifactType.trim()) return "";
  const normalized = artifactType.trim().toLowerCase();
  if (normalized === "email") return "email_template";
  if (normalized === "document") return "document_template";
  return normalized;
}

function buildArtifactNameClause({ artifactType = "", artifactLabel = "", surface = "scoped_editor" } = {}) {
  const typeLabel = normalizeArtifactType(artifactType).replace(/_/g, " ").trim() || "artifact";
  const trimmedLabel = typeof artifactLabel === "string" ? artifactLabel.trim() : "";
  if (trimmedLabel) {
    return surface === "workspace"
      ? `the selected ${typeLabel} "${trimmedLabel}"`
      : `this ${typeLabel} "${trimmedLabel}"`;
  }
  return surface === "workspace" ? `the selected ${typeLabel}` : `this ${typeLabel}`;
}

function fillPromptTemplate(template, values = {}) {
  const source = typeof template === "string" ? template : "";
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const replacement = values[key];
    return typeof replacement === "string" ? replacement : "";
  }).trim();
}

export function getArtifactCapability(capabilityCatalog, artifactType) {
  const normalized = normalizeArtifactType(artifactType);
  const artifacts = capabilityCatalog?.artifacts;
  if (!normalized || !artifacts || typeof artifacts !== "object") return null;
  const artifact = artifacts[normalized];
  return artifact && typeof artifact === "object" ? artifact : null;
}

export function getArtifactQuickActions(capabilityCatalog, artifactType, options = {}) {
  const artifact = getArtifactCapability(capabilityCatalog, artifactType);
  const actions = Array.isArray(artifact?.quick_actions) ? artifact.quick_actions : [];
  const surface = typeof options.surface === "string" && options.surface.trim() ? options.surface.trim() : "scoped_editor";
  const excludeFocuses = new Set(
    Array.isArray(options.excludeFocuses)
      ? options.excludeFocuses.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [],
  );
  const artifactNameClause = buildArtifactNameClause({
    artifactType,
    artifactLabel: options.artifactLabel || artifact?.label || "",
    surface,
  });
  return actions
    .filter((action) => {
      if (!action || typeof action !== "object") return false;
      if (excludeFocuses.has(action.focus)) return false;
      const surfaces = Array.isArray(action.surfaces) ? action.surfaces : [];
      return surfaces.length === 0 || surfaces.includes(surface);
    })
    .map((action, index) => ({
      id: String(action.id || `action_${index + 1}`),
      label: String(action.label || action.id || `Action ${index + 1}`),
      focus: typeof action.focus === "string" ? action.focus : null,
      prompt: fillPromptTemplate(action.prompt_template, {
        artifact_name_clause: artifactNameClause,
      }),
    }))
    .filter((action) => action.prompt);
}
