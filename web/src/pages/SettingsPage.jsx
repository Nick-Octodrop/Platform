import React from "react";
import SettingsShell from "../ui/SettingsShell.jsx";
import { useAccessContext } from "../access.js";

export default function SettingsPage() {
  const { loading, hasCapability } = useAccessContext();
  const wiredPages = new Set([
    "/settings/settings",
    "/settings/password",
    "/settings/users",
    "/settings/workspaces",
    "/settings/secrets",
    "/settings/email",
    "/settings/email/connections",
    "/settings/email-templates",
    "/settings/email-outbox",
    "/settings/documents",
    "/settings/documents/templates",
    "/ops",
    "/settings/diagnostics",
  ]);
  const placeholderPages = new Set([
  ]);

  const categories = [
    { id: "general", label: "General" },
    { id: "users", label: "Users & Access" },
    { id: "email", label: "Email" },
    { id: "documents", label: "Documents" },
    { id: "automations", label: "Automations" },
    { id: "developer", label: "Developer" },
  ];

  const blocks = [
    {
      id: "settings",
      category_id: "general",
      title: "Profile",
      description: "Password, theme, preferences, and profile details.",
      primary: { label: "Open Profile", to_page: "/settings/settings?tab=profile" },
      keywords: ["theme", "profile", "account", "password", "preferences"],
    },
    {
      id: "users",
      category_id: "users",
      title: "Users & Roles",
      description: "Manage users, roles, and access policies.",
      primary: { label: "Manage Users", to_page: "/settings/users" },
      keywords: ["roles", "permissions", "access"],
      required_capability: "workspace.manage_members",
    },
    {
      id: "workspaces",
      category_id: "users",
      title: "Workspaces",
      description: "Org workspaces and memberships.",
      primary: { label: "Open Workspaces", to_page: "/settings/workspaces" },
      keywords: ["org", "members"],
      required_capability: "workspace.manage_settings",
    },
    {
      id: "email-connections",
      category_id: "email",
      title: "Email Connections",
      description: "Connect providers to send email.",
      primary: { label: "Manage Connections", to_page: "/settings/email/connections" },
      keywords: ["smtp", "provider"],
      required_capability: "templates.manage",
    },
    {
      id: "email-templates",
      category_id: "email",
      title: "Email Templates",
      description: "Reusable email templates for automations.",
      primary: { label: "Open Templates", to_page: "/settings/email-templates" },
      keywords: ["template", "content"],
      required_capability: "templates.manage",
    },
    {
      id: "email-outbox",
      category_id: "email",
      title: "Email Outbox",
      description: "Queued, sent, and failed messages.",
      primary: { label: "View Outbox", to_page: "/settings/email-outbox" },
      keywords: ["outbox", "deliverability", "queue"],
      required_capability: "templates.manage",
    },
    {
      id: "documents-templates",
      category_id: "documents",
      title: "Document Templates",
      description: "HTML → PDF templates with placeholders.",
      primary: { label: "Open Templates", to_page: "/settings/documents/templates" },
      keywords: ["pdf", "html", "template"],
      required_capability: "templates.manage",
    },
    {
      id: "jobs",
      category_id: "automations",
      title: "Jobs / Ops",
      description: "Background jobs and worker health.",
      primary: { label: "Open Ops", to_page: "/ops" },
      keywords: ["jobs", "queues", "workers"],
      required_capability: "automations.manage",
    },
    {
      id: "secrets",
      category_id: "developer",
      title: "Secrets",
      description: "Environment secrets and integrations.",
      primary: { label: "Manage Secrets", to_page: "/settings/secrets" },
      keywords: ["keys", "tokens"],
      required_capability: "workspace.manage_settings",
    },
    {
      id: "diagnostics",
      category_id: "developer",
      title: "Diagnostics",
      description: "System health checks and perf diagnostics.",
      primary: { label: "Open Diagnostics", to_page: "/settings/diagnostics" },
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
    .filter((block) => !block.required_capability || hasCapability(block.required_capability));

  return (
    <div className="h-full min-h-0">
      <SettingsShell
        title="Settings"
        categories={categories}
        blocks={blocks}
      />
    </div>
  );
}
