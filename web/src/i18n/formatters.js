import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "./options.js";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY_RE = /^\d{2}:\d{2}(?::\d{2})?$/;

const dateFormatterCache = new Map();
const numberFormatterCache = new Map();

function stableOptionsKey(options = {}) {
  const entries = Object.entries(options).filter(([, value]) => value !== undefined);
  entries.sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function getDateFormatter(locale, options = {}) {
  const key = `${locale}:${stableOptionsKey(options)}`;
  if (!dateFormatterCache.has(key)) {
    dateFormatterCache.set(key, new Intl.DateTimeFormat(locale, options));
  }
  return dateFormatterCache.get(key);
}

function getNumberFormatter(locale, options = {}) {
  const key = `${locale}:${stableOptionsKey(options)}`;
  if (!numberFormatterCache.has(key)) {
    numberFormatterCache.set(key, new Intl.NumberFormat(locale, options));
  }
  return numberFormatterCache.get(key);
}

function parseDateLike(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : { date: value, mode: "datetime" };
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (DATE_ONLY_RE.test(raw)) {
    return { date: new Date(`${raw}T00:00:00Z`), mode: "date" };
  }
  if (TIME_ONLY_RE.test(raw)) {
    return { date: new Date(`1970-01-01T${raw}Z`), mode: "time" };
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return { date: parsed, mode: "datetime" };
}

function formatNumericValue(value, formatter, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback || "";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback || String(value);
  return formatter.format(numeric);
}

export function formatDateValue(value, { locale = DEFAULT_LOCALE, timezone = DEFAULT_TIMEZONE, ...options } = {}) {
  const parsed = parseDateLike(value);
  if (!parsed) return value == null ? "" : String(value);
  const formatterOptions = {
    dateStyle: "medium",
    ...(parsed.mode === "date" ? { timeZone: "UTC" } : { timeZone: timezone || DEFAULT_TIMEZONE }),
    ...options,
  };
  return getDateFormatter(locale || DEFAULT_LOCALE, formatterOptions).format(parsed.date);
}

export function formatTimeValue(value, { locale = DEFAULT_LOCALE, timezone = DEFAULT_TIMEZONE, ...options } = {}) {
  const parsed = parseDateLike(value);
  if (!parsed) return value == null ? "" : String(value);
  const formatterOptions = {
    timeStyle: "short",
    ...(parsed.mode === "time" ? { timeZone: "UTC" } : { timeZone: timezone || DEFAULT_TIMEZONE }),
    ...options,
  };
  return getDateFormatter(locale || DEFAULT_LOCALE, formatterOptions).format(parsed.date);
}

export function formatDateTimeValue(value, { locale = DEFAULT_LOCALE, timezone = DEFAULT_TIMEZONE, ...options } = {}) {
  const parsed = parseDateLike(value);
  if (!parsed) return value == null ? "" : String(value);
  const formatterOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone || DEFAULT_TIMEZONE,
    ...options,
  };
  return getDateFormatter(locale || DEFAULT_LOCALE, formatterOptions).format(parsed.date);
}

export function formatNumberValue(value, { locale = DEFAULT_LOCALE, ...options } = {}) {
  const formatter = getNumberFormatter(locale || DEFAULT_LOCALE, options);
  return formatNumericValue(value, formatter);
}

export function formatPercentValue(value, { locale = DEFAULT_LOCALE, minimumFractionDigits, maximumFractionDigits, ...options } = {}) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const formatter = getNumberFormatter(locale || DEFAULT_LOCALE, {
    style: "percent",
    minimumFractionDigits,
    maximumFractionDigits,
    ...options,
  });
  return formatter.format(numeric / 100);
}

export function formatCurrencyValue(
  value,
  currencyCode,
  { locale = DEFAULT_LOCALE, minimumFractionDigits, maximumFractionDigits, ...options } = {},
) {
  const safeCurrency = String(currencyCode || "").trim().toUpperCase();
  if (!safeCurrency) return value == null ? "" : String(value);
  const formatter = getNumberFormatter(locale || DEFAULT_LOCALE, {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits,
    maximumFractionDigits,
    ...options,
  });
  return formatNumericValue(value, formatter, value == null ? "" : String(value));
}
