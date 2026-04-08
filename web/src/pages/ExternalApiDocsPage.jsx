import React, { useEffect, useMemo } from "react";
import {
  BookOpen,
  Copy,
  Database,
  ExternalLink,
  FileJson,
  KeyRound,
  Radio,
  Terminal,
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
    <pre className="overflow-x-auto rounded-box border border-base-300 bg-base-200/70 p-3 text-xs leading-6">
      <code>{children}</code>
    </pre>
  );
}

function DocCard({ icon: Icon, label, href, description }) {
  return (
    <a
      className="group flex min-h-24 flex-col justify-between rounded-box border border-base-300 bg-base-100 p-4 transition hover:border-success hover:bg-base-200/50"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <div className="flex items-start justify-between gap-3">
        <Icon className="h-5 w-5 text-success" />
        <ExternalLink className="h-4 w-4 opacity-35 transition group-hover:opacity-80" />
      </div>
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-1 text-xs leading-5 opacity-65">{description}</div>
      </div>
    </a>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="w-28 shrink-0 font-medium opacity-60">{label}</div>
      <div className="min-w-0 flex-1 leading-6">{value}</div>
    </div>
  );
}

function EndpointRow({ label, endpoints }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-3">
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {endpoints.map((endpoint) => (
          <span key={endpoint} className="rounded-btn bg-base-200 px-2 py-1 font-mono text-[11px] text-base-content/70">
            {endpoint}
          </span>
        ))}
      </div>
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
      {
        label: "Swagger UI",
        description: "Interactive reference for testing calls with an API key.",
        href: buildDocUrl("/ext/v1/docs"),
        icon: Terminal,
      },
      {
        label: "ReDoc",
        description: "Clean reference view for reading the full public API.",
        href: buildDocUrl("/ext/v1/redoc"),
        icon: BookOpen,
      },
      {
        label: "OpenAPI JSON",
        description: "Machine-readable schema for SDKs and generated clients.",
        href: buildDocUrl("/ext/v1/openapi.json"),
        icon: FileJson,
      },
      {
        label: "Guide",
        description: "Production integration notes, auth, retries, and webhooks.",
        href: buildDocUrl("/ext/v1/guide.md"),
        icon: BookOpen,
      },
      {
        label: "Events",
        description: "Webhook event names and payload expectations.",
        href: buildDocUrl("/ext/v1/events.md"),
        icon: Radio,
      },
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
          <div className={`${DESKTOP_PAGE_SHELL_BODY} gap-4 overflow-visible pb-8`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <span className="badge badge-success badge-outline">External API v1</span>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight">Octodrop External API</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 opacity-70">
                  Client-ready documentation for records, files, automations, and signed webhooks. The docs are public;
                  the API itself requires a scoped <span className="font-mono text-xs">X-Api-Key</span>.
                </p>
              </div>
              <div className="rounded-box border border-base-300 bg-base-200/60 p-4 lg:w-96">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-50">Base URL</div>
                <div className="mt-2 break-all font-mono text-xs leading-5">{apiBaseUrl || "Not configured"}</div>
                <button
                  className="btn btn-ghost btn-xs mt-3 gap-1"
                  type="button"
                  onClick={() => copy(apiBaseUrl, "Base URL copied")}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy base URL
                </button>
              </div>
            </div>

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {links.map((link) => (
                <DocCard key={link.href} {...link} />
              ))}
            </section>

            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <section className="rounded-box border border-base-300 bg-base-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="h-4 w-4 text-success" />
                  Production contract
                </div>
                <div className="mt-4 space-y-3">
                  <DetailRow label="Auth" value="Send X-Api-Key on every /ext/v1 request. Do not put keys in query strings." />
                  <DetailRow label="Scopes" value="Use one credential per integration with only the scopes it needs." />
                  <DetailRow label="Rate limits" value="Default is 300 requests per 60 seconds per API credential. Handle 429 with Retry-After." />
                  <DetailRow label="Pagination" value="Use limit and cursor. The current hard cap is 200 records per page." />
                  <DetailRow label="Webhooks" value="Verify X-Octo-Timestamp and X-Octo-Signature before processing events." />
                  <DetailRow label="Errors" value="Expect stable JSON errors with ok=false and errors[].code/message/path." />
                </div>
              </section>

              <section className="rounded-box border border-base-300 bg-base-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Terminal className="h-4 w-4 text-success" />
                  Quickstart
                </div>
                <p className="mt-2 text-sm leading-6 opacity-70">
                  Create a scoped API credential in Settings, then call metadata first to discover installed entity IDs.
                </p>
                <div className="mt-4">
                  <CodeBlock>{curlExample}</CodeBlock>
                </div>
                <button
                  className="btn btn-primary btn-sm mt-3 gap-2"
                  type="button"
                  onClick={() => copy(curlExample, "Quickstart copied")}
                >
                  <Copy className="h-4 w-4" />
                  Copy
                </button>
              </section>
            </div>

            <section className="rounded-box border border-base-300 bg-base-100 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Database className="h-4 w-4 text-success" />
                    Public API surface
                  </div>
                  <p className="mt-1 text-sm leading-6 opacity-70">Supported client-facing routes for v1.</p>
                </div>
                <a className="btn btn-outline btn-sm gap-2" href={buildDocUrl("/ext/v1/redoc")} target="_blank" rel="noreferrer">
                  Full reference
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <EndpointRow label="Metadata" endpoints={["GET /ext/v1/meta/entities"]} />
                <EndpointRow
                  label="Records"
                  endpoints={[
                    "GET /ext/v1/records/{entity_id}",
                    "POST /ext/v1/records/{entity_id}",
                    "GET|PUT|PATCH|DELETE /ext/v1/records/{entity_id}/{record_id}",
                  ]}
                />
                <EndpointRow
                  label="Attachments"
                  endpoints={[
                    "POST /ext/v1/attachments/upload",
                    "POST /ext/v1/attachments/link",
                    "GET /ext/v1/records/{entity_id}/{record_id}/attachments",
                    "GET /ext/v1/attachments/{attachment_id}/download",
                  ]}
                />
                <EndpointRow
                  label="Automations"
                  endpoints={[
                    "GET /ext/v1/automations",
                    "POST /ext/v1/automations/{automation_id}/runs",
                    "GET /ext/v1/automation-runs/{run_id}",
                  ]}
                />
              </div>
            </section>

            <section className="rounded-box border border-base-300 bg-base-200/45 p-4">
              <div className="text-sm font-semibold">Client handoff</div>
              <div className="mt-2 grid gap-2 text-sm leading-6 opacity-75 md:grid-cols-2">
                <div>Create one credential per external system and grant minimum scopes.</div>
                <div>Store keys server-side only and rotate them on a regular schedule.</div>
                <div>Use metadata routes to discover entity and field IDs instead of hardcoding labels.</div>
                <div>Handle 401, 403, 429, and cursor pagination in the integration client.</div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
