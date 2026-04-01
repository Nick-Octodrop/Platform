# Octodrop External Event Catalog

This document describes the public event names and payload shapes used by Octodrop outbound webhook subscriptions.

Base webhook envelope:

```json
{
  "event": "record.updated",
  "occurred_at": "2026-04-01T02:14:22Z",
  "delivery_id": "whd_123",
  "workspace_id": "org_123",
  "data": {
    "...": "..."
  }
}
```

Notes:

- `event` is the event name matched against the subscription `event_pattern`
- `occurred_at` is the UTC timestamp when Octodrop emitted the event
- `delivery_id` is the webhook delivery identifier for support and tracing
- `workspace_id` is the Octodrop workspace/org identifier
- `data` contains the event-specific payload

## Event Pattern Matching

Supported subscription patterns:

- `*`
- `billing.*`
- `record.updated`

Pattern behavior:

- exact match: event must equal the pattern
- prefix wildcard: `prefix.*` matches any event beginning with `prefix.`
- catch-all: `*` matches every event

## Core Public Events

### `record.created`

Emitted when a record is created through Octodrop.

```json
{
  "event": "record.created",
  "occurred_at": "2026-04-01T02:14:22Z",
  "delivery_id": "whd_123",
  "workspace_id": "org_123",
  "data": {
    "entity_id": "entity.construction_project",
    "record_id": "rec_123",
    "record": {
      "id": "rec_123",
      "construction_project.name": "West Yard Upgrade"
    }
  }
}
```

### `record.updated`

Emitted when a record is updated through Octodrop.

```json
{
  "event": "record.updated",
  "occurred_at": "2026-04-01T02:14:22Z",
  "delivery_id": "whd_124",
  "workspace_id": "org_123",
  "data": {
    "entity_id": "entity.construction_project",
    "record_id": "rec_123",
    "record": {
      "id": "rec_123",
      "construction_project.status": "active"
    }
  }
}
```

### `automation.run.completed`

Emitted when an automation run completes successfully.

```json
{
  "event": "automation.run.completed",
  "occurred_at": "2026-04-01T02:14:22Z",
  "delivery_id": "whd_125",
  "workspace_id": "org_123",
  "data": {
    "automation_id": "aut_123",
    "run_id": "run_123",
    "status": "completed"
  }
}
```

### `automation.run.failed`

Emitted when an automation run fails.

```json
{
  "event": "automation.run.failed",
  "occurred_at": "2026-04-01T02:14:22Z",
  "delivery_id": "whd_126",
  "workspace_id": "org_123",
  "data": {
    "automation_id": "aut_123",
    "run_id": "run_124",
    "status": "failed",
    "error": "Connection timeout"
  }
}
```

### `integration.webhook.received`

Emitted when Octodrop receives and accepts an inbound integration webhook.

```json
{
  "event": "integration.webhook.received",
  "occurred_at": "2026-04-01T02:14:22Z",
  "delivery_id": "whd_127",
  "workspace_id": "org_123",
  "data": {
    "connection_id": "conn_123",
    "webhook_id": "wh_123",
    "event_key": "invoice.created",
    "provider_event_id": "evt_123",
    "signature_valid": true,
    "payload": {
      "invoice_id": "inv_123"
    }
  }
}
```

### `integration.webhook.*`

Provider-specific webhook event keys may be fanned out as:

- `integration.webhook.invoice.created`
- `integration.webhook.contact.updated`
- `integration.webhook.payment.received`

These use the same envelope as `integration.webhook.received`, with the provider event key reflected in both the public event name and `data.event_key`.

### `integration.sync.completed`

Emitted when an integration sync finishes.

```json
{
  "event": "integration.sync.completed",
  "occurred_at": "2026-04-01T02:14:22Z",
  "delivery_id": "whd_128",
  "workspace_id": "org_123",
  "data": {
    "connection_id": "conn_123",
    "scope_key": "contacts",
    "count": 25
  }
}
```

### `integration.mapping.applied`

Emitted when a sync item is mapped successfully into Octodrop.

```json
{
  "event": "integration.mapping.applied",
  "occurred_at": "2026-04-01T02:14:22Z",
  "delivery_id": "whd_129",
  "workspace_id": "org_123",
  "data": {
    "connection_id": "conn_123",
    "mapping_id": "map_123",
    "target_entity_id": "entity.contact",
    "target_record_id": "rec_555"
  }
}
```

## Stability Notes

- The webhook envelope fields documented here are intended to be stable for `v1`
- `data` payloads may gain new optional fields over time
- consumers should ignore fields they do not recognize
- consumers should not assume field order

## Recommendations For Consumers

- verify `X-Octo-Timestamp` and `X-Octo-Signature`
- deduplicate on `delivery_id`
- process asynchronously
- treat unknown optional fields as non-breaking additions
