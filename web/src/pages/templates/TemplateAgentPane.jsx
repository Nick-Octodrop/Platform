import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccessContext } from "../../access.js";
import useWorkspaceProviderStatus from "../../hooks/useWorkspaceProviderStatus.js";
import useAiCapabilityCatalog from "../../hooks/useAiCapabilityCatalog.js";
import ProviderSecretModal from "../../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../../components/ProviderUnavailableState.jsx";
import LoadingSpinner from "../../components/LoadingSpinner.jsx";
import ArtifactAiStageCard from "../../components/ArtifactAiStageCard.jsx";
import ScopedAiAssistantPane from "../../components/ScopedAiAssistantPane.jsx";
import { apiFetch, startArtifactAiPlanStream } from "../../api.js";
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
  return normalized === "<p>hello</p>"
    || normalized === "<p>hello</p>\n"
    || normalized.includes("data-octo-starter=\"email-template\"")
    || normalized.includes("data-octo-starter=\"document-template\"");
}

function humanizeProgressLabel(value, { stripEntityPrefix = false } = {}) {
  if (typeof value !== "string" || !value.trim()) return "";
  let text = value.trim();
  if (stripEntityPrefix) {
    text = text.replace(/^entity\./, "");
  }
  return text.replaceAll("_", " ").replaceAll("-", " ").trim();
}

