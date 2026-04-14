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
import { useI18n } from "../i18n/LocalizationProvider.jsx";

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

function DocLinkRow({ icon: Icon, label, href, description }) {
  return (
    <a
      className="group flex items-start justify-between gap-4 rounded-box border border-base-300 bg-base-100 px-4 py-3 transition hover:border-success/50 hover:bg-base-200/40"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 shrink-0 text-success">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{label}</div>
          <div className="mt-1 text-xs leading-5 opacity-65">{description}</div>
        </div>
      </div>
      <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 opacity-35 transition group-hover:opacity-80" />
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
      <div className="mt-2 flex flex-col gap-2">
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
  const { t } = useI18n();
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
                <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-50">{t("settings.external_api_docs.badge")}</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">{label || t("settings.external_api_docs.redirecting")}</h1>
                <p className="mt-2 text-sm leading-6 opacity-70">{t("settings.external_api_docs.redirect_description")}</p>
              </div>
              <span className="badge badge-success badge-outline">v1</span>
            </div>
            <div className="mt-5 rounded-box border border-base-300 bg-base-200/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-50">{t("settings.external_api_docs.destination")}</div>
              <div className="mt-2 break-all font-mono text-sm">{url}</div>
            </div>
            <a className="btn btn-primary btn-sm mt-5 gap-2" href={url}>
              <ExternalLink className="h-4 w-4" />
              {t("settings.external_api_docs.open_now")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExternalApiDocsPage() {
  const { pushToast } = useToast();
  const { t } = useI18n();
  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), []);
  const curlExample = `curl "${apiBaseUrl || "https://api.example.com"}/ext/v1/meta/entities?limit=50" \\
  -H "X-Api-Key: octo_live_..."`;

  const links = useMemo(
    () => [
      {
        label: t("settings.external_api_docs.links.swagger.label"),
        description: t("settings.external_api_docs.links.swagger.description"),
        href: buildDocUrl("/ext/v1/docs"),
        icon: Terminal,
      },
      {
        label: t("settings.external_api_docs.links.redoc.label"),
        description: t("settings.external_api_docs.links.redoc.description"),
        href: buildDocUrl("/ext/v1/redoc"),
        icon: BookOpen,
      },
      {
        label: t("settings.external_api_docs.links.openapi.label"),
        description: t("settings.external_api_docs.links.openapi.description"),
        href: buildDocUrl("/ext/v1/openapi.json"),
        icon: FileJson,
      },
      {
        label: t("settings.external_api_docs.links.guide.label"),
        description: t("settings.external_api_docs.links.guide.description"),
        href: buildDocUrl("/ext/v1/guide.md"),
        icon: BookOpen,
      },
      {
        label: t("settings.external_api_docs.links.events.label"),
        description: t("settings.external_api_docs.links.events.description"),
        href: buildDocUrl("/ext/v1/events.md"),
        icon: Radio,
      },
    ],
    [t],
  );

  async function copy(value, label = t("settings.external_api_docs.copied")) {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      pushToast("success", label);
    } catch {
      pushToast("error", t("settings.external_api_docs.copy_failed"));
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-base-200 p-3 text-base-content sm:p-4 lg:p-6">
      <main className="mx-auto flex min-h-full max-w-5xl flex-col">
        <div className={DESKTOP_PAGE_SHELL}>
          <div className={`${DESKTOP_PAGE_SHELL_BODY} gap-4 overflow-visible pb-8`}>
            <div className="space-y-4">
              <div className="max-w-3xl">
                <span className="badge badge-success badge-outline">{t("settings.external_api_docs.version_badge")}</span>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t("settings.external_api_docs.title")}</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 opacity-70">
                  {t("settings.external_api_docs.subtitle")} <span className="font-mono text-xs">X-Api-Key</span>.
                </p>
              </div>
              <div className="rounded-box border border-base-300 bg-base-200/60 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-50">{t("settings.external_api_docs.base_url")}</div>
                <div className="mt-2 break-all font-mono text-xs leading-5">{apiBaseUrl || t("settings.external_api_docs.not_configured")}</div>
                <button
                  className="btn btn-ghost btn-xs mt-3 gap-1"
                  type="button"
                  onClick={() => copy(apiBaseUrl, t("settings.external_api_docs.base_url_copied"))}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t("settings.external_api_docs.copy_base_url")}
                </button>
              </div>
            </div>

            <section className="rounded-box border border-base-300 bg-base-100 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <BookOpen className="h-4 w-4 text-success" />
                {t("settings.external_api_docs.reference_title")}
              </div>
              <p className="mt-1 text-sm leading-6 opacity-70">
                {t("settings.external_api_docs.reference_description")}
              </p>
              <div className="mt-4 space-y-3">
              {links.map((link) => (
                  <DocLinkRow key={link.href} {...link} />
              ))}
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-box border border-base-300 bg-base-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="h-4 w-4 text-success" />
                  {t("settings.external_api_docs.contract_title")}
                </div>
                <div className="mt-4 space-y-3">
                  <DetailRow label={t("settings.external_api_docs.contract.auth_label")} value={t("settings.external_api_docs.contract.auth_value")} />
                  <DetailRow label={t("settings.external_api_docs.contract.scopes_label")} value={t("settings.external_api_docs.contract.scopes_value")} />
                  <DetailRow label={t("settings.external_api_docs.contract.rate_limits_label")} value={t("settings.external_api_docs.contract.rate_limits_value")} />
                  <DetailRow label={t("settings.external_api_docs.contract.pagination_label")} value={t("settings.external_api_docs.contract.pagination_value")} />
                  <DetailRow label={t("settings.external_api_docs.contract.webhooks_label")} value={t("settings.external_api_docs.contract.webhooks_value")} />
                  <DetailRow label={t("settings.external_api_docs.contract.errors_label")} value={t("settings.external_api_docs.contract.errors_value")} />
                </div>
              </section>

              <section className="rounded-box border border-base-300 bg-base-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Terminal className="h-4 w-4 text-success" />
                  {t("settings.external_api_docs.quickstart_title")}
                </div>
                <p className="mt-2 text-sm leading-6 opacity-70">
                  {t("settings.external_api_docs.quickstart_description")}
                </p>
                <div className="mt-4">
                  <CodeBlock>{curlExample}</CodeBlock>
                </div>
                <button
                  className="btn btn-primary btn-sm mt-3 gap-2"
                  type="button"
                  onClick={() => copy(curlExample, t("settings.external_api_docs.quickstart_copied"))}
                >
                  <Copy className="h-4 w-4" />
                  {t("common.copy")}
                </button>
              </section>
            </div>

            <section className="rounded-box border border-base-300 bg-base-100 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Database className="h-4 w-4 text-success" />
                    {t("settings.external_api_docs.surface_title")}
                  </div>
                  <p className="mt-1 text-sm leading-6 opacity-70">{t("settings.external_api_docs.surface_description")}</p>
                </div>
                <a className="btn btn-outline btn-sm gap-2" href={buildDocUrl("/ext/v1/redoc")} target="_blank" rel="noreferrer">
                  {t("settings.external_api_docs.full_reference")}
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <div className="mt-4 space-y-3">
                <EndpointRow label={t("settings.external_api_docs.endpoints.metadata")} endpoints={["GET /ext/v1/meta/entities"]} />
                <EndpointRow
                  label={t("settings.external_api_docs.endpoints.records")}
                  endpoints={[
                    "GET /ext/v1/records/{entity_id}",
                    "POST /ext/v1/records/{entity_id}",
                    "GET|PUT|PATCH|DELETE /ext/v1/records/{entity_id}/{record_id}",
                  ]}
                />
                <EndpointRow
                  label={t("settings.external_api_docs.endpoints.attachments")}
                  endpoints={[
                    "POST /ext/v1/attachments/upload",
                    "POST /ext/v1/attachments/link",
                    "GET /ext/v1/records/{entity_id}/{record_id}/attachments",
                    "GET /ext/v1/attachments/{attachment_id}/download",
                  ]}
                />
                <EndpointRow
                  label={t("settings.external_api_docs.endpoints.automations")}
                  endpoints={[
                    "GET /ext/v1/automations",
                    "POST /ext/v1/automations/{automation_id}/runs",
                    "GET /ext/v1/automation-runs/{run_id}",
                  ]}
                />
              </div>
            </section>

            <section className="rounded-box border border-base-300 bg-base-200/45 p-4">
              <div className="text-sm font-semibold">{t("settings.external_api_docs.handoff_title")}</div>
              <div className="mt-2 grid gap-2 text-sm leading-6 opacity-75 md:grid-cols-2">
                <div>{t("settings.external_api_docs.handoff_items.credential")}</div>
                <div>{t("settings.external_api_docs.handoff_items.keys")}</div>
                <div>{t("settings.external_api_docs.handoff_items.metadata")}</div>
                <div>{t("settings.external_api_docs.handoff_items.errors")}</div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
