import React from "react";

export default function Tabs({ tabs, activeId, onChange, fullWidth = false, className = "" }) {
  if (!Array.isArray(tabs) || tabs.length === 0) return null;
  const containerClass = [
    "tabs",
    "tabs-boxed",
    fullWidth ? "w-full flex" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={containerClass}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${activeId === tab.id ? "tab-active" : ""} ${fullWidth ? "flex-1" : ""}`}
          onClick={() => onChange?.(tab.id)}
          type="button"
        >
          {tab.label || tab.id}
        </button>
      ))}
    </div>
  );
}
