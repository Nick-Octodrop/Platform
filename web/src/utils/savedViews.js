export function buildSavedViewDomain(activeFilter, clientFilters = []) {
  const conditions = [];
  if (activeFilter?.domain) conditions.push(activeFilter.domain);
  if (Array.isArray(clientFilters)) {
    for (const flt of clientFilters) {
      if (!flt?.field_id) continue;
      if (flt.op === "contains") {
        conditions.push({ op: "contains", field: flt.field_id, value: flt.value });
      } else if (flt.op === "eq") {
        conditions.push({ op: "eq", field: flt.field_id, value: flt.value });
      }
    }
  }
  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { op: "and", conditions };
}
