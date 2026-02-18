const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/;

function parseDateValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatDate(value, fallback = "") {
  const date = parseDateValue(value);
  if (!date) return fallback || (value == null ? "" : String(value));
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
  }).format(date);
}

export function formatDateTime(value, fallback = "") {
  const date = parseDateValue(value);
  if (!date) return fallback || (value == null ? "" : String(value));
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatTime(value, fallback = "") {
  const date = parseDateValue(value);
  if (!date) return fallback || (value == null ? "" : String(value));
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(date);
}

export function formatDateLike(value, { fieldType, fieldId } = {}) {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value);
  if (fieldType === "date") return formatDate(value, raw);
  if (fieldType === "datetime") return formatDateTime(value, raw);
  if (ISO_DATE_ONLY_RE.test(raw)) return formatDate(raw, raw);
  if (ISO_DATE_TIME_RE.test(raw)) return formatDateTime(raw, raw);
  if (fieldId && /(created_at|updated_at|sent_at|run_at|_at)$/.test(fieldId)) {
    return formatDateTime(value, raw);
  }
  return raw;
}
