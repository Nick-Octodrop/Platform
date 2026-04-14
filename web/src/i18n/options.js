export const DEFAULT_LOCALE = "en-NZ";
export const FALLBACK_LOCALE = DEFAULT_LOCALE;
export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_CURRENCY = "NZD";

export const SUPPORTED_LOCALES = [
  { code: "en-NZ", label: "English (New Zealand)" },
  { code: "en-US", label: "English (United States)" },
  { code: "fr-FR", label: "Francais (France)" },
  { code: "nl-NL", label: "Nederlands (Nederland)" },
];

export const COMMON_CURRENCIES = [
  "NZD",
  "AUD",
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "SGD",
  "AED",
];

const FALLBACK_TIMEZONES = [
  "UTC",
  "Pacific/Auckland",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Paris",
  "Europe/London",
  "America/Los_Angeles",
  "America/New_York",
  "Asia/Singapore",
];

export function getTimezoneOptions() {
  try {
    const values = Intl.supportedValuesOf?.("timeZone");
    if (Array.isArray(values) && values.length > 0) return values;
  } catch {
    // ignore browser gaps
  }
  return FALLBACK_TIMEZONES;
}

export function getLocaleLabel(locale) {
  const match = SUPPORTED_LOCALES.find((item) => item.code === locale);
  return match?.label || locale;
}
