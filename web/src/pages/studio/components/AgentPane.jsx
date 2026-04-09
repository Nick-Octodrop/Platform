import React, { useState } from "react";
import AgentChatInput from "../../../ui/AgentChatInput.jsx";
import { useAccessContext } from "../../../access.js";
import useWorkspaceProviderStatus from "../../../hooks/useWorkspaceProviderStatus.js";
import ProviderSecretModal from "../../../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../../../components/ProviderUnavailableState.jsx";
import LoadingSpinner from "../../../components/LoadingSpinner.jsx";

export default function AgentPane({ onApply, onValidate, onPreview, disabled }) {
  const { hasCapability } = useAccessContext();
  const { providers, loading, reload } = useWorkspaceProviderStatus(["openai"]);
  const [input, setInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const openAiConnected = Boolean(providers?.openai?.connected);
  const canManageSettings = hasCapability("workspace.manage_settings");

  return (
    <>
      <div className="card bg-base-100 shadow h-full flex flex-col min-h-0">
        <div className="card-body flex flex-col min-h-0">
          <div className="flex items-center justify-between">
            <h3 className="card-title">Agent</h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
            {loading ? (
              <LoadingSpinner className="min-h-0 h-full" />
            ) : openAiConnected ? (
              <>
                <div className="text-sm opacity-60">Ask for changes and get PatchSets.</div>
                <div className="chat chat-start">
                  <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">assistant</div>
                  <div className="chat-bubble text-sm leading-5 max-w-[85%] bg-base-200 text-base-content">
                    Describe the change you want and I will draft an update.
                  </div>
                </div>
              </>
            ) : (
              <ProviderUnavailableState
                title="OpenAI not connected"
                description="Connect an OpenAI key for this workspace to use Studio AI."
                actionLabel="Connect OpenAI"
                canManageSettings={canManageSettings}
                loading={loading}
                onAction={() => setModalOpen(true)}
              />
            )}
          </div>
          {openAiConnected && (
            <div className="mt-3 border-t border-base-200 pt-3">
              <AgentChatInput
                value={input}
                onChange={setInput}
                onSend={() => {
                  if (!input.trim()) return;
                  setInput("");
                }}
                disabled={disabled}
                placeholder="Describe a change…"
                minRows={4}
              />
            </div>
          )}
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
      <ProviderSecretModal
        open={modalOpen}
        providerKey="openai"
        canManageSettings={canManageSettings}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setModalOpen(false);
          await reload();
        }}
      />
    </>
  );
}
