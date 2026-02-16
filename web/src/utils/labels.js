export function humanizeFieldId(fieldId) {
  if (!fieldId || typeof fieldId !== "string") return "";
  const base = fieldId.includes(".") ? fieldId.split(".").pop() : fieldId;
  return base
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function resolveFieldLabel(column, fieldIndex) {
  const fieldId = column?.field_id;
  if (column?.label) return column.label;
  const field = fieldId ? fieldIndex?.[fieldId] : null;
  if (field?.label) return field.label;
  const human = humanizeFieldId(fieldId);
  return human || fieldId || "";
}
