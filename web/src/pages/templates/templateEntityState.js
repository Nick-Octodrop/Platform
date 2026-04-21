export function getTemplateEntityId(draft) {
  const entityId = draft?.variables_schema?.entity_id;
  return typeof entityId === "string" ? entityId : "";
}

export function setTemplateEntityId(draft, entityId) {
  const nextEntityId = typeof entityId === "string" ? entityId : "";
  return {
    ...(draft || {}),
    variables_schema: {
      ...((draft && draft.variables_schema) || {}),
      entity_id: nextEntityId,
    },
  };
}

export function syncSampleToTemplateEntity({ sample, draftEntityId, entities }) {
  const nextSample = sample && typeof sample === "object" ? sample : {};
  const entityList = Array.isArray(entities) ? entities : [];
  const normalizedDraftEntityId = typeof draftEntityId === "string" ? draftEntityId : "";

  if (normalizedDraftEntityId) {
    if (nextSample.entity_id === normalizedDraftEntityId) return null;
    return { ...nextSample, entity_id: normalizedDraftEntityId, record_id: "" };
  }

  const currentEntityId = typeof nextSample.entity_id === "string" ? nextSample.entity_id : "";
  const hasCurrentEntity = currentEntityId && entityList.some((ent) => ent && ent.id === currentEntityId);
  if (currentEntityId && !hasCurrentEntity) {
    return { ...nextSample, entity_id: "", record_id: "" };
  }
  return null;
}

export function buildEffectiveTemplateSample(sample, draft) {
  const nextSample = sample && typeof sample === "object" ? { ...sample } : {};
  const draftEntityId = getTemplateEntityId(draft);
  if (!draftEntityId) {
    return nextSample;
  }
  if (nextSample.entity_id === draftEntityId) {
    return nextSample;
  }
  return {
    ...nextSample,
    entity_id: draftEntityId,
    record_id: "",
  };
}

export function buildTemplateEntityOptions(entities, selectedEntityId) {
  const base = Array.isArray(entities) ? entities.filter((item) => item && typeof item.id === "string" && item.id) : [];
  const selected = typeof selectedEntityId === "string" ? selectedEntityId : "";
  if (!selected || base.some((item) => item.id === selected)) {
    return base;
  }
  return [{ id: selected, label: selected }, ...base];
}
