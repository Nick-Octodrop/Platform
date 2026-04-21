import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEffectiveTemplateSample,
  buildTemplateEntityOptions,
  getTemplateEntityId,
  setTemplateEntityId,
  syncSampleToTemplateEntity,
} from "./templateEntityState.js";

test("getTemplateEntityId reads the draft variables schema entity", () => {
  assert.equal(
    getTemplateEntityId({ variables_schema: { entity_id: "entity.biz_quote" } }),
    "entity.biz_quote",
  );
  assert.equal(getTemplateEntityId({}), "");
});

test("setTemplateEntityId writes the draft variables schema entity", () => {
  const updated = setTemplateEntityId(
    { name: "Quote Email", variables_schema: { locale: "en-NZ" } },
    "entity.biz_quote",
  );
  assert.equal(updated.variables_schema.entity_id, "entity.biz_quote");
  assert.equal(updated.variables_schema.locale, "en-NZ");
});

test("syncSampleToTemplateEntity prefers the template entity over stale sample state", () => {
  const next = syncSampleToTemplateEntity({
    sample: { entity_id: "entity.biz_purchase_order", record_id: "po-1" },
    draftEntityId: "entity.biz_quote",
    entities: [
      { id: "entity.biz_purchase_order", label: "Purchase Order" },
      { id: "entity.biz_quote", label: "Quote" },
    ],
  });
  assert.deepEqual(next, { entity_id: "entity.biz_quote", record_id: "" });
});

test("syncSampleToTemplateEntity still follows the draft entity when meta entities are incomplete", () => {
  const next = syncSampleToTemplateEntity({
    sample: { entity_id: "", record_id: "" },
    draftEntityId: "entity.billing_invoice",
    entities: [{ id: "entity.biz_quote", label: "Quote" }],
  });
  assert.deepEqual(next, { entity_id: "entity.billing_invoice", record_id: "" });
});

test("syncSampleToTemplateEntity leaves aligned sample state unchanged", () => {
  const next = syncSampleToTemplateEntity({
    sample: { entity_id: "entity.biz_quote", record_id: "quo-1" },
    draftEntityId: "entity.biz_quote",
    entities: [{ id: "entity.biz_quote", label: "Quote" }],
  });
  assert.equal(next, null);
});

test("syncSampleToTemplateEntity clears invalid sample entities when no template entity is set", () => {
  const next = syncSampleToTemplateEntity({
    sample: { entity_id: "entity.legacy", record_id: "legacy-1" },
    draftEntityId: "",
    entities: [{ id: "entity.biz_quote", label: "Quote" }],
  });
  assert.deepEqual(next, { entity_id: "", record_id: "" });
});

test("buildEffectiveTemplateSample follows the draft entity and clears stale record ids", () => {
  const next = buildEffectiveTemplateSample(
    { entity_id: "entity.biz_purchase_order", record_id: "po-1" },
    { variables_schema: { entity_id: "entity.biz_supplier_order" } },
  );
  assert.deepEqual(next, { entity_id: "entity.biz_supplier_order", record_id: "" });
});

test("buildEffectiveTemplateSample preserves aligned sample state", () => {
  const next = buildEffectiveTemplateSample(
    { entity_id: "entity.biz_supplier_order", record_id: "so-1" },
    { variables_schema: { entity_id: "entity.biz_supplier_order" } },
  );
  assert.deepEqual(next, { entity_id: "entity.biz_supplier_order", record_id: "so-1" });
});

test("buildTemplateEntityOptions includes the selected entity when meta options are incomplete", () => {
  const options = buildTemplateEntityOptions(
    [{ id: "entity.biz_quote", label: "Quote" }],
    "entity.billing_invoice",
  );
  assert.equal(options[0].id, "entity.billing_invoice");
  assert.equal(options[0].label, "entity.billing_invoice");
});
