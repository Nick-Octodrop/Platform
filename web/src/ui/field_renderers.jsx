import React from "react";
import { getFieldInputAffixes } from "../utils/fieldFormatting.js";

export function getFieldValue(record, fieldId) {
  if (!record) return "";
  if (fieldId.endsWith(".id")) return record.id || "";
  return record[fieldId] ?? "";
}

export function setFieldValue(record, fieldId, value) {
  const next = { ...record };
  if (fieldId.endsWith(".id")) {
    next.id = value;
  } else {
    next[fieldId] = value;
  }
  return next;
}

function AutoTextarea({ value, onChange, disabled }) {
  const ref = React.useRef(null);

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 288;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  React.useEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      ref={ref}
      className="textarea textarea-bordered w-full py-3 leading-5"
      rows={1}
      style={{ minHeight: "3rem", maxHeight: "18rem", overflowY: "hidden", resize: "vertical" }}
      disabled={disabled}
      value={value}
      onInput={resize}
      onChange={(e) => {
        onChange(e.target.value);
        resize();
      }}
    />
  );
}

function normalizeEnumOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((opt) => {
    if (typeof opt === "string") {
      return { value: opt, label: opt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) };
    }
    if (opt && typeof opt === "object") {
      const value = opt.value ?? opt.id ?? opt.key;
      const label = opt.label ?? opt.value ?? opt.id ?? opt.key;
      return { value, label };
    }
    return null;
  }).filter(Boolean);
}

export function renderField(field, value, onChange, readonly, record = null) {
  const common = {
    className: "input input-bordered w-full",
    disabled: readonly || field.readonly,
  };

  switch (field.type) {
    case "string":
      return (
        <input
          {...common}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "text":
      return (
        <AutoTextarea
          value={value || ""}
          onChange={onChange}
          disabled={readonly || field.readonly}
        />
      );
    case "enum":
      if (field?.ui?.widget === "steps") {
        const options = normalizeEnumOptions(field.options);
        return (
          <ul className="steps steps-horizontal w-full">
            {options.map((opt) => {
              const isActive = value === opt.value;
              const canClick = !(readonly || field.readonly);
              return (
                <li
                  key={opt.value}
                  className={`step ${isActive ? "step-primary" : ""}`}
                  onClick={() => {
                    if (canClick) onChange(opt.value);
                  }}
                >
                  {opt.label ?? opt.value}
                </li>
              );
            })}
          </ul>
        );
      }
      const options = normalizeEnumOptions(field.options);
      const selected = options.find((opt) => opt.value === value);
      const selectedLabel = selected?.label ?? selected?.value ?? "Select";
      const isDisabled = readonly || field.readonly;
      return (
        <div className={`dropdown dropdown-bottom w-full ${isDisabled ? "pointer-events-none opacity-60" : ""}`}>
          <label
            tabIndex={0}
            className="input input-bordered w-full flex items-center justify-between cursor-pointer"
            aria-disabled={isDisabled}
          >
            <span className="truncate">{selectedLabel}</span>
            <span className="opacity-60 pointer-events-none">▾</span>
          </label>
          <ul tabIndex={0} className="dropdown-content menu menu-compact menu-vertical p-2 shadow bg-base-100 rounded-box w-full max-h-60 overflow-auto z-30">
            {options.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  className={opt.value === value ? "active" : ""}
                  onClick={(event) => {
                    onChange(opt.value);
                    const dropdown = event.currentTarget.closest(".dropdown");
                    const trigger = dropdown?.querySelector('[tabindex="0"]');
                    trigger?.blur();
                    if (document.activeElement instanceof HTMLElement) {
                      document.activeElement.blur();
                    }
                  }}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    case "date":
      return (
        <input
          {...common}
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "datetime": {
      const formatted = typeof value === "string" && value.includes("T") ? value.slice(0, 16) : value || "";
      return (
        <input
          {...common}
          type="datetime-local"
          value={formatted}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    case "number":
      {
        const { prefix, suffix, align } = getFieldInputAffixes(field, record);
        const leftPad = prefix ? `${Math.max(3.2, prefix.length * 0.6 + 1.4)}rem` : undefined;
        const rightPad = suffix ? `${Math.max(3.2, suffix.length * 0.6 + 1.4)}rem` : undefined;
        return (
          <div className="relative">
            {prefix ? (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm opacity-60 pointer-events-none">
                {prefix}
              </span>
            ) : null}
            <input
              {...common}
              type="number"
              className={`${common.className} ${align}`.trim()}
              style={{
                paddingLeft: leftPad,
                paddingRight: rightPad,
              }}
              value={value ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                if (next === "") {
                  onChange("");
                  return;
                }
                const parsed = Number(next);
                onChange(Number.isNaN(parsed) ? "" : parsed);
              }}
            />
            {suffix ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm opacity-60 pointer-events-none">
                {suffix}
              </span>
            ) : null}
          </div>
        );
      }
    case "tags":
      return (
        <input
          {...common}
          value={Array.isArray(value) ? value.join(", ") : value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="comma separated"
        />
      );
    case "user":
      return (
        <input
          {...common}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="user id"
        />
      );
    case "users":
      return (
        <input
          {...common}
          value={Array.isArray(value) ? value.join(", ") : value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="comma separated user ids"
        />
      );
    case "bool":
    case "boolean":
      return (
        <input
          className="checkbox"
          type="checkbox"
          disabled={readonly || field.readonly}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "uuid":
      return (
        <input
          {...common}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return <div className="text-sm text-error">Unknown field type: {field.type}</div>;
  }
}
