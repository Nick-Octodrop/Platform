import React from "react";
import SettingsShell from "../ui/SettingsShell.jsx";
import { useAccessContext } from "../access.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function SettingsPage() {
  const { t } = useI18n();
  const { hasCapability, isSuperadmin } = useAccessContext();
  const wiredPages = new Set([
    "/settings/settings",
    "/settings/password",
    "/settings/users",
    "/settings/access-policies",
    "/settings/workspaces",
    "/studio",
    "/integrations",
    "/automations",
    "/settings/secrets",
    "/settings/document-numbering",
    "/settings/api-credentials",
    "/settings/webhook-subscriptions",
    "/settings/email",
    "/settings/email/connections",
    "/settings/email-templates",
    "/settings/email-outbox",
    "/settings/documents",
    "/settings/documents/templates",
    "/ops",
    "/settings/diagnostics",
    "/settings/security",
  ]);
  const placeholderPages = new Set([
  ]);

  const categories = [
    { id: "general", label: t("settings.index.categories.general") },
    { id: "users", label: t("settings.index.categories.users") },
    ...(isSuperadmin ? [{ id: "security", label: t("settings.index.categories.security") }] : []),
    { id: "email", label: t("settings.index.categories.email") },
    { id: "documents", label: t("settings.index.categories.documents") },
    { id: "automations", label: t("settings.index.categories.automations") },
    { id: "developer", label: t("settings.index.categories.developer") },
  ];

  const blocks = [
    {
      id: "settings",
      category_id: "general",
      title: t("settings.index.blocks.settings.title"),
      description: t("settings.index.blocks.settings.description"),
      primary: { label: t("settings.index.blocks.settings.primary"), to_page: "/settings/settings?tab=profile" },
      keywords: ["theme", "profile", "account", "password", "preferences"],
    },
    {
      id: "users",
      category_id: "users",
      title: t("settings.index.blocks.users.title"),
      description: t("settings.index.blocks.users.description"),
      primary: { label: t("settings.index.blocks.users.primary"), to_page: "/settings/users" },
      keywords: ["roles", "permissions", "access"],
      required_capability: "workspace.manage_members",
    },
    {
      id: "access-policies",
      category_id: "users",
      title: t("settings.index.blocks.access_policies.title"),
      description: t("settings.index.blocks.access_policies.description"),
      primary: { label: t("settings.index.blocks.access_policies.primary"), to_page: "/settings/access-policies" },
      keywords: ["profiles", "policies", "field access", "app visibility"],
      required_capability: "workspace.manage_members",
    },
    {
      id: "security",
      category_id: "security",
      title: t("settings.index.blocks.security.title"),
      description: t("settings.index.blocks.security.description"),
      primary: { label: t("settings.index.blocks.security.primary"), to_page: "/settings/security" },
      keywords: ["alerts", "monitoring", "security", "webhooks", "audit", "superadmin"],
      superadmin_only: true,
    },
    {
      id: "workspaces",
      category_id: "users",
      title: t("settings.index.blocks.workspaces.title"),
      description: t("settings.index.blocks.workspaces.description"),
      primary: { label: t("settings.index.blocks.workspaces.primary"), to_page: "/settings/workspaces" },
      keywords: ["org", "members"],
      required_capability: "workspace.manage_settings",
    },
    {
      id: "email-connections",
      category_id: "email",
      title: t("settings.index.blocks.email_connections.title"),
      description: t("settings.index.blocks.email_connections.description"),
      primary: { label: t("settings.index.blocks.email_connections.primary"), to_page: "/settings/email/connections" },
      keywords: ["smtp", "provider"],
      required_capability: "templates.manage",
    },
    {
      id: "email-templates",
      category_id: "email",
      title: t("settings.index.blocks.email_templates.title"),
      description: t("settings.index.blocks.email_templates.description"),
      primary: { label: t("settings.index.blocks.email_templates.primary"), to_page: "/settings/email-templates" },
      keywords: ["template", "content"],
      required_capability: "templates.manage",
    },
    {
      id: "email-outbox",
      category_id: "email",
      title: t("settings.index.blocks.email_outbox.title"),
      description: t("settings.index.blocks.email_outbox.description"),
      primary: { label: t("settings.index.blocks.email_outbox.primary"), to_page: "/settings/email-outbox" },
      keywords: ["outbox", "deliverability", "queue"],
      required_capability: "templates.manage",
    },
    {
      id: "documents-templates",
      category_id: "documents",
      title: t("settings.index.blocks.documents_templates.title"),
      description: t("settings.index.blocks.documents_templates.description"),
      primary: { label: t("settings.index.blocks.documents_templates.primary"), to_page: "/settings/documents/templates" },
      keywords: ["pdf", "html", "template"],
      required_capability: "templates.manage",
    },
    {
      id: "document-numbering",
      category_id: "documents",
      title: t("settings.index.blocks.document_numbering.title"),
      description: t("settings.index.blocks.document_numbering.description"),
      primary: { label: t("settings.index.blocks.document_numbering.primary"), to_page: "/settings/document-numbering" },
      keywords: ["document numbers", "sequences", "quotes", "invoice numbers"],
      required_capability: "workspace.manage_settings",
    },
    {
      id: "automations",
      category_id: "automations",
      title: t("settings.index.blocks.automations.title"),
      description: t("settings.index.blocks.automations.description"),
      primary: { label: t("settings.index.blocks.automations.primary"), to_page: "/automations" },
      keywords: ["automation", "triggers", "runs", "workflow"],
      required_capability: "automations.manage",
    },
    {
      id: "integrations",
      category_id: "automations",
      title: t("settings.index.blocks.integrations.title"),
      description: t("settings.index.blocks.integrations.description"),
      primary: { label: t("settings.index.blocks.integrations.primary"), to_page: "/integrations" },
      keywords: ["providers", "connections", "oauth", "sync", "webhooks"],
      required_capability: "workspace.manage_settings",
    },
    {
      id: "jobs",
      category_id: "automations",
      title: t("settings.index.blocks.jobs.title"),
      description: t("settings.index.blocks.jobs.description"),
      primary: { label: t("settings.index.blocks.jobs.primary"), to_page: "/ops" },
      keywords: ["jobs", "queues", "workers"],
      required_capability: "automations.manage",
    },
    {
      id: "studio",
      category_id: "developer",
      title: t("settings.index.blocks.studio.title"),
      description: t("settings.index.blocks.studio.description"),
      primary: { label: t("settings.index.blocks.studio.primary"), to_page: "/studio" },
      keywords: ["manifests", "builder", "modules", "schema"],
      required_capability: "modules.manage",
    },
    {
      id: "api-credentials",
      category_id: "developer",
      title: t("settings.index.blocks.api_credentials.title"),
      description: t("settings.index.blocks.api_credentials.description"),
      primary: { label: t("settings.index.blocks.api_credentials.primary"), to_page: "/settings/api-credentials" },
      keywords: ["api", "keys", "external", "integration"],
      required_capability: "workspace.manage_settings",
    },
    {
      id: "webhook-subscriptions",
      category_id: "developer",
      title: t("settings.index.blocks.webhook_subscriptions.title"),
      description: t("settings.index.blocks.webhook_subscriptions.description"),
      primary: { label: t("settings.index.blocks.webhook_subscriptions.primary"), to_page: "/settings/webhook-subscriptions" },
      keywords: ["webhooks", "events", "callbacks"],
      required_capability: "workspace.manage_settings",
    },
    {
      id: "secrets",
      category_id: "developer",
      title: t("settings.index.blocks.secrets.title"),
      description: t("settings.index.blocks.secrets.description"),
      primary: { label: t("settings.index.blocks.secrets.primary"), to_page: "/settings/secrets" },
      keywords: ["keys", "tokens"],
      required_capability: "workspace.manage_settings",
    },
    {
      id: "diagnostics",
      category_id: "developer",
      title: t("settings.index.blocks.diagnostics.title"),
      description: t("settings.index.blocks.diagnostics.description"),
      primary: { label: t("settings.index.blocks.diagnostics.primary"), to_page: "/settings/diagnostics" },
      keywords: ["perf", "health"],
      required_capability: "workspace.manage_settings",
    },
  ].map((block) => ({
    ...block,
    wired: (() => {
      const raw = block?.primary?.to_page || "";
      const path = String(raw).split("?")[0].split("#")[0];
      return wiredPages.has(path) && !placeholderPages.has(path);
    })(),
  }))
    // Deny-by-default: don't render privileged settings blocks until access context loads.
    .filter((block) => !block.superadmin_only || isSuperadmin)
    .filter((block) => !block.required_capability || hasCapability(block.required_capability));

  return (
    <div className="h-full min-h-0">
      <SettingsShell
        title={t("settings.index.title")}
        categories={categories}
        blocks={blocks}
      />
    </div>
  );
}
