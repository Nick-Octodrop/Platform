import React from "react";
import SettingsShell from "../ui/SettingsShell.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function DocumentsHomePage() {
  const { t } = useI18n();
  const categories = [
    { id: "content", label: t("settings.documents_home.categories.content", {}, { defaultValue: "Content" }) },
  ];

  const blocks = [
    {
      id: "docs-templates",
      category_id: "content",
      title: t("settings.documents_home.blocks.templates.title", {}, { defaultValue: "Templates" }),
      description: t("settings.documents_home.blocks.templates.description", {}, { defaultValue: "HTML to PDF templates with placeholders." }),
      primary: { label: t("settings.documents_home.blocks.templates.primary", {}, { defaultValue: "Open Templates" }), to_page: "/settings/documents/templates" },
      keywords: ["template", "pdf", "html"],
    },
  ];

  return (
    <SettingsShell
      title={t("settings.documents_home.title", {}, { defaultValue: "Documents" })}
      subtitle={t("settings.documents_home.subtitle", {}, { defaultValue: "Templates." })}
      categories={categories}
      blocks={blocks}
      searchPlaceholder={t("settings.documents_home.search", {}, { defaultValue: "Search documents settings..." })}
    />
  );
}
