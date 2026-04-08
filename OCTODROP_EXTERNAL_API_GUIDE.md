# Octodrop External API Guide

This guide covers the public Octodrop integration surface exposed under `/ext/v1`.

## Authentication

Use an API credential created in:

- `Settings -> Developer -> API Credentials`

Send the token in the `X-Api-Key` header:

```bash
curl https://your-octodrop.example.com/ext/v1/meta/entities \
  -H "X-Api-Key: octo_live_..."
```

Production notes:

- API credentials are workspace-scoped.
- API credentials can be scoped to metadata, records, and automation access.
- API credentials are static keys, not OAuth access tokens.
- There are no refresh tokens for external API callers.
- Expired or revoked keys return `401`.
- Missing scopes or blocked record access return `403`.
- Rate-limited requests return `429` with `Retry-After`.
- Keys can be rotated or given an expiry time from the API Credentials settings page.
- Do not send API keys in query strings, browser local storage, screenshots, logs, or client-side code.
- Create one API credential per external system so individual vendors can be revoked without disrupting other integrations.
- Store API keys in a server-side secret manager and rotate them on a planned schedule or immediately after suspected exposure.

Supported scopes:

| Scope | Use |
| --- | --- |
| `meta.read` | Discover installed entities and field metadata. |
| `records.read` | Read and search records. |
| `records.write` | Create, update, delete, upload, link, and unlink record data or attachments. |
| `automations.read` | List published automations and automation runs. |
| `automations.write` | Queue published automation runs. |
| `*` | Full external API access. Avoid for normal client integrations. |

## Public Docs

Available public docs endpoints:

- `/ext/v1/openapi.json`
- `/ext/v1/docs`
- `/ext/v1/redoc`
- `/ext/v1/guide.md`
- `/ext/v1/events.md`

## Entity Metadata

List entities and fields:

```bash
curl "https://your-octodrop.example.com/ext/v1/meta/entities?limit=50" \
  -H "X-Api-Key: octo_live_..."
```

This returns:

- entity ids
- display fields
- field ids
- field labels
- field types
- enum options where relevant

Metadata list pagination params:

- `limit`
- `offset`
- `cursor`

## Records API

Records are addressed by manifest entity id. Use `/ext/v1/meta/entities` first to discover installed entity ids and field ids.

### List records

```bash
curl "https://your-octodrop.example.com/ext/v1/records/ENTITY_ID?limit=25" \
  -H "X-Api-Key: octo_live_..."
```

Supported query params:

- `q`
- `limit`
- `offset`
- `cursor`
- `search_fields`
- `fields`
- `domain`

Record list responses include:

- `records`
- `pagination`
- optional `next_cursor`

### Get one record

```bash
curl https://your-octodrop.example.com/ext/v1/records/ENTITY_ID/RECORD_ID \
  -H "X-Api-Key: octo_live_..."
```

### Create a record

```bash
curl https://your-octodrop.example.com/ext/v1/records/ENTITY_ID \
  -H "X-Api-Key: octo_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "record": {
      "entity.name": "Example record",
      "entity.status": "draft"
    }
  }'
```

### Replace a record

`PUT` replaces the full validated payload.

```bash
curl -X PUT https://your-octodrop.example.com/ext/v1/records/ENTITY_ID/RECORD_ID \
  -H "X-Api-Key: octo_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "record": {
      "entity.name": "Example record",
      "entity.status": "active"
    }
  }'
```

### Patch a record

`PATCH` merges only the provided fields, then validates the final record.

```bash
curl -X PATCH https://your-octodrop.example.com/ext/v1/records/ENTITY_ID/RECORD_ID \
  -H "X-Api-Key: octo_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "record": {
      "entity.status": "completed"
    }
  }'
```

### Delete a record

```bash
curl -X DELETE https://your-octodrop.example.com/ext/v1/records/ENTITY_ID/RECORD_ID \
  -H "X-Api-Key: octo_live_..."
```

