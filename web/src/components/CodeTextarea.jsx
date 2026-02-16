import React, { useMemo, useState } from "react";

export default function CodeTextarea({
  value,
  onChange,
  className = "",
  textareaClassName = "",
  placeholder,
  readOnly = false,
  minHeight = "200px",
  fill = false,
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const lines = useMemo(() => String(value || "").split("\n").length, [value]);

  return (
    <div
      className={`border border-base-200 rounded-box overflow-hidden bg-base-100 ${fill ? "h-full" : ""} ${className}`}
      style={!fill ? { minHeight } : undefined}
    >
      <div className="flex h-full min-h-0">
        <div className="bg-base-200 text-xs text-right px-2 py-2 font-mono select-none">
          <pre style={{ transform: `translateY(-${scrollTop}px)`, lineHeight: "1rem" }}>
            {Array.from({ length: lines }, (_, idx) => idx + 1).join("\n")}
          </pre>
        </div>
        <textarea
          className={`textarea textarea-bordered w-full font-mono text-xs rounded-none border-0 code-textarea ${fill ? "h-full" : ""} ${textareaClassName}`}
          value={value}
          onChange={(e) => onChange?.(e)}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          placeholder={placeholder}
          readOnly={readOnly}
          style={!fill ? { minHeight, lineHeight: "1rem" } : { lineHeight: "1rem" }}
        />
      </div>
    </div>
  );
}
