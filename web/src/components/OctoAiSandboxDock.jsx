import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { PRIMARY_BUTTON_SM, SOFT_BUTTON_SM } from "./buttonStyles.js";
import {
  answerOctoAiQuestion,
  applyOctoAiPatchset,
  clearCaches,
  discardOctoAiSandbox,
  generateOctoAiPatchset,
  getActiveWorkspaceId,
  getOctoAiSession,
  rollbackOctoAiPatchset,
  sendOctoAiChatMessage,
  setTabWorkspaceId,
  validateOctoAiPatchset,
} from "../api.js";

function questionKind(meta) {
  return meta && typeof meta === "object" && typeof meta.kind === "string" ? meta.kind : "text";
}

function questionNeedsTypedReply(meta) {
  return ["text", "module_target", "entity_target", "field_target", "tab_target", "target_resolution"].includes(questionKind(meta));
}

function summarizeAnswer(msg) {
  if (!msg || typeof msg !== "object") return "";
  const answer = msg.answer_json && typeof msg.answer_json === "object" ? msg.answer_json : null;
  const body = typeof msg.body === "string" ? msg.body.trim() : "";
  if (!answer) return body;
  if (typeof answer.confirm_plan === "boolean") return answer.confirm_plan ? "Approved." : body || "Needs changes.";
  return body || "Answered.";
}

function chatMessageText(msg) {
  if (!msg || typeof msg !== "object") return "";
  if (msg.message_type === "answer") return summarizeAnswer(msg);
  return typeof msg.body === "string" ? msg.body : "";
}

function parseNarrativeSections(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => line || (index > 0 && arr[index - 1]));
  const sections = [];
  let current = { title: "", body: [], bullets: [] };

  function pushCurrent() {
    if (!current.title && current.body.length === 0 && current.bullets.length === 0) return;
    sections.push(current);
    current = { title: "", body: [], bullets: [] };
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current.body.length > 0 || current.bullets.length > 0) {
        current.body.push("");
      }
      continue;
    }
    if (/^[A-Z][A-Za-z /-]+:$/.test(line)) {
      pushCurrent();
      current.title = line.slice(0, -1);
      continue;
    }
    if (line.startsWith("- ")) {
      current.bullets.push(line.slice(2).trim());
      continue;
    }
    current.body.push(line);
  }
  pushCurrent();
  return sections;
}

