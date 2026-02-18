import React from "react";
import SettingsShell from "../ui/SettingsShell.jsx";

export default function EmailHomePage() {
  const categories = [
    { id: "setup", label: "Setup" },
    { id: "content", label: "Content" },
    { id: "operations", label: "Operations" },
  ];

  const blocks = [
    {
      id: "email-connections",
      category_id: "setup",
      title: "Connections",
      description: "Connect a provider to send email.",
      primary: { label: "Manage Connections", to_page: "/settings/email/connections" },
      keywords: ["smtp", "provider"],
    },
    {
      id: "email-templates",
      category_id: "content",
      title: "Templates",
      description: "Reusable email templates for automations and actions.",
      primary: { label: "Open Templates", to_page: "/settings/email-templates" },
      keywords: ["template", "content"],
    },
    {
      id: "email-outbox",
      category_id: "operations",
      title: "Outbox",
      description: "Queued, sent, and failed messages.",
      primary: { label: "View Outbox", to_page: "/settings/email-outbox" },
      keywords: ["queue", "deliverability"],
    },
  ];

  return (
    <SettingsShell
      title="Email"
      subtitle="Configure providers, templates, and delivery."
      categories={categories}
      blocks={blocks}
      searchPlaceholder="Search email settings…"
    />
  );
}