Record writes and deletes require the `records.write` scope. All writes run through the same entity access, field visibility, validation, lookup-domain, and document-numbering rules as the main Octodrop app.

## Attachments API

### Upload an attachment

```bash
curl -X POST https://your-octodrop.example.com/ext/v1/attachments/upload \
  -H "X-Api-Key: octo_live_..." \
  -F "file=@/path/to/file.pdf"
```

The response includes an `attachment.id`. Uploading creates the file but does not automatically link it to a record.

### Link an attachment to a record

```bash
curl -X POST https://your-octodrop.example.com/ext/v1/attachments/link \
  -H "X-Api-Key: octo_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "attachment_id": "ATTACHMENT_ID",
    "entity_id": "ENTITY_ID",
    "record_id": "RECORD_ID",
    "purpose": "default"
  }'
```

### List record attachments

```bash
curl https://your-octodrop.example.com/ext/v1/records/ENTITY_ID/RECORD_ID/attachments \
  -H "X-Api-Key: octo_live_..."
```

Optional query param:

- `purpose`

### Download an attachment

```bash
curl -L https://your-octodrop.example.com/ext/v1/attachments/ATTACHMENT_ID/download \
  -H "X-Api-Key: octo_live_..." \
  -o attachment.bin
```

### Unlink an attachment from a record

```bash
curl -X DELETE https://your-octodrop.example.com/ext/v1/records/ENTITY_ID/RECORD_ID/attachments/ATTACHMENT_ID \
  -H "X-Api-Key: octo_live_..."
```

If the attachment has no remaining links, Octodrop may remove the stored file as part of cleanup.

## Automations API

### List published automations

```bash
curl "https://your-octodrop.example.com/ext/v1/automations?limit=50" \
  -H "X-Api-Key: octo_live_..."
```

Automation list pagination params:

- `limit`
- `offset`
- `cursor`

### Get one published automation

```bash
curl https://your-octodrop.example.com/ext/v1/automations/AUTOMATION_ID \
  -H "X-Api-Key: octo_live_..."
```

### Queue an automation run

```bash
curl -X POST https://your-octodrop.example.com/ext/v1/automations/AUTOMATION_ID/runs \
  -H "X-Api-Key: octo_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {
      "source": "partner_system",
      "reference": "ABC-123"
    }
  }'
```

This queues a run, it does not execute inline.

### List automation runs

```bash
curl "https://your-octodrop.example.com/ext/v1/automations/AUTOMATION_ID/runs?limit=50" \
  -H "X-Api-Key: octo_live_..."
```

### Get one automation run

```bash
curl https://your-octodrop.example.com/ext/v1/automation-runs/RUN_ID \
  -H "X-Api-Key: octo_live_..."
```

Use these endpoints to poll a queued automation run after receiving the `run.id` from the queue response.

## Webhook Subscriptions

External webhook subscriptions are configured in:

- `Settings -> Developer -> Webhook Subscriptions`

Each subscription includes:

- `target_url`
- `event_pattern`
- optional signing secret
- optional static headers

### Event pattern matching

Supported patterns:

- exact match: `record.updated`
- prefix wildcard: `construction.*`
- catch-all: `*`

### Delivery model

- deliveries are async worker jobs
- failures are stored on the subscription
- each subscription tracks:
  - `last_delivered_at`
  - `last_status_code`
  - `last_error`

Public event names and example payload shapes are documented in:

- `/ext/v1/events.md`

## Webhook Signing

If a signing secret is configured, outbound webhook deliveries include:

- `X-Octo-Timestamp`
- `X-Octo-Signature`

The signature is:

- HMAC SHA-256
- over the bytes of: `timestamp + "." + raw_body`

Header format:

```text
X-Octo-Signature: sha256=<hex_digest>
```

### Verification example

```python
import hashlib
import hmac

def verify(payload_bytes: bytes, timestamp: str, provided_signature: str, secret: str) -> bool:
    candidate = provided_signature.removeprefix("sha256=").strip()
    signed = timestamp.encode("utf-8") + b"." + payload_bytes
    digest = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(candidate, digest)
```

