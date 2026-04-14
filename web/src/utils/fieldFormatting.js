import {
  formatCurrencyRuntime,
  formatNumberRuntime,
  formatPercentRuntime,
  getI18nRuntimeSnapshot,
} from "../i18n/runtime.js";

function getRecordValue(record, fieldId) {
  if (!record || typeof record !== "object" || typeof fieldId !== "string") return "";
  if (fieldId.endsWith(".id")) return record.id || "";
  return record[fieldId] ?? "";
}

function normalizePrecision(value, fallback = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.min(6, Math.floor(numeric));
}

function resolveFormatKind(field) {
  const kind = field?.format?.kind;
  if (field?.type === "currency") return "currency";
  if (typeof kind !== "string" || !kind.trim()) return "plain";
  return kind.trim().toLowerCase();
}

function resolveCurrencyCode(field, record) {
  const dynamicField = field?.currency_field || field?.format?.currency_field;
  const dynamicValue = typeof dynamicField === "string" ? getRecordValue(record || {}, dynamicField) : null;
  const workspaceCurrency = getI18nRuntimeSnapshot().defaultCurrency || "NZD";
  const explicitCode = field?.currency_code || field?.format?.currency_code || field?.format?.currency;
  const raw = dynamicValue || explicitCode || (field?.currency_source === "workspace_default" || field?.format?.currency_source === "workspace_default" ? workspaceCurrency : workspaceCurrency);
  return typeof raw === "string" && raw.trim() ? raw.trim().toUpperCase() : workspaceCurrency;
}

function resolveUnitLabel(field, record) {
  const dynamicField = field?.format?.unit_field;
  const dynamicValue = typeof dynamicField === "string" ? getRecordValue(record || {}, dynamicField) : null;
  const raw = dynamicValue || field?.format?.unit || "";
  return typeof raw === "string" ? raw.trim() : "";
}

function getCurrencySymbol(currency) {
  try {
    const formatter = new Intl.NumberFormat(getI18nRuntimeSnapshot().locale, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    const currencyPart = formatter.formatToParts(0).find((part) => part.type === "currency");
    return currencyPart?.value || currency;
  } catch {
    return currency;
  }
}

function formatPlainNumber(numeric, precision) {
  return formatNumberRuntime(numeric, {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : Math.min(precision, 2),
    maximumFractionDigits: precision,
  });
}

export function isNumericField(field) {
  return field?.type === "number" || field?.type === "currency";
}

export function resolveFieldNumericFormat(field, record = null) {
  const kind = resolveFormatKind(field);
  const precision =
    kind === "currency"
      ? normalizePrecision(field?.format?.precision, 2)
      : normalizePrecision(field?.format?.precision, 2);
  return {
    kind,
    precision,
    currency: resolveCurrencyCode(field, record),
    unit: resolveUnitLabel(field, record),
  };
}

export function getFieldInputAffixes(field, record = null) {
  if (!isNumericField(field)) return { prefix: "", suffix: "", align: "" };
  const format = resolveFieldNumericFormat(field, record);
  if (format.kind === "currency") {
    return { prefix: getCurrencySymbol(format.currency), suffix: "", align: "text-right" };
  }
  if (format.kind === "percent") {
    return { prefix: "", suffix: "%", align: "text-right" };
  }
  if (format.kind === "measurement" || format.kind === "duration") {
    return { prefix: "", suffix: format.unit, align: "text-right" };
  }
  return { prefix: "", suffix: "", align: "text-right" };
}

export function formatFieldValue(field, value, record = null) {
  if (value === null || value === undefined || value === "") return "";
  if (!isNumericField(field)) return String(value);
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const format = resolveFieldNumericFormat(field, record);
  if (format.kind === "currency") {
    try {
      return formatCurrencyRuntime(numeric, format.currency, {
        minimumFractionDigits: format.precision,
        maximumFractionDigits: format.precision,
      });
    } catch {
      return `${format.currency} ${numeric.toFixed(format.precision)}`;
    }
  }
  if (format.kind === "percent") {
    return formatPercentRuntime(numeric, {
      minimumFractionDigits: Math.min(format.precision, 6),
      maximumFractionDigits: format.precision,
    });
  }
  if (format.kind === "measurement" || format.kind === "duration") {
    const base = formatPlainNumber(numeric, format.precision);
    return format.unit ? `${base} ${format.unit}` : base;
  }
  return formatPlainNumber(numeric, format.precision);
}
