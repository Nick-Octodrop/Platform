import React, { useEffect, useMemo } from "react";
import { API_URL } from "../api.js";
import { useToast } from "../components/Toast.jsx";

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
    <div className="min-h-screen bg-base-200 px-4 py-10 text-base-content">
      <div className="mx-auto max-w-2xl rounded-2xl border border-base-300 bg-base-100 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/50">External API</p>
        <h1 className="mt-2 text-2xl font-semibold">{label || "Redirecting"}</h1>
        <p className="mt-3 text-sm leading-6 text-base-content/70">
          This app URL is a frontend shell, so the browser is being redirected to the backend API host for the
          external docs.
        </p>
        <div className="mt-5 rounded-xl border border-base-300 bg-base-200/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/50">Destination</p>
          <p className="mt-2 break-all font-mono text-sm">{url}</p>
        </div>
        <div className="mt-5">
          <a className="btn btn-primary btn-sm" href={url}>
            Open now
          </a>
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
        url: buildDocUrl("/ext/v1/docs"),
      },
      {
        id: "redoc",
        label: "ReDoc",
        description: "Reference-style documentation for the same external API.",
        url: buildDocUrl("/ext/v1/redoc"),
      },
      {
        id: "openapi",
        label: "OpenAPI JSON",
        description: "Machine-readable schema for SDKs, Postman imports, and code generation.",
        url: buildDocUrl("/ext/v1/openapi.json"),
      },
      {
        id: "guide",
        label: "Guide",
        description: "Human-readable quickstart with auth, records, automations, and webhooks.",
        url: buildDocUrl("/ext/v1/guide.md"),
      },
    ],
    [],
  );

  async function handleCopy(value) {
    try {
      await navigator.clipboard.writeText(value);
      pushToast("success", "Copied link");
    } catch {
      pushToast("error", "Could not copy link");
    }
  }

  return (
    <div className="min-h-screen bg-base-200 px-4 py-10 text-base-content">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-3xl border border-base-300 bg-base-100 p-6 shadow-sm sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/50">Octodrop External API</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Public developer docs</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-base-content/70 sm:text-base">
            The `app.octodrop.com` host is your frontend application. The actual API docs live on the configured backend
            API host, so this page resolves the correct URLs and links you there directly.
          </p>
          <div className="mt-6 rounded-2xl border border-base-300 bg-base-200/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/50">Resolved API host</p>
            <p className="mt-2 break-all font-mono text-sm">{apiBaseUrl}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {links.map((link) => (
            <div key={link.id} className="rounded-2xl border border-base-300 bg-base-100 p-5 shadow-sm">
              <h2 className="text-lg font-semibold">{link.label}</h2>
              <p className="mt-2 text-sm leading-6 text-base-content/70">{link.description}</p>
              <div className="mt-4 rounded-xl border border-base-300 bg-base-200/60 p-3">
                <p className="break-all font-mono text-xs sm:text-sm">{link.url}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a className="btn btn-primary btn-sm" href={link.url} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleCopy(link.url)}>
                  Copy URL
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-base-300 bg-base-100 p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Why the old links bounced home</h2>
          <p className="mt-2 text-sm leading-6 text-base-content/70">
            When you opened `/ext/v1/docs` on the app host, the SPA router handled that path first and sent you back
            into the logged-in app. The links above go to the backend API host directly instead.
          </p>
        </div>
      </div>
    </div>
  );
}
