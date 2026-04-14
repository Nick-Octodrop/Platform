import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Tabs from "../components/Tabs.jsx";
import { getOctoAiSession } from "../api.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

function JsonPanel({ value }) {
  return (
    <pre className="rounded-box bg-base-200 p-3 text-xs whitespace-pre-wrap overflow-auto">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

function SummaryList({ title, items, emptyText }) {
  return (
    <div className="rounded-box border border-base-200 bg-base-100">
      <div className="border-b border-base-200 px-4 py-3 text-sm font-semibold">{title}</div>
      <div className="px-4 py-3 text-sm">
        {Array.isArray(items) && items.length > 0 ? (
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li key={`${title}-${index}`}>- {item}</li>
            ))}
          </ul>
        ) : (
          <div className="opacity-60">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

function messageText(message) {
  return typeof message?.body === "string" ? message.body : "";
}

function messageRoleClass(message) {
  return message?.role === "user" ? "chat-end" : "chat-start";
}

function messageBubbleClass(message) {
  if (message?.role === "user") return "chat-bubble max-w-[85%] bg-primary text-primary-content text-sm leading-5";
  return "chat-bubble max-w-[85%] bg-base-200 text-base-content text-sm leading-5";
}

function messageRoleLabel(message) {
  if (message?.role === "user") return "you";
  return message?.role || "assistant";
}

export default function OctoAiSessionDetailPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [data, setData] = useState({ session: null, messages: [], plans: [], patchsets: [], releases: [] });

  const latestPlan = useMemo(() => (Array.isArray(data.plans) && data.plans.length > 0 ? data.plans[0] : null), [data.plans]);
  const latestPatchset = useMemo(() => (Array.isArray(data.patchsets) && data.patchsets.length > 0 ? data.patchsets[0] : null), [data.patchsets]);
  const structuredPlan = useMemo(() => {
    const plan = latestPlan?.plan_json?.plan;
    if (!plan || typeof plan !== "object") return null;
    if (plan.plan_v1 && typeof plan.plan_v1 === "object") return plan.plan_v1;
    return plan.structured_plan && typeof plan.structured_plan === "object" ? plan.structured_plan : null;
  }, [latestPlan]);

  async function load() {
    if (!sessionId) return;
    setLoading(true);
    setError("");
    try {
      const res = await getOctoAiSession(sessionId);
      setData({
        session: res?.session || null,
        messages: Array.isArray(res?.messages) ? res.messages : [],
        plans: Array.isArray(res?.plans) ? res.plans : [],
        patchsets: Array.isArray(res?.patchsets) ? res.patchsets : [],
        releases: Array.isArray(res?.releases) ? res.releases : [],
      });
    } catch (err) {
      setError(err?.message || t("settings.octo_ai.session_detail.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [sessionId]);

  const overviewItems = useMemo(() => {
    const items = [];
    if (data.session?.summary) items.push(data.session.summary);
    if (data.session?.sandbox_name) items.push(t("settings.octo_ai.session_detail.sandbox_value", { value: data.session.sandbox_name }));
    if (data.session?.sandbox_status) items.push(t("settings.octo_ai.session_detail.sandbox_status_value", { value: data.session.sandbox_status.replace(/_/g, " ") }));
    if (data.session?.release_status) items.push(t("settings.octo_ai.session_detail.release_status_value", { value: data.session.release_status.replace(/_/g, " ") }));
    if (data.session?.seed_mode) items.push(t("settings.octo_ai.session_detail.seed_mode_value", { value: data.session.seed_mode.replace(/_/g, " ") }));
    if (data.session?.simulation_mode) items.push(t("settings.octo_ai.session_detail.simulation_value", { value: data.session.simulation_mode.replace(/_/g, " ") }));
    return items;
  }, [data.session, t]);

  const changeItems = useMemo(() => {
    if (Array.isArray(structuredPlan?.changes) && structuredPlan.changes.length > 0) {
      return structuredPlan.changes
        .map((item) => (typeof item?.summary === "string" ? item.summary.trim() : ""))
        .filter(Boolean);
    }
    return [];
  }, [structuredPlan]);

  const moduleItems = useMemo(() => {
    if (Array.isArray(structuredPlan?.modules) && structuredPlan.modules.length > 0) {
      return structuredPlan.modules.map((item) => {
        const label = item?.module_label || item?.module_id || t("settings.octo_ai.session_detail.unknown_module");
        const status = item?.status || t("settings.octo_ai.session_detail.planned");
        return `${label} (${status.replace(/_/g, " ")})`;
      });
    }
    return [];
  }, [structuredPlan, t]);

  const tabs = [
    { id: "overview", label: t("settings.octo_ai.session_detail.tabs.overview") },
    { id: "changes", label: t("settings.octo_ai.session_detail.tabs.changes") },
    { id: "chat", label: t("settings.octo_ai.session_detail.tabs.chat") },
    { id: "validation", label: t("settings.octo_ai.session_detail.tabs.validation") },
    { id: "releases", label: t("settings.octo_ai.session_detail.tabs.releases") },
  ];

  return (
    <div className="h-[calc(100vh-6rem)] min-h-0 overflow-hidden p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className={SOFT_BUTTON_SM} onClick={() => navigate("/octo-ai")}>{t("common.back")}</button>
          <h1 className="text-lg font-semibold">{data.session?.title || t("settings.octo_ai.session_detail.ai_session")}</h1>
          <span className="badge badge-outline">{data.session?.status || "draft"}</span>
          <span className="badge badge-ghost">{t("settings.octo_ai.session_detail.history_only")}</span>
          {data.session?.sandbox_name ? <span className="badge badge-ghost">{data.session.sandbox_name}</span> : null}
        </div>
      </div>

      {error ? <div className="alert alert-error text-sm mb-3">{error}</div> : null}

      {loading ? (
        <div className="card bg-base-100 shadow h-full flex items-center justify-center opacity-70">{t("settings.octo_ai.session_detail.loading")}</div>
      ) : (
        <div className="card bg-base-100 shadow h-full min-h-0 flex flex-col">
          <div className="border-b border-base-200 p-3">
            <Tabs tabs={tabs} activeId={activeTab} onChange={setActiveTab} fullWidth />
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <div className={activeTab === "overview" ? "" : "hidden"}>
              <div className="grid gap-4 lg:grid-cols-2">
                <SummaryList title={t("settings.octo_ai.session_detail.session_summary")} items={overviewItems} emptyText={t("settings.octo_ai.session_detail.no_session_summary")} />
                <SummaryList title={t("settings.octo_ai.session_detail.affected_modules")} items={moduleItems} emptyText={t("settings.octo_ai.session_detail.no_affected_modules")} />
              </div>
              <div className="mt-4 rounded-box border border-base-200 bg-base-100 p-4 text-sm">
                {t("settings.octo_ai.session_detail.history_only_description")}
              </div>
            </div>
            <div className={activeTab === "changes" ? "" : "hidden"}>
              <div className="grid gap-4 lg:grid-cols-2">
                <SummaryList title={t("settings.octo_ai.session_detail.planned_changes")} items={changeItems} emptyText={t("settings.octo_ai.session_detail.no_planned_changes")} />
                <JsonPanel value={structuredPlan || latestPlan?.plan_json || {}} />
              </div>
            </div>
            <div className={activeTab === "chat" ? "" : "hidden"}>
              <div className="space-y-3">
                {(data.messages || []).length > 0 ? (
                  (data.messages || []).map((message) => (
                    <div key={message.id} className={`chat ${messageRoleClass(message)}`}>
                      <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{messageRoleLabel(message) === "you" ? t("settings.octo_ai.session_detail.you") : t("settings.octo_ai.session_detail.assistant")}</div>
                      <div className={`${messageBubbleClass(message)} whitespace-pre-wrap`}>{messageText(message)}</div>
                    </div>
                  ))
                ) : (
                  <div className="opacity-60 text-sm">{t("settings.octo_ai.session_detail.no_chat_history")}</div>
                )}
              </div>
            </div>
            <div className={activeTab === "validation" ? "" : "hidden"}>
              <JsonPanel value={latestPatchset?.validation_json || {}} />
            </div>
            <div className={activeTab === "releases" ? "" : "hidden"}>
              <JsonPanel value={data.releases || []} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
