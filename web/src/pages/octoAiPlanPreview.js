function titleize(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const tail = value.trim().split(".").pop() || value.trim();
  return tail
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function opModuleLabel(op) {
  return op?.artifact_label || op?.module_label || titleize(op?.artifact_id || op?.module_id) || "workspace";
}

function opFieldLabel(op) {
  return (
    (typeof op?.field?.label === "string" && op.field.label.trim() ? op.field.label.trim() : "") ||
    (typeof op?.field_label === "string" && op.field_label.trim() ? op.field_label.trim() : "") ||
    titleize(op?.field_id)
  );
}

function opEntityLabel(op) {
  return (
    (typeof op?.entity_label === "string" && op.entity_label.trim() ? op.entity_label.trim() : "") ||
    titleize(op?.entity_id)
  );
}

function opPageLabel(op) {
  return (
    (typeof op?.page_title === "string" && op.page_title.trim() ? op.page_title.trim() : "") ||
    titleize(op?.page_id)
  );
}

function opViewLabel(op) {
  return (
    (typeof op?.view_label === "string" && op.view_label.trim() ? op.view_label.trim() : "") ||
    titleize(op?.view_id)
  );
}

function opPlacementLabel(op) {
  return typeof op?.placement_label === "string" && op.placement_label.trim() ? op.placement_label.trim() : "";
}

function summarizePlanOperation(op) {
  if (!op || typeof op !== "object") return "";
  const opName = typeof op.op === "string" ? op.op : "";
  const moduleLabel = opModuleLabel(op);
  const fieldLabel = opFieldLabel(op);
  const entityLabel = opEntityLabel(op);
  const pageLabel = opPageLabel(op);
  const viewLabel = opViewLabel(op);
  const placementLabel = opPlacementLabel(op);

  if (opName === "create_module") {
    return `Create module '${moduleLabel}'.`;
  }
  if (opName === "create_entity" || opName === "ensure_entity") {
    return entityLabel ? `Create entity '${entityLabel}' in ${moduleLabel}.` : `Create an entity in ${moduleLabel}.`;
  }
  if (opName === "add_field") {
    return fieldLabel ? `Add field '${fieldLabel}' to ${moduleLabel}.` : `Add a field to ${moduleLabel}.`;
  }
  if (opName === "update_field") {
    return fieldLabel ? `Update field '${fieldLabel}' in ${moduleLabel}.` : `Update a field in ${moduleLabel}.`;
  }
  if (opName === "remove_field") {
    return fieldLabel ? `Remove field '${fieldLabel}' from ${moduleLabel}.` : `Remove a field from ${moduleLabel}.`;
  }
  if (opName === "insert_section_field") {
    if (fieldLabel && placementLabel) return `Place field '${fieldLabel}' in '${placementLabel}' in ${moduleLabel}.`;
    if (fieldLabel) return `Place field '${fieldLabel}' in the form layout in ${moduleLabel}.`;
  }
  if (opName === "move_section_field") {
    if (fieldLabel && placementLabel) return `Move field '${fieldLabel}' into '${placementLabel}' in ${moduleLabel}.`;
    if (fieldLabel) return `Move field '${fieldLabel}' in ${moduleLabel}.`;
  }
  if (opName === "add_page") {
    return pageLabel ? `Add page '${pageLabel}' in ${moduleLabel}.` : `Add a page in ${moduleLabel}.`;
  }
  if (opName === "update_page") {
    return pageLabel ? `Update page '${pageLabel}' in ${moduleLabel}.` : `Update a page in ${moduleLabel}.`;
  }
  if (opName === "remove_page") {
    return pageLabel ? `Remove page '${pageLabel}' from ${moduleLabel}.` : `Remove a page from ${moduleLabel}.`;
  }
  if (opName === "add_view") {
    return viewLabel ? `Add view '${viewLabel}' in ${moduleLabel}.` : `Add a view in ${moduleLabel}.`;
  }
  if (opName === "update_view") {
    return viewLabel ? `Update view '${viewLabel}' in ${moduleLabel}.` : `Update a view in ${moduleLabel}.`;
  }
  if (opName === "remove_view") {
    return viewLabel ? `Remove view '${viewLabel}' from ${moduleLabel}.` : `Remove a view from ${moduleLabel}.`;
  }
  if (opName) {
    return `${titleize(opName)} in ${moduleLabel}.`;
  }
  return "";
}

export function summarizePlanOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) return [];
  return operations
    .map((op) => summarizePlanOperation(op))
    .filter((line) => typeof line === "string" && line.trim());
}
