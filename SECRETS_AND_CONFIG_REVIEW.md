# Secrets and Config Review

## Findings

- A JWT-like token was committed in `manifests/marketplace/README.md` and has been replaced with a placeholder. It must still be rotated/revoked.
- `.env` files are ignored, but developers must avoid pasting tokens into docs and manifests.
- `app/secrets.py` uses encrypted stored secrets with `APP_SECRET_KEY`; production must set this.
- No formal `APP_SECRET_KEY` rotation process is implemented.
- `STUDIO2_AGENT_LOG_PAYLOAD` can expose sensitive AI prompts/payloads if enabled.

## Controls Added

- `scripts/security_check.py` scans tracked files for JWTs, OpenAI keys, service-role keys, and DB URLs.
- CI workflow runs the local security scanner.
- Production env checks require `APP_SECRET_KEY`, Supabase config, CORS origins, and trusted hosts.

## Required Next Steps

- Rotate the exposed token.
- Add pre-commit secret scanning if the team uses pre-commit.
- Define key rotation for `APP_SECRET_KEY`.
- Verify no service-role keys are exposed to frontend bundles.
- Ensure production secrets live only in the hosting provider secret manager.

