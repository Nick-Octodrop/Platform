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

Notes:

- API credentials are workspace-scoped.
- API credentials can be scoped to metadata, records, and automation access.
- API credentials are static keys, not OAuth access tokens.
- There are no refresh tokens for external API callers.
- Expired or revoked keys return `401`.
- Rate-limited requests return `429`.
- Keys can be rotated or given an expiry time from the API Credentials settings page.

## Public Docs

Available public docs endpoints:

- `/ext/v1/openapi.json`
- `/ext/v1/docs`
- `/ext/v1/redoc`
- `/ext/v1/guide.md`

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

### List records

```bash
curl "https://your-octodrop.example.com/ext/v1/records/entity.construction_project?limit=25" \
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
curl https://your-octodrop.example.com/ext/v1/records/entity.construction_project/RECORD_ID \
  -H "X-Api-Key: octo_live_..."
```

### Create a record

```bash
curl https://your-octodrop.example.com/ext/v1/records/entity.construction_project \
  -H "X-Api-Key: octo_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "record": {
      "construction_project.name": "West Yard Upgrade",
      "construction_project.status": "planned"
    }
  }'
```

### Replace a record

`PUT` replaces the full validated payload.

```bash
curl -X PUT https://your-octodrop.example.com/ext/v1/records/entity.construction_project/RECORD_ID \
  -H "X-Api-Key: octo_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "record": {
      "construction_project.name": "West Yard Upgrade",
      "construction_project.status": "active"
    }
  }'
```

### Patch a record

`PATCH` merges only the provided fields, then validates the final record.

```bash
curl -X PATCH https://your-octodrop.example.com/ext/v1/records/entity.construction_project/RECORD_ID \
  -H "X-Api-Key: octo_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "record": {
      "construction_project.status": "completed"
    }
  }'
```

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

## Next Expected Additions

Planned next layers on top of this foundation:

- richer external event catalog
- tighter quotas and per-key policy controls
- more formal public API examples and SDK helpers
- broader external resources beyond records and automation runs
