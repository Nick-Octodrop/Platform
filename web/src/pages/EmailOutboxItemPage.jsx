import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import Tabs from "../components/Tabs.jsx";

export default function EmailOutboxItemPage() {
  const { outboxId } = useParams();
  const navigate = useNavigate();
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
      setError(err?.message || "Failed to load email");
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
      { id: "preview", label: "Preview" },
      { id: "details", label: "Details" },
    ],
    [],
  );

  const html = String(item?.body_html || "");

  const headerStatus = item?.status || "";
  const detailTo = Array.isArray(item?.to) ? item.to.join(", ") : "";
  const detailFrom = item?.from_email || "";

  return (
    <TabbedPaneShell
      title={item?.subject || "Email"}
      subtitle={headerStatus ? `Status: ${headerStatus}` : "Email preview"}
      rightActions={(
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-ghost" type="button" onClick={load} disabled={loading}>
            Refresh
          </button>
          <button className="btn btn-sm" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      )}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      <div className="rounded-box border border-base-300 bg-base-100 p-4">
        {item?.last_error ? (
          <div className="text-xs text-error whitespace-pre-wrap">{item.last_error}</div>
        ) : null}
        <div className={item?.last_error ? "mt-4" : ""}>
          <Tabs tabs={tabs} activeId={activeTab} onChange={setActiveTab} />
        </div>
      </div>

      <div className="mt-4 rounded-box border border-base-300 bg-base-100 overflow-hidden min-h-[28rem]">
        {loading ? (
          <div className="p-4 text-sm opacity-70">Loading…</div>
        ) : !item ? (
          <div className="p-4 text-sm opacity-60">Email not found.</div>
        ) : activeTab === "preview" ? (
          html ? (
            <iframe
              title="Email preview"
              className="w-full h-[70vh] bg-base-100"
              sandbox=""
              srcDoc={html}
            />
          ) : (
            <div className="p-4 text-sm opacity-60">No HTML body.</div>
          )
        ) : (
          <div className="p-4 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs opacity-70">Outbox ID</div>
                <div className="text-sm font-mono break-all">{item.id}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">From</div>
                <div className="text-sm break-all">{detailFrom || "—"}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs opacity-70">To</div>
                <div className="text-sm break-all">{detailTo || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Template</div>
                <div className="text-sm break-all">{templateName || item.template_id || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Created</div>
                <div className="text-sm">{item.created_at || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Sent</div>
                <div className="text-sm">{item.sent_at || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Provider Message ID</div>
                <div className="text-sm font-mono break-all">{item.provider_message_id || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Reply-To</div>
                <div className="text-sm break-all">{item.reply_to || "—"}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs opacity-70">CC / BCC</div>
                <div className="text-sm break-all">
                  CC: {Array.isArray(item.cc) && item.cc.length ? item.cc.join(", ") : "—"} | BCC:{" "}
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
