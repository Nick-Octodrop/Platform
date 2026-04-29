import test from "node:test";
import assert from "node:assert/strict";

import { normalizeManifestRecordPayload } from "./formPayload.js";

test("normalizeManifestRecordPayload keeps readonly lookup-populated snapshot fields", () => {
  const fieldIndex = {
    "quote.id": { id: "quote.id", type: "uuid", readonly: true },
    "quote.contact_id": {
      id: "quote.contact_id",
      type: "lookup",
      ui: {
        populate_from_lookup: {
          field_map: {
            "quote.contact_name": "contact.name",
            "quote.contact_email": "contact.email",
          },
          clear_fields: ["quote.contact_phone"],
        },
      },
    },
    "quote.contact_name": { id: "quote.contact_name", type: "string", readonly: true },
    "quote.contact_email": { id: "quote.contact_email", type: "string", readonly: true },
    "quote.contact_phone": { id: "quote.contact_phone", type: "string", readonly: true },
    "quote.total": {
      id: "quote.total",
      type: "number",
      readonly: true,
      compute: { expression: { op: "add", args: [1, 2] } },
    },
  };

  const payload = normalizeManifestRecordPayload(fieldIndex, {
    "quote.id": "generated",
    "quote.contact_id": "person-1",
    "quote.contact_name": "Ada Lovelace",
    "quote.contact_email": "ada@example.test",
    "quote.contact_phone": "",
    "quote.total": 123,
  });

  assert.deepEqual(payload, {
    "quote.contact_id": "person-1",
    "quote.contact_name": "Ada Lovelace",
    "quote.contact_email": "ada@example.test",
    "quote.contact_phone": "",
  });
});
