# API Security Review

## Implemented During This Audit

- Production CORS defaults were tightened in `app/main.py`.
- `TrustedHostMiddleware` support was added via `OCTO_TRUSTED_HOSTS`.
- Baseline headers were added: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and HSTS for HTTPS/production.
- Generic 500 detail is hidden in production.
- Attachment routes now validate active workspace and record access.

## Remaining Gaps

- Global rate limiting is still missing for normal authenticated routes.
- CSP is not yet configured.
- Webhook endpoints should require timestamped signatures in production.
- Outbound integration/webhook URL handling needs SSRF controls.
- Production startup should fail on unsafe auth/config flags, not only CI checks.

## Recommended API Tests

- Cross-tenant object id access returns 404/403.
- Admin-only endpoints reject standard users.
- Field-masked users cannot write hidden fields.
- Webhook signature missing/expired/invalid returns 401/403.
- Upload over limit returns 413.
- CORS rejects unconfigured origins in production mode.

