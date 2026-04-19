import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccessContext } from "../../access.js";
import useWorkspaceProviderStatus from "../../hooks/useWorkspaceProviderStatus.js";
import useAiCapabilityCatalog from "../../hooks/useAiCapabilityCatalog.js";
import ProviderSecretModal from "../../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../../components/ProviderUnavailableState.jsx";
import LoadingSpinner from "../../components/LoadingSpinner.jsx";
import ArtifactAiStageCard from "../../components/ArtifactAiStageCard.jsx";
import ScopedAiAssistantPane from "../../components/ScopedAiAssistantPane.jsx";
import { apiFetch } from "../../api.js";
import { getArtifactQuickActions } from "../../aiCapabilities.js";
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

function hasValidationErrors(validation) {
  return Array.isArray(validation?.errors) && validation.errors.length > 0;
}

function hasMeaningfulHtmlContent(value) {
  const source = String(value || "").trim();
  if (!source) return false;
  const textOnly = source
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Boolean(textOnly || /<(img|table|svg|hr)\b/i.test(source));
}

function hasMeaningfulTemplateDraft(agentKind, draft) {
  if (!draft || typeof draft !== "object") return false;
  if (agentKind === "document") {
    return hasMeaningfulHtmlContent(draft?.html)
      || hasMeaningfulHtmlContent(draft?.header_html)
      || hasMeaningfulHtmlContent(draft?.footer_html);
  }
  return Boolean(
    String(draft?.subject || "").trim()
    || String(draft?.body_text || "").trim()
    || hasMeaningfulHtmlContent(draft?.body_html),
  );
}

function isHtmlStarterValue(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return normalized === "<p>hello</p>" || normalized === "<p>hello</p>\n";
}

