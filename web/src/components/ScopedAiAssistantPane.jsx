import React, { useEffect, useMemo, useRef } from "react";
import AgentChatInput from "../ui/AgentChatInput.jsx";
import AiActionStrip from "./AiActionStrip.jsx";

function formatHistoryCardMessage(card) {
  if (!card || typeof card !== "object") return "";
  const stageLabel = typeof card.stageLabel === "string" ? card.stageLabel.trim() : "";
  const summary = typeof card.summary === "string" ? card.summary.trim() : "";
  const validation = card?.validation && typeof card.validation === "object"
    ? card.validation
    : null;
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings.length : 0;
  const errors = Array.isArray(validation?.errors) ? validation.errors.length : 0;
  const normalizedStage = stageLabel.toLowerCase();
  const lines = [];
  if (normalizedStage === "applied") {
    lines.push("Draft applied.");
  } else if (normalizedStage === "discarded") {
    lines.push("Draft discarded.");
  } else if (summary) {
    lines.push(summary);
  } else if (stageLabel) {
    lines.push(stageLabel);
  }
  if (validation?.compiled_ok === true && !errors) {
    lines.push("Validation passed.");
  } else if (errors > 0) {
    lines.push(`Validation has ${errors} error${errors === 1 ? "" : "s"}.`);
  } else if (warnings > 0) {
    lines.push(`Validation has ${warnings} warning${warnings === 1 ? "" : "s"}.`);
  }
  return lines.join("\n\n").trim();
}

function buildOpeningMessage(introMessage) {
  const base = String(introMessage || "").trim();
  if (!base) return "What would you like me to help you with?";
  if (base.includes("?")) return base;
  return `${base}\n\nWhat would you like to change?`;
}

function buildPendingMessageSequence(primaryMessage, alternateMessages) {
  const candidates = [];
  if (typeof primaryMessage === "string" && primaryMessage.trim()) {
    candidates.push(primaryMessage.trim());
  }
  if (Array.isArray(alternateMessages)) {
    for (const item of alternateMessages) {
      if (typeof item !== "string") continue;
      const text = item.trim();
      if (text) candidates.push(text);
    }
  }
  return candidates.filter((item, index) => candidates.indexOf(item) === index);
}

