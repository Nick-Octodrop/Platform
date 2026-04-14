import { formatDateRuntime, formatDateTimeRuntime, formatTimeRuntime } from "../i18n/runtime.js";

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
  return formatDateRuntime(value, { dateStyle: "long" });
}

export function formatDateTime(value, fallback = "") {
  const date = parseDateValue(value);
  if (!date) return fallback || (value == null ? "" : String(value));
  return formatDateTimeRuntime(value, { dateStyle: "medium", timeStyle: "short" });
}

export function formatTime(value, fallback = "") {
  const date = parseDateValue(value);
  if (!date) return fallback || (value == null ? "" : String(value));
  return formatTimeRuntime(value, { timeStyle: "short" });
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
