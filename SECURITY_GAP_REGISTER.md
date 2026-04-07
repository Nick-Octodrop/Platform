# Security Gap Register

| ID | Severity | Area | Gap | Status | Owner |
| --- | --- | --- | --- | --- | --- |
| C1 | Critical | Tenant isolation | RLS/policies added in migration; production application and live DB role verification still required | Partially fixed | Backend/DB |
| C2 | Critical | Secrets | JWT-like token committed in README | Repo fixed, rotate required | Owner |
| C3 | Critical | Auth | `OCTO_DISABLE_AUTH` can disable auth if misconfigured | Partially fixed | Backend/DevOps |
| H1 | High | Files | Attachment access did not always prove active workspace and record access | Fixed | Backend |
| H2 | High | Files | Upload endpoints lacked size limits | Partially fixed | Backend |
| H3 | High | Webhooks | Webhooks can be unsigned if no signing secret; legacy timestampless mode exists | Open | Backend/Integrations |
| H4 | High | CORS | Credentialed CORS defaults were broad | Fixed | Backend/DevOps |
| H5 | High | Errors | Raw exception details leaked in production responses | Fixed | Backend |
| H6 | High | Storage | Storage policies added; service-role paths and live bucket privacy still require verification | Partially fixed | Backend/DevOps |
| H7 | High | API abuse | Missing broad user/IP/workspace rate limits | Open | Backend/DevOps |
| M1 | Medium | Browser | No tested CSP | Open | Frontend/Backend |
| M2 | Medium | Secrets | No formal secret encryption key rotation plan | Open | Backend/DevOps |
| M3 | Medium | Studio | Generated module safety needs stronger tests and action allowlists | Open | Backend |
| M4 | Medium | Integrations | Outbound URL SSRF controls need review | Open | Backend/Integrations |
| L1 | Low | Repo hygiene | Built PWA artifacts not fully ignored | Fixed | Backend |
| L2 | Low | Logging | PII/secret log review incomplete | Open | DevOps |
