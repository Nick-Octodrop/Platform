import React from "react";
import SettingsShell from "../ui/SettingsShell.jsx";

export default function SettingsPage() {
  const wiredPages = new Set([
    "/settings/preferences",
    "/studio",
    "/settings/users",
    "/settings/workspaces",
    "/settings/email",
    "/settings/email/connections",
    "/settings/email-templates",
    "/settings/email-outbox",
    "/settings/email/diagnostics",
    "/settings/documents",
    "/settings/documents/templates",
    "/ops",
    "/automations",
    "/data",
    "/settings/diagnostics",
  ]);
  const placeholderPages = new Set([
    "/settings/email/connections",
    "/settings/email/diagnostics",
    "/settings/documents/defaults",
    "/settings/secrets",
  ]);

  const categories = [
    { id: "general", label: "General" },
    { id: "modules", label: "Modules" },
    { id: "users", label: "Users & Access" },
    { id: "email", label: "Email" },
    { id: "documents", label: "Documents" },
    { id: "automations", label: "Automations" },
    { id: "developer", label: "Developer" },
  ];

  const blocks = [
    {
      id: "preferences",
      category_id: "general",
      title: "Preferences",
      description: "Theme, developer mode, and account profile.",
      primary: { label: "Open Preferences", to_page: "/settings/preferences" },
      keywords: ["theme", "profile", "account", "developer"],
    },
    {
      id: "studio",
      category_id: "modules",
      title: "Studio",
      description: "Create and manage custom modules.",
      primary: { label: "Open Studio", to_page: "/studio" },
      keywords: ["modules", "builder", "studio"],
    },
    {
      id: "users",
      category_id: "users",
      title: "Users & Roles",
      description: "Manage users, roles, and access policies.",
      primary: { label: "Manage Users", to_page: "/settings/users" },
      keywords: ["roles", "permissions", "access"],
    },
    {
      id: "workspaces",
      category_id: "users",
      title: "Workspaces",
      description: "Org workspaces and memberships.",
      primary: { label: "Open Workspaces", to_page: "/settings/workspaces" },
      keywords: ["org", "members"],
    },
    {
      id: "email-connections",
      category_id: "email",
      title: "Email Connections",
      description: "Connect providers to send email.",
      primary: { label: "Manage Connections", to_page: "/settings/email/connections" },
      keywords: ["smtp", "provider"],
    },
    {
      id: "email-templates",
      category_id: "email",
      title: "Email Templates",
      description: "Reusable email templates for automations.",
      primary: { label: "Open Templates", to_page: "/settings/email-templates" },
      keywords: ["template", "content"],
    },
    {
      id: "email-outbox",
      category_id: "email",
      title: "Email Outbox",
      description: "Queued, sent, and failed messages.",
      primary: { label: "View Outbox", to_page: "/settings/email-outbox" },
      keywords: ["outbox", "deliverability", "queue"],
    },
    {
      id: "email-diagnostics",
      category_id: "email",
      title: "Email Diagnostics",
      description: "Connection status and recent failures.",
      primary: { label: "Open Diagnostics", to_page: "/settings/email/diagnostics" },
      keywords: ["health", "status", "smtp"],
    },
    {
      id: "documents-templates",
      category_id: "documents",
      title: "Document Templates",
      description: "HTML → PDF templates with placeholders.",
      primary: { label: "Open Templates", to_page: "/settings/documents/templates" },
      keywords: ["pdf", "html", "template"],
    },
    {
      id: "documents-defaults",
      category_id: "documents",
      title: "Document Defaults",
      description: "Naming rules and attachment behavior.",
      primary: { label: "Configure Defaults", to_page: "/settings/documents/defaults" },
      keywords: ["defaults", "naming"],
    },
    {
      id: "jobs",
      category_id: "automations",
      title: "Jobs / Ops",
      description: "Background jobs and worker health.",
      primary: { label: "Open Ops", to_page: "/ops" },
      keywords: ["jobs", "queues", "workers"],
    },
    {
      id: "automations",
      category_id: "automations",
      title: "Automations",
      description: "Design and monitor automation workflows.",
      primary: { label: "Open Automations", to_page: "/automations" },
      keywords: ["workflow", "runs"],
    },
    {
      id: "secrets",
      category_id: "developer",
      title: "Secrets",
      description: "Environment secrets and integrations.",
      primary: { label: "Manage Secrets", to_page: "/settings/secrets" },
      keywords: ["keys", "tokens"],
    },
    {
      id: "data-explorer",
      category_id: "developer",
      title: "Data Explorer",
      description: "Browse entities and records.",
      primary: { label: "Open Data", to_page: "/data" },
      keywords: ["entities", "records"],
    },
    {
      id: "diagnostics",
      category_id: "developer",
      title: "Diagnostics",
      description: "System health checks and perf diagnostics.",
      primary: { label: "Open Diagnostics", to_page: "/settings/diagnostics" },
      keywords: ["perf", "health"],
    },
  ].map((block) => ({
    ...block,
    wired: wiredPages.has(block?.primary?.to_page) && !placeholderPages.has(block?.primary?.to_page),
  }));

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
