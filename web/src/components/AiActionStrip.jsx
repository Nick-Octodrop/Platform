import React from "react";

function buttonClass(action) {
  if (action?.primary) return "btn btn-sm btn-primary";
  if (action?.tone === "error") return "btn btn-sm btn-error";
  if (action?.outline) return "btn btn-sm btn-outline";
  return "btn btn-sm";
}

export default function AiActionStrip({
  title = "",
  actions = [],
  busy = false,
  compact = false,
}) {
  const visible = Array.isArray(actions)
    ? actions.filter((item) => item && item.label && typeof item.onClick === "function")
    : [];
  if (!visible.length) return null;
  return (
    <div className={`rounded-box border border-base-200 bg-base-200 ${compact ? "px-2.5 py-2" : "px-3 py-2.5"}`}>
      {title ? <div className="mb-2 text-[10px] uppercase tracking-wide opacity-60">{title}</div> : null}
      <div className="flex flex-wrap gap-2">
        {visible.map((action) => (
          <button
            key={action.key || action.id || action.label}
            type="button"
            className={buttonClass(action)}
            disabled={Boolean(action.disabled || (busy && action.allowWhileBusy !== true))}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
