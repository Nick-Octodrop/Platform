import React, { useEffect, useRef } from "react";
import AgentChatInput from "../ui/AgentChatInput.jsx";
import ArtifactAiStageCard from "./ArtifactAiStageCard.jsx";
import AiActionStrip from "./AiActionStrip.jsx";

function normalizeHistoryCard(card) {
  if (!card || typeof card !== "object") return null;
  return {
    ...card,
    actions: [],
    busy: false,
    embedded: true,
  };
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
  minRows = 4,
  actionStrip = null,
}) {
  const internalScrollRef = useRef(null);
  const activeScrollRef = scrollRef || internalScrollRef;
  const bubbleBase = "chat-bubble text-sm leading-5 max-w-[85%]";

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
        {messages.length === 0 && introMessage ? (
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{assistantLabel}</div>
            <div className={`${bubbleBase} bg-base-200 text-base-content`}>
              {introMessage}
            </div>
          </div>
        ) : null}
        {messages.map((item, index) => (
          <div key={`${item.role}-${index}`} className={`chat ${item.role === "user" ? "chat-end" : "chat-start"}`}>
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">
              {item.role === "user" ? userLabel : assistantLabel}
            </div>
            {item.text ? (
              <div className={`${bubbleBase} ${item.role === "user" ? "bg-primary text-primary-content" : "bg-base-200 text-base-content"}`}>
                <div className="whitespace-pre-wrap text-sm">{item.text}</div>
              </div>
            ) : null}
            {item.card ? (
              <div className={`mt-2 ${bubbleBase} bg-base-200 text-base-content p-0 overflow-hidden`}>
                <ArtifactAiStageCard {...normalizeHistoryCard(item.card)} />
              </div>
            ) : null}
            {item.diagnostics?.parse_error ? (
              <div className="chat-footer mt-2 text-xs text-error">
                AI parse error: {item.diagnostics.parse_error}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-base-200 pt-3">
        {stageCard ? (
          <div className="mb-3 chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{assistantLabel}</div>
            <div className={`${bubbleBase} bg-base-200 text-base-content p-0 overflow-hidden`}>
              <div className="max-h-[40vh] overflow-y-auto">
                {stageCard}
              </div>
            </div>
          </div>
        ) : null}
        {actionStrip ? (
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
          disabled={inputDisabled}
          placeholder={inputPlaceholder}
          minRows={minRows}
        />
      </div>
    </div>
  );
}