function AssistantNarrative({ text }) {
  const sections = useMemo(() => parseNarrativeSections(text), [text]);
  if (!sections.length) {
    return <div className="whitespace-pre-wrap text-sm leading-6">{text}</div>;
  }
  return (
    <div className="space-y-3 text-sm leading-6">
      {sections.map((section, index) => (
        <div key={`${section.title || "section"}-${index}`} className="space-y-2">
          {section.title ? <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{section.title}</div> : null}
          {section.body.map((item, bodyIndex) =>
            item ? (
              <div key={`body-${bodyIndex}`} className="whitespace-pre-wrap">
                {item}
              </div>
            ) : (
              <div key={`space-${bodyIndex}`} className="h-1" />
            ),
          )}
          {section.bullets.length > 0 ? (
            <ul className="space-y-1">
              {section.bullets.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="opacity-60">-</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
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

function messageRoleClass(msg) {
  return msg?.role === "user" ? "chat-end" : "chat-start";
}

function messageBubbleClass(msg) {
  if (msg?.role === "user") return "chat-bubble max-w-[85%] bg-primary text-primary-content text-sm leading-5";
  return "chat-bubble max-w-[85%] bg-base-200 text-base-content text-sm leading-5";
}

function messageRoleLabel(msg) {
  if (msg?.role === "user") return "you";
  return msg?.role || "assistant";
}

function findFormSectionLabel(result) {
  const manifest = result?.manifest;
  const formView = Array.isArray(manifest?.views)
    ? manifest.views.find((view) => view?.kind === "form" && Array.isArray(view?.sections))
    : null;
  if (!formView) return "";
  const headerTabs = formView?.header?.tabs?.tabs;
  const resolvedSectionIds = new Set();
  for (const op of Array.isArray(result?.resolved_ops) ? result.resolved_ops : []) {
    const path = typeof op?.path === "string" ? op.path : "";
    const match = path.match(/^\/views\/(\d+)\/sections\/(\d+)\/fields\/\d+$/);
    if (!match) continue;
    const sectionIndex = Number(match[2]);
    const section = Array.isArray(formView.sections) ? formView.sections[sectionIndex] : null;
    if (section?.id) {
      resolvedSectionIds.add(section.id);
    }
  }
  if (!resolvedSectionIds.size) return "";
  if (Array.isArray(headerTabs)) {
    for (const tab of headerTabs) {
      const tabSections = Array.isArray(tab?.sections) ? tab.sections : [];
      if (tabSections.some((sectionId) => resolvedSectionIds.has(sectionId))) {
        return typeof tab?.label === "string" ? tab.label : "";
      }
    }
  }
  const firstSectionId = Array.from(resolvedSectionIds)[0];
  const section = Array.isArray(formView.sections) ? formView.sections.find((item) => item?.id === firstSectionId) : null;
  return typeof section?.title === "string" ? section.title : "";
}

function buildApplySummary(validation) {
  const results = Array.isArray(validation?.results) ? validation.results : [];
  if (results.length === 0) return null;
  const primary = results[0] || {};
  const moduleName = primary?.manifest?.module?.name || primary?.module_id || "Module";
  const resolvedOps = Array.isArray(primary?.resolved_ops) ? primary.resolved_ops : [];
  const workflowTouched = resolvedOps.some((op) => typeof op?.path === "string" && op.path.startsWith("/workflows/"));
  if (workflowTouched) {
    return {
      title: `${moduleName} status flow updated in sandbox`,
      body: `Refresh ${moduleName} and check the status bar plus the status action buttons on the form to see the new lifecycle state.`,
    };
  }
  const addedField = Array.isArray(primary?.manifest?.entities)
    ? primary.manifest.entities.flatMap((entity) => (Array.isArray(entity?.fields) ? entity.fields : [])).find((field) => {
        const fieldId = typeof field?.id === "string" ? field.id : "";
        return resolvedOps.some((op) => typeof op?.value === "string" && op.value === fieldId);
      })
    : null;
  const fieldLabel = typeof addedField?.label === "string" ? addedField.label : "";
  const tabLabel = findFormSectionLabel(primary);
  if (fieldLabel && tabLabel) {
    return {
      title: `${moduleName} updated in sandbox`,
      body: `Open ${moduleName}, open a record, then check the ${tabLabel} tab for the '${fieldLabel}' field.`,
    };
  }
  if (fieldLabel) {
    return {
      title: `${moduleName} updated in sandbox`,
      body: `Open ${moduleName} and look for the new '${fieldLabel}' field on the affected form or view.`,
    };
  }
  return {
    title: `${moduleName} updated in sandbox`,
    body: `Refresh ${moduleName} in the sandbox to review the latest change.`,
  };
}

function shouldForceSandboxReload(validation) {
  const results = Array.isArray(validation?.results) ? validation.results : [];
  for (const result of results) {
    const resolvedOps = Array.isArray(result?.resolved_ops) ? result.resolved_ops : [];
    for (const op of resolvedOps) {
      const path = typeof op?.path === "string" ? op.path : "";
      if (path.startsWith("/workflows/")) return true;
      if (path.includes("/header/statusbar")) return true;
      if (/^\/entities\/\d+\/fields\/\d+$/.test(path)) return true;
    }
  }
  return false;
}

export default function OctoAiSandboxDock({ sessionId, onExit }) {
  const location = useLocation();
  const chatScrollRef = useRef(null);
  const autoApplyAttemptsRef = useRef(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [applySummary, setApplySummary] = useState(null);
  const [data, setData] = useState({ session: null, messages: [], plans: [], patchsets: [], releases: [] });
  const isEmbedMode = useMemo(() => new URLSearchParams(location.search).get("octo_ai_embed") === "1", [location.search]);

  const latestPlan = useMemo(() => (Array.isArray(data.plans) && data.plans.length > 0 ? data.plans[0] : null), [data.plans]);
  const latestPatchset = useMemo(() => latestPatchsetFromList(data.patchsets, latestPlan?.id || ""), [data.patchsets, latestPlan?.id]);
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
  const hasPendingQuestion = Boolean(activeQuestion);
  const structuredPlan = useMemo(() => {
    const plan = latestPlan?.plan_json?.plan;
    return plan && typeof plan === "object" && plan.structured_plan && typeof plan.structured_plan === "object" ? plan.structured_plan : null;
  }, [latestPlan]);
  const latestAdvisories = useMemo(() => {
    const advisories = latestPlan?.plan_json?.plan?.advisories;
    return Array.isArray(advisories) ? advisories.filter((item) => typeof item === "string" && item.trim()) : [];
  }, [latestPlan]);
  const latestPatchsetStatus = typeof latestPatchset?.status === "string" ? latestPatchset.status : "";
  const latestApprovalMessage = useMemo(() => {
    const messages = Array.isArray(data.messages) ? [...data.messages] : [];
    messages.reverse();
    return (
      messages.find(
        (item) =>
          item?.role === "user" &&
          item?.message_type === "answer" &&
          item?.answer_json &&
          typeof item.answer_json === "object" &&
          item.answer_json.confirm_plan === true,
      ) || null
    );
  }, [data.messages]);

  const changeSummaries = useMemo(
    () =>
      Array.isArray(structuredPlan?.changes)
        ? structuredPlan.changes.map((item) => item?.summary).filter((item) => typeof item === "string" && item.trim())
        : [],
    [structuredPlan],
  );
  const detailSections = useMemo(
    () =>
      Array.isArray(structuredPlan?.sections)
        ? structuredPlan.sections
            .filter((section) => section && typeof section === "object" && Array.isArray(section.items) && section.items.length > 0)
            .map((section) => ({
              title: typeof section.title === "string" ? section.title : "",
              items: section.items.filter((item) => typeof item === "string" && item.trim()),
            }))
            .filter((section) => section.title && section.items.length > 0)
        : [],
    [structuredPlan],
  );
  const moduleSummaries = useMemo(
    () =>
      Array.isArray(structuredPlan?.modules)
        ? structuredPlan.modules
            .map((item) => `${item?.module_label || item?.module_id || "Unknown module"} (${(item?.status || "planned").replace(/_/g, " ")})`)
            .filter(Boolean)
        : [],
    [structuredPlan],
  );
  const planAssumptions = useMemo(
    () => (Array.isArray(structuredPlan?.assumptions) ? structuredPlan.assumptions.filter((item) => typeof item === "string" && item.trim()) : []),
    [structuredPlan],
  );
  const planRisks = useMemo(
    () => (Array.isArray(structuredPlan?.risks) ? structuredPlan.risks.filter((item) => typeof item === "string" && item.trim()) : []),
    [structuredPlan],
  );
  const validationSummary = latestPatchset?.validation_json || null;
  const showTechnicalDetails = useMemo(
    () =>
      latestPatchsetStatus === "invalid" ||
      latestPatchsetStatus === "applied" ||
      (Array.isArray(data.releases) && data.releases.length > 0) ||
      Boolean(error),
    [data.releases, error, latestPatchsetStatus],
  );
  const statusBadge = useMemo(() => {
    if (activeQuestionMeta?.kind === "confirm_plan") return { label: "Plan ready", tone: "badge-warning" };
    if (questionNeedsTypedReply(activeQuestionMeta)) return { label: "Needs detail", tone: "badge-info" };
    if (latestPatchsetStatus === "applied") return { label: "Sandbox updated", tone: "badge-success" };
    if (latestPatchsetStatus === "invalid" || data.session?.status === "failed") return { label: "Needs fix", tone: "badge-error" };
    return { label: "Planning", tone: "badge-ghost" };
  }, [activeQuestionMeta, data.session?.status, latestPatchsetStatus]);

  const headerSummary = useMemo(() => {
    if (activeQuestionMeta?.kind === "confirm_plan") {
      return "Review the plan below. When you approve it, Octo AI will apply the validated change to this sandbox automatically.";
    }
    if (latestPatchsetStatus === "applied") {
      return "Sandbox updated. Keep chatting to refine it, or roll back the latest sandbox change.";
    }
    if (latestPatchsetStatus === "invalid" || data.session?.status === "failed") {
      return "The latest sandbox change needs attention. Ask Octo AI to revise it or review the details below.";
    }
    return "Describe what you want changed in this sandbox. Octo AI will explain the plan first, then apply it here after approval.";
  }, [activeQuestionMeta?.kind, data.session?.status, latestPatchsetStatus]);

  async function refreshSession({ showLoading = false } = {}) {
    if (!sessionId) return null;
    if (showLoading) setLoading(true);
    setError("");
    try {
      const sessionRes = await getOctoAiSession(sessionId);
      const nextData = {
        session: sessionRes?.session || null,
        messages: Array.isArray(sessionRes?.messages) ? sessionRes.messages : [],
        plans: Array.isArray(sessionRes?.plans) ? sessionRes.plans : [],
        patchsets: Array.isArray(sessionRes?.patchsets) ? sessionRes.patchsets : [],
        releases: Array.isArray(sessionRes?.releases) ? sessionRes.releases : [],
      };
      setData(nextData);
      return nextData;
    } catch (err) {
      setError(err?.message || "Failed to load AI session");
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    refreshSession({ showLoading: true });
  }, [sessionId]);

  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [data.messages, activeQuestion, changeSummaries.length, latestPatchsetStatus]);

  useEffect(() => {
    const latestPlanId = typeof latestPlan?.id === "string" ? latestPlan.id : "";
    const latestApprovalId = typeof latestApprovalMessage?.id === "string" ? latestApprovalMessage.id : "";
    const sessionStatus = typeof data.session?.status === "string" ? data.session.status : "";
    const attemptKey = latestPlanId && latestApprovalId ? `${latestPlanId}:${latestApprovalId}` : "";
    const shouldAutoApply =
      Boolean(sessionId && latestPlanId && latestApprovalId && attemptKey) &&
      !hasPendingQuestion &&
      !busy &&
      !streaming &&
      ["ready_to_apply", "applied"].includes(sessionStatus) &&
      latestPatchsetStatus !== "applied";

    if (!shouldAutoApply || autoApplyAttemptsRef.current.has(attemptKey)) {
      return;
    }

    autoApplyAttemptsRef.current.add(attemptKey);
    let cancelled = false;

    (async () => {
      try {
        await applyLatestPlanToSandbox();
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Failed to apply the latest plan to this sandbox");
          autoApplyAttemptsRef.current.delete(attemptKey);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    latestPlan,
    latestApprovalMessage,
    hasPendingQuestion,
    busy,
    streaming,
    data.session?.status,
    latestPatchsetStatus,
  ]);

  function latestPlanFromPayload(payload) {
    return Array.isArray(payload?.plans) && payload.plans.length > 0 ? payload.plans[0] : null;
  }

  function latestPatchsetForPlan(payload, planId) {
    return latestPatchsetFromList(payload?.patchsets, planId);
  }

  function refreshSandboxWorkspace() {
    if (typeof window === "undefined") return;
    clearCaches();
    const workspaceId = getActiveWorkspaceId();
    if (workspaceId) {
      setTabWorkspaceId(workspaceId);
    }
    window.dispatchEvent(new CustomEvent("octo:sandbox-refresh"));
  }

  async function applyLatestPlanToSandbox(sessionPayload = null) {
    if (!sessionId) return;
    let payload = sessionPayload || data;
    const plan = latestPlanFromPayload(payload);
    const planId = typeof plan?.id === "string" ? plan.id : "";
    if (!planId) return;

    let patchset = latestPatchsetForPlan(payload, planId);
    if (patchset?.status === "applied") {
      refreshSandboxWorkspace();
      return;
    }

    if (!patchset || patchset.plan_id !== planId) {
      await generateOctoAiPatchset(sessionId, { plan_id: planId });
      payload = await refreshSession();
      patchset = latestPatchsetForPlan(payload, planId);
    }

    if (!patchset?.id) return;

    if (!["validated", "approved", "applied"].includes(String(patchset.status || ""))) {
      await validateOctoAiPatchset(patchset.id);
      payload = await refreshSession();
      patchset = latestPatchsetForPlan(payload, planId);
    }

    if (!patchset?.id || patchset?.status === "applied") {
      refreshSandboxWorkspace();
      return;
    }

    if (patchset?.status !== "validated" && patchset?.status !== "approved") {
      throw new Error("The approved plan could not be validated for this sandbox.");
    }

    await applyOctoAiPatchset(patchset.id, true);
    const refreshed = await refreshSession();
    const latestAppliedPatchset = latestPatchsetForPlan(refreshed, planId);
    const latestValidation = latestAppliedPatchset?.validation_json || validationSummary || null;
    setApplySummary(buildApplySummary(latestValidation));
    refreshSandboxWorkspace();
    if (shouldForceSandboxReload(latestValidation)) {
      window.setTimeout(() => {
        window.location.reload();
      }, 60);
    }
  }

  async function submitQuestionAnswer(action, payload = {}) {
    if (!sessionId || !hasPendingQuestion) return;
    setBusy(true);
    setError("");
    try {
      setApplySummary(null);
      await answerOctoAiQuestion(sessionId, {
        action,
        text: payload?.text || undefined,
        question_id: activeQuestionMeta?.id || undefined,
      });
      setMessage("");
      await refreshSession();
    } catch (err) {
      setError(err?.message || "Failed to submit answer");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    const text = message.trim();
    if (!text || busy || streaming) return;
    if (hasPendingQuestion) {
      await submitQuestionAnswer("custom", { text });
      return;
    }
    setStreaming(true);
    setError("");
    try {
      setApplySummary(null);
      await sendOctoAiChatMessage(sessionId, { message: text });
      setMessage("");
      await refreshSession();
    } catch (err) {
      setError(err?.message || "Failed to send message");
    } finally {
      setStreaming(false);
    }
  }

  async function doApplyLatestPlan() {
    if (!sessionId || hasPendingQuestion) return;
    setBusy(true);
    setError("");
    try {
      await applyLatestPlanToSandbox();
    } catch (err) {
      setError(err?.message || "Failed to apply the latest plan to this sandbox");
    } finally {
      setBusy(false);
    }
  }

  async function doRollbackPatchset() {
    if (!latestPatchset?.id) return;
    setBusy(true);
    setError("");
    try {
      await rollbackOctoAiPatchset(latestPatchset.id);
      await refreshSession();
      refreshSandboxWorkspace();
    } catch (err) {
      setError(err?.message || "Failed to roll back the latest sandbox change");
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
      onExit?.();
    } catch (err) {
      setError(err?.message || "Failed to discard sandbox");
    } finally {
      setBusy(false);
    }
  }

  if (isEmbedMode) {
    return null;
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm opacity-70">Loading AI sandbox…</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-100">
      <div className="border-b border-base-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">{data.session?.title || "Octo AI"}</div>
              <span className={`badge badge-sm ${statusBadge.tone}`}>{statusBadge.label}</span>
            </div>
            <div className="mt-1 text-sm leading-6 opacity-75">{headerSummary}</div>
          </div>
          <button className={SOFT_BUTTON_SM} type="button" onClick={onExit}>Exit</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {latestPlan && !hasPendingQuestion && latestPatchsetStatus !== "applied" ? (
            <button className={SOFT_BUTTON_SM} disabled={busy} onClick={doApplyLatestPlan}>Apply latest plan</button>
          ) : null}
          <button className={SOFT_BUTTON_SM} disabled={busy || !latestPatchset} onClick={doRollbackPatchset}>Rollback</button>
          <button className={SOFT_BUTTON_SM} disabled={busy} onClick={doDiscardSandbox}>Discard</button>
        </div>
      </div>

      {error ? <div className="mx-3 mt-3 alert alert-error text-sm">{error}</div> : null}

      <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-auto p-3">
        <div className="space-y-3">
          {applySummary ? (
            <div className="alert alert-success text-sm">
              <div>
                <div className="font-semibold">{applySummary.title}</div>
                <div className="mt-1 opacity-90">{applySummary.body}</div>
              </div>
            </div>
          ) : null}
          {latestPatchsetStatus === "invalid" ? (
            <div className="alert alert-warning text-sm">The last sandbox apply attempt failed validation. Ask Octo AI to revise the plan.</div>
          ) : null}

          {(data.messages || []).length > 0 ? (
            (data.messages || []).map((msg) => (
              <div key={msg.id} className={`chat ${messageRoleClass(msg)}`}>
                <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{messageRoleLabel(msg)}</div>
                <div className={messageBubbleClass(msg)}>
                  {msg?.role === "assistant" ? <AssistantNarrative text={chatMessageText(msg)} /> : <div className="whitespace-pre-wrap text-sm leading-6">{chatMessageText(msg)}</div>}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-box border border-dashed border-base-300 p-4 text-sm opacity-70">
              Start by telling Octo AI what to build or change in this sandbox.
            </div>
          )}
          {detailSections.length > 0 ? (
            <div className="rounded-box border border-base-200 bg-base-100 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Plan details</div>
              <div className="mt-2 space-y-3">
                {detailSections.map((section) => (
                  <InfoList key={section.title} title={section.title} items={section.items} emptyText="" />
                ))}
              </div>
            </div>
          ) : null}

          {structuredPlan && (moduleSummaries.length > 0 || latestAdvisories.length > 0 || planRisks.length > 0) ? (
            <div className="rounded-box border border-base-200 bg-base-100 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">At a glance</div>
              <div className="mt-2 space-y-3">
                {moduleSummaries.length > 0 ? <InfoList title="Affected modules" items={moduleSummaries} emptyText="" /> : null}
                {latestAdvisories.length > 0 ? <InfoList title="Suggestions" items={latestAdvisories.slice(0, 2)} emptyText="" /> : null}
                {planRisks.length > 0 ? <InfoList title="Watchouts" items={planRisks.slice(0, 2)} emptyText="" /> : null}
              </div>
            </div>
          ) : null}

          {showTechnicalDetails ? (
            <details className="rounded-box border border-base-200 bg-base-100" open={Boolean(validationSummary && latestPatchsetStatus === "invalid")}>
              <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold uppercase tracking-wide opacity-70">Technical details</summary>
              <div className="space-y-3 border-t border-base-200 px-4 py-3">
                <InfoList
                  title="Sandbox activity"
                  items={[
                    data.session?.sandbox_name ? `Sandbox: ${data.session.sandbox_name}` : "",
                    data.session?.sandbox_status ? `Sandbox status: ${String(data.session.sandbox_status).replace(/_/g, " ")}` : "",
                    latestPatchsetStatus ? `Latest patchset: ${latestPatchsetStatus.replace(/_/g, " ")}` : "",
                  ].filter(Boolean)}
                  emptyText="No technical activity yet."
                />
                <pre className="rounded-box bg-base-200 p-3 text-xs whitespace-pre-wrap overflow-auto">
                  {JSON.stringify({ validation: validationSummary || {}, releases: data.releases || [] }, null, 2)}
                </pre>
              </div>
            </details>
          ) : null}
        </div>
      </div>

      <div className="border-t border-base-200 p-3 space-y-3">
        {hasPendingQuestion ? (
          <div className="rounded-box border border-base-300 bg-base-200/60 p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
              {questionKind(activeQuestionMeta) === "confirm_plan" ? "Plan review" : "Clarification needed"}
            </div>
            <div className="text-sm leading-6">{activeQuestionMeta?.prompt || activeQuestion}</div>
            {questionNeedsTypedReply(activeQuestionMeta) ? (
              <div className="text-xs opacity-70">Reply below with the missing detail.</div>
            ) : null}
            {questionKind(activeQuestionMeta) === "confirm_plan" ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-xs btn-primary" disabled={busy || streaming} onClick={() => submitQuestionAnswer("approve")}>
                  Approve and apply
                </button>
                <button type="button" className="btn btn-xs" disabled={busy || streaming} onClick={() => submitQuestionAnswer("disapprove")}>
                  Revise plan
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <textarea
          className="textarea textarea-bordered w-full text-sm leading-6 min-h-[120px]"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            questionKind(activeQuestionMeta) === "confirm_plan"
              ? "Tell Octo AI what you want changed about this plan..."
              : hasPendingQuestion
                ? "Reply with the missing detail..."
                : "Describe what you want changed in this sandbox..."
          }
        />
        <button className={PRIMARY_BUTTON_SM} disabled={streaming || busy || !message.trim()} onClick={sendMessage}>
          {streaming ? "Planning..." : questionKind(activeQuestionMeta) === "confirm_plan" ? "Send revision" : hasPendingQuestion ? "Reply" : "Send"}
        </button>
      </div>
    </div>
  );
}
