import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PRIMARY_BUTTON_SM } from "../components/buttonStyles.js";
import SystemListToolbar from "./SystemListToolbar.jsx";

export default function SettingsShell({
  title,
  categories = [],
  blocks = [],
}) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const navCategories = useMemo(() => {
    return [{ id: "all", label: "All" }, ...categories];
  }, [categories]);
  const toolbarFilters = useMemo(
    () => navCategories.map((cat) => ({ id: cat.id, label: cat.label })),
    [navCategories]
  );

  const filteredBlocks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return blocks.filter((block) => {
      if (activeCategory !== "all" && block.category_id !== activeCategory) {
        return false;
      }
      if (!needle) return true;
      const keywords = Array.isArray(block.keywords) ? block.keywords.join(" ") : "";
      const haystack = `${block.title || ""} ${block.description || ""} ${keywords}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [blocks, activeCategory, query]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="card bg-base-100 border border-base-300 shadow-sm h-full min-h-0 flex flex-col overflow-hidden">
        <div className="card-body flex flex-col min-h-0">
          <div className="shrink-0">
            <SystemListToolbar
              title={title}
              searchValue={query}
              onSearchChange={setQuery}
              filters={toolbarFilters}
              onFilterChange={setActiveCategory}
              onClearFilters={() => setActiveCategory("all")}
              onRefresh={() => {}}
              showListToggle={false}
            />
          </div>
          <div className="mt-4 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {filteredBlocks.length === 0 ? (
              <div className="text-sm opacity-60">No settings match your search.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredBlocks.map((block) => (
                  <div
                    key={block.id}
                    className={`border rounded-box p-4 bg-base-100 shadow-sm flex flex-col min-h-[140px] ${
                      block.wired === false ? "border-warning/40" : "border-base-200"
                    }`}
                  >
                    <div className="text-base font-semibold">{block.title}</div>
                    {block.description && (
                      <div className="text-sm opacity-70 mt-1">{block.description}</div>
                    )}
                    {block.wired === false && (
                      <div className="mt-2">
                        <span className="badge badge-warning badge-sm">Not wired</span>
                      </div>
                    )}
                    <div className="mt-auto pt-4 flex items-center gap-3">
                      {block.wired === false ? (
                        <button className={`${PRIMARY_BUTTON_SM} btn-disabled`} type="button" disabled>
                          {block.primary?.label || "Open"}
                        </button>
                      ) : (
                        <Link className={PRIMARY_BUTTON_SM} to={block.primary.to_page}>
                          {block.primary.label}
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