Recommendation:

- reject missing timestamps
- reject timestamps older than 5 minutes
- use the raw request body exactly as received

Compatibility note:

- Octodrop still accepts older inbound signatures that were computed over the raw body only
- new outbound deliveries use the timestamped scheme

## Common Response Shape

Success:

```json
{
  "ok": true,
  "...": "...",
  "errors": [],
  "warnings": []
}
```

Failure:

```json
{
  "ok": false,
  "errors": [
    {
      "code": "SOME_ERROR",
      "message": "Readable explanation",
      "path": "field_or_header",
      "detail": {}
    }
  ],
  "warnings": []
}
```

Common status codes:

| Status | Meaning |
| --- | --- |
| `200` / `201` | Request succeeded. |
| `400` | Invalid payload, query parameter, cursor, or manifest field. |
| `401` | Missing, invalid, expired, or revoked API key. |
| `403` | Valid key, but missing scope or record/entity access. |
| `404` | Record, automation, attachment, or route not found within the scoped workspace. |
| `413` | Upload exceeds the configured file-size limit. |
| `429` | Rate limit exceeded. Retry after the `Retry-After` value. |
| `500` | Server error. Retry only if the operation is safe or idempotent from the client side. |

## Current Limits

- API credentials are rate-limited per credential
- default server limit is `300 requests per 60 seconds`
- limits can be changed server-side with:
  - `OCTO_EXT_API_RATE_LIMIT_WINDOW_SECONDS`
  - `OCTO_EXT_API_RATE_LIMIT_MAX_REQUESTS`
- responses include:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Window-Seconds`
- rate-limited responses also include:
  - `Retry-After`
- record writes still go through the same manifest validation rules as the main app
- default attachment upload limit is `10MB`
- attachment limit can be changed server-side with `OCTO_MAX_UPLOAD_BYTES`

Recommended client retry behavior:

- retry `429` only after `Retry-After`
- retry transient `500`, `502`, `503`, or `504` with exponential backoff
- do not blindly retry `POST`, `PUT`, `PATCH`, or `DELETE` unless your integration can safely de-duplicate the operation
- never retry `401`, `403`, or validation `400` without changing credentials, scopes, or payload

## Pagination Contract

List endpoints use a shared pattern:

- `limit`
- `offset`
- `cursor`

Responses include:

```json
{
  "ok": true,
  "records": [],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "next_cursor": "50",
    "has_more": true
  },
  "next_cursor": "50",
  "errors": [],
  "warnings": []
}
```

Notes:

- `limit` defaults to `50`
- current hard cap is `200`
- `cursor` is currently an integer offset token
- `next_cursor` is omitted when there are no more results

## Recommended Integration Pattern

1. Create an API credential with the minimum scopes needed.
2. Pull entity metadata from `/ext/v1/meta/entities`.
3. Read and write records through `/ext/v1/records/...`.
4. Trigger published automations for side effects that should remain inside Octodrop.
5. Subscribe external systems to events through webhook subscriptions.
6. Verify webhook signatures using the shared secret.

## Production Readiness Checklist

- Use a separate API credential for every external system.
- Grant only the scopes required by that integration.
- Store the key in a server-side secret manager.
- Confirm the integration handles `401`, `403`, `404`, `413`, and `429` explicitly.
- Confirm list syncs use `limit` and `next_cursor`.
- Confirm webhook receivers verify `X-Octo-Signature` and reject old `X-Octo-Timestamp` values.
- Confirm webhook handlers are idempotent by delivery/event id and tolerate duplicate delivery.
- Confirm file uploads are scanned or validated by the receiving workflow if files come from untrusted users.
- Confirm logs redact `X-Api-Key`, webhook signatures, and downloaded file URLs.
- Rotate the API key before moving from test to production if it was shared during implementation.
