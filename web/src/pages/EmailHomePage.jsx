import React from "react";
import SettingsShell from "../ui/SettingsShell.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function EmailHomePage() {
  const { t } = useI18n();
  const categories = [
    { id: "setup", label: t("settings.email_home.categories.setup", {}, { defaultValue: "Setup" }) },
    { id: "content", label: t("settings.email_home.categories.content", {}, { defaultValue: "Content" }) },
    { id: "operations", label: t("settings.email_home.categories.operations", {}, { defaultValue: "Operations" }) },
  ];

  const blocks = [
    {
      id: "email-connections",
      category_id: "setup",
      title: t("settings.email_home.blocks.connections.title", {}, { defaultValue: "Connections" }),
      description: t("settings.email_home.blocks.connections.description", {}, { defaultValue: "Connect a provider to send email." }),
      primary: { label: t("settings.email_home.blocks.connections.primary", {}, { defaultValue: "Manage Connections" }), to_page: "/settings/email/connections" },
      keywords: ["smtp", "provider"],
    },
    {
      id: "email-templates",
      category_id: "content",
      title: t("settings.email_home.blocks.templates.title", {}, { defaultValue: "Templates" }),
      description: t("settings.email_home.blocks.templates.description", {}, { defaultValue: "Reusable email templates for automations and actions." }),
      primary: { label: t("settings.email_home.blocks.templates.primary", {}, { defaultValue: "Open Templates" }), to_page: "/settings/email-templates" },
      keywords: ["template", "content"],
    },
    {
      id: "email-outbox",
      category_id: "operations",
      title: t("settings.email_home.blocks.outbox.title", {}, { defaultValue: "Outbox" }),
      description: t("settings.email_home.blocks.outbox.description", {}, { defaultValue: "Queued, sent, and failed messages." }),
      primary: { label: t("settings.email_home.blocks.outbox.primary", {}, { defaultValue: "View Outbox" }), to_page: "/settings/email-outbox" },
      keywords: ["queue", "deliverability"],
    },
  ];

  return (
    <SettingsShell
      title={t("settings.email_home.title", {}, { defaultValue: "Email" })}
      subtitle={t("settings.email_home.subtitle", {}, { defaultValue: "Configure providers, templates, and delivery." })}
      categories={categories}
      blocks={blocks}
      searchPlaceholder={t("settings.email_home.search", {}, { defaultValue: "Search email settings..." })}
    />
  );
}
