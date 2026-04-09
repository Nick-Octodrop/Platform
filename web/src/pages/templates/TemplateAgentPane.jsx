import React, { useState } from "react";
import AgentChatInput from "../../ui/AgentChatInput.jsx";
import { useAccessContext } from "../../access.js";
import useWorkspaceProviderStatus from "../../hooks/useWorkspaceProviderStatus.js";
import ProviderSecretModal from "../../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../../components/ProviderUnavailableState.jsx";

export default function TemplateAgentPane({ disabled, initialMessage }) {
  const { hasCapability } = useAccessContext();
  const { providers, loading, reload } = useWorkspaceProviderStatus(["openai"]);
  const [input, setInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const message = initialMessage || "Describe the template change you want and I will draft an update.";
  const bubbleBase = "chat-bubble text-sm leading-5 max-w-[85%]";
  const openAiConnected = Boolean(providers?.openai?.connected);
  const canManageSettings = hasCapability("workspace.manage_settings");

  if (!openAiConnected) {
    return (
      <>
        <ProviderUnavailableState
          title="OpenAI not connected"
          description="Connect an OpenAI key for this workspace to use template AI."
          actionLabel="Connect OpenAI"
          canManageSettings={canManageSettings}
          loading={loading}
          onAction={() => setModalOpen(true)}
        />
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

  return (
    <>
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto space-y-4">
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">assistant</div>
            <div className={`${bubbleBase} bg-base-200 text-base-content`}>
              {message}
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-base-200 pt-3">
          <AgentChatInput
            value={input}
            onChange={setInput}
            onSend={() => {
              if (!input.trim()) return;
              setInput("");
            }}
            disabled={disabled}
            placeholder="Describe a template change..."
            minRows={4}
          />
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
