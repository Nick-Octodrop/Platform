import React, { useState } from "react";
import AgentChatInput from "../../ui/AgentChatInput.jsx";
import { useAccessContext } from "../../access.js";
import useWorkspaceProviderStatus from "../../hooks/useWorkspaceProviderStatus.js";
import ProviderSecretModal from "../../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../../components/ProviderUnavailableState.jsx";
import LoadingSpinner from "../../components/LoadingSpinner.jsx";
import { useI18n } from "../../i18n/LocalizationProvider.jsx";

export default function TemplateAgentPane({ disabled, initialMessage }) {
  const { hasCapability, isSuperadmin } = useAccessContext();
  const { t } = useI18n();
  const { providers, loading, reload } = useWorkspaceProviderStatus(["openai"]);
  const [input, setInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const message = initialMessage || t("settings.template_studio.default_agent_message");
  const bubbleBase = "chat-bubble text-sm leading-5 max-w-[85%]";
  const openAiConnected = Boolean(providers?.openai?.connected);
  const canManageSettings = hasCapability("workspace.manage_settings");

  if (!isSuperadmin) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto space-y-4">
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{t("settings.template_studio.assistant")}</div>
            <div className={`${bubbleBase} bg-base-200 text-base-content`}>
              Studio AI is currently limited to superadmins.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <>
        <LoadingSpinner className="min-h-0 h-full" />
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

  if (!openAiConnected) {
    return (
      <>
        <ProviderUnavailableState
          title={t("settings.template_studio.openai_not_connected")}
          description={t("settings.template_studio.openai_not_connected_description")}
          actionLabel={t("settings.template_studio.connect_openai")}
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
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{t("settings.template_studio.assistant")}</div>
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
            placeholder={t("settings.template_studio.describe_template_change")}
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
