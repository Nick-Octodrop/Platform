import React, { useEffect, useMemo } from "react";
import { BookOpen, Braces, Copy, ExternalLink, FileJson, KeyRound, Radio, ShieldCheck, Terminal } from "lucide-react";
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

export function ExternalApiDocsRedirectPage({ path, label }) {
  const url = useMemo(() => buildDocUrl(path), [path]);

  useEffect(() => {
    if (typeof window === "undefined" || !url) return;
    window.location.replace(url);
  }, [url]);

  return (
    <div className="min-h-screen bg-base-200 p-4 text-base-content md:p-6">
      <div className="mx-auto max-w-4xl">
        <div className={DESKTOP_PAGE_SHELL}>
          <div className={DESKTOP_PAGE_SHELL_BODY}>
            <div className="flex items-start justify-between gap-4 border-b border-base-300 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/50">External API</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">{label || "Redirecting"}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/70">
                  This frontend route is handing off to the backend API documentation host.
                </p>
              </div>
              <span className="badge badge-success badge-outline">v1</span>
            </div>
            <div className="mt-5 rounded-box border border-base-300 bg-base-200/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/50">Destination</p>
              <p className="mt-2 break-all font-mono text-sm">{url}</p>
            </div>
            <div className="mt-5">
              <a className="btn btn-primary btn-sm gap-2" href={url}>
                <ExternalLink className="h-4 w-4" />
                Open now
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExternalApiDocsPage() {
  const { pushToast } = useToast();
  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), []);
  const links = useMemo(
    () => [
      {
        id: "docs",
        label: "Swagger UI",
        description: "Interactive REST docs for the public Octodrop API.",
        icon: Terminal,
        url: buildDocUrl("/ext/v1/docs"),
        tone: "text-success",
      },
      {
        id: "redoc",
        label: "ReDoc",
        description: "Reference-style documentation for the same external API.",
        icon: BookOpen,
        url: buildDocUrl("/ext/v1/redoc"),
        tone: "text-info",
      },
      {
        id: "openapi",
        label: "OpenAPI JSON",
        description: "Machine-readable schema for SDKs, Postman imports, and code generation.",
        icon: FileJson,
        url: buildDocUrl("/ext/v1/openapi.json"),
        tone: "text-warning",
      },
      {
        id: "guide",
        label: "Guide",
        description: "Human-readable quickstart with auth, records, automations, and webhooks.",
        icon: Braces,
        url: buildDocUrl("/ext/v1/guide.md"),
        tone: "text-primary",
      },
      {
        id: "events",
        label: "Event Catalog",
        description: "Public webhook event names, payload envelope, and example event shapes for subscribers.",
        icon: Radio,
        url: buildDocUrl("/ext/v1/events.md"),
        tone: "text-error",
      },
    ],
    [],
  );

  async function handleCopy(value) {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      pushToast("success", "Copied link");
    } catch {
      pushToast("error", "Could not copy link");
    }
  }

  return (
    <div className="min-h-screen bg-base-200 p-4 text-base-content md:p-6">
      <div className="mx-auto max-w-6xl">
        <div className={DESKTOP_PAGE_SHELL}>
          <div className={`${DESKTOP_PAGE_SHELL_BODY} gap-5`}>
            <div className="flex flex-col gap-4 border-b border-base-300 pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/50">
                    Octodrop External API
                  </p>
                  <span className="badge badge-success badge-outline">v1</span>
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Developer documentation</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/70">
                  API reference, schema exports, webhook event docs, and implementation guidance for external systems
                  integrating with Octodrop.
                </p>
              </div>
              <div className="rounded-box border border-base-300 bg-base-200/60 p-3 text-left lg:min-w-80">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/50">API host</p>
                <p className="mt-2 break-all font-mono text-xs text-base-content/80">{apiBaseUrl || "Not configured"}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <KeyRound className="h-5 w-5 text-success" />
                  <div>
                    <p className="text-sm font-semibold">API key auth</p>
                    <p className="text-xs text-base-content/60">Use scoped `X-Api-Key` credentials.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-info" />
                  <div>
                    <p className="text-sm font-semibold">Tenant-scoped</p>
                    <p className="text-xs text-base-content/60">Records resolve inside the credential workspace.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <Radio className="h-5 w-5 text-warning" />
                  <div>
                    <p className="text-sm font-semibold">Signed webhooks</p>
                    <p className="text-xs text-base-content/60">Verify signatures and replay windows.</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Documentation endpoints</h2>
                  <p className="text-sm text-base-content/60">Open the interactive docs or copy stable backend URLs.</p>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {links.map((link) => {
                  const Icon = link.icon;
                  return (
                    <div key={link.id} className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="rounded-box bg-base-200 p-2">
                          <Icon className={`h-5 w-5 ${link.tone}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <h3 className="text-sm font-semibold">{link.label}</h3>
                              <p className="mt-1 text-sm leading-5 text-base-content/65">{link.description}</p>
                            </div>
                            <a className="btn btn-primary btn-xs gap-1" href={link.url} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                              Open
                            </a>
                          </div>
                          <div className="mt-3 flex items-center gap-2 rounded-box border border-base-300 bg-base-200/50 px-3 py-2">
                            <p className="min-w-0 flex-1 truncate font-mono text-xs text-base-content/75">{link.url}</p>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs gap-1"
                              onClick={() => handleCopy(link.url)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-box border border-base-300 bg-base-200/60 p-4">
              <h2 className="text-sm font-semibold">Deployment note</h2>
              <p className="mt-1 text-sm leading-6 text-base-content/65">
                These links resolve against the configured backend API host. If the web and API hosts differ, this page
                still sends developers to the service that owns the OpenAPI schema and webhook docs.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
