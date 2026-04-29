export function normalizeManifestRecordPayload(fieldIndex = {}, source = {}) {
  if (!source || typeof source !== "object") return source;
  const payload = { ...source };
  const allowedFieldIds = new Set(Object.keys(fieldIndex || {}).filter((fieldId) => typeof fieldId === "string" && fieldId));
  for (const key of Object.keys(payload)) {
    if (key === "id") continue;
    if (key.includes(".") && !allowedFieldIds.has(key)) {
      delete payload[key];
    }
  }
  for (const [fieldId, field] of Object.entries(fieldIndex || {})) {
    if (fieldId !== "id" && (field?.readonly === true || (field?.compute && typeof field.compute === "object"))) {
      delete payload[fieldId];
      continue;
    }
    if ((field?.type === "number" || field?.type === "currency") && typeof payload[fieldId] === "string") {
      const normalized = payload[fieldId].replace(/,/g, "").trim();
      if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") {
        payload[fieldId] = null;
      } else {
        const parsed = Number(normalized);
        if (Number.isFinite(parsed)) payload[fieldId] = parsed;
      }
    }
    if (field?.type === "tags" && typeof payload[fieldId] === "string") {
      payload[fieldId] = payload[fieldId]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
    if (field?.type === "users" && typeof payload[fieldId] === "string") {
      payload[fieldId] = payload[fieldId]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }
  return payload;
}
