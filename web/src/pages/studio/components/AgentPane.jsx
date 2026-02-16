import React, { useState } from "react";
import AgentChatInput from "../../../ui/AgentChatInput.jsx";

export default function AgentPane({ onApply, onValidate, onPreview, disabled }) {
  const [input, setInput] = useState("");
  return (
    <div className="card bg-base-100 shadow h-full flex flex-col min-h-0">
      <div className="card-body flex flex-col min-h-0">
        <div className="flex items-center justify-between">
          <h3 className="card-title">Agent</h3>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
          <div className="text-sm opacity-60">Ask for changes and get PatchSets.</div>
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">assistant</div>
            <div className="chat-bubble text-sm leading-5 max-w-[85%] bg-base-200 text-base-content">
              Describe the change you want and I will draft an update.
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3">
        <AgentChatInput
          value={input}
          onChange={setInput}
          onSend={() => {
            if (!input.trim()) return;
            setInput("");
          }}
          disabled={disabled}
          placeholder="Describe a change…"
          minRows={1}
        />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button className="btn btn-primary btn-sm" onClick={onApply} disabled={disabled}>Apply</button>
          <div className="dropdown dropdown-end">
            <button className="btn btn-ghost btn-sm">More</button>
            <ul className="menu dropdown-content z-[1000] p-2 shadow bg-base-100 rounded-box w-40 text-sm">
              <li><button onClick={onValidate}>Validate</button></li>
              <li><button onClick={onPreview}>Preview</button></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
