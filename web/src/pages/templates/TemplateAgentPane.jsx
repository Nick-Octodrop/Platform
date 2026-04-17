import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAccessContext } from "../../access.js";
import useWorkspaceProviderStatus from "../../hooks/useWorkspaceProviderStatus.js";
import ProviderSecretModal from "../../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../../components/ProviderUnavailableState.jsx";
import LoadingSpinner from "../../components/LoadingSpinner.jsx";
import ArtifactAiStageCard from "../../components/ArtifactAiStageCard.jsx";
import ScopedAiAssistantPane from "../../components/ScopedAiAssistantPane.jsx";
import { apiFetch } from "../../api.js";
import { useI18n } from "../../i18n/LocalizationProvider.jsx";

function formatValidationLines(items = []) {
  return items
    .map((item) => {
      if (!item) return "";
      if (typeof item === "string") return item;
      const loc = item.line ? ` (line ${item.line}${item.col ? `, col ${item.col}` : ""})` : "";
      return `${item.message || item.code || "Issue"}${loc}`.trim();
    })
    .filter(Boolean);
}

export default function TemplateAgentPane({
  disabled,
  initialMessage,
  agentKind,
  user,
  recordId,
  draft,
  setDraft,
  setValidationState,
  validationState,
  onFixHandlerChange,
}) {
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

  const buildTemplateAiRepairPrompt = useCallback((validation, summary) => {
    const errors = formatValidationLines(validation?.errors || []);
    const warnings = formatValidationLines([
      ...(validation?.warnings || []),
      ...((validation?.undefined || []).map((item) => `Undefined: ${item}`)),
      ...((validation?.possible_undefined || []).map((item) => `Undefined: ${item}`)),
    ]);
    const sections = [`Fix this ${templateLabel} draft so it passes validation.`];
    if (summary) sections.push(`Current goal: ${summary}`);
    if (errors.length > 0) sections.push(`Errors:\n- ${errors.join("\n- ")}`);
    if (warnings.length > 0) sections.push(`Warnings:\n- ${warnings.join("\n- ")}`);
    sections.push("Return a corrected draft that preserves the intended change.");
    return sections.join("\n\n");
  }, [templateLabel]);

  const runTemplateAiPlan = useCallback(async (rawText, draftOverride = null) => {
    const text = String(rawText || "").trim();
    const nextDraft = draftOverride || draft;
    if (!text || submitting || disabled || !endpoint || !nextDraft) return;
    setProposal(null);
    setMessages((prev) => [...prev, { role: "user", text }]);
    if (!draftOverride) {
      setInput("");
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(endpoint, {
        method: "POST",
        body: {
          prompt: text,
          draft: nextDraft,
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
  }, [disabled, draft, endpoint, submitting]);

  const runTemplateAiFix = useCallback(async ({ draft: repairDraft = null, validation = null, summary = "" } = {}) => {
    const nextValidation = validation || proposal?.validation || validationState;
    const nextDraft = repairDraft || proposal?.draft || draft;
    if (!nextDraft || !nextValidation) return;
    const repairPrompt = buildTemplateAiRepairPrompt(nextValidation, summary || proposal?.summary || "");
    return runTemplateAiPlan(repairPrompt, nextDraft);
  }, [buildTemplateAiRepairPrompt, draft, proposal, runTemplateAiPlan, validationState]);

  async function handleSend() {
    await runTemplateAiPlan(input);
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

  useEffect(() => {
    if (typeof onFixHandlerChange !== "function") return undefined;
    if (!openAiConnected) {
      onFixHandlerChange(null);
      return undefined;
    }
    const hasIssues = ((validationState?.errors || []).length > 0)
      || ((validationState?.warnings || []).length > 0)
      || ((validationState?.undefined || []).length > 0)
      || ((validationState?.possible_undefined || []).length > 0);
    if (!hasIssues || !draft) {
      onFixHandlerChange(null);
      return undefined;
    }
    const handler = () => runTemplateAiFix({
      draft,
      validation: validationState,
      summary: draft?.name || `${templateLabel} draft`,
    });
    onFixHandlerChange(() => handler);
    return () => onFixHandlerChange(null);
  }, [draft, onFixHandlerChange, openAiConnected, runTemplateAiFix, templateLabel, validationState]);

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
            stageLabel={proposal?.validation?.compiled_ok === false ? "Needs Fix" : "Ready to Apply"}
            stageTone={proposal?.validation?.compiled_ok === false ? "danger" : "primary"}
            assumptions={proposal.assumptions}
            warnings={proposal.warnings}
            validation={proposal.validation}
            actions={[
              { label: "Apply draft", onClick: applyProposal, primary: true, disabled: !proposal?.draft || proposal?.validation?.compiled_ok === false },
              ...(proposal?.validation?.compiled_ok === false ? [{
                label: "Fix with AI",
                onClick: () => runTemplateAiFix({
                  draft: proposal?.draft,
                  validation: proposal?.validation,
                  summary: proposal?.summary,
                }),
              }] : []),
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
