import test from "node:test";
import assert from "node:assert/strict";
import { formatCurrencyValue, formatDateTimeValue, formatNumberValue } from "./formatters.js";
import { localizeManifest } from "./manifest.js";
import { bootstrapRuntime, ensureRuntimeNamespaces, setRuntimePreferences, translateRuntime } from "./runtime.js";

function normalizeSpaces(value) {
  return String(value || "").replace(/[\u00a0\u202f]/g, " ");
}

test("French locale uses bundled French strings for shared fallback copy", async () => {
  setRuntimePreferences({ locale: "fr-FR", timezone: "Europe/Paris", defaultCurrency: "EUR" });
  await ensureRuntimeNamespaces(["common"]);
  assert.equal(translateRuntime("common.english_only_fallback"), "Anglais uniquement");
});

test("runtime locale changes switch translated UI strings", async () => {
  setRuntimePreferences({ locale: "en-NZ", timezone: "Pacific/Auckland", defaultCurrency: "NZD" });
  await ensureRuntimeNamespaces(["common"]);
  assert.equal(translateRuntime("common.save"), "Save");

  setRuntimePreferences({ locale: "fr-FR", timezone: "Europe/Paris", defaultCurrency: "EUR" });
  await ensureRuntimeNamespaces(["common"]);
  assert.equal(translateRuntime("common.save"), "Enregistrer");
});

test("Dutch locale uses bundled Dutch strings for shared and settings copy", async () => {
  setRuntimePreferences({ locale: "nl-NL", timezone: "Europe/Amsterdam", defaultCurrency: "EUR" });
  await ensureRuntimeNamespaces(["common", "settings"]);
  assert.equal(translateRuntime("common.save"), "Opslaan");
  assert.equal(translateRuntime("settings.workspaces_tab"), "Werkruimtes");
  assert.equal(translateRuntime("common.english_only_fallback"), "Alleen Engels als terugval");
});

test("bootstrap runtime reuses cached translations synchronously", async () => {
  setRuntimePreferences({ locale: "fr-FR", timezone: "Europe/Paris", defaultCurrency: "EUR" });
  await ensureRuntimeNamespaces(["common"]);

  setRuntimePreferences({ locale: "en-NZ", timezone: "Pacific/Auckland", defaultCurrency: "NZD" });
  bootstrapRuntime({ locale: "fr-FR", timezone: "Europe/Paris", defaultCurrency: "EUR", namespaces: ["common"] });
  assert.equal(translateRuntime("common.save"), "Enregistrer");
});

test("manifest localisation resolves translation keys and keeps plain labels for legacy fields", async () => {
  setRuntimePreferences({ locale: "fr-FR", timezone: "Europe/Paris", defaultCurrency: "EUR" });
  const manifest = {
    module: { id: "biz_contacts", name_key: "contacts.module.name", name: "Contacts" },
    entities: [
      {
        id: "entity.biz_contact",
        label_key: "contacts.entity.contact",
        label: "Contact",
        fields: [
          { id: "biz_contact.name", type: "string", label_key: "contacts.fields.name", label: "Name" },
          { id: "biz_contact.legacy_code", type: "string", label: "Legacy code" },
        ],
      },
    ],
    actions: [
      { id: "action.contact_new", kind: "open_form", action_label_key: "contacts.actions.new", label: "New contact" },
    ],
  };

  const localized = await localizeManifest(manifest);
  assert.equal(localized.module.name, "Répertoire");
  assert.equal(localized.entities[0].fields[0].label, "Nom");
  assert.equal(localized.entities[0].fields[1].label, "Legacy code");
  assert.equal(localized.actions[0].label, "Nouveau contact");
});

test("currency and number formatting stays locale-aware while keeping the same currency code", () => {
  const enNz = normalizeSpaces(formatCurrencyValue(1234.56, "USD", { locale: "en-NZ" }));
  const frFr = normalizeSpaces(formatCurrencyValue(1234.56, "USD", { locale: "fr-FR" }));
  assert.notEqual(enNz, frFr);
  assert.match(enNz, /1,234\.56/);
  assert.match(frFr, /1 234,56/);

  const numberFr = normalizeSpaces(formatNumberValue(1234.56, { locale: "fr-FR", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  assert.match(numberFr, /1 234,56/);
});

test("date time formatting uses locale and timezone", () => {
  const value = "2026-04-14T10:30:00Z";
  const nz = formatDateTimeValue(value, { locale: "en-NZ", timezone: "Pacific/Auckland" });
  const fr = formatDateTimeValue(value, { locale: "fr-FR", timezone: "Europe/Paris" });
  assert.notEqual(nz, fr);
  assert.match(nz, /14/);
  assert.match(fr, /14/);
});
