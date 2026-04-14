import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import Tabs from "../components/Tabs.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function EmailOutboxItemPage() {
  const { outboxId } = useParams();
  const { t, formatDateTime } = useI18n();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("preview");
  const [templateName, setTemplateName] = useState("");

  async function load() {
    if (!outboxId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/email/outbox/${outboxId}`);
      setItem(res?.outbox || null);
    } catch (err) {
      setItem(null);
      setError(err?.message || t("settings.email_outbox.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outboxId]);

  useEffect(() => {
    let mounted = true;
    async function loadTemplateName(templateId) {
      if (!templateId) {
        setTemplateName("");
        return;
      }
      try {
        const res = await apiFetch(`/email/templates/${templateId}`);
        const tpl = res?.template || null;
        const name = tpl?.name || tpl?.title || "";
        if (!mounted) return;
        setTemplateName(String(name || "").trim());
      } catch {
        if (!mounted) return;
        setTemplateName("");
      }
    }
    loadTemplateName(item?.template_id);
    return () => {
      mounted = false;
    };
  }, [item?.template_id]);

  const tabs = useMemo(
    () => [
      { id: "preview", label: t("common.preview") },
      { id: "details", label: t("common.details") },
    ],
    [t],
  );

  const html = String(item?.body_html || "");

  const detailTo = Array.isArray(item?.to) ? item.to.join(", ") : "";
  const detailFrom = item?.from_email || "";

  return (
    <TabbedPaneShell
      contentContainer={true}
      contentContainerClass="h-full min-h-0 flex flex-col"
    >
      {error ? <div className="alert alert-error text-sm">{error}</div> : null}
      {item?.last_error ? (
        <div className="alert alert-error text-sm whitespace-pre-wrap">{item.last_error}</div>
      ) : null}

      <Tabs tabs={tabs} activeId={activeTab} onChange={setActiveTab} />

      <div className="mt-4 flex-1 min-h-0 rounded-box border border-base-300 bg-base-100 overflow-hidden flex flex-col">
        {loading ? (
          <div className="p-4 text-sm opacity-70">{t("common.loading")}</div>
        ) : !item ? (
          <div className="p-4 text-sm opacity-60">{t("settings.email_outbox.email_not_found")}</div>
        ) : activeTab === "preview" ? (
          html ? (
            <iframe
              title={t("settings.email_outbox.email_preview")}
              className="w-full flex-1 min-h-0 bg-base-100"
              sandbox=""
              srcDoc={html}
            />
          ) : (
            <div className="p-4 text-sm opacity-60">{t("settings.email_outbox.no_html_body")}</div>
          )
        ) : (
          <div className="p-4 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs opacity-70">{t("settings.email_outbox.outbox_id")}</div>
                <div className="text-sm font-mono break-all">{item.id}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("common.from")}</div>
                <div className="text-sm break-all">{detailFrom || "—"}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs opacity-70">{t("common.to")}</div>
                <div className="text-sm break-all">{detailTo || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("settings.email_outbox.template")}</div>
                <div className="text-sm break-all">{templateName || item.template_id || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("common.created")}</div>
                <div className="text-sm">{formatDateTime(item.created_at) || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("settings.email_outbox.sent")}</div>
                <div className="text-sm">{formatDateTime(item.sent_at) || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("settings.email_outbox.provider_message_id")}</div>
                <div className="text-sm font-mono break-all">{item.provider_message_id || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("settings.email_outbox.reply_to")}</div>
                <div className="text-sm break-all">{item.reply_to || "—"}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs opacity-70">{t("settings.email_outbox.cc_bcc")}</div>
                <div className="text-sm break-all">
                  {t("settings.email_outbox.cc_label")}: {Array.isArray(item.cc) && item.cc.length ? item.cc.join(", ") : "—"} | {t("settings.email_outbox.bcc_label")}:{" "}
                  {Array.isArray(item.bcc) && item.bcc.length ? item.bcc.join(", ") : "—"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TabbedPaneShell>
  );
}