export default function ScopedAiAssistantPane({
  introMessage = "",
  assistantLabel = "Assistant",
  userLabel = "You",
  messages = [],
  stageCard = null,
  scrollRef = null,
  autoScrollKey = null,
  inputValue = "",
  onInputChange,
  onSend,
  inputDisabled = false,
  inputPlaceholder = "",
  minRows = 1,
  maxRows = 6,
  decisionSlots = [],
  onSelectDecisionSlotOption = null,
  actionStrip = null,
  pendingAssistantMessage = "",
  pendingAssistantMessages = [],
  inputBusy = false,
  inputBusyLabel = "",
}) {
  const internalScrollRef = useRef(null);
  const activeScrollRef = scrollRef || internalScrollRef;
  const bubbleBase = "chat-bubble text-sm leading-5 max-w-[85%]";
  const openingMessage = buildOpeningMessage(introMessage);
  const showOpeningMessage = Boolean(openingMessage)
    && !(messages[0] && messages[0].role !== "user");
  const pendingAssistantText = typeof pendingAssistantMessage === "string" ? pendingAssistantMessage.trim() : "";
  const pendingAssistantSequence = useMemo(
    () => buildPendingMessageSequence(pendingAssistantText, pendingAssistantMessages),
    [pendingAssistantMessages, pendingAssistantText],
  );
  const stopAction = useMemo(() => {
    if (!inputBusy) return null;
    const actions = Array.isArray(actionStrip?.actions) ? actionStrip.actions : [];
    return actions.find((action) => action?.allowWhileBusy && typeof action?.onClick === "function")
      || actions.find((action) => (
        typeof action?.onClick === "function"
        && /cancel|stop/i.test(String(action?.label || action?.key || ""))
      ))
      || null;
  }, [actionStrip, inputBusy]);
  const showActionStrip = Boolean(actionStrip) && !inputBusy;
  const activePendingAssistantText = pendingAssistantText || pendingAssistantSequence[0] || "";

  useEffect(() => {
    const node = activeScrollRef?.current;
    if (!node) return undefined;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeScrollRef, autoScrollKey, messages.length, Boolean(stageCard)]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div ref={activeScrollRef} className="flex-1 min-h-0 overflow-auto space-y-4" aria-live="polite">
        {showOpeningMessage ? (
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{assistantLabel}</div>
            <div className={`${bubbleBase} bg-base-200 text-base-content`}>
              {openingMessage}
            </div>
          </div>
        ) : null}
        {messages.map((item, index) => {
          const messageText = item.text || (item.role !== "user" ? formatHistoryCardMessage(item.card) : "");
          return (
          <div key={`${item.role}-${index}`} className={`chat ${item.role === "user" ? "chat-end" : "chat-start"}`}>
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">
              {item.role === "user" ? userLabel : assistantLabel}
            </div>
            {messageText ? (
              <div className={`${bubbleBase} ${item.role === "user" ? "bg-primary text-primary-content" : "bg-base-200 text-base-content"}`}>
                <div className="whitespace-pre-wrap text-sm">{messageText}</div>
              </div>
            ) : null}
            {item.diagnostics?.parse_error ? (
              <div className="chat-footer mt-2 text-xs text-error">
                AI parse error: {item.diagnostics.parse_error}
              </div>
            ) : null}
          </div>
        );
        })}
        {activePendingAssistantText ? (
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">
              {assistantLabel}
            </div>
            <div className={`${bubbleBase} bg-base-200 text-base-content`}>
              <div className="flex items-center gap-2 text-sm">
                <span className="loading loading-dots loading-xs shrink-0" />
                <span className="whitespace-pre-wrap">
                  {activePendingAssistantText}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 pt-3">
        {stageCard ? (
          <div className="mb-3">
            <div className="max-h-[40vh] overflow-y-auto">
              {stageCard}
            </div>
          </div>
        ) : null}
        {Array.isArray(decisionSlots) && decisionSlots.length > 0 ? (
          <div className="mb-3 space-y-3">
            {decisionSlots.map((slot) => {
              const options = Array.isArray(slot?.options) ? slot.options.filter((item) => item && typeof item === "object") : [];
              return (
                <div key={slot?.slot_id || slot?.id || slot?.label || slot?.prompt} className="rounded-box border border-base-300 bg-base-100 p-3">
                  <div className="text-sm font-medium">{slot?.label || slot?.prompt || "Decision required"}</div>
                  {typeof slot?.why_needed === "string" && slot.why_needed.trim() ? (
                    <div className="mt-1 text-xs opacity-70">{slot.why_needed.trim()}</div>
                  ) : null}
                  {options.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {options.map((option) => (
                        <button
                          key={option?.id || option?.value || option?.label}
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => onSelectDecisionSlotOption?.(slot, option)}
                        >
                          {option?.label || option?.value || "Choose"}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {slot?.allow_free_text ? (
                    <div className="mt-2 text-xs opacity-60">Type a custom answer below if none of these options fit.</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {showActionStrip ? (
          <div className="mb-3">
            <AiActionStrip
              title={actionStrip?.title || ""}
              actions={actionStrip?.actions || []}
              busy={Boolean(actionStrip?.busy)}
            />
          </div>
        ) : null}
        <AgentChatInput
          value={inputValue}
          onChange={onInputChange}
          onSend={onSend}
          onStop={stopAction?.onClick}
          disabled={inputDisabled}
          busy={inputBusy}
          busyLabel={inputBusyLabel}
          placeholder={inputPlaceholder}
          minRows={minRows}
          maxRows={maxRows}
        />
      </div>
    </div>
  );
}
