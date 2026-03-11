import React from "react";
import useMediaQuery from "../hooks/useMediaQuery.js";

export default function Tabs({ tabs, activeId, onChange, fullWidth = false, className = "" }) {
  if (!Array.isArray(tabs) || tabs.length === 0) return null;
  const isMobile = useMediaQuery("(max-width: 768px)");
  const useEqualWidth = fullWidth && !isMobile;
  const containerClass = [
    "tabs flex-nowrap overflow-x-auto no-scrollbar",
    "tabs-boxed",
    "w-full",
    useEqualWidth ? "flex" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={containerClass}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab whitespace-nowrap ${activeId === tab.id ? "tab-active" : ""} ${useEqualWidth ? "flex-1" : "flex-none"}`}
          onClick={() => onChange?.(tab.id)}
          type="button"
          title={tab.label || tab.id}
        >
          {tab.label || tab.id}
        </button>
      ))}
    </div>
  );
}
