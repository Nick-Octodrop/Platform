import React, { useMemo } from "react";

function extractNodeText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (React.isValidElement(node)) return extractNodeText(node.props?.children);
  return "";
}

function flattenOptions(children, groupLabel = "") {
  const items = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      items.push(...flattenOptions(child.props.children, groupLabel));
      return;
    }
    if (child.type === "optgroup") {
      const label = String(child.props?.label || "").trim();
      items.push(...flattenOptions(child.props?.children, label));
      return;
    }
    if (child.type === "option") {
      const value = child.props?.value ?? "";
      const label = extractNodeText(child.props?.children).trim();
      items.push({
        value: String(value),
        label: label || String(value || ""),
        disabled: Boolean(child.props?.disabled),
        groupLabel,
      });
    }
  });
  return items;
}

function normalizeTriggerClassName(className = "") {
  return className
    .replace(/\bselect-bordered\b/g, "input-bordered")
    .replace(/\bselect-ghost\b/g, "input-ghost")
    .replace(/\bselect-primary\b/g, "input-primary")
    .replace(/\bselect-secondary\b/g, "input-secondary")
    .replace(/\bselect-accent\b/g, "input-accent")
    .replace(/\bselect-info\b/g, "input-info")
    .replace(/\bselect-success\b/g, "input-success")
    .replace(/\bselect-warning\b/g, "input-warning")
    .replace(/\bselect-error\b/g, "input-error")
    .replace(/\bselect-xs\b/g, "input-xs")
    .replace(/\bselect-sm\b/g, "input-sm")
    .replace(/\bselect-md\b/g, "input-md")
    .replace(/\bselect-lg\b/g, "input-lg")
    .replace(/\bselect\b/g, "input")
    .trim();
}

export default function AppSelect({
  children,
  value,
  onChange,
  className = "select select-bordered",
  disabled = false,
  placeholder = "",
  name,
  id,
  "aria-label": ariaLabel,
  title,
}) {
  const options = useMemo(() => flattenOptions(children), [children]);
  const normalizedValue = value == null ? "" : String(value);
  const selected = options.find((option) => option.value === normalizedValue) || null;
  const triggerClassName = useMemo(
    () => `${normalizeTriggerClassName(className)} w-full flex items-center justify-between cursor-pointer`,
    [className]
  );
  const groupedOptions = useMemo(() => {
    const groups = [];
    let currentGroup = "__default__";
    for (const option of options) {
      const groupKey = option.groupLabel || "__default__";
      if (groupKey !== currentGroup) {
        currentGroup = groupKey;
        groups.push({ label: option.groupLabel, items: [] });
      } else if (groups.length === 0) {
        groups.push({ label: option.groupLabel, items: [] });
      }
      groups[groups.length - 1].items.push(option);
    }
    return groups;
  }, [options]);

  function emitChange(nextValue) {
    onChange?.({
      target: {
        value: nextValue,
        name,
        id,
      },
      currentTarget: {
        value: nextValue,
        name,
        id,
      },
    });
  }

  return (
    <div className={`dropdown dropdown-bottom w-full ${disabled ? "pointer-events-none opacity-60" : ""}`}>
      <button
        type="button"
        tabIndex={0}
        id={id}
        aria-label={ariaLabel}
        title={title}
        className={triggerClassName}
        aria-disabled={disabled}
      >
        <span className="truncate text-left">
          {selected?.label || placeholder || options[0]?.label || "Select"}
        </span>
        <span className="pointer-events-none opacity-60">▾</span>
      </button>
      <ul
        tabIndex={0}
        className="dropdown-content menu menu-compact menu-vertical block w-full max-h-72 overflow-y-auto overflow-x-hidden whitespace-normal rounded-box border border-base-300 bg-base-100 p-2 shadow z-[220]"
      >
        {groupedOptions.map((group, groupIndex) => (
          <React.Fragment key={`group-${group.label || "default"}-${groupIndex}`}>
            {group.label ? (
              <li className="menu-title">
                <span className="whitespace-normal break-words">{group.label}</span>
              </li>
            ) : null}
            {group.items.map((option) => (
              <li key={`${group.label || "default"}-${option.value}`} className="block">
                <button
                  type="button"
                  disabled={option.disabled}
                  className={`${option.value === normalizedValue ? "active" : ""} w-full justify-start whitespace-normal break-words text-left`}
                  onClick={(event) => {
                    emitChange(option.value);
                    const dropdown = event.currentTarget.closest(".dropdown");
                    const trigger = dropdown?.querySelector('[tabindex="0"]');
                    trigger?.blur();
                    if (document.activeElement instanceof HTMLElement) {
                      document.activeElement.blur();
                    }
                  }}
                >
                  <span className="whitespace-normal break-words">{option.label}</span>
                </button>
              </li>
            ))}
          </React.Fragment>
        ))}
      </ul>
    </div>
  );
}
