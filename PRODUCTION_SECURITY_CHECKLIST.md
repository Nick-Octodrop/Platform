# Production Security Checklist

## Required Before Production

- [ ] Rotate/revoke the exposed API token previously present in README.
- [ ] `APP_ENV=production`.
- [ ] `OCTO_DISABLE_AUTH` unset or false.
- [ ] `SUPABASE_URL` set.
- [ ] `SUPABASE_DB_URL` set only in backend/worker secret storage.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set only in backend/worker secret storage.
- [ ] `APP_SECRET_KEY` set and backed up securely.
- [ ] `OCTO_CORS_ORIGINS` contains only production origins.
- [ ] `OCTO_TRUSTED_HOSTS` contains only production hostnames.
- [ ] `OCTO_CORS_ALLOW_NETLIFY_PREVIEWS` false unless deliberately required.
- [ ] `STUDIO2_AGENT_LOG_PAYLOAD` false.
- [ ] `OCTO_MAX_UPLOAD_BYTES` set to a business-approved value.
- [ ] Attachment bucket private.
- [ ] Branding/logo bucket public only if required.
- [ ] RLS enabled and policies deployed for tenant-scoped tables.
- [ ] Webhook signing secrets configured for all production inbound webhooks.
- [ ] Global API rate limiting configured at edge or app middleware.
- [ ] Database backups enabled and restore tested.
- [ ] Storage backups or retention policy defined.
- [ ] Security workflow passes.
- [ ] `make security` passes.
- [ ] `make security-strict` passes once RLS is implemented.

## Deployment Rollback Checks

- [ ] Previous deployment version available.
- [ ] Migration rollback/forward plan documented.
- [ ] Feature flags available for Studio, integrations, and webhooks.
- [ ] Worker queues can be paused.
- [ ] Customer-impacting incident contact path known.

