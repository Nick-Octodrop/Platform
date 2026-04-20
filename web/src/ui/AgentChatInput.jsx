import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Send, Square } from "lucide-react";
import { translateRuntime } from "../i18n/runtime.js";

const AgentChatInput = forwardRef(function AgentChatInput({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  busy = false,
  placeholder = translateRuntime("settings.studio.agent.placeholder"),
  minRows = 1,
  maxRows = 6,
  className = "",
}, ref) {
  const textareaRef = useRef(null);

  useImperativeHandle(ref, () => textareaRef.current, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
    const chromeHeight = paddingTop + paddingBottom + borderTop + borderBottom;
    const minHeight = Math.ceil((Math.max(minRows, 1) * lineHeight) + chromeHeight);
    const maxHeight = Math.ceil((Math.max(maxRows, minRows, 1) * lineHeight) + chromeHeight);
    el.style.height = "0px";
    const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxRows, minRows, value]);

  const trimmedValue = value?.trim() || "";
  const canStop = busy && typeof onStop === "function";
  const sendDisabled = disabled || !trimmedValue;

  return (
    <div className={`flex w-full items-end gap-2 ${className}`}>
      <textarea
        ref={textareaRef}
        className="textarea textarea-bordered w-full min-w-0 flex-1 resize-none py-3 text-sm leading-5 no-scrollbar"
        rows={minRows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!sendDisabled) {
              onSend?.();
            }
          }
        }}
        disabled={disabled}
      />
      <button
        className={`btn btn-square h-11 w-11 shrink-0 self-end ${canStop ? "btn-ghost" : "btn-primary"}`}
        onClick={() => {
          if (canStop) {
            onStop?.();
            return;
          }
          if (!sendDisabled) {
            onSend?.();
          }
        }}
        disabled={canStop ? false : sendDisabled}
        type="button"
        aria-label={canStop ? "Stop" : translateRuntime("common.send_message")}
      >
        {canStop ? <Square size={14} strokeWidth={1.8} /> : (busy ? <span className="loading loading-spinner loading-xs" /> : <Send size={16} strokeWidth={1.5} />)}
      </button>
    </div>
  );
});

export default AgentChatInput;