export default function TemplateAgentPane({
  disabled,
  initialMessage,
  agentKind,
  user,
  recordId,
  sample,
  draft,
  setDraft,
  setValidationState,
  validationState,
  autoFixToken = 0,
  onAutoFixHandled,
  input,
  setInput,
  messages,
  setMessages,
  proposal,
  setProposal,
}) {
  const { hasCapability } = useAccessContext();
  const { t } = useI18n();
  const { providers, loading, reload } = useWorkspaceProviderStatus(["openai"]);
  const { capabilities: aiCapabilities } = useAiCapabilityCatalog();
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const message = initialMessage || t("settings.template_studio.default_agent_message");
  const templateLabel = agentKind === "document" ? "document template" : "email template";
  const assistantLabel = agentKind === "document" ? "AI Document Assistant" : "AI Email Assistant";
  const isStarterTemplateDraft = useMemo(() => {
    if (!draft || typeof draft !== "object") return false;
    if (agentKind === "document") {
      const starterName = String(t("settings.documents_templates_page.untitled_template") || "").trim();
      const name = String(draft?.name || "").trim();
      const description = String(draft?.description || "").trim();
      const html = String(draft?.html || "").trim();
      const headerHtml = String(draft?.header_html || "").trim();
      const footerHtml = String(draft?.footer_html || "").trim();
      return name === starterName
        && !description
        && isHtmlStarterValue(html)
        && !headerHtml
        && !footerHtml;
    }
    const starterName = String(t("settings.email_templates.untitled_template") || "").trim();
    const starterSubject = String(t("settings.email_templates.new_template") || "").trim();
    const name = String(draft?.name || "").trim();
    const subject = String(draft?.subject || "").trim();
    const description = String(draft?.description || "").trim();
    const bodyHtml = String(draft?.body_html || "").trim();
    const bodyText = String(draft?.body_text || "").trim();
    return name === starterName
      && subject === starterSubject
      && !description
      && !bodyText
      && isHtmlStarterValue(bodyHtml);
  }, [agentKind, draft, t]);
  const openAiConnected = Boolean(providers?.openai?.connected);
  const canUseTemplateAi = hasCapability("templates.manage");
  const canManageSettings = hasCapability("workspace.manage_settings");
  const userLabel = user?.email || t("common.you");
  const lastAutoFixTokenRef = useRef(0);
  const quickActions = useMemo(() => getArtifactQuickActions(
    aiCapabilities,
    agentKind,
    {
      surface: "scoped_editor",
      artifactLabel: draft?.name || templateLabel,
      excludeFocuses: ["validation"],
    },
  ), [agentKind, aiCapabilities, draft?.name, templateLabel]);
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
    if (!errors.length) return "";
    const sections = [`Fix only the validation errors in this ${templateLabel} draft.`];
    if (summary) sections.push(`Current goal: ${summary}`);
    if (errors.length > 0) sections.push(`Errors:\n- ${errors.join("\n- ")}`);
    sections.push("Preserve the existing structure, copy, and visual design unless a validation error requires a targeted change.");
    sections.push("Do not do extra redesign, copy cleanup, or non-validation improvements.");
    sections.push("Return the smallest corrected draft that preserves the intended change.");
    return sections.join("\n\n");
  }, [templateLabel]);

  const runTemplateAiPlan = useCallback(async (rawText, draftOverride = null, options = null) => {
    const text = String(rawText || "").trim();
    const nextDraft = draftOverride || draft;
    if (!text || submitting || disabled || !endpoint || !nextDraft) return;
    const focus = options?.focus || null;
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
          focus,
          sample: sample?.entity_id ? { entity_id: sample.entity_id, record_id: sample.record_id || "" } : null,
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
  }, [disabled, draft, endpoint, sample, submitting]);

  const runTemplateAiFix = useCallback(async ({ draft: repairDraft = null, validation = null, summary = "" } = {}) => {
    const nextValidation = validation || proposal?.validation || validationState;
    const nextDraft = repairDraft || proposal?.draft || draft;
    if (!nextDraft || !nextValidation || !hasValidationErrors(nextValidation)) return;
    const repairPrompt = buildTemplateAiRepairPrompt(nextValidation, summary || proposal?.summary || "");
    if (!repairPrompt) return;
    return runTemplateAiPlan(repairPrompt, nextDraft, { focus: "validation" });
  }, [buildTemplateAiRepairPrompt, draft, proposal, runTemplateAiPlan, validationState]);

  async function handleSend() {
    await runTemplateAiPlan(input);
  }

  async function handleQuickAction(action) {
    if (!action || submitting || disabled || !draft) return;
    await runTemplateAiPlan(action.prompt, draft, { focus: action.focus });
  }

  const templateHasSeedContent = useMemo(
    () => hasMeaningfulTemplateDraft(agentKind, draft) && !isStarterTemplateDraft,
    [agentKind, draft, isStarterTemplateDraft],
  );

  const actionStrip = useMemo(() => {
    if (submitting) return null;
    if (proposal) {
      return {
        title: "Actions",
        actions: [
          {
            key: "apply-draft",
            label: "Apply draft",
            onClick: applyProposal,
            primary: true,
            disabled: !proposal?.draft || proposal?.validation?.compiled_ok === false,
          },
          ...(proposal?.validation?.compiled_ok === false
            ? [{
                key: "fix-with-ai",
                label: "Fix with AI",
                onClick: () => runTemplateAiFix({
                  draft: proposal?.draft,
                  validation: proposal?.validation,
                  summary: proposal?.summary,
                }),
              }]
            : []),
          {
            key: "discard-proposal",
            label: "Discard",
            onClick: discardProposal,
            outline: true,
          },
        ],
      };
    }
    if (!draft || disabled || !endpoint || !templateHasSeedContent) return null;
    const idleActions = [
      ...(hasValidationErrors(validationState)
        ? [{
            key: "fix-current-validation",
            label: "Fix with AI",
            onClick: () => runTemplateAiFix({
              draft,
              validation: validationState,
              summary: draft?.name || `${templateLabel} draft`,
            }),
            primary: true,
          }]
        : []),
      ...quickActions.map((action) => ({
        key: action.id,
        label: action.label,
        onClick: () => handleQuickAction(action),
        outline: true,
      })),
    ];
    return idleActions.length ? { title: "Actions", actions: idleActions } : null;
  }, [
    applyProposal,
    disabled,
    discardProposal,
    draft,
    endpoint,
    handleQuickAction,
    proposal,
    quickActions,
    runTemplateAiFix,
    submitting,
    templateHasSeedContent,
    templateLabel,
    validationState,
  ]);

  function applyProposal() {
    if (!proposal?.draft) return;
    if (typeof setDraft === "function") {
      setDraft(proposal.draft);
    }
    if (typeof setValidationState === "function") {
      setValidationState((prev) => ({
        ...(prev || {}),
        status: "checking",
      }));
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
    if (!openAiConnected) return;
    if (!autoFixToken) return;
    if (!hasValidationErrors(validationState) || !draft) return;
    if (autoFixToken === lastAutoFixTokenRef.current) return;
    lastAutoFixTokenRef.current = autoFixToken;
    if (typeof onAutoFixHandled === "function") {
      onAutoFixHandled();
    }
    runTemplateAiFix({
      draft,
      validation: validationState,
      summary: draft?.name || `${templateLabel} draft`,
    });
  }, [autoFixToken, draft, onAutoFixHandled, openAiConnected, runTemplateAiFix, templateLabel, validationState]);

  if (!canUseTemplateAi) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto space-y-4">
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{assistantLabel}</div>
            <div className="chat-bubble text-sm leading-5 max-w-[85%] bg-base-200 text-base-content">
              You need template management access to use template AI.
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
        assistantLabel={assistantLabel}
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
          />
        ) : null)}
        inputValue={input}
        onInputChange={setInput}
        onSend={handleSend}
        inputDisabled={disabled || submitting || !endpoint || !draft}
        inputPlaceholder={t("settings.template_studio.describe_template_change")}
        minRows={4}
        actionStrip={actionStrip}
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
