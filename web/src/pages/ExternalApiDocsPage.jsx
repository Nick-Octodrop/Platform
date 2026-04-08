import React, { useEffect, useMemo } from "react";
import {
  BookOpen,
  Copy,
  Database,
  ExternalLink,
  FileJson,
  KeyRound,
  Radio,
  ShieldCheck,
  Terminal,
  UploadCloud,
  Workflow,
} from "lucide-react";
import { API_URL } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveApiBaseUrl() {
  const raw = trimTrailingSlash(API_URL || "");
  if (!raw) return "";
  if (typeof window === "undefined") return raw;
  try {
    return trimTrailingSlash(new URL(raw, window.location.origin).toString());
  } catch {
    return raw;
  }
}

function buildDocUrl(path) {
  return `${resolveApiBaseUrl()}${path}`;
}

function CodeBlock({ children }) {
  return (
    <pre className="overflow-x-auto rounded-box border border-base-300 bg-base-200/70 p-4 text-xs leading-6">
      <code>{children}</code>
    </pre>
  );
}

function Section({ title, description, children }) {
  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="mt-1 text-sm leading-6 opacity-70">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SurfaceCard({ icon: Icon, title, description, endpoints }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-box bg-base-200 p-2">
          <Icon className="h-5 w-5 text-success" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-sm leading-5 opacity-70">{description}</div>
          <div className="mt-3 space-y-1">
            {endpoints.map((endpoint) => (
              <div key={endpoint} className="truncate font-mono text-xs text-base-content/70">
                {endpoint}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value, description }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-200/35 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] opacity-55">{label}</div>
      <div className="mt-2 text-sm font-semibold">{value}</div>
      {description ? <div className="mt-1 text-xs leading-5 opacity-70">{description}</div> : null}
    </div>
  );
}

export function ExternalApiDocsRedirectPage({ path, label }) {
  const url = useMemo(() => buildDocUrl(path), [path]);

  useEffect(() => {
    if (typeof window === "undefined" || !url) return;
    window.location.replace(url);
  }, [url]);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-base-200 p-4 text-base-content md:p-6">
      <div className="mx-auto max-w-3xl">
        <div className={DESKTOP_PAGE_SHELL}>
          <div className={DESKTOP_PAGE_SHELL_BODY}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-50">Octodrop API</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">{label || "Redirecting"}</h1>
                <p className="mt-2 text-sm leading-6 opacity-70">Opening the backend documentation endpoint.</p>
              </div>
              <span className="badge badge-success badge-outline">v1</span>
            </div>
            <div className="mt-5 rounded-box border border-base-300 bg-base-200/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-50">Destination</div>
              <div className="mt-2 break-all font-mono text-sm">{url}</div>
            </div>
            <a className="btn btn-primary btn-sm mt-5 gap-2" href={url}>
              <ExternalLink className="h-4 w-4" />
              Open now
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExternalApiDocsPage() {
  const { pushToast } = useToast();
  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), []);
  const curlExample = `curl "${apiBaseUrl || "https://api.example.com"}/ext/v1/meta/entities?limit=50" \\
  -H "X-Api-Key: octo_live_..."`;

  const links = useMemo(
    () => [
      { label: "Interactive Docs", href: buildDocUrl("/ext/v1/docs"), icon: Terminal },
      { label: "Reference Docs", href: buildDocUrl("/ext/v1/redoc"), icon: BookOpen },
      { label: "OpenAPI JSON", href: buildDocUrl("/ext/v1/openapi.json"), icon: FileJson },
      { label: "Integration Guide", href: buildDocUrl("/ext/v1/guide.md"), icon: BookOpen },
      { label: "Webhook Events", href: buildDocUrl("/ext/v1/events.md"), icon: Radio },
    ],
    [],
  );

  async function copy(value, label = "Copied") {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      pushToast("success", label);
    } catch {
      pushToast("error", "Could not copy");
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-base-200 p-3 text-base-content sm:p-4 lg:p-6">
      <main className="mx-auto flex min-h-full max-w-6xl flex-col">
        <div className={DESKTOP_PAGE_SHELL}>
          <div className={`${DESKTOP_PAGE_SHELL_BODY} gap-4 overflow-visible pb-8 md:overflow-auto`}>
            <div className="flex flex-col gap-4 border-b border-base-300 pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge badge-success badge-outline">Octodrop API v1</span>
                  <span className="badge badge-ghost">Client ready</span>
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight">Public API documentation</h1>
                <p className="mt-3 text-sm leading-6 opacity-70">
                  Use the public API to read metadata, work with records, attach files, trigger published automations,
                  and receive signed webhook events. Every request is scoped to the workspace behind the API key.
                </p>
              </div>
              <div className="rounded-box border border-base-300 bg-base-200/60 p-3 lg:min-w-96">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-50">Base URL</div>
                <div className="mt-2 break-all font-mono text-xs">{apiBaseUrl || "Not configured"}</div>
                <button className="btn btn-ghost btn-xs mt-3 gap-1" type="button" onClick={() => copy(apiBaseUrl, "Base URL copied")}>
                  <Copy className="h-3.5 w-3.5" />
                  Copy base URL
                </button>
              </div>
            </div>

            <Section title="Documentation links" description="Use these links when handing the API to a client or integration partner.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {links.map((link) => {
                  const Icon = link.icon;
                  return (
                    <a
                      key={link.href}
                      className="group rounded-box border border-base-300 bg-base-100 p-4 transition hover:border-success hover:bg-base-200/50"
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <Icon className="h-5 w-5 text-success" />
                        <ExternalLink className="h-3.5 w-3.5 opacity-40 transition group-hover:opacity-80" />
                      </div>
                      <div className="mt-3 text-sm font-semibold">{link.label}</div>
                    </a>
                  );
                })}
              </div>
            </Section>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
                <KeyRound className="h-5 w-5 text-success" />
                <div className="mt-3 text-sm font-semibold">API key auth</div>
                <div className="mt-1 text-sm opacity-70">Send `X-Api-Key` with a scoped credential from Settings. Never use query string keys.</div>
              </div>
              <div className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
                <ShieldCheck className="h-5 w-5 text-info" />
                <div className="mt-3 text-sm font-semibold">Tenant scoped</div>
                <div className="mt-1 text-sm opacity-70">Keys can only see records inside their workspace and scope.</div>
              </div>
              <div className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
                <Radio className="h-5 w-5 text-warning" />
                <div className="mt-3 text-sm font-semibold">Signed webhooks</div>
                <div className="mt-1 text-sm opacity-70">Outbound events support HMAC signatures and replay checks.</div>
              </div>
            </div>

            <Section title="Production contract" description="The supported operational behavior clients should build against.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <InfoTile
                  label="Authentication"
                  value="X-Api-Key"
                  description="Static per-system credentials. Create one key per integration and rotate/revoke from Settings."
                />
                <InfoTile
                  label="Scopes"
                  value="Least privilege"
                  description="Use meta.read, records.read, records.write, automations.read, and automations.write as needed."
                />
                <InfoTile
                  label="Rate limit"
                  value="300 / 60s default"
                  description="Per API credential. Handle 429 using Retry-After and X-RateLimit-* headers."
                />
                <InfoTile
                  label="Pagination"
                  value="limit + cursor"
                  description="List responses include pagination and next_cursor. Current list cap is 200."
                />
                <InfoTile
                  label="Errors"
                  value="Stable JSON"
                  description="Failures return ok=false with errors[].code, message, path, and optional detail."
                />
                <InfoTile
                  label="Files"
                  value="10MB default"
                  description="Attachments are workspace scoped. Upload first, then link to a record."
                />
                <InfoTile
                  label="Webhooks"
                  value="HMAC SHA-256"
                  description="Verify X-Octo-Timestamp and X-Octo-Signature over timestamp.raw_body."
                />
                <InfoTile
                  label="Security"
                  value="No shared keys"
                  description="Do not reuse credentials between vendors. Store keys server-side only."
                />
              </div>
            </Section>

            <Section title="Quickstart" description="Create a scoped API credential, then call metadata first to discover installed entities and field IDs.">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <CodeBlock>{curlExample}</CodeBlock>
                </div>
                <button className="btn btn-primary btn-sm gap-2" type="button" onClick={() => copy(curlExample, "Quickstart copied")}>
                  <Copy className="h-4 w-4" />
                  Copy
                </button>
              </div>
            </Section>

            <Section title="Public API surface" description="This is the supported client-facing surface for v1. Use the OpenAPI docs for parameters and response schemas.">
              <div className="grid gap-3 lg:grid-cols-2">
                <SurfaceCard
                  icon={Database}
                  title="Metadata"
                  description="Discover installed entities and fields before reading or writing records."
                  endpoints={["GET /ext/v1/meta/entities"]}
                />
                <SurfaceCard
                  icon={Database}
                  title="Records"
                  description="List, search, read, create, replace, patch, and delete records through manifest validation."
                  endpoints={[
                    "GET /ext/v1/records/{entity_id}",
                    "POST /ext/v1/records/{entity_id}",
                    "GET|PUT|PATCH|DELETE /ext/v1/records/{entity_id}/{record_id}",
                  ]}
                />
                <SurfaceCard
                  icon={UploadCloud}
                  title="Attachments"
                  description="Upload files, link them to records, list record attachments, download, and unlink."
                  endpoints={[
                    "POST /ext/v1/attachments/upload",
                    "POST /ext/v1/attachments/link",
                    "GET /ext/v1/records/{entity_id}/{record_id}/attachments",
                    "GET /ext/v1/attachments/{attachment_id}/download",
                  ]}
                />
                <SurfaceCard
                  icon={Workflow}
                  title="Automations"
                  description="List published automations, queue a run, and poll run status."
                  endpoints={[
                    "GET /ext/v1/automations",
                    "POST /ext/v1/automations/{automation_id}/runs",
                    "GET /ext/v1/automation-runs/{run_id}",
                  ]}
                />
              </div>
            </Section>

            <Section title="Client handoff checklist">
              <ul className="space-y-2 text-sm leading-6 opacity-75">
                <li>Create one API credential per external system and grant the minimum scopes required.</li>
                <li>Send `X-Api-Key` on every `/ext/v1` request. Do not put the key in query strings.</li>
                <li>Use `/ext/v1/meta/entities` to discover entity and field IDs instead of hardcoding labels.</li>
                <li>Expect `401` for missing/expired/revoked keys and `403` for missing scopes or blocked record access.</li>
                <li>Use cursor pagination for lists and handle `429` with the `Retry-After` header.</li>
                <li>Verify webhook signatures with `X-Octo-Timestamp` and `X-Octo-Signature` before processing events.</li>
                <li>Store credentials in a server-side secret manager and rotate them on a regular schedule.</li>
              </ul>
            </Section>
          </div>
        </div>
      </main>
    </div>
  );
}
