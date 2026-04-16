import React, { useMemo, useState } from "react";
import { useAccessContext } from "../../access.js";
import useWorkspaceProviderStatus from "../../hooks/useWorkspaceProviderStatus.js";
import ProviderSecretModal from "../../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../../components/ProviderUnavailableState.jsx";
import LoadingSpinner from "../../components/LoadingSpinner.jsx";
import ArtifactAiStageCard from "../../components/ArtifactAiStageCard.jsx";
import ScopedAiAssistantPane from "../../components/ScopedAiAssistantPane.jsx";
import { apiFetch } from "../../api.js";
import { useI18n } from "../../i18n/LocalizationProvider.jsx";

export default function TemplateAgentPane({ disabled, initialMessage, agentKind, user, recordId, draft, setDraft, setValidationState }) {
  const { hasCapability, isSuperadmin } = useAccessContext();
  const { t } = useI18n();
  const { providers, loading, reload } = useWorkspaceProviderStatus(["openai"]);
  const [input, setInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [proposal, setProposal] = useState(null);
  const message = initialMessage || t("settings.template_studio.default_agent_message");
  const templateLabel = agentKind === "document" ? "document template" : "email template";
  const openAiConnected = Boolean(providers?.openai?.connected);
  const canManageSettings = hasCapability("workspace.manage_settings");
  const userLabel = user?.email || t("common.you");
  const planningStatusItems = useMemo(() => ([
    `Reviewing the current ${templateLabel} draft`,
    "Checking structure, placeholders, and editable content",
    `Preparing a validated ${templateLabel} proposal`,
  ]), [templateLabel]);
  const endpoint = useMemo(() => {
    if (!recordId) return "";
    if (agentKind === "email") return `/email/templates/${recordId}/ai/plan`;
    if (agentKind === "document") return `/documents/templates/${recordId}/ai/plan`;
    return "";
  }, [agentKind, recordId]);

  async function handleSend() {
    const text = input.trim();
    if (!text || submitting || disabled || !endpoint || !draft) return;
    setProposal(null);
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setSubmitting(true);
    try {
      const res = await apiFetch(endpoint, {
        method: "POST",
        body: {
          prompt: text,
          draft,
        },
      });
      setProposal({
        draft: res?.draft || null,
        validation: res?.validation || null,
        summary: String(res?.summary || "Draft ready to apply."),
        assumptions: Array.isArray(res?.assumptions) ? res.assumptions : [],
        warnings: Array.isArray(res?.warnings) ? res.warnings : [],
      });
      setMessages((prev) => [...prev, { role: "assistant", text: String(res?.summary || "Draft ready to apply.") }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", text: err?.message || t("common.error") }]);
    } finally {
      setSubmitting(false);
    }
  }

  function applyProposal() {
    if (!proposal?.draft) return;
    if (typeof setDraft === "function") {
      setDraft(proposal.draft);
    }
    if (proposal.validation && typeof setValidationState === "function") {
      setValidationState(proposal.validation);
    }
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        card: {
          title: "Template Plan",
          summary: proposal.summary,
          stageLabel: "Applied",
          stageTone: "success",
          assumptions: proposal.assumptions,
          warnings: proposal.warnings,
          validation: proposal.validation,
        },
      },
    ]);
    setProposal(null);
  }

  function discardProposal() {
    if (proposal) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          card: {
            title: "Template Plan",
            summary: proposal.summary,
            stageLabel: "Discarded",
            stageTone: "ghost",
            assumptions: proposal.assumptions,
            warnings: proposal.warnings,
            validation: proposal.validation,
          },
        },
      ]);
    }
    setProposal(null);
  }

  if (!isSuperadmin) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto space-y-4">
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{t("settings.template_studio.assistant")}</div>
            <div className="chat-bubble text-sm leading-5 max-w-[85%] bg-base-200 text-base-content">
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
      <ScopedAiAssistantPane
        introMessage={message}
        assistantLabel={t("settings.template_studio.assistant")}
        userLabel={userLabel}
        messages={messages}
        autoScrollKey={`${messages.length}:${submitting ? "loading" : "idle"}:${proposal ? "proposal" : "none"}`}
        stageCard={submitting ? (
          <ArtifactAiStageCard
            title="Template Plan"
            summary="Working through the request and preparing a validated template proposal."
            stageLabel="Planning"
            stageTone="warning"
            statusItems={planningStatusItems}
            busy
          />
        ) : (!submitting && proposal ? (
          <ArtifactAiStageCard
            title="Template Plan"
            summary={proposal.summary}
            stageLabel="Ready to Apply"
            stageTone="primary"
            assumptions={proposal.assumptions}
            warnings={proposal.warnings}
            validation={proposal.validation}
            actions={[
              { label: "Apply draft", onClick: applyProposal, primary: true, disabled: !proposal?.draft },
              { label: "Discard", onClick: discardProposal },
            ]}
          />
        ) : null)}
        inputValue={input}
        onInputChange={setInput}
        onSend={handleSend}
        inputDisabled={disabled || submitting || !endpoint || !draft}
        inputPlaceholder={t("settings.template_studio.describe_template_change")}
        minRows={4}
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
