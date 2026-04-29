function lookupPopulatedFieldIds(fieldIndex = {}) {
  const ids = new Set();
  for (const field of Object.values(fieldIndex || {})) {
    const populate =
      field?.ui?.populate_from_lookup && typeof field.ui.populate_from_lookup === "object"
        ? field.ui.populate_from_lookup
        : null;
    if (!populate) continue;
    if (populate.field_map && typeof populate.field_map === "object") {
      for (const targetFieldId of Object.keys(populate.field_map)) {
        if (typeof targetFieldId === "string" && targetFieldId) ids.add(targetFieldId);
      }
    }
    if (Array.isArray(populate.clear_fields)) {
      for (const targetFieldId of populate.clear_fields) {
        if (typeof targetFieldId === "string" && targetFieldId) ids.add(targetFieldId);
      }
    }
  }
  return ids;
}

export function normalizeManifestRecordPayload(fieldIndex = {}, source = {}) {
  if (!source || typeof source !== "object") return source;
  const payload = { ...source };
  const allowedFieldIds = new Set(Object.keys(fieldIndex || {}).filter((fieldId) => typeof fieldId === "string" && fieldId));
  const lookupPopulatedReadonlyIds = lookupPopulatedFieldIds(fieldIndex);
  for (const key of Object.keys(payload)) {
    if (key === "id") continue;
    if (key.includes(".") && !allowedFieldIds.has(key)) {
      delete payload[key];
    }
  }
  for (const [fieldId, field] of Object.entries(fieldIndex || {})) {
    const isComputed = field?.compute && typeof field.compute === "object";
    const isReadonly = field?.readonly === true;
    const isLookupPopulatedReadonly = isReadonly && lookupPopulatedReadonlyIds.has(fieldId);
    if (fieldId !== "id" && (isComputed || (isReadonly && !isLookupPopulatedReadonly))) {
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