function summarizeTemplatePlanProgressEvent(evt, templateLabel) {
  if (!evt || typeof evt !== "object") return "";
  const data = evt.data && typeof evt.data === "object" ? evt.data : {};
  if (typeof data.summary === "string" && data.summary.trim()) {
    return data.summary.trim();
  }
  if (evt.event === "run_started") return "";
  if (evt.event === "context_resolved") {
    if (typeof data.profile_summary === "string" && data.profile_summary.trim()) {
      return data.profile_summary.trim();
    }
    const entityLabel = humanizeProgressLabel(data.selected_entity_label || data.selected_entity_id, { stripEntityPrefix: true });
    const focusLabel = humanizeProgressLabel(data.requested_focus_label || data.requested_focus);
    const supportsLineItems = Boolean(data.supports_line_items);
    const usesTableLayout = Boolean(data.uses_table_layout);
    const usesLogoReference = Boolean(data.uses_logo_reference);
    const hasButtonLikeCta = Boolean(data.has_button_like_cta);
    const hasHeaderFooterSections = Boolean(data.has_header_footer_sections);
    let draftShape = "";
    if (templateLabel === "document template") {
      if (usesTableLayout && supportsLineItems) {
        draftShape = "line-item table layout";
      } else if (hasHeaderFooterSections) {
        draftShape = "header and footer layout";
      } else if (usesLogoReference) {
        draftShape = "branded layout";
      }
    } else if (usesTableLayout && supportsLineItems) {
      draftShape = "line-item email layout";
    } else if (hasButtonLikeCta) {
      draftShape = "CTA-driven email layout";
    } else if (usesLogoReference) {
      draftShape = "branded email layout";
    }
    if (entityLabel && draftShape && focusLabel) {
      return `Reviewing the ${entityLabel} ${draftShape} for ${focusLabel} changes.`;
    }
    if (entityLabel && draftShape) {
      return `Reviewing the ${entityLabel} ${draftShape}.`;
    }
    if (entityLabel && focusLabel) {
      return `Reviewing the ${entityLabel} ${templateLabel} for ${focusLabel} changes.`;
    }
    if (entityLabel) {
      return `Reviewing the ${entityLabel} ${templateLabel}.`;
    }
    if (focusLabel) {
      return `Reviewing the current ${templateLabel} for ${focusLabel} changes.`;
    }
    return "";
  }
  if (evt.event === "draft_loaded") return "";
  if (evt.event === "plan_requested") return "";
  if (evt.event === "draft_refined") {
    if (typeof data.summary === "string" && data.summary.trim()) {
      return data.summary.trim();
    }
    if (Number(data.hint_count || 0) > 0) {
      return `Applying your answer to the current ${templateLabel} draft.`;
    }
    return "";
  }
  if (evt.event === "decision_required") {
    if (typeof data.slot_label === "string" && data.slot_label.trim()) {
      return `Waiting on one decision: ${data.slot_label.trim()}.`;
    }
    if (typeof data.question === "string" && data.question.trim()) {
      return `Waiting on one decision: ${data.question.trim()}`;
    }
    return `Checking which decision is still needed for the ${templateLabel} draft.`;
  }
  if (evt.event === "stage_started") {
    if (evt.phase === "planning") return "";
    if (evt.phase === "validating") return `Validating the proposed ${templateLabel} draft.`;
  }
  if (evt.event === "plan_result") {
    if (Number(data.required_questions || 0) > 0) return "";
    if (typeof data.summary === "string" && data.summary.trim()) {
      return data.summary.trim();
    }
    const questions = Number(data.required_questions || 0);
    if (questions > 0) return `Prepared a draft ${templateLabel} proposal and need one decision to continue.`;
    return `Prepared a draft ${templateLabel} proposal.`;
  }
  if (evt.event === "validate_result") {
    if (typeof data.summary === "string" && data.summary.trim()) {
      return data.summary.trim();
    }
    const total = Number(data?.error_counts?.total || 0);
    if (total > 0) return `Validation found ${total} issue${total === 1 ? "" : "s"} in the proposed ${templateLabel} draft.`;
    return `Validation passed for the proposed ${templateLabel} draft.`;
  }
  if (evt.event === "final_done") return "Finalizing the proposal.";
  if (evt.event === "stopped") return "Stopping the current run.";
  return "";
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
  const [progressEvents, setProgressEvents] = useState([]);
  const streamCancelRef = useRef(null);
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
  const [activeRequestMode, setActiveRequestMode] = useState("");
  const pendingAssistantMessage = useMemo(() => {
    if (!submitting) return "";
    for (let index = progressEvents.length - 1; index >= 0; index -= 1) {
      const summary = summarizeTemplatePlanProgressEvent(progressEvents[index], templateLabel);
      if (summary) return summary;
    }
    if (activeRequestMode === "validation") {
      return `Checking the current ${templateLabel} validation issues and preparing a targeted fix.`;
    }
    if (activeRequestMode === "decision") {
      return `Applying your answer and updating the current ${templateLabel} draft.`;
    }
    if (activeRequestMode) {
      return activeRequestMode;
    }
    return `Reviewing the current ${templateLabel} draft and planning the requested changes.`;
  }, [activeRequestMode, progressEvents, submitting, templateLabel]);
  const endpoint = useMemo(() => {
    if (!recordId) return "";
    if (agentKind === "email") return `/email/templates/${recordId}/ai/plan`;
    if (agentKind === "document") return `/documents/templates/${recordId}/ai/plan`;
    return "";
  }, [agentKind, recordId]);

  const cancelTemplateAiRun = useCallback(() => {
    streamCancelRef.current?.();
  }, []);

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
    const text = String(options?.displayText || rawText || "").trim();
    const requestPrompt = String(options?.requestPrompt || rawText || "").trim();
    const nextDraft = draftOverride || draft;
    if (!requestPrompt || !text || submitting || disabled || !endpoint || !nextDraft) return;
    const focus = options?.focus || null;
    const requestMode = focus === "validation"
      ? "validation"
      : (options?.requestPrompt ? "decision" : "");
    setProposal(null);
    setMessages((prev) => [...prev, { role: "user", text }]);
    if (!draftOverride) {
      setInput("");
    }
    setProgressEvents([]);
    setActiveRequestMode(requestMode);
    setSubmitting(true);
    try {
      const requestBody = {
        prompt: requestPrompt,
        draft: nextDraft,
        focus,
        hints: options?.hints && typeof options.hints === "object" ? options.hints : null,
        sample: sample?.entity_id ? { entity_id: sample.entity_id, record_id: sample.record_id || "" } : null,
      };
      let res = null;
      try {
        const { cancel, promise } = startArtifactAiPlanStream({
          path: `${endpoint}/stream`,
          body: requestBody,
          onEvent: (evt) => {
            setProgressEvents((prev) => [...prev, evt].slice(-200));
          },
        });
        streamCancelRef.current = cancel;
        res = await promise;
      } catch (streamErr) {
        if (streamErr?.name === "AbortError") return;
        res = await apiFetch(endpoint, {
          method: "POST",
          body: { ...requestBody, include_progress: true },
        });
        if (Array.isArray(res?.progress)) {
          setProgressEvents(res.progress.slice(-200));
        }
      }
      const requiredQuestions = Array.isArray(res?.required_questions)
        ? res.required_questions.filter((item) => typeof item === "string" && item.trim())
        : [];
      const questionMeta = res?.required_question_meta && typeof res.required_question_meta === "object"
        ? res.required_question_meta
        : null;
      const decisionSlots = Array.isArray(res?.decision_slots)
        ? res.decision_slots.filter((item) => item && typeof item === "object")
        : [];
      setProposal({
        draft: res?.draft || null,
        validation: res?.validation || null,
        summary: String(res?.summary || "Draft ready to apply."),
        assumptions: Array.isArray(res?.assumptions) ? res.assumptions : [],
        warnings: Array.isArray(res?.warnings) ? res.warnings : [],
        advisories: Array.isArray(res?.warnings) ? res.warnings : [],
        risks: res?.validation?.compiled_ok === false ? ["The draft still has validation issues and needs review before apply."] : [],
        requiredQuestions,
        questionMeta,
        decisionSlots,
        prompt: requestPrompt,
        focus,
      });
      setMessages((prev) => [...prev, { role: "assistant", text: String(res?.summary || "Draft ready to apply.") }]);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setMessages((prev) => [...prev, { role: "assistant", text: err?.message || t("common.error") }]);
    } finally {
      streamCancelRef.current = null;
      setActiveRequestMode("");
      setSubmitting(false);
    }
  }, [disabled, draft, endpoint, sample, submitting, t]);

  const runTemplateAiFix = useCallback(async ({ draft: repairDraft = null, validation = null, summary = "" } = {}) => {
    const nextValidation = validation || proposal?.validation || validationState;
    const nextDraft = repairDraft || proposal?.draft || draft;
    if (!nextDraft || !nextValidation || !hasValidationErrors(nextValidation)) return;
    const repairPrompt = buildTemplateAiRepairPrompt(nextValidation, summary || proposal?.summary || "");
    if (!repairPrompt) return;
    return runTemplateAiPlan(repairPrompt, nextDraft, { focus: "validation" });
  }, [buildTemplateAiRepairPrompt, draft, proposal, runTemplateAiPlan, validationState]);

  async function handleSend() {
    if (pendingTemplateDecisionSlots.length > 0 && pendingTemplateDecisionSlots[0]?.allow_free_text) {
      await submitTemplateDecisionText(input);
      return;
    }
    await runTemplateAiPlan(input);
  }

  async function handleQuickAction(action) {
    if (!action || submitting || disabled || !draft) return;
    await runTemplateAiPlan(action.prompt, draft, { focus: action.focus });
  }

  const pendingTemplateDecisionSlots = useMemo(() => (
    Array.isArray(proposal?.decisionSlots)
      ? proposal.decisionSlots.filter((item) => item && typeof item === "object")
      : []
  ), [proposal?.decisionSlots]);

  const submitTemplateDecisionSlotOption = useCallback(async (slot, option) => {
    if (!proposal?.prompt || !slot || !option) return;
    const optionValue = typeof option?.value === "string" ? option.value.trim() : "";
    const optionLabel = typeof option?.label === "string" ? option.label.trim() : optionValue;
    const hints = option?.hints && typeof option.hints === "object" ? option.hints : {};
    await runTemplateAiPlan(optionLabel || optionValue, proposal?.draft, {
      requestPrompt: proposal?.prompt,
      displayText: optionLabel || optionValue,
      focus: proposal?.focus || null,
      hints,
    });
  }, [proposal?.draft, proposal?.focus, proposal?.prompt, runTemplateAiPlan]);

  const submitTemplateDecisionText = useCallback(async (rawText) => {
    const slot = pendingTemplateDecisionSlots[0];
    const text = String(rawText || "").trim();
    if (!text || !proposal?.prompt || !slot?.allow_free_text) return;
    const hintField = typeof slot?.hint_field === "string" && slot.hint_field.trim() ? slot.hint_field.trim() : "selected_option_value";
    await runTemplateAiPlan(text, proposal?.draft, {
      requestPrompt: proposal?.prompt,
      displayText: text,
      focus: proposal?.focus || null,
      hints: { [hintField]: text, selected_option_value: text },
    });
  }, [pendingTemplateDecisionSlots, proposal?.draft, proposal?.focus, proposal?.prompt, runTemplateAiPlan]);

  const templateHasSeedContent = useMemo(
    () => hasMeaningfulTemplateDraft(agentKind, draft) && !isStarterTemplateDraft,
    [agentKind, draft, isStarterTemplateDraft],
  );

  const actionStrip = useMemo(() => {
    if (submitting) {
      return {
        title: "Actions",
        actions: [
          {
            key: "cancel-run",
            label: "Stop",
            onClick: cancelTemplateAiRun,
            allowWhileBusy: true,
            outline: true,
          },
        ],
      };
    }
    if (proposal) {
      if (pendingTemplateDecisionSlots.length > 0) {
        return {
          title: "Actions",
          actions: [
            {
              key: "discard-proposal",
              label: "Discard",
              onClick: discardProposal,
              outline: true,
            },
          ],
        };
      }
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
    cancelTemplateAiRun,
    disabled,
    discardProposal,
    draft,
    endpoint,
    handleQuickAction,
    proposal,
    pendingTemplateDecisionSlots.length,
    quickActions,
    runTemplateAiFix,
    submitting,
    templateHasSeedContent,
    templateLabel,
    validationState,
  ]);

  function applyProposal() {
    if (!proposal?.draft || pendingTemplateDecisionSlots.length > 0) return;
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
          advisories: proposal.advisories,
          risks: proposal.risks,
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
            advisories: proposal.advisories,
            risks: proposal.risks,
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
        autoScrollKey={`${messages.length}:${progressEvents.length}:${submitting ? "loading" : "idle"}:${proposal ? "proposal" : "none"}:${pendingTemplateDecisionSlots.length ? "slots" : "no-slots"}`}
        stageCard={!submitting && proposal ? (
          <ArtifactAiStageCard
            title="Template Plan"
            summary=""
            stageLabel={pendingTemplateDecisionSlots.length > 0 ? "Decision Needed" : (proposal?.validation?.compiled_ok === false ? "Needs Fix" : "Ready to Apply")}
            stageTone={pendingTemplateDecisionSlots.length > 0 ? "warning" : (proposal?.validation?.compiled_ok === false ? "error" : "primary")}
            advisories={proposal.advisories}
            risks={proposal.risks}
            requiredQuestions={proposal.requiredQuestions}
            assumptions={proposal.assumptions}
            warnings={proposal.warnings}
            validation={proposal.validation}
          />
        ) : null}
        inputValue={input}
        onInputChange={setInput}
        onSend={handleSend}
        inputDisabled={disabled || submitting || !endpoint || !draft}
        inputPlaceholder={t("settings.template_studio.describe_template_change")}
        minRows={1}
        decisionSlots={pendingTemplateDecisionSlots}
        onSelectDecisionSlotOption={submitTemplateDecisionSlotOption}
        actionStrip={actionStrip}
        pendingAssistantMessage={pendingAssistantMessage}
        pendingAssistantMessages={[]}
        inputBusy={submitting}
        inputBusyLabel={pendingAssistantMessage}
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
