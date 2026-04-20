import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Tabs from "../components/Tabs.jsx";
import AppSelect from "../components/AppSelect.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import {
  answerOctoAiQuestion,
  applyOctoAiPatchset,
  createOctoAiRelease,
  discardOctoAiSandbox,
  ensureOctoAiSandbox,
  generateOctoAiPatchset,
  getOctoAiSession,
  promoteOctoAiRelease,
  rollbackOctoAiPatchset,
  rollbackOctoAiRelease,
  sendOctoAiChatMessage,
  validateOctoAiPatchset,
} from "../api.js";
import { PRIMARY_BUTTON_SM, SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { DESKTOP_PANEL_SHELL } from "../ui/pageShell.js";
import AgentChatInput from "../ui/AgentChatInput.jsx";
import { useAccessContext } from "../access.js";
import useWorkspaceProviderStatus from "../hooks/useWorkspaceProviderStatus.js";
import useAiCapabilityCatalog from "../hooks/useAiCapabilityCatalog.js";
import ProviderSecretModal from "../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../components/ProviderUnavailableState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { getArtifactQuickActions } from "../aiCapabilities.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

function JsonBlock({ value }) {
  return (
    <pre className="text-xs whitespace-pre-wrap bg-base-200 rounded-lg p-3 h-full overflow-auto">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

function StatusChip({ label, tone = "ghost" }) {
  const className =
    tone === "primary"
      ? "badge badge-primary"
      : tone === "success"
        ? "badge badge-success"
        : tone === "warning"
          ? "badge badge-warning"
          : "badge badge-ghost";
  return <span className={className}>{label}</span>;
}

function humanizeArtifactType(artifactType) {
  if (typeof artifactType !== "string" || !artifactType.trim() || artifactType === "none") return "";
  return artifactType.replace(/_/g, " ").trim();
}

function humanizeArtifactKey(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const text = value.trim();
  if (/^[0-9a-f-]{24,}$/i.test(text)) return text;
  const tail = text.split(".").pop() || text;
  return tail.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function humanizePlanStatus(status) {
  if (typeof status !== "string" || !status.trim()) return "planned";
  return status.replace(/_/g, " ");
}

function ActionStrip({ actions, busy = false }) {
  const visible = Array.isArray(actions) ? actions.filter((item) => item && item.label && typeof item.onClick === "function") : [];
  if (!visible.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
        {visible.map((action) => (
          <button
            key={action.label}
            type="button"
            className={action.primary ? "btn btn-sm btn-primary" : "btn btn-sm"}
            disabled={busy || action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}

function InfoList({ title, items, emptyText }) {
  return (
    <div className="rounded-box border border-base-200 bg-base-100 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{title}</div>
      {Array.isArray(items) && items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm leading-6">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="opacity-60">-</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-sm opacity-60">{emptyText}</div>
      )}
    </div>
  );
}

function summarizePatchsetRevision(patchset, t) {
  if (!patchset || typeof patchset !== "object") return t("revision.default");
  const ops = Array.isArray(patchset?.patch_json?.operations) ? patchset.patch_json.operations.filter((op) => op && typeof op === "object") : [];
  if (!ops.length) return t("revision.noop");
  const labels = [];
  for (const op of ops) {
    if (op.op === "add_field") {
      const field = op.field && typeof op.field === "object" ? op.field : {};
      if (typeof field.label === "string" && field.label.trim()) labels.push(t("revision.add_field", { field: field.label }));
      continue;
    }
    if (op.op === "insert_section_field") {
      if (typeof op.placement_label === "string" && op.placement_label.trim()) labels.push(t("revision.place_in", { placement: op.placement_label }));
      continue;
    }
    if (op.op === "create_module" && typeof op.artifact_id === "string" && op.artifact_id.trim()) {
      labels.push(t("revision.create_module", { module: op.artifact_id }));
      continue;
    }
  }
  return labels.slice(0, 2).join(" • ") || t("revision.change_count", { count: ops.length });
}

function patchsetActivityTimestamp(patchset) {
  if (!patchset || typeof patchset !== "object") return 0;
  const candidates = [
    patchset.applied_at,
    patchset.validated_at,
    patchset.updated_at,
    patchset.created_at,
  ];
  for (const value of candidates) {
    if (typeof value !== "string" || !value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function patchsetStatusRank(patchset) {
  const status = typeof patchset?.status === "string" ? patchset.status : "";
  if (status === "applied") return 5;
  if (status === "approved") return 4;
  if (status === "validated") return 3;
  if (status === "invalid") return 2;
  if (status === "draft") return 1;
  return 0;
}

function comparePatchsetsNewestFirst(left, right) {
  const timestampDelta = patchsetActivityTimestamp(right) - patchsetActivityTimestamp(left);
  if (timestampDelta !== 0) return timestampDelta;
  const rankDelta = patchsetStatusRank(right) - patchsetStatusRank(left);
  if (rankDelta !== 0) return rankDelta;
  const leftId = typeof left?.id === "string" ? left.id : "";
  const rightId = typeof right?.id === "string" ? right.id : "";
  return rightId.localeCompare(leftId);
}

function latestPatchsetFromList(patchsets, planId = "") {
  if (!Array.isArray(patchsets) || patchsets.length === 0) return null;
  const scoped = planId ? patchsets.filter((item) => item?.plan_id === planId) : patchsets;
  const candidates = scoped.length > 0 ? scoped : patchsets;
  return [...candidates].sort(comparePatchsetsNewestFirst)[0] || null;
}

function DetailsDrawer({ open, onClose, activeTab, onTabChange, sections, t }) {
  if (!open) return null;
  const tabs = [
    { id: "changes", label: t("details.tabs.changes") },
    { id: "validation", label: t("details.tabs.validation") },
    { id: "technical", label: t("details.tabs.technical") },
    { id: "history", label: t("details.tabs.history") },
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <button type="button" className="flex-1 cursor-default" aria-label={t("details.close_aria")} onClick={onClose} />
      <div className="h-full w-[min(720px,92vw)] border-l border-base-300 bg-base-100 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-base-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">{t("details.title")}</div>
            <div className="text-xs opacity-60">{t("details.description")}</div>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t("details.close")}</button>
        </div>
        <div className="border-b border-base-200 p-3">
          <Tabs tabs={tabs} activeId={activeTab} onChange={onTabChange} fullWidth />
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {tabs.map((tab) => (
            <div key={tab.id} className={activeTab === tab.id ? "" : "hidden"}>
              <JsonBlock value={sections?.[tab.id] || {}} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function questionKind(meta) {
  return meta && typeof meta === "object" && typeof meta.kind === "string" ? meta.kind : "text";
}

function questionNeedsTypedReply(meta) {
  const kind = questionKind(meta);
  if (kind === "decision_slot") {
    const options = Array.isArray(meta?.options) ? meta.options.filter((item) => item && typeof item === "object") : [];
    return options.length === 0 || Boolean(meta?.allow_free_text);
  }
  return ["text", "module_target", "entity_target", "field_target", "tab_target", "target_resolution"].includes(kind);
}

function extractDecisionSlots(latestPlan) {
  const direct = Array.isArray(latestPlan?.plan_json?.plan?.decision_slots) ? latestPlan.plan_json.plan.decision_slots : [];
  if (direct.length > 0) return direct.filter((item) => item && typeof item === "object");
  const planV1Direct = Array.isArray(latestPlan?.plan_json?.plan?.plan_v1?.decision_slots) ? latestPlan.plan_json.plan.plan_v1.decision_slots : [];
  if (planV1Direct.length > 0) return planV1Direct.filter((item) => item && typeof item === "object");
  const structured = Array.isArray(latestPlan?.plan_json?.plan?.structured_plan?.decision_slots) ? latestPlan.plan_json.plan.structured_plan.decision_slots : [];
  if (structured.length > 0) return structured.filter((item) => item && typeof item === "object");
  const clarificationSlots = Array.isArray(latestPlan?.plan_json?.plan?.plan_v1?.clarifications?.slots) ? latestPlan.plan_json.plan.plan_v1.clarifications.slots : [];
  if (clarificationSlots.length > 0) return clarificationSlots.filter((item) => item && typeof item === "object");
  return [];
}

function chatTextLooksLikeNewRequest(text) {
  if (typeof text !== "string") return false;
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.split(/\s+/).length < 3) return false;
  const hasEditVerb = /\b(add|create|make|update|change|remove|delete|build|upgrade|move|put|rename|hide|show)\b/.test(normalized);
  if (!hasEditVerb) return false;
  const hasRequestFrame = /\b(can|could|would|will)\s+you\b|\bi want(?: you)? to\b/.test(normalized);
  const hasRevisionMarker = /\b(actually|instead|switch|now|also|another|too|as well|there|same tab|same section|same module|follow[- ]?up)\b/.test(normalized);
  return hasRequestFrame || hasRevisionMarker || normalized.split(/\s+/).length >= 5;
}

function summarizeAnswer(msg, t) {
  if (!msg || typeof msg !== "object") return "";
  const answer = msg.answer_json && typeof msg.answer_json === "object" ? msg.answer_json : null;
  const body = typeof msg.body === "string" ? msg.body.trim() : "";
  if (!answer) return body;
  if (typeof answer.field_label === "string" && answer.field_label.trim() && typeof answer.field_type === "string" && answer.field_type.trim()) {
    return `${body || t("answers.saved_details")}\n${t("answers.field_value", { field: answer.field_label.trim(), type: answer.field_type.trim() })}`;
  }
  if (typeof answer.include_form === "boolean" || typeof answer.include_list === "boolean") {
    const placement =
      answer.include_form && answer.include_list
        ? t("answers.placement.form_and_list")
        : answer.include_form
          ? t("answers.placement.form_only")
          : answer.include_list
            ? t("answers.placement.list_only")
            : t("answers.placement.schema_only");
    return `${body || t("answers.answered")}\n${t("answers.decision_value", { value: placement })}`;
  }
  if (typeof answer.deduplicate_existing === "boolean") {
    return `${body || t("answers.answered")}\n${t("answers.decision_value", { value: answer.deduplicate_existing ? t("answers.deduplicate") : t("answers.keep_duplicates") })}`;
  }
  if (typeof answer.confirm_plan === "boolean") {
    return answer.confirm_plan ? t("answers.approved") : body || t("answers.needs_changes");
  }
  if (typeof answer.selected_option_label === "string" && answer.selected_option_label.trim()) {
    return `${body || t("answers.answered")}\n${answer.selected_option_label.trim()}`;
  }
  if (typeof answer.recipient_email === "string" && answer.recipient_email.trim()) {
    return `${body || t("answers.answered")}\n${answer.recipient_email.trim()}`;
  }
  if (typeof answer.tab_target === "string" && answer.tab_target.trim()) {
    return `${body || t("answers.answered")}\n${t("answers.tab_value", { value: answer.tab_target.trim() })}`;
  }
  if (typeof answer.field_target === "string" && answer.field_target.trim()) {
    return `${body || t("answers.answered")}\n${t("answers.field_target_value", { value: answer.field_target.trim() })}`;
  }
  return body;
}

function chatMessageText(msg, t) {
  if (!msg || typeof msg !== "object") return "";
  if (msg.message_type === "answer") return summarizeAnswer(msg, t);
  if (msg.role === "assistant" && typeof msg.body === "string" && msg.body.includes("I understand this as:")) {
    const lines = msg.body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sections = { understanding: [], changes: [], checks: [], next: [] };
    let current = "understanding";
    for (const line of lines) {
      if (line === "I understand this as:") {
        current = "understanding";
        continue;
      }
      if (line === "Planned changes:") {
        current = "changes";
        continue;
      }
      if (line === "What to check in sandbox:") {
        current = "checks";
        continue;
      }
      if (/^If this looks right, confirm the plan/i.test(line) || /^Plan confirmed\./i.test(line)) {
        sections.next.push(line);
        current = "next";
        continue;
      }
      if (line.endsWith(":")) {
        current = "";
        continue;
      }
      if (current && line.startsWith("- ")) {
        sections[current]?.push(line.slice(2).trim());
      } else if (current === "understanding") {
        sections.understanding.push(line);
      }
    }
    const compact = [];
    if (sections.understanding[0]) compact.push(`${t("chat.summary.plan")}\n${sections.understanding[0]}`);
    if (sections.changes.length) {
      compact.push(`${t("chat.summary.changes")}\n${sections.changes.slice(0, 3).map((line) => `- ${line}`).join("\n")}`);
    }
    if (sections.checks.length) {
      compact.push(`${t("chat.summary.check_sandbox")}\n${sections.checks.slice(0, 2).map((line) => `- ${line}`).join("\n")}`);
    }
    if (sections.next[0]) {
      const nextText = /^Plan confirmed\./i.test(sections.next[0])
        ? t("chat.summary.plan_approved_next")
        : sections.next[0];
      compact.push(`${t("chat.summary.next")}\n${nextText}`);
    }
    return compact.join("\n\n") || msg.body;
  }
  return typeof msg.body === "string" ? msg.body : "";
}

function shouldHideChatMessage(msg, index, messages) {
  if (!msg || typeof msg !== "object") return false;
  const answer = msg.answer_json && typeof msg.answer_json === "object" ? msg.answer_json : null;
  if (msg.message_type === "answer" && answer?.confirm_plan === true) {
    return true;
  }
  if (msg.role === "assistant" && typeof msg.body === "string" && msg.body.startsWith("Plan approved.")) {
    const laterMessages = Array.isArray(messages) ? messages.slice(index + 1) : [];
    if (
      laterMessages.some(
        (item) =>
          item?.role === "assistant"
          && typeof item?.body === "string"
          && item.body.startsWith("Sandbox updated."),
      )
    ) {
      return true;
    }
  }
  return false;
}

function messageRoleClass(msg) {
  if (msg?.role === "user") return "chat-end";
  return "chat-start";
}

function messageBubbleClass(msg) {
  if (msg?.role === "user") return "chat-bubble max-w-[85%] bg-primary text-primary-content text-sm leading-5";
  return "chat-bubble max-w-[85%] bg-base-200 text-base-content text-sm leading-5";
}

function messageRoleLabel(msg, t) {
  if (msg?.role === "user") return t("chat.roles.you");
  return msg?.role === "assistant" ? t("chat.roles.assistant") : (msg?.role || t("chat.roles.assistant"));
}

function buildWorkspaceFrameSrc({ sessionId, sandboxWorkspaceId }) {
  const params = new URLSearchParams();
  params.set("octo_ai_frame", "1");
  params.set("octo_ai_sandbox", "1");
  if (sessionId) params.set("octo_ai_session", sessionId);
  if (sandboxWorkspaceId) params.set("octo_ai_workspace", sandboxWorkspaceId);
  return `/home?${params.toString()}`;
}

function buildLiveWorkspaceFrameSrc() {
  const params = new URLSearchParams();
  params.set("octo_ai_frame", "1");
  params.set("octo_ai_sandbox", "0");
  params.set("octo_ai_live", "1");
  return `/home?${params.toString()}`;
}

function isActiveSession(status) {
  return ["draft", "planning", "waiting_input", "ready_to_apply", "applied", "failed"].includes(status || "draft");
}

function resolveChangeRequestStage({ hasStarted, hasPendingQuestion, latestPatchset, latestRelease, releaseStatus, applying, publishing }) {
  if (!hasStarted) return "idle";
  if (publishing) return "publishing";
  if (releaseStatus === "promoted" || latestRelease?.status === "promoted") return "published";
  if (applying) return "applying";
  if (latestPatchset?.status === "applied" || latestRelease?.status === "draft") return "sandbox_ready";
  if (hasPendingQuestion || !latestPatchset) return "planning";
  if (["validated", "approved", "draft"].includes(String(latestPatchset?.status || ""))) return "ready_to_apply";
  return "planning";
}

function questionSupersededByAppliedRevision(latestPlan, latestPatchset) {
  if (!latestPlan) return false;
  if (!latestPatchset || latestPatchset?.status !== "applied") return false;
  const planCreatedAt = typeof latestPlan?.created_at === "string" ? latestPlan.created_at : "";
  const appliedAt =
    typeof latestPatchset?.applied_at === "string" && latestPatchset.applied_at
      ? latestPatchset.applied_at
      : typeof latestPatchset?.created_at === "string"
        ? latestPatchset.created_at
        : "";
  return Boolean(planCreatedAt && appliedAt && appliedAt > planCreatedAt);
}

export default function OctoAiWorkspacePage() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const { t } = useI18n();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { hasCapability } = useAccessContext();
  const { providers: aiProviders, loading: providerStatusLoading, reload: reloadProviderStatus } = useWorkspaceProviderStatus(["openai"]);
  const { capabilities: aiCapabilities } = useAiCapabilityCatalog();
  const chatScrollRef = useRef(null);
  const chatBottomRef = useRef(null);
  const composerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldSpecLabel, setFieldSpecLabel] = useState("");
  const [fieldSpecType, setFieldSpecType] = useState("string");
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState("changes");
  const [applyingRevision, setApplyingRevision] = useState(false);
  const [publishingRevision, setPublishingRevision] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewNotice, setPreviewNotice] = useState("");
  const [agentTab, setAgentTab] = useState("chat");
  const [mobileUtilitySheet, setMobileUtilitySheet] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const [pendingChatMessage, setPendingChatMessage] = useState(null);
  const [pendingAssistantState, setPendingAssistantState] = useState("");
  const [openAiModalOpen, setOpenAiModalOpen] = useState(false);
  const [data, setData] = useState({ session: null, messages: [], plans: [], patchsets: [], releases: [], validation_runs: [], sandboxes: [], event_logs: [] });
  const openAiConnected = Boolean(aiProviders?.openai?.connected);
  const canManageSettings = hasCapability("workspace.manage_settings");
  const octoT = (key, values) => t(`settings.octo_ai.workspace.${key}`, values);

  const latestPlan = useMemo(() => (Array.isArray(data.plans) && data.plans.length > 0 ? data.plans[0] : null), [data.plans]);
  const latestPatchset = useMemo(() => latestPatchsetFromList(data.patchsets, latestPlan?.id || ""), [data.patchsets, latestPlan?.id]);
  const latestRelease = useMemo(() => (Array.isArray(data.releases) && data.releases.length > 0 ? data.releases[0] : null), [data.releases]);
  const latestPromotedRelease = useMemo(() => (Array.isArray(data.releases) ? data.releases.find((item) => item?.status === "promoted") || null : null), [data.releases]);
  const appliedRevisions = useMemo(
    () => (Array.isArray(data.patchsets) ? data.patchsets.filter((item) => item?.status === "applied") : []),
    [data.patchsets],
  );
  const currentSandboxRevision = useMemo(() => (appliedRevisions.length > 0 ? appliedRevisions[0] : null), [appliedRevisions]);
  const selectedRevision = useMemo(
    () => appliedRevisions.find((item) => item?.id === selectedRevisionId) || currentSandboxRevision || null,
    [appliedRevisions, currentSandboxRevision, selectedRevisionId],
  );
  const selectedRevisionRelease = useMemo(
    () =>
      Array.isArray(data.releases) && selectedRevision?.id
        ? data.releases.find((item) => item?.patchset_id === selectedRevision.id && item?.status !== "rolled_back") || null
        : null,
    [data.releases, selectedRevision?.id],
  );
  const visibleMessages = useMemo(() => {
    const allMessages = Array.isArray(data.messages) ? data.messages : [];
    return allMessages.filter((msg, index) => !shouldHideChatMessage(msg, index, allMessages));
  }, [data.messages]);
  const renderedMessages = useMemo(() => {
    const items = [...visibleMessages];
    if (pendingChatMessage) {
      items.push({
        id: pendingChatMessage.id,
        role: "user",
        body: pendingChatMessage.body,
      });
    }
    if (pendingAssistantState) {
      items.push({
        id: `pending-assistant:${pendingAssistantState}`,
        role: "assistant",
        body: pendingAssistantState,
        pending: true,
      });
    }
    return items;
  }, [pendingAssistantState, pendingChatMessage, visibleMessages]);
  const activeQuestionMeta = useMemo(() => {
    const direct = latestPlan?.required_question_meta;
    if (direct && typeof direct === "object") return direct;
    const nested = latestPlan?.plan_json?.plan?.required_question_meta;
    if (nested && typeof nested === "object") return nested;
    return null;
  }, [latestPlan]);
  const activeQuestion = useMemo(() => {
    const direct = Array.isArray(latestPlan?.questions_json) ? latestPlan.questions_json : [];
    if (direct.length > 0 && typeof direct[0] === "string" && direct[0].trim()) return direct[0].trim();
    const nested = Array.isArray(latestPlan?.plan_json?.plan?.required_questions) ? latestPlan.plan_json.plan.required_questions : [];
    if (nested.length > 0 && typeof nested[0] === "string" && nested[0].trim()) return nested[0].trim();
    return "";
  }, [latestPlan]);
  const activeDecisionSlots = useMemo(() => extractDecisionSlots(latestPlan), [latestPlan]);
  const hasPendingQuestion = useMemo(() => {
    if (!activeQuestion) return false;
    return !questionSupersededByAppliedRevision(latestPlan, latestPatchset);
  }, [activeQuestion, latestPatchset, latestPlan]);
  const hasConversationStarted = useMemo(
    () => Array.isArray(data.messages) && data.messages.some((msg) => typeof chatMessageText(msg, octoT) === "string" && chatMessageText(msg, octoT).trim()),
    [data.messages, t],
  );
  const latestPlanOps = useMemo(() => {
    const direct = Array.isArray(latestPlan?.plan_json?.plan?.candidate_operations) ? latestPlan.plan_json.plan.candidate_operations : [];
    return direct.filter((op) => op && typeof op === "object");
  }, [latestPlan]);
  const structuredPlan = useMemo(() => {
    const plan = latestPlan?.plan_json?.plan;
    if (!plan || typeof plan !== "object") return null;
    if (plan.plan_v1 && typeof plan.plan_v1 === "object") return plan.plan_v1;
    return plan.structured_plan && typeof plan.structured_plan === "object" ? plan.structured_plan : null;
  }, [latestPlan]);
  const latestAdvisories = useMemo(() => {
    const advisories = latestPlan?.plan_json?.plan?.advisories;
    return Array.isArray(advisories) ? advisories.filter((item) => typeof item === "string" && item.trim()) : [];
  }, [latestPlan]);
  const messageCount = Array.isArray(data.messages) ? data.messages.length : 0;
  const activeSession = useMemo(() => isActiveSession(data.session?.status), [data.session?.status]);
  const workspaceFrameSrc = useMemo(
    () =>
      buildWorkspaceFrameSrc({
        sessionId,
        sandboxWorkspaceId: data.session?.sandbox_workspace_id || "",
      }),
    [data.session?.sandbox_workspace_id, sessionId],
  );
  const liveWorkspaceFrameSrc = useMemo(() => buildLiveWorkspaceFrameSrc(), []);

  useEffect(() => {
    if (activeQuestionMeta?.kind === "field_spec") {
      const defaults = activeQuestionMeta?.defaults || {};
      setFieldSpecLabel(typeof defaults?.field_label === "string" ? defaults.field_label : "");
      setFieldSpecType(typeof defaults?.field_type === "string" ? defaults.field_type : "string");
      return;
    }
    setFieldSpecLabel("");
    setFieldSpecType("string");
  }, [activeQuestionMeta?.id, activeQuestionMeta?.kind, activeQuestion]);

  useEffect(() => {
    if (appliedRevisions.length === 0) {
      setSelectedRevisionId("");
      return;
    }
    if (!selectedRevisionId || !appliedRevisions.some((item) => item?.id === selectedRevisionId)) {
      setSelectedRevisionId(appliedRevisions[0]?.id || "");
    }
  }, [appliedRevisions, selectedRevisionId]);

  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messageCount, activeQuestion, loading, pendingAssistantState, pendingChatMessage]);

  useEffect(() => {
    if (!previewNotice) return undefined;
    const timer = window.setTimeout(() => setPreviewNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [previewNotice]);

  const changeSummaries = useMemo(() => {
    if (Array.isArray(structuredPlan?.changes) && structuredPlan.changes.length > 0) {
      return structuredPlan.changes.map((item) => item?.summary).filter((item) => typeof item === "string" && item.trim());
    }
    return latestPlanOps.map((item) => octoT("plan.op_in_artifact", { op: item.op, artifact: item.artifact_id || octoT("plan.workspace") }));
  }, [structuredPlan, latestPlanOps, t]);

  const artifactSummaries = useMemo(() => {
    if (Array.isArray(structuredPlan?.artifacts) && structuredPlan.artifacts.length > 0) {
      return structuredPlan.artifacts.map((item) => {
        const label = item?.artifact_label || item?.artifact_id || octoT("plan.workspace");
        const typeLabel = typeof item?.artifact_type === "string" ? item.artifact_type.replace(/_/g, " ") : "artifact";
        const status = humanizePlanStatus(item?.status);
        return `${label} (${typeLabel}, ${status})`;
      });
    }
    if (Array.isArray(structuredPlan?.modules) && structuredPlan.modules.length > 0) {
      return structuredPlan.modules.map((item) => {
        const label = item?.module_label || item?.module_id || octoT("plan.unknown_module");
        const status = item?.status === "missing_from_workspace" ? octoT("plan.missing_from_workspace") : octoT("plan.planned");
        return octoT("plan.module_status", { label, status });
      });
    }
    return [];
  }, [structuredPlan, t]);
  const selectedArtifactContext = useMemo(() => {
    const artifactType = typeof data.session?.selected_artifact_type === "string" ? data.session.selected_artifact_type : "none";
    const artifactKey = typeof data.session?.selected_artifact_key === "string" ? data.session.selected_artifact_key : "";
    if (!artifactType || artifactType === "none") {
      return { type: "none", key: "", label: "", typeLabel: "" };
    }
    const typeLabel = humanizeArtifactType(artifactType);
    const plannedArtifacts = Array.isArray(structuredPlan?.artifacts) ? structuredPlan.artifacts : [];
    const matchedArtifact = plannedArtifacts.find(
      (item) => item?.artifact_type === artifactType && item?.artifact_id === artifactKey,
    );
    const artifactLabel =
      (typeof matchedArtifact?.artifact_label === "string" && matchedArtifact.artifact_label.trim())
      || humanizeArtifactKey(artifactKey)
      || artifactKey;
    return {
      type: artifactType,
      key: artifactKey,
      label: artifactLabel,
      typeLabel,
    };
  }, [data.session?.selected_artifact_key, data.session?.selected_artifact_type, structuredPlan?.artifacts]);
  const artifactFocusActions = useMemo(() => {
    return getArtifactQuickActions(
      aiCapabilities,
      selectedArtifactContext.type,
      {
        surface: "workspace",
        artifactLabel: selectedArtifactContext.label || "selected artifact",
      },
    );
  }, [aiCapabilities, selectedArtifactContext.label, selectedArtifactContext.type]);

  async function refreshSession(options = {}) {
    if (!sessionId) return;
    const showLoading = options.showLoading !== false;
    if (showLoading) setLoading(true);
    setError("");
    try {
      const sessionRes = await getOctoAiSession(sessionId);
      setData({
        session: sessionRes?.session || null,
        messages: Array.isArray(sessionRes?.messages) ? sessionRes.messages : [],
        plans: Array.isArray(sessionRes?.plans) ? sessionRes.plans : [],
        patchsets: Array.isArray(sessionRes?.patchsets) ? sessionRes.patchsets : [],
        releases: Array.isArray(sessionRes?.releases) ? sessionRes.releases : [],
        validation_runs: Array.isArray(sessionRes?.validation_runs) ? sessionRes.validation_runs : [],
        sandboxes: Array.isArray(sessionRes?.sandboxes) ? sessionRes.sandboxes : [],
        event_logs: Array.isArray(sessionRes?.event_logs) ? sessionRes.event_logs : [],
      });
    } catch (err) {
      setError(err?.message || octoT("errors.load_session"));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    refreshSession({ showLoading: true });
  }, [sessionId]);

  async function submitQuestionAnswer(action, payload = {}) {
    if (!sessionId || !hasPendingQuestion) return;
    const text = typeof payload?.text === "string" ? payload.text : "";
    const hints = payload?.hints && typeof payload.hints === "object" ? payload.hints : undefined;
    setBusy(true);
    setError("");
    if (text) {
      setPendingChatMessage({ id: `pending-user:${Date.now()}`, body: text });
    }
    setPendingAssistantState(octoT("pending.updating_request"));
    try {
      await answerOctoAiQuestion(sessionId, {
        action,
        text: text || undefined,
        hints,
        question_id: activeQuestionMeta?.id || undefined,
      });
      await refreshSession({ showLoading: false });
    } catch (err) {
      setError(err?.message || octoT("errors.submit_answer"));
    } finally {
      setPendingChatMessage(null);
      setPendingAssistantState("");
      setBusy(false);
    }
  }

  async function submitDecisionSlotOption(slot, option) {
    if (!slot || !option) return;
    const optionValue = typeof option?.value === "string" ? option.value.trim() : "";
    const optionLabel = typeof option?.label === "string" && option.label.trim() ? option.label.trim() : optionValue;
    const hints = {
      ...(option?.hints && typeof option.hints === "object" ? option.hints : {}),
      selected_option_id: typeof option?.id === "string" ? option.id : undefined,
      selected_option_value: optionValue || undefined,
      selected_option_label: optionLabel || undefined,
    };
    if (typeof slot?.hint_field === "string" && slot.hint_field.trim() && optionValue) {
      hints[slot.hint_field.trim()] = optionValue;
    }
    await submitQuestionAnswer("custom", {
      text: optionLabel || optionValue,
      hints,
    });
  }

  async function submitChatRequest(rawText, options = {}) {
    const text = typeof rawText === "string" ? rawText.trim() : "";
    if (!text || streaming || busy) return;
    if (!openAiConnected) {
      if (canManageSettings) {
        setOpenAiModalOpen(true);
      } else {
        setError(octoT("errors.openai_not_connected"));
      }
      return;
    }
    const bypassPendingQuestion = options?.forceNewRequest === true || (hasPendingQuestion && chatTextLooksLikeNewRequest(text));
    if (hasPendingQuestion && !bypassPendingQuestion) {
      const hints = activeQuestionMeta?.kind === "field_spec"
        ? {
            field_label: fieldSpecLabel.trim() || undefined,
            field_type: fieldSpecType || undefined,
            field_id: activeQuestionMeta?.defaults?.field_id || undefined,
          }
        : undefined;
      await submitQuestionAnswer("custom", { text, hints });
      if (options?.clearInput !== false) setMessage("");
      return;
    }
    setStreaming(true);
    setError("");
    setPendingChatMessage({ id: `pending-user:${Date.now()}`, body: text });
    setPendingAssistantState(octoT("pending.planning_change"));
    try {
      await sendOctoAiChatMessage(sessionId, { message: text });
      if (options?.clearInput !== false) setMessage("");
      await refreshSession({ showLoading: false });
    } catch (err) {
      if (err?.code === "OPENAI_NOT_CONFIGURED" || (err?.message || "").includes("OpenAI")) {
        if (canManageSettings) {
          setOpenAiModalOpen(true);
        } else {
          setError(octoT("errors.openai_not_connected"));
        }
      } else {
      setError(err?.message || octoT("errors.send_message"));
      }
    } finally {
      setPendingChatMessage(null);
      setPendingAssistantState("");
      setStreaming(false);
    }
  }

  async function sendMessage() {
    await submitChatRequest(message, { clearInput: true });
  }

  async function sendFocusedIntent(action) {
    if (!action?.prompt) return;
    await submitChatRequest(action.prompt, { forceNewRequest: true, clearInput: true });
  }

  async function doEnsureSandbox() {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      await ensureOctoAiSandbox(sessionId);
      await refreshSession({ showLoading: false });
    } catch (err) {
      setError(err?.message || octoT("errors.prepare_sandbox"));
    } finally {
      setBusy(false);
    }
  }

  async function doDiscardSandbox() {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      await discardOctoAiSandbox(sessionId);
      navigate("/octo-ai");
    } catch (err) {
      setError(err?.message || octoT("errors.discard_sandbox"));
    } finally {
      setBusy(false);
    }
  }

  function doOpenLiveReference() {
    if (typeof window === "undefined") return;
    window.open(liveWorkspaceFrameSrc, "_blank", "noopener,noreferrer");
  }

  async function ensureValidatedRevision() {
    if (!sessionId) return "";
    if (!data.session?.sandbox_workspace_id) {
      await ensureOctoAiSandbox(sessionId);
    }
    await generateOctoAiPatchset(sessionId, {});
    const generated = await getOctoAiSession(sessionId);
    const patchset = latestPatchsetFromList(generated?.patchsets, latestPlan?.id || "");
    if (!patchset?.id) {
      throw new Error(octoT("errors.no_patchset_generated"));
    }
    await validateOctoAiPatchset(patchset.id);
    const refreshed = await refreshSession({ showLoading: false });
    const validatedPatchset = latestPatchsetFromList(refreshed?.patchsets, patchset.plan_id || latestPlan?.id || "");
    if (!validatedPatchset?.id) {
      throw new Error(octoT("errors.no_validated_revision"));
    }
    if (!["validated", "approved", "applied"].includes(String(validatedPatchset.status || ""))) {
      throw new Error(octoT("errors.patchset_not_validated", { status: String(validatedPatchset.status || octoT("plan.unknown_status")) }));
    }
    return validatedPatchset.id;
  }

  async function prepareLatestRevision() {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      await ensureValidatedRevision();
    } catch (err) {
      setError(err?.message || octoT("errors.prepare_latest_revision"));
    } finally {
      setBusy(false);
    }
  }

  async function doConfirmPlan() {
    if (!sessionId || !hasPendingQuestion) return;
    setApplyingRevision(true);
    setBusy(true);
    setError("");
    setPreviewNotice(octoT("preview.applying_approved_plan"));
    try {
      await answerOctoAiQuestion(sessionId, {
        action: "approve",
        question_id: activeQuestionMeta?.id || undefined,
      });
      await refreshSession({ showLoading: false });
      const patchsetId = await ensureValidatedRevision();
      if (!patchsetId) {
        throw new Error(octoT("errors.no_validated_revision_apply"));
      }
      await applyOctoAiPatchset(patchsetId, true);
      await refreshSession({ showLoading: false });
      setPreviewNonce((value) => value + 1);
      setPreviewNotice(octoT("preview.sandbox_updated"));
    } catch (err) {
      setError(err?.message || octoT("errors.confirm_plan"));
      setPreviewNotice("");
    } finally {
      setApplyingRevision(false);
      setBusy(false);
    }
  }

  async function doApplyRevision() {
    if (!latestPatchset?.id) return;
    setApplyingRevision(true);
    setBusy(true);
    setError("");
    setPreviewNotice(octoT("preview.applying_revision"));
    try {
      const patchsetId = ["validated", "approved", "applied"].includes(String(latestPatchset.status || ""))
        ? latestPatchset.id
        : await ensureValidatedRevision();
      await applyOctoAiPatchset(patchsetId, true);
      await refreshSession({ showLoading: false });
      setPreviewNonce((value) => value + 1);
      setPreviewNotice(octoT("preview.sandbox_updated"));
    } catch (err) {
      setError(err?.message || octoT("errors.apply_revision"));
      setPreviewNotice("");
    } finally {
      setApplyingRevision(false);
      setBusy(false);
    }
  }

  async function doPromoteRelease() {
    setPublishingRevision(true);
    setBusy(true);
    setError("");
    try {
      let releaseId = selectedRevisionRelease?.id || "";
      if (!releaseId) {
        const created = await createOctoAiRelease(sessionId, selectedRevision?.id ? { patchset_id: selectedRevision.id } : {});
        releaseId = typeof created?.release?.id === "string" ? created.release.id : "";
      }
      if (!releaseId) throw new Error(octoT("errors.no_release_available"));
      await promoteOctoAiRelease(releaseId);
      await refreshSession({ showLoading: false });
    } catch (err) {
      setError(err?.message || octoT("errors.promote_release"));
    } finally {
      setPublishingRevision(false);
      setBusy(false);
    }
  }

  async function doRestoreRevision() {
    if (!selectedRevision?.id || !currentSandboxRevision?.id || selectedRevision.id === currentSandboxRevision.id) return;
    const orderedApplied = appliedRevisions.map((item) => item?.id).filter(Boolean);
    const selectedIndex = orderedApplied.indexOf(selectedRevision.id);
    if (selectedIndex <= 0) return;
    const rollbackIds = orderedApplied.slice(0, selectedIndex);
    setRestoringRevision(true);
    setBusy(true);
    setError("");
    setPreviewNotice(octoT("preview.restoring_revision"));
    try {
      for (const patchsetId of rollbackIds) {
        await rollbackOctoAiPatchset(patchsetId);
      }
      await refreshSession({ showLoading: false });
      setPreviewNonce((value) => value + 1);
      setPreviewNotice(octoT("preview.sandbox_restored"));
    } catch (err) {
      setError(err?.message || octoT("errors.restore_revision"));
      setPreviewNotice("");
    } finally {
      setRestoringRevision(false);
      setBusy(false);
    }
  }

  async function doRollbackRelease() {
    if (!latestPromotedRelease?.id) return;
    setBusy(true);
    setError("");
    try {
      await rollbackOctoAiRelease(latestPromotedRelease.id);
      await refreshSession({ showLoading: false });
      setDetailsTab("history");
      setDetailsOpen(true);
    } catch (err) {
      setError(err?.message || octoT("errors.rollback_release"));
    } finally {
      setBusy(false);
    }
  }

  const requestStage = useMemo(
    () =>
      resolveChangeRequestStage({
        hasStarted: hasConversationStarted,
        hasPendingQuestion,
        latestPatchset,
        latestRelease,
        releaseStatus: data.session?.release_status,
        applying: applyingRevision,
        publishing: publishingRevision,
      }),
    [applyingRevision, data.session?.release_status, hasConversationStarted, hasPendingQuestion, latestPatchset, latestRelease, publishingRevision],
  );
  const stageTone =
    requestStage === "idle"
      ? "ghost"
      : requestStage === "published"
      ? "success"
      : requestStage === "sandbox_ready" || requestStage === "ready_to_apply"
        ? "primary"
        : requestStage === "applying" || requestStage === "publishing"
          ? "warning"
          : "ghost";
  const requestStageLabel = octoT(`stages.${requestStage}`);
  const detailsPayload = useMemo(
    () => ({
      changes: {
        summary: structuredPlan || latestPlan?.plan_json || {},
        patchset: latestPatchset?.patch_json || {},
        releases: data.releases || [],
      },
      validation: latestPatchset?.validation_json || {},
      technical: {
        session: data.session || {},
        patchset: latestPatchset || {},
        events: data.event_logs || [],
      },
      history: {
        patchsets: data.patchsets || [],
        validation_runs: data.validation_runs || [],
        sandboxes: data.sandboxes || [],
        releases: data.releases || [],
      },
    }),
    [data.event_logs, data.patchsets, data.releases, data.sandboxes, data.session, data.validation_runs, latestPatchset, latestPlan, structuredPlan],
  );
  const planSummaryText = structuredPlan?.summary
    || changeSummaries[0]
    || data.session?.summary
    || octoT("plan.default_summary");
  const composerPlaceholder = useMemo(() => {
    if (requestStage === "idle") return octoT("placeholders.idle");
    if (requestStage === "planning") return octoT("placeholders.planning");
    if (requestStage === "ready_to_apply") return octoT("placeholders.ready_to_apply");
    if (requestStage === "applying") return octoT("placeholders.applying");
    if (requestStage === "sandbox_ready") return octoT("placeholders.sandbox_ready");
    if (requestStage === "publishing") return octoT("placeholders.publishing");
    return octoT("placeholders.follow_up");
  }, [requestStage, t]);
  const openChangesView = useMemo(
    () => () => {
      if (isMobile) {
        setMobileUtilitySheet("details");
        return;
      }
      setDetailsTab("changes");
      setDetailsOpen(true);
    },
    [isMobile],
  );
  const actionStripActions = useMemo(() => {
    if (requestStage === "idle" && !selectedRevision) {
      return [];
    }
    if (hasPendingQuestion) {
      if (activeQuestionMeta?.kind === "confirm_plan") {
        return [
          { label: octoT("actions.apply_to_sandbox"), primary: true, onClick: doConfirmPlan, hint: octoT("hints.confirm_plan") },
          { label: octoT("actions.view_scope"), onClick: openChangesView },
        ];
      }
      if (activeDecisionSlots.length > 0) {
        return [
          { label: "Use custom answer", primary: true, onClick: () => composerRef.current?.focus(), hint: "Pick an option below or type a custom value." },
          { label: octoT("actions.view_scope"), onClick: openChangesView },
        ];
      }
      return [
        { label: octoT("actions.answer_in_chat"), primary: true, onClick: () => composerRef.current?.focus(), hint: octoT("hints.answer_in_chat") },
        { label: octoT("actions.view_scope"), onClick: openChangesView },
      ];
    }
    if (selectedRevision) {
      const publishingSelectedRevision = Boolean(currentSandboxRevision?.id && selectedRevision.id !== currentSandboxRevision.id);
      const actions = [
        {
          label: selectedRevisionRelease?.status === "promoted" ? octoT("actions.published") : publishingSelectedRevision ? octoT("actions.publish_selected_revision") : octoT("actions.publish_to_live"),
          primary: true,
          onClick: doPromoteRelease,
          disabled: publishingRevision || selectedRevisionRelease?.status === "promoted",
        },
        { label: octoT("actions.view_changes"), onClick: openChangesView },
      ];
      if (currentSandboxRevision?.id && selectedRevision.id !== currentSandboxRevision.id) {
        actions.push({ label: octoT("actions.restore_to_sandbox"), onClick: doRestoreRevision, disabled: restoringRevision });
      } else if (appliedRevisions.length > 1) {
        actions.push({ label: octoT("actions.revisions"), onClick: () => setAgentTab("revisions") });
      }
      return actions;
    }
    if (requestStage === "planning" || requestStage === "idle") {
      return [
        { label: octoT("actions.view_scope"), primary: true, onClick: openChangesView, hint: octoT("hints.view_scope") },
      ];
    }
    if (requestStage === "ready_to_apply") {
      return [
        { label: octoT("actions.apply_to_sandbox"), primary: true, onClick: doApplyRevision, hint: octoT("hints.apply_revision") },
        { label: octoT("actions.view_changes"), onClick: openChangesView },
      ];
    }
    if (requestStage === "applying") {
      return [
        { label: octoT("actions.applying_to_sandbox"), primary: true, onClick: () => {}, disabled: true, hint: octoT("hints.applying") },
      ];
    }
    if (requestStage === "publishing") {
      return [
        { label: octoT("actions.publishing"), primary: true, onClick: () => {}, disabled: true, hint: octoT("hints.publishing") },
      ];
    }
    if (requestStage === "published") {
      return [
        { label: octoT("actions.view_live"), primary: true, onClick: doOpenLiveReference, hint: octoT("hints.view_live") },
        { label: octoT("actions.roll_back"), onClick: doRollbackRelease, disabled: !latestPromotedRelease?.id },
        { label: octoT("actions.new_change_request"), onClick: () => navigate("/octo-ai") },
      ];
    }
    return [];
  }, [activeDecisionSlots.length, activeQuestionMeta?.kind, appliedRevisions.length, currentSandboxRevision?.id, hasPendingQuestion, latestPromotedRelease?.id, openChangesView, publishingRevision, requestStage, restoringRevision, selectedRevision, selectedRevisionRelease?.status, navigate, t]);

  const previewPane = (
    <div className={`relative h-full min-h-0 overflow-hidden ${isMobile ? "bg-base-100" : DESKTOP_PANEL_SHELL}`}>
      {previewNotice ? (
        <div className="absolute left-3 top-3 z-10 rounded-full border border-base-200 bg-base-100/95 px-3 py-1 text-xs font-medium text-primary shadow-sm">
          {previewNotice}
        </div>
      ) : null}
      {applyingRevision || publishingRevision ? (
        <div className="absolute right-3 top-3 z-10 rounded-full border border-base-200 bg-base-100/95 px-3 py-1 text-xs shadow-sm">
          {applyingRevision ? octoT("preview.applying_revision_short") : octoT("preview.publishing_short")}
        </div>
      ) : null}
      {!data.session?.sandbox_workspace_id ? (
        <div className="flex h-full items-center justify-center p-4 text-sm opacity-60">{octoT("preview.no_sandbox_workspace")}</div>
      ) : (
        <iframe
          key={`${workspaceFrameSrc}:${previewNonce}`}
          title={octoT("preview.title")}
          src={workspaceFrameSrc}
          className="h-full w-full border-0 bg-base-100"
        />
      )}
    </div>
  );

  const revisionsPane = (
    <div className="space-y-3">
      {appliedRevisions.map((patchset, index) => {
        const isSelected = patchset.id === selectedRevision?.id;
        const isCurrent = patchset.id === currentSandboxRevision?.id;
        const release = Array.isArray(data.releases) ? data.releases.find((item) => item?.patchset_id === patchset.id && item?.status !== "rolled_back") : null;
        return (
          <button
            key={patchset.id}
            type="button"
            onClick={() => setSelectedRevisionId(patchset.id)}
            className={`w-full rounded-lg border p-3 text-left ${isSelected ? "border-primary bg-primary/5" : "border-base-300 bg-base-100"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{octoT("revision.list_item", { number: appliedRevisions.length - index })}</div>
              <div className="flex items-center gap-2">
                {isCurrent ? <StatusChip label={octoT("revision.current")} tone="primary" /> : null}
                {release?.status === "promoted" ? <StatusChip label={octoT("revision.published")} tone="success" /> : null}
              </div>
            </div>
            <div className="mt-2 text-sm opacity-80">{summarizePatchsetRevision(patchset, octoT)}</div>
          </button>
        );
      })}
    </div>
  );

  const chatPane = (
    <div className="flex h-full min-h-0 flex-col space-y-3">
      {openAiConnected ? (
        <>
          <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-auto space-y-2">
            {renderedMessages.length > 0 ? (
              renderedMessages.map((msg) => (
                <div key={msg.id} className={`chat ${messageRoleClass(msg)}`}>
                  <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{messageRoleLabel(msg, octoT)}</div>
                  <div className={`${messageBubbleClass(msg)} whitespace-pre-wrap`}>
                    {msg.pending ? (
                      <div className="flex items-center gap-2">
                        <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                        <span>{msg.body}</span>
                      </div>
                    ) : (
                      chatMessageText(msg, octoT)
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="chat chat-start">
                <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{octoT("chat.roles.assistant")}</div>
                <div className={`${messageBubbleClass({ role: "assistant" })} whitespace-pre-wrap`}>
                  {octoT("chat.empty")}
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
          <div className="border-t border-base-200 pt-3 space-y-2">
            {hasPendingQuestion && activeQuestion ? (
              <div className="rounded-lg border border-base-300 bg-base-50 px-3 py-2 text-sm">
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">{octoT("chat.needs_input")}</div>
                <div className="mt-1 whitespace-pre-wrap">{activeQuestion}</div>
                {activeDecisionSlots.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {activeDecisionSlots.map((slot) => {
                      const options = Array.isArray(slot?.options) ? slot.options.filter((item) => item && typeof item === "object") : [];
                      return (
                        <div key={slot?.slot_id || slot?.label || slot?.prompt} className="rounded-lg border border-base-200 bg-base-100 px-3 py-3">
                          <div className="text-sm font-medium">{slot?.label || slot?.prompt || "Decision required"}</div>
                          {typeof slot?.why_needed === "string" && slot.why_needed.trim() ? (
                            <div className="mt-1 text-xs opacity-70">{slot.why_needed.trim()}</div>
                          ) : null}
                          {options.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {options.map((option) => (
                                <button
                                  key={option.id || option.value || option.label}
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  disabled={busy || streaming || applyingRevision || publishingRevision || restoringRevision}
                                  onClick={() => submitDecisionSlotOption(slot, option)}
                                >
                                  {option.label || option.value}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {options.some((option) => typeof option?.description === "string" && option.description.trim()) ? (
                            <div className="mt-2 space-y-1">
                              {options.map((option) => (
                                typeof option?.description === "string" && option.description.trim() ? (
                                  <div key={`${option.id || option.value || option.label}:description`} className="text-xs opacity-60">
                                    <span className="font-medium">{option.label || option.value}</span>: {option.description.trim()}
                                  </div>
                                ) : null
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {artifactFocusActions.length > 0 ? (
              <div className="rounded-lg border border-base-300 bg-base-100 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide opacity-60">Focused intents</div>
                  <span className="badge badge-outline badge-sm">
                    {selectedArtifactContext.typeLabel || "artifact"}{selectedArtifactContext.label ? `: ${selectedArtifactContext.label}` : ""}
                  </span>
                </div>
                <div className="mt-2 text-xs opacity-70">
                  Octo AI reuses the same module, automation, and template capability rules as the scoped editors.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {artifactFocusActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="btn btn-xs btn-outline"
                      disabled={streaming || busy || applyingRevision || publishingRevision || restoringRevision}
                      onClick={() => sendFocusedIntent(action)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {actionStripActions.length > 0 ? (
              <ActionStrip actions={actionStripActions} busy={busy || streaming || applyingRevision || publishingRevision || restoringRevision} />
            ) : null}
            {activeQuestionMeta?.kind === "field_spec" ? (
              <div className="space-y-2">
                <input
                  type="text"
                  className="input input-bordered input-sm w-full"
                  placeholder={octoT("field_spec.label_placeholder")}
                  value={fieldSpecLabel}
                  onChange={(e) => setFieldSpecLabel(e.target.value)}
                />
                <AppSelect className="select select-bordered select-sm w-full" value={fieldSpecType} onChange={(e) => setFieldSpecType(e.target.value)}>
                  {(activeQuestionMeta?.options?.field_types || []).map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </AppSelect>
              </div>
            ) : null}
            <AgentChatInput
              ref={composerRef}
              value={message}
              onChange={setMessage}
              onSend={sendMessage}
              placeholder={hasPendingQuestion ? (questionNeedsTypedReply(activeQuestionMeta) ? octoT("placeholders.question_reply") : octoT("placeholders.question_clarification")) : composerPlaceholder}
              disabled={streaming || busy || applyingRevision || publishingRevision || restoringRevision}
              minRows={1}
            />
          </div>
        </>
      ) : providerStatusLoading ? (
        <LoadingSpinner className="min-h-0 h-full" />
      ) : (
        <ProviderUnavailableState
          title={octoT("provider_unavailable.title")}
          description={octoT("provider_unavailable.description")}
          actionLabel={octoT("provider_unavailable.action")}
          canManageSettings={canManageSettings}
          loading={providerStatusLoading}
          onAction={() => setOpenAiModalOpen(true)}
        />
      )}
    </div>
  );

  const mobileDetailsPane = (
    <div className="space-y-3">
      <InfoList title={octoT("lists.plan_summary")} items={planSummaryText ? [planSummaryText] : []} emptyText={octoT("lists.no_summary")} />
      <InfoList title={octoT("lists.changes")} items={changeSummaries} emptyText={octoT("lists.no_changes")} />
      <InfoList
        title={Array.isArray(structuredPlan?.artifacts) && structuredPlan.artifacts.length > 0 ? "Affected artifacts" : octoT("lists.modules")}
        items={artifactSummaries}
        emptyText={Array.isArray(structuredPlan?.artifacts) && structuredPlan.artifacts.length > 0 ? "No affected artifacts yet." : octoT("lists.no_modules")}
      />
      <InfoList title={octoT("lists.advisories")} items={latestAdvisories} emptyText={octoT("lists.no_advisories")} />
    </div>
  );

  const mobileAgentPane = (
    <div className="space-y-4">
      {appliedRevisions.length > 0 ? (
        <Tabs
          tabs={[
            { id: "chat", label: octoT("tabs.chat") },
            { id: "revisions", label: octoT("tabs.revisions_count", { count: appliedRevisions.length }) },
          ]}
          activeId={agentTab}
          onChange={setAgentTab}
          fullWidth
        />
      ) : null}
      <div className="min-h-0">
        {agentTab === "revisions" && appliedRevisions.length > 0 ? revisionsPane : chatPane}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="h-full min-h-0 bg-base-100 flex flex-col overflow-hidden">
        {error ? <div className="alert alert-error text-sm rounded-none">{error}</div> : null}
        <div className="flex-1 min-h-0 flex flex-col bg-base-100 overflow-hidden">
          {loading ? (
            <div className="flex-1 min-h-0 flex items-center justify-center px-4 text-sm opacity-70">{octoT("loading_workspace")}</div>
          ) : !data.session?.sandbox_workspace_id || data.session?.sandbox_status === "discarded" ? (
            <div className="flex-1 min-h-0 flex flex-col px-4 py-5">
              <div className="rounded-none text-center gap-4 flex flex-col">
                <h2 className="text-lg font-semibold">{octoT("sandbox_not_ready.title")}</h2>
                <p className="text-sm opacity-75">
                  {activeSession
                    ? octoT("sandbox_not_ready.active_description")
                    : octoT("sandbox_not_ready.inactive_description")}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button className={SOFT_BUTTON_SM} onClick={() => navigate("/octo-ai")}>{octoT("actions.back_to_sessions")}</button>
                  <button className={SOFT_BUTTON_SM} onClick={() => navigate(`/octo-ai/sessions/${sessionId}`)}>{octoT("actions.view_history")}</button>
                  {activeSession ? (
                    <button className={PRIMARY_BUTTON_SM} disabled={busy} onClick={doEnsureSandbox}>{octoT("actions.create_sandbox")}</button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-base-200 bg-base-100 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold truncate">{data.session?.title || t("settings.octo_ai.change_request")}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusChip label={requestStageLabel} tone={stageTone} />
                      {selectedRevision ? (
                        <span className="text-xs opacity-60">
                          {selectedRevision.id === currentSandboxRevision?.id ? octoT("revision.current") : octoT("revision.selected_short", { id: selectedRevision.id.slice(0, 8) })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {appliedRevisions.length > 0 ? (
                      <button
                        type="button"
                        className={SOFT_BUTTON_SM}
                        onClick={() => {
                          setAgentTab("revisions");
                          setMobileUtilitySheet("agent");
                        }}
                      >
                        {octoT("actions.revisions")}
                      </button>
                    ) : null}
                    <button type="button" className={PRIMARY_BUTTON_SM} onClick={() => setMobileUtilitySheet("agent")}>
                      {octoT("actions.ai")}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-0 bg-base-100">
                <div className="h-full min-h-0">
                  {previewPane}
                </div>
              </div>
            </>
          )}
        </div>
        {mobileUtilitySheet ? (
          <div className="fixed inset-0 z-[220]">
            <button
              type="button"
              className="absolute inset-0 bg-base-content/35"
              aria-label={octoT("mobile.close_panel")}
              onClick={() => setMobileUtilitySheet("")}
            />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4 flex flex-col">
              <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
              <div className="flex items-center justify-between gap-2 pb-3">
                <div className="text-sm font-semibold">
                  {mobileUtilitySheet === "agent" ? octoT("mobile.agent") : mobileUtilitySheet === "preview" ? octoT("mobile.preview") : octoT("mobile.details")}
                </div>
                <button type="button" className={SOFT_BUTTON_SM} onClick={() => setMobileUtilitySheet("")}>{t("common.done")}</button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                {mobileUtilitySheet === "preview"
                  ? <div className="h-[60vh]">{previewPane}</div>
                  : mobileUtilitySheet === "agent"
                    ? mobileAgentPane
                    : mobileDetailsPane}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-6rem)] min-h-0 flex flex-col overflow-hidden">
      {error ? <div className="alert alert-error text-sm mb-4 flex-none">{error}</div> : null}

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="card bg-base-100 shadow h-full min-h-0 flex items-center justify-center overflow-hidden">
            <div className="opacity-70">{octoT("loading_workspace")}</div>
          </div>
        ) : !data.session?.sandbox_workspace_id || data.session?.sandbox_status === "discarded" ? (
          <div className="card bg-base-100 shadow h-full min-h-0 flex items-center justify-center overflow-hidden">
            <div className="max-w-xl space-y-4 p-6 text-center">
              <h2 className="text-xl font-semibold">{octoT("sandbox_not_ready.title")}</h2>
              <p className="text-sm opacity-75">
                {activeSession
                  ? octoT("sandbox_not_ready.active_description")
                  : octoT("sandbox_not_ready.inactive_description")}
              </p>
              <div className="flex items-center justify-center gap-2">
                <button className={SOFT_BUTTON_SM} onClick={() => navigate("/octo-ai")}>{octoT("actions.back_to_sessions")}</button>
                <button className={SOFT_BUTTON_SM} onClick={() => navigate(`/octo-ai/sessions/${sessionId}`)}>{octoT("actions.view_history")}</button>
                {activeSession ? (
                  <button className={PRIMARY_BUTTON_SM} disabled={busy} onClick={doEnsureSandbox}>{octoT("actions.create_sandbox")}</button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <PanelGroup direction="horizontal" autoSaveId="octo-ai-sandbox-shell" className="h-full min-h-0">
            <Panel defaultSize={72} minSize={50}>
              <div className="h-full min-h-0 flex flex-col overflow-hidden">
                <div className="flex-1 min-h-0">
                  {previewPane}
                </div>
              </div>
            </Panel>
            <PanelResizeHandle className="w-2 bg-base-200 hover:bg-base-300" />
            <Panel defaultSize={28} minSize={24} maxSize={42}>
              <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col overflow-hidden">
                <div className="border-b border-base-200 px-4 py-4">
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm font-semibold">{data.session?.title || t("settings.octo_ai.change_request")}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusChip label={requestStageLabel} tone={stageTone} />
                        {selectedRevision ? (
                          <span className="text-xs opacity-60">
                            {selectedRevision.id === currentSandboxRevision?.id ? octoT("revision.current") : octoT("revision.selected_short", { id: selectedRevision.id.slice(0, 8) })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {appliedRevisions.length > 0 ? (
                    <div className="mt-3">
                      <Tabs
                        tabs={[
                          { id: "chat", label: octoT("tabs.chat") },
                          { id: "revisions", label: octoT("tabs.revisions_count", { count: appliedRevisions.length }) },
                        ]}
                        activeId={agentTab}
                        onChange={setAgentTab}
                        fullWidth
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex-1 min-h-0 overflow-auto p-4">
                  {agentTab === "revisions" && appliedRevisions.length > 0 ? (
                    revisionsPane
                  ) : (
                    chatPane
                  )}
                </div>
              </div>
            </Panel>
          </PanelGroup>
        )}
      </div>
      <DetailsDrawer open={detailsOpen} onClose={() => setDetailsOpen(false)} activeTab={detailsTab} onTabChange={setDetailsTab} sections={detailsPayload} t={octoT} />
      <ProviderSecretModal
        open={openAiModalOpen}
        providerKey="openai"
        canManageSettings={canManageSettings}
        onClose={() => setOpenAiModalOpen(false)}
        onSaved={async () => {
          setOpenAiModalOpen(false);
          await reloadProviderStatus();
        }}
      />
    </div>
  );
}
