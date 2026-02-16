import React, { useEffect, useRef } from "react";
import { Send } from "lucide-react";

export default function AgentChatInput({
  value,
  onChange,
  onSend,
  disabled,
  placeholder = "Describe a change…",
  minRows = 1,
  className = "",
}) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const minHeight = minRows * 24;
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
  }, [value, minRows]);

  return (
    <div className={`relative w-full ${className}`}>
      <textarea
        ref={textareaRef}
        className="textarea textarea-bordered w-full text-sm leading-5 resize-none pr-12 py-4 min-w-0 overflow-y-auto no-scrollbar"
        rows={minRows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend?.();
          }
        }}
        disabled={disabled}
      />
      <button
        className="btn btn-primary btn-sm btn-square absolute right-2.5 top-3 -translate-y-0.5"
        onClick={onSend}
        disabled={disabled || !value?.trim()}
        type="button"
        aria-label="Send message"
      >
        <Send size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
