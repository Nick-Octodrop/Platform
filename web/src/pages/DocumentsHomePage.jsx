import React from "react";
import SettingsShell from "../ui/SettingsShell.jsx";

export default function DocumentsHomePage() {
  const categories = [
    { id: "content", label: "Content" },
  ];

  const blocks = [
    {
      id: "docs-templates",
      category_id: "content",
      title: "Templates",
      description: "HTML → PDF templates with placeholders.",
      primary: { label: "Open Templates", to_page: "/settings/documents/templates" },
      keywords: ["template", "pdf", "html"],
    },
  ];

  return (
    <SettingsShell
      title="Documents"
      subtitle="Templates."
      categories={categories}
      blocks={blocks}
      searchPlaceholder="Search documents settings…"
    />
  );
}
