import React, { useState } from "react";
import AgentChatInput from "../../ui/AgentChatInput.jsx";

export default function TemplateAgentPane({ disabled, initialMessage }) {
  const [input, setInput] = useState("");
  const message = initialMessage || "Describe the template change you want and I will draft an update.";

  const bubbleBase = "chat-bubble text-sm leading-5 max-w-[85%]";
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto space-y-4">
        <div className="chat chat-start">
          <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">assistant</div>
          <div className={`${bubbleBase} bg-base-200 text-base-content`}>
            {message}
          </div>
        </div>
      </div>
      <div className="shrink-0 pt-4">
        <AgentChatInput
          value={input}
          onChange={setInput}
          onSend={() => {
            if (!input.trim()) return;
            setInput("");
          }}
          disabled={disabled}
          minRows={1}
        />
      </div>
    </div>
  );
}
