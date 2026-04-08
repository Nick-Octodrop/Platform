import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Tabs from "../components/Tabs.jsx";
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

function summarizePatchsetRevision(patchset) {
  if (!patchset || typeof patchset !== "object") return "Revision";
  const ops = Array.isArray(patchset?.patch_json?.operations) ? patchset.patch_json.operations.filter((op) => op && typeof op === "object") : [];
  if (!ops.length) return "No-op revision";
  const labels = [];
  for (const op of ops) {
    if (op.op === "add_field") {
      const field = op.field && typeof op.field === "object" ? op.field : {};
      if (typeof field.label === "string" && field.label.trim()) labels.push(`Add ${field.label}`);
      continue;
    }
    if (op.op === "insert_section_field") {
      if (typeof op.placement_label === "string" && op.placement_label.trim()) labels.push(`Place in ${op.placement_label}`);
      continue;
    }
    if (op.op === "create_module" && typeof op.artifact_id === "string" && op.artifact_id.trim()) {
      labels.push(`Create ${op.artifact_id}`);
      continue;
    }
  }
  return labels.slice(0, 2).join(" • ") || `${ops.length} change${ops.length === 1 ? "" : "s"}`;
}

function DetailsDrawer({ open, onClose, activeTab, onTabChange, sections }) {
  if (!open) return null;
  const tabs = [
    { id: "changes", label: "What Changed" },
    { id: "validation", label: "Validation" },
    { id: "technical", label: "Technical Details" },
    { id: "history", label: "History" },
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <button type="button" className="flex-1 cursor-default" aria-label="Close details" onClick={onClose} />
      <div className="h-full w-[min(720px,92vw)] border-l border-base-300 bg-base-100 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-base-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Request Details</div>
            <div className="text-xs opacity-60">Technical information is secondary to the main change-request flow.</div>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>Close</button>
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
  return ["text", "module_target", "entity_target", "field_target", "tab_target", "target_resolution"].includes(questionKind(meta));
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

function summarizeAnswer(msg) {
  if (!msg || typeof msg !== "object") return "";
  const answer = msg.answer_json && typeof msg.answer_json === "object" ? msg.answer_json : null;
  const body = typeof msg.body === "string" ? msg.body.trim() : "";
  if (!answer) return body;
  if (typeof answer.field_label === "string" && answer.field_label.trim() && typeof answer.field_type === "string" && answer.field_type.trim()) {
    return `${body || "Saved details."}\nField: ${answer.field_label.trim()} (${answer.field_type.trim()})`;
  }
  if (typeof answer.include_form === "boolean" || typeof answer.include_list === "boolean") {
    const placement =
      answer.include_form && answer.include_list
        ? "Form + list"
        : answer.include_form
          ? "Form only"
          : answer.include_list
            ? "List only"
            : "Schema only";
    return `${body || "Answered."}\nDecision: ${placement}`;
  }
  if (typeof answer.deduplicate_existing === "boolean") {
    return `${body || "Answered."}\nDecision: ${answer.deduplicate_existing ? "Deduplicate existing entries" : "Keep duplicates as-is"}`;
  }
  if (typeof answer.confirm_plan === "boolean") {
    return answer.confirm_plan ? "Approved." : body || "Needs changes.";
  }
  if (typeof answer.tab_target === "string" && answer.tab_target.trim()) {
    return `${body || "Answered."}\nTab: ${answer.tab_target.trim()}`;
  }
  if (typeof answer.field_target === "string" && answer.field_target.trim()) {
    return `${body || "Answered."}\nField: ${answer.field_target.trim()}`;
  }
  return body;
}

function chatMessageText(msg) {
  if (!msg || typeof msg !== "object") return "";
  if (msg.message_type === "answer") return summarizeAnswer(msg);
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
    if (sections.understanding[0]) compact.push(`Plan\n${sections.understanding[0]}`);
    if (sections.changes.length) {
      compact.push(`Changes\n${sections.changes.slice(0, 3).map((line) => `- ${line}`).join("\n")}`);
    }
    if (sections.checks.length) {
      compact.push(`Check in sandbox\n${sections.checks.slice(0, 2).map((line) => `- ${line}`).join("\n")}`);
    }
    if (sections.next[0]) {
      const nextText = /^Plan confirmed\./i.test(sections.next[0])
        ? "Plan approved. I prepared a validated revision. Next: Apply to Sandbox."
        : sections.next[0];
      compact.push(`Next\n${nextText}`);
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

function messageRoleLabel(msg) {
  if (msg?.role === "user") return "you";
  return msg?.role || "assistant";
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
  if (!hasStarted) return "Idle";
  if (publishing) return "Publishing";
  if (releaseStatus === "promoted" || latestRelease?.status === "promoted") return "Published";
  if (applying) return "Applying to Sandbox";
  if (latestPatchset?.status === "applied" || latestRelease?.status === "draft") return "Sandbox Ready";
  if (hasPendingQuestion || !latestPatchset) return "Planning";
  if (["validated", "approved", "draft"].includes(String(latestPatchset?.status || ""))) return "Ready to Apply";
  return "Planning";
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
  const isMobile = useMediaQuery("(max-width: 768px)");
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
  const [data, setData] = useState({ session: null, messages: [], plans: [], patchsets: [], releases: [], validation_runs: [], sandboxes: [], event_logs: [] });

  const latestPlan = useMemo(() => (Array.isArray(data.plans) && data.plans.length > 0 ? data.plans[0] : null), [data.plans]);
  const latestPatchset = useMemo(() => (Array.isArray(data.patchsets) && data.patchsets.length > 0 ? data.patchsets[0] : null), [data.patchsets]);
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
  const hasPendingQuestion = useMemo(() => {
    if (!activeQuestion) return false;
    return !questionSupersededByAppliedRevision(latestPlan, latestPatchset);
  }, [activeQuestion, latestPatchset, latestPlan]);
  const hasConversationStarted = useMemo(
    () => Array.isArray(data.messages) && data.messages.some((msg) => typeof chatMessageText(msg) === "string" && chatMessageText(msg).trim()),
    [data.messages],
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
    return latestPlanOps.map((item) => `${item.op} in ${item.artifact_id || "workspace"}`);
  }, [structuredPlan, latestPlanOps]);

  const moduleSummaries = useMemo(() => {
    if (Array.isArray(structuredPlan?.modules) && structuredPlan.modules.length > 0) {
      return structuredPlan.modules.map((item) => {
        const label = item?.module_label || item?.module_id || "Unknown module";
        const status = item?.status === "missing_from_workspace" ? "missing from workspace" : "planned";
        return `${label} (${status})`;
      });
    }
    return [];
  }, [structuredPlan]);

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
      setError(err?.message || "Failed to load session workspace");
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
    setPendingAssistantState("Updating the request...");
    try {
      await answerOctoAiQuestion(sessionId, {
        action,
        text: text || undefined,
        hints,
        question_id: activeQuestionMeta?.id || undefined,
      });
      await refreshSession({ showLoading: false });
    } catch (err) {
      setError(err?.message || "Failed to submit answer");
    } finally {
      setPendingChatMessage(null);
      setPendingAssistantState("");
      setBusy(false);
    }
  }

  async function sendMessage() {
    const text = message.trim();
    if (!text || streaming || busy) return;
    const bypassPendingQuestion = hasPendingQuestion && chatTextLooksLikeNewRequest(text);
    if (hasPendingQuestion && !bypassPendingQuestion) {
      const hints = activeQuestionMeta?.kind === "field_spec"
        ? {
            field_label: fieldSpecLabel.trim() || undefined,
            field_type: fieldSpecType || undefined,
            field_id: activeQuestionMeta?.defaults?.field_id || undefined,
          }
        : undefined;
      await submitQuestionAnswer("custom", { text, hints });
      setMessage("");
      return;
    }
    setStreaming(true);
    setError("");
    setPendingChatMessage({ id: `pending-user:${Date.now()}`, body: text });
    setPendingAssistantState("Planning the change...");
    try {
      await sendOctoAiChatMessage(sessionId, { message: text });
      setMessage("");
      await refreshSession({ showLoading: false });
    } catch (err) {
      setError(err?.message || "Failed to send AI message");
    } finally {
      setPendingChatMessage(null);
      setPendingAssistantState("");
      setStreaming(false);
    }
  }

  async function doEnsureSandbox() {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      await ensureOctoAiSandbox(sessionId);
      await refreshSession({ showLoading: false });
    } catch (err) {
      setError(err?.message || "Failed to prepare sandbox");
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
      setError(err?.message || "Failed to discard sandbox");
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
    const patchset = Array.isArray(generated?.patchsets) && generated.patchsets.length > 0 ? generated.patchsets[0] : null;
    if (!patchset?.id) {
      throw new Error("No patchset was generated for this request.");
    }
    await validateOctoAiPatchset(patchset.id);
    await refreshSession({ showLoading: false });
    return patchset.id;
  }

  async function prepareLatestRevision() {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      await ensureValidatedRevision();
    } catch (err) {
      setError(err?.message || "Failed to prepare the latest revision");
    } finally {
      setBusy(false);
    }
  }

  async function doConfirmPlan() {
    if (!sessionId || !hasPendingQuestion) return;
    setApplyingRevision(true);
    setBusy(true);
    setError("");
    setPreviewNotice("Applying approved plan to sandbox...");
    try {
      await answerOctoAiQuestion(sessionId, {
        action: "approve",
        question_id: activeQuestionMeta?.id || undefined,
      });
      await refreshSession({ showLoading: false });
      const patchsetId = await ensureValidatedRevision();
      if (!patchsetId) {
        throw new Error("No validated revision was available to apply.");
      }
      await applyOctoAiPatchset(patchsetId, true);
      await refreshSession({ showLoading: false });
      setPreviewNonce((value) => value + 1);
      setPreviewNotice("Sandbox updated");
    } catch (err) {
      setError(err?.message || "Failed to confirm the plan");
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
    setPreviewNotice("Applying revision to sandbox...");
    try {
      await applyOctoAiPatchset(latestPatchset.id, true);
      await refreshSession({ showLoading: false });
      setPreviewNonce((value) => value + 1);
      setPreviewNotice("Sandbox updated");
    } catch (err) {
      setError(err?.message || "Failed to apply the revision to sandbox");
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
      if (!releaseId) throw new Error("No release was available to publish.");
      await promoteOctoAiRelease(releaseId);
      await refreshSession({ showLoading: false });
    } catch (err) {
      setError(err?.message || "Failed to promote release");
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
    setPreviewNotice("Restoring selected sandbox revision...");
    try {
      for (const patchsetId of rollbackIds) {
        await rollbackOctoAiPatchset(patchsetId);
      }
      await refreshSession({ showLoading: false });
      setPreviewNonce((value) => value + 1);
      setPreviewNotice("Sandbox restored");
    } catch (err) {
      setError(err?.message || "Failed to restore the selected revision");
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
      setError(err?.message || "Failed to roll back the published release");
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
    requestStage === "Idle"
      ? "ghost"
      : requestStage === "Published"
      ? "success"
      : requestStage === "Sandbox Ready" || requestStage === "Ready to Apply"
        ? "primary"
        : requestStage === "Applying to Sandbox" || requestStage === "Publishing"
          ? "warning"
          : "ghost";
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
    || "Describe the change, confirm the plan, test it in sandbox, then publish when ready.";
  const composerPlaceholder = useMemo(() => {
    if (requestStage === "Idle") return "Describe the change you want to make...";
    if (requestStage === "Planning") return "Describe what you want changed, or refine the plan...";
    if (requestStage === "Ready to Apply") return "Review the validated revision, request changes, or add more instructions...";
    if (requestStage === "Applying to Sandbox") return "Applying revision to sandbox...";
    if (requestStage === "Sandbox Ready") return "Test the result, report issues, or request another revision...";
    if (requestStage === "Publishing") return "Publishing changes to live...";
    return "Describe a follow-up change...";
  }, [requestStage]);
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
    if (requestStage === "Idle" && !selectedRevision) {
      return [];
    }
    if (hasPendingQuestion) {
      if (activeQuestionMeta?.kind === "confirm_plan") {
        return [
          { label: "Apply to Sandbox", primary: true, onClick: doConfirmPlan, hint: "Approve the plan, validate the revision, and apply it to sandbox." },
          { label: "View Scope", onClick: openChangesView },
        ];
      }
      return [
        { label: "Answer in Chat", primary: true, onClick: () => composerRef.current?.focus(), hint: "This request needs one more detail before it can be applied." },
        { label: "View Scope", onClick: openChangesView },
      ];
    }
    if (selectedRevision) {
      const publishingSelectedRevision = Boolean(currentSandboxRevision?.id && selectedRevision.id !== currentSandboxRevision.id);
      const actions = [
        {
          label: selectedRevisionRelease?.status === "promoted" ? "Published" : publishingSelectedRevision ? "Publish Selected Revision" : "Publish to Live",
          primary: true,
          onClick: doPromoteRelease,
          disabled: publishingRevision || selectedRevisionRelease?.status === "promoted",
        },
        { label: "View Changes", onClick: openChangesView },
      ];
      if (currentSandboxRevision?.id && selectedRevision.id !== currentSandboxRevision.id) {
        actions.push({ label: "Restore to Sandbox", onClick: doRestoreRevision, disabled: restoringRevision });
      } else if (appliedRevisions.length > 1) {
        actions.push({ label: "Revisions", onClick: () => setAgentTab("revisions") });
      }
      return actions;
    }
    if (requestStage === "Planning" || requestStage === "Idle") {
      return [
        { label: "View Scope", primary: true, onClick: openChangesView, hint: "Review the current scope while you keep refining the request in chat." },
      ];
    }
    if (requestStage === "Ready to Apply") {
      return [
        { label: "Apply to Sandbox", primary: true, onClick: doApplyRevision, hint: "Apply the validated revision and refresh the preview automatically." },
        { label: "View Changes", onClick: openChangesView },
      ];
    }
    if (requestStage === "Applying to Sandbox") {
      return [
        { label: "Applying to Sandbox", primary: true, onClick: () => {}, disabled: true, hint: "The preview will refresh automatically when the apply completes." },
      ];
    }
    if (requestStage === "Publishing") {
      return [
        { label: "Publishing", primary: true, onClick: () => {}, disabled: true, hint: "Publishing this request to live now." },
      ];
    }
    if (requestStage === "Published") {
      return [
        { label: "View Live", primary: true, onClick: doOpenLiveReference, hint: "Open the live workspace to confirm the published result." },
        { label: "Roll Back", onClick: doRollbackRelease, disabled: !latestPromotedRelease?.id },
        { label: "New Change Request", onClick: () => navigate("/octo-ai") },
      ];
    }
    return [];
  }, [activeQuestionMeta?.kind, agentTab, appliedRevisions.length, currentSandboxRevision?.id, doPromoteRelease, hasPendingQuestion, latestPromotedRelease?.id, openChangesView, publishingRevision, requestStage, restoringRevision, selectedRevision, selectedRevisionRelease?.status, navigate]);

  const previewPane = (
    <div className={`relative h-full min-h-0 overflow-hidden ${isMobile ? "bg-base-100" : DESKTOP_PANEL_SHELL}`}>
      {previewNotice ? (
        <div className="absolute left-3 top-3 z-10 rounded-full border border-base-200 bg-base-100/95 px-3 py-1 text-xs font-medium text-primary shadow-sm">
          {previewNotice}
        </div>
      ) : null}
      {applyingRevision || publishingRevision ? (
        <div className="absolute right-3 top-3 z-10 rounded-full border border-base-200 bg-base-100/95 px-3 py-1 text-xs shadow-sm">
          {applyingRevision ? "Applying revision..." : "Publishing..."}
        </div>
      ) : null}
      {!data.session?.sandbox_workspace_id ? (
        <div className="flex h-full items-center justify-center p-4 text-sm opacity-60">No sandbox workspace is attached to this session yet.</div>
      ) : (
        <iframe
          key={`${workspaceFrameSrc}:${previewNonce}`}
          title="Sandbox workspace preview"
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
              <div className="text-sm font-medium">Revision {appliedRevisions.length - index}</div>
              <div className="flex items-center gap-2">
                {isCurrent ? <StatusChip label="Current" tone="primary" /> : null}
                {release?.status === "promoted" ? <StatusChip label="Published" tone="success" /> : null}
              </div>
            </div>
            <div className="mt-2 text-sm opacity-80">{summarizePatchsetRevision(patchset)}</div>
          </button>
        );
      })}
    </div>
  );

  const chatPane = (
    <div className="flex h-full min-h-0 flex-col space-y-3">
      <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-auto space-y-2">
        {renderedMessages.length > 0 ? (
          renderedMessages.map((msg) => (
            <div key={msg.id} className={`chat ${messageRoleClass(msg)}`}>
              <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{messageRoleLabel(msg)}</div>
              <div className={`${messageBubbleClass(msg)} whitespace-pre-wrap`}>
                {msg.pending ? (
                  <div className="flex items-center gap-2">
                    <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                    <span>{msg.body}</span>
                  </div>
                ) : (
                  chatMessageText(msg)
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">assistant</div>
            <div className={`${messageBubbleClass({ role: "assistant" })} whitespace-pre-wrap`}>
              Describe the change you want to make. I will plan it first, then show the right workflow actions when there is something real to act on.
            </div>
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>
      <div className="border-t border-base-200 pt-3 space-y-2">
        {hasPendingQuestion && activeQuestion ? (
          <div className="rounded-lg border border-base-300 bg-base-50 px-3 py-2 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide opacity-60">Needs input</div>
            <div className="mt-1 whitespace-pre-wrap">{activeQuestion}</div>
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
              placeholder="Field label"
              value={fieldSpecLabel}
              onChange={(e) => setFieldSpecLabel(e.target.value)}
            />
            <select className="select select-bordered select-sm w-full" value={fieldSpecType} onChange={(e) => setFieldSpecType(e.target.value)}>
              {(activeQuestionMeta?.options?.field_types || []).map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </select>
          </div>
        ) : null}
        <AgentChatInput
          ref={composerRef}
          value={message}
          onChange={setMessage}
          onSend={sendMessage}
          placeholder={hasPendingQuestion ? (questionNeedsTypedReply(activeQuestionMeta) ? "Type the missing detail or correction here..." : "Reply with clarification or extra instructions...") : composerPlaceholder}
          disabled={streaming || busy || applyingRevision || publishingRevision || restoringRevision}
          minRows={4}
        />
      </div>
    </div>
  );

  const mobileDetailsPane = (
    <div className="space-y-3">
      <InfoList title="Plan Summary" items={planSummaryText ? [planSummaryText] : []} emptyText="No summary yet." />
      <InfoList title="Changes" items={changeSummaries} emptyText="Describe the change in chat to generate a scoped plan." />
      <InfoList title="Modules" items={moduleSummaries} emptyText="Modules will appear here once the plan is scoped." />
      <InfoList title="Advisories" items={latestAdvisories} emptyText="No advisories for this draft." />
    </div>
  );

  const mobileAgentPane = (
    <div className="space-y-4">
      {appliedRevisions.length > 0 ? (
        <Tabs
          tabs={[
            { id: "chat", label: "Chat" },
            { id: "revisions", label: `Revisions (${appliedRevisions.length})` },
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
            <div className="flex-1 min-h-0 flex items-center justify-center px-4 text-sm opacity-70">Loading workspace...</div>
          ) : !data.session?.sandbox_workspace_id || data.session?.sandbox_status === "discarded" ? (
            <div className="flex-1 min-h-0 flex flex-col px-4 py-5">
              <div className="rounded-none text-center gap-4 flex flex-col">
                <h2 className="text-lg font-semibold">Sandbox not ready</h2>
                <p className="text-sm opacity-75">
                  {activeSession
                    ? "Create the sandbox for this request, then keep working here with the live sandbox preview."
                    : "This session no longer has an active sandbox. Historical sessions stay readable, but only active sessions can launch a sandbox."}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button className={SOFT_BUTTON_SM} onClick={() => navigate("/octo-ai")}>Back to sessions</button>
                  <button className={SOFT_BUTTON_SM} onClick={() => navigate(`/octo-ai/sessions/${sessionId}`)}>View history</button>
                  {activeSession ? (
                    <button className={PRIMARY_BUTTON_SM} disabled={busy} onClick={doEnsureSandbox}>Create Sandbox</button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-base-200 bg-base-100 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold truncate">{data.session?.title || "Change Request"}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusChip label={requestStage} tone={stageTone} />
                      {selectedRevision ? (
                        <span className="text-xs opacity-60">
                          {selectedRevision.id === currentSandboxRevision?.id ? "Current revision" : `Selected revision ${selectedRevision.id.slice(0, 8)}`}
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
                        Revisions
                      </button>
                    ) : null}
                    <button type="button" className={PRIMARY_BUTTON_SM} onClick={() => setMobileUtilitySheet("agent")}>
                      AI
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
              aria-label="Close panel"
              onClick={() => setMobileUtilitySheet("")}
            />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4 flex flex-col">
              <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
              <div className="flex items-center justify-between gap-2 pb-3">
                <div className="text-sm font-semibold">
                  {mobileUtilitySheet === "agent" ? "Octo AI" : mobileUtilitySheet === "preview" ? "Sandbox Preview" : "Plan Details"}
                </div>
                <button type="button" className={SOFT_BUTTON_SM} onClick={() => setMobileUtilitySheet("")}>Done</button>
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
            <div className="opacity-70">Loading workspace...</div>
          </div>
        ) : !data.session?.sandbox_workspace_id || data.session?.sandbox_status === "discarded" ? (
          <div className="card bg-base-100 shadow h-full min-h-0 flex items-center justify-center overflow-hidden">
            <div className="max-w-xl space-y-4 p-6 text-center">
              <h2 className="text-xl font-semibold">Sandbox not ready</h2>
              <p className="text-sm opacity-75">
                {activeSession
                  ? "Create the sandbox for this request, then keep working here with the live sandbox preview."
                  : "This session no longer has an active sandbox. Historical sessions stay readable, but only active sessions can launch a sandbox."}
              </p>
              <div className="flex items-center justify-center gap-2">
                <button className={SOFT_BUTTON_SM} onClick={() => navigate("/octo-ai")}>Back to sessions</button>
                <button className={SOFT_BUTTON_SM} onClick={() => navigate(`/octo-ai/sessions/${sessionId}`)}>View history</button>
                {activeSession ? (
                  <button className={PRIMARY_BUTTON_SM} disabled={busy} onClick={doEnsureSandbox}>Create Sandbox</button>
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
                      <div className="text-sm font-semibold">{data.session?.title || "Change Request"}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusChip label={requestStage} tone={stageTone} />
                        {selectedRevision ? (
                          <span className="text-xs opacity-60">
                            {selectedRevision.id === currentSandboxRevision?.id ? "Current revision" : `Selected revision ${selectedRevision.id.slice(0, 8)}`}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {appliedRevisions.length > 0 ? (
                    <div className="mt-3">
                      <Tabs
                        tabs={[
                          { id: "chat", label: "Chat" },
                          { id: "revisions", label: `Revisions (${appliedRevisions.length})` },
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
      <DetailsDrawer open={detailsOpen} onClose={() => setDetailsOpen(false)} activeTab={detailsTab} onTabChange={setDetailsTab} sections={detailsPayload} />
    </div>
  );
}
