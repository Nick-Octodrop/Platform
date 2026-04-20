import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import SamplePicker from "./SamplePicker.jsx";
import { API_URL, getActiveWorkspaceId } from "../../api.js";
import { getSafeSession } from "../../supabase.js";
import { apiFetch } from "../../api.js";
import CodeTextarea from "../../components/CodeTextarea.jsx";
import AppSelect from "../../components/AppSelect.jsx";
import { formatDateTime } from "../../utils/dateTime.js";
import ListViewRenderer from "../../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../../ui/SystemListToolbar.jsx";
import { translateRuntime } from "../../i18n/runtime.js";
import { useI18n } from "../../i18n/LocalizationProvider.jsx";
import { buildTemplateEntityOptions, getTemplateEntityId, setTemplateEntityId } from "./templateEntityState.js";

function Fieldset({ label, hint, optional = false, className = "", children }) {
  return (
    <fieldset className={`fieldset ${className}`}>
      <legend className="fieldset-legend text-xs uppercase opacity-60 tracking-wide">
        {label}
      </legend>
      {children}
      {(hint || optional) && (
        <span className="label label-text-alt opacity-50">
          {hint || (optional ? translateRuntime("settings.template_studio.optional") : "")}
        </span>
      )}
    </fieldset>
  );
}

function SectionGroup({ title, description, children, className = "" }) {
  return (
    <section className={`rounded-box border border-base-300 bg-base-100 p-4 ${className}`}>
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
      <div className="mt-4">
        {children}
      </div>
    </section>
  );
}

function DocumentTemplateTab({ draft, setDraft, sample, setSample, entities }) {
  const selectedEntityId = getTemplateEntityId(draft);
  const entityOptions = buildTemplateEntityOptions(entities, selectedEntityId);

  function handleEntityChange(nextEntityId) {
    setDraft((prev) => setTemplateEntityId(prev, nextEntityId));
    setSample((prev) => ({ ...(prev || {}), entity_id: nextEntityId, record_id: "" }));
  }

  return (
    <div className="space-y-4">
      <SectionGroup
        title={translateRuntime("settings.template_studio.template_details")}
        description={translateRuntime("settings.template_studio.document_template_details_description")}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Fieldset label={translateRuntime("common.name")}>
            <input
              className="input input-bordered"
              value={draft?.name || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), name: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label={translateRuntime("common.description")} optional>
            <input
              className="input input-bordered"
              value={draft?.description || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), description: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label={translateRuntime("common.entity")} hint={translateRuntime("settings.template_studio.template_entity_hint")}>
            <AppSelect
              className="select select-bordered"
              value={selectedEntityId}
              onChange={(e) => handleEntityChange(e.target.value)}
            >
              <option value="">{translateRuntime("settings.template_studio.select_entity")}</option>
              {entityOptions.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.label || ent.id}
                </option>
              ))}
            </AppSelect>
          </Fieldset>
          <Fieldset
            label={translateRuntime("settings.template_studio.filename_pattern")}
            hint={translateRuntime("settings.template_studio.filename_pattern_hint")}
            className="md:col-span-2"
          >
            <input
              className="input input-bordered"
              value={draft?.filename_pattern || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), filename_pattern: e.target.value }))}
              placeholder={translateRuntime("settings.template_studio.filename_pattern_placeholder")}
            />
          </Fieldset>
        </div>
      </SectionGroup>
      <SectionGroup
        title={translateRuntime("settings.template_studio.document_content")}
        description={translateRuntime("settings.template_studio.document_content_description")}
      >
        <div className="grid grid-cols-1 gap-4">
          <Fieldset label={translateRuntime("settings.template_studio.html_template_jinja")}>
            <CodeTextarea
              value={draft?.html || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), html: e.target.value }))}
              minHeight="260px"
            />
          </Fieldset>
          <Fieldset label={translateRuntime("settings.template_studio.header_html")} optional>
            <CodeTextarea
              value={draft?.header_html || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), header_html: e.target.value }))}
              minHeight="120px"
            />
          </Fieldset>
          <Fieldset label={translateRuntime("settings.template_studio.footer_html")} hint={translateRuntime("settings.template_studio.footer_html_hint")}>
            <CodeTextarea
              value={draft?.footer_html || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), footer_html: e.target.value }))}
              minHeight="120px"
            />
          </Fieldset>
        </div>
      </SectionGroup>
      <SectionGroup
        title={translateRuntime("settings.template_studio.page_setup")}
        description={translateRuntime("settings.template_studio.page_setup_description")}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Fieldset label={translateRuntime("settings.template_studio.paper_size")}>
            <AppSelect
              className="select select-bordered"
              value={draft?.paper_size || "A4"}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), paper_size: e.target.value }))}
            >
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </AppSelect>
          </Fieldset>
          <Fieldset label={translateRuntime("settings.template_studio.top_margin")}>
            <input
              className="input input-bordered"
              value={draft?.margin_top || "12mm"}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), margin_top: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label={translateRuntime("settings.template_studio.right_margin")}>
            <input
              className="input input-bordered"
              value={draft?.margin_right || "12mm"}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), margin_right: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label={translateRuntime("settings.template_studio.bottom_margin")}>
            <input
              className="input input-bordered"
              value={draft?.margin_bottom || "12mm"}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), margin_bottom: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label={translateRuntime("settings.template_studio.left_margin")}>
            <input
              className="input input-bordered"
              value={draft?.margin_left || "12mm"}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), margin_left: e.target.value }))}
            />
          </Fieldset>
        </div>
      </SectionGroup>
    </div>
  );
}

function EmailTemplateComposeTab({ draft, setDraft, connections, setSample, entities, t }) {
  const selectedEntityId = getTemplateEntityId(draft);
  const entityOptions = buildTemplateEntityOptions(entities, selectedEntityId);

  function handleEntityChange(nextEntityId) {
    setDraft((prev) => setTemplateEntityId(prev, nextEntityId));
    setSample((prev) => ({ ...(prev || {}), entity_id: nextEntityId, record_id: "" }));
  }

  return (
    <div className="space-y-4">
      <SectionGroup
        title={t("settings.template_studio.template_details")}
        description={t("settings.template_studio.email_template_details_description")}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Fieldset label={t("common.name")}>
            <input
              className="input input-bordered"
              value={draft?.name || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), name: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label={t("common.description")} optional>
            <input
              className="input input-bordered"
              value={draft?.description || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), description: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label={t("common.entity")} hint={t("settings.template_studio.template_entity_hint")} className="md:col-start-1">
            <AppSelect
              className="select select-bordered"
              value={selectedEntityId}
              onChange={(e) => handleEntityChange(e.target.value)}
            >
              <option value="">{t("settings.template_studio.select_entity")}</option>
              {entityOptions.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.label || ent.id}
                </option>
              ))}
            </AppSelect>
          </Fieldset>
          <Fieldset label={t("common.connection")} optional>
            {connections.length > 0 ? (
              <AppSelect
                className="select select-bordered"
                value={draft?.default_connection_id || ""}
                onChange={(e) => setDraft((prev) => ({ ...(prev || {}), default_connection_id: e.target.value || null }))}
              >
                <option value="">{t("settings.template_studio.use_default_connection")}</option>
                {connections.map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {conn.name || conn.id}
                  </option>
                ))}
              </AppSelect>
            ) : (
              <input
                className="input input-bordered"
                placeholder={t("settings.template_studio.connection_id_placeholder")}
                value={draft?.default_connection_id || ""}
                onChange={(e) => setDraft((prev) => ({ ...(prev || {}), default_connection_id: e.target.value }))}
              />
            )}
          </Fieldset>
        </div>
      </SectionGroup>
      <SectionGroup
        title={t("settings.template_studio.message_content")}
        description={t("settings.template_studio.message_content_description")}
      >
        <div className="grid grid-cols-1 gap-4">
          <Fieldset label={t("settings.template_studio.subject_jinja")}>
            <input
              className="input input-bordered"
              value={draft?.subject || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), subject: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label={t("settings.template_studio.body_html_jinja")}>
            <CodeTextarea
              value={draft?.body_html || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), body_html: e.target.value }))}
              textareaClassName="resize-none"
              minHeight="260px"
            />
          </Fieldset>
          <Fieldset label={t("settings.template_studio.text_fallback")} optional>
            <CodeTextarea
              value={draft?.body_text || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), body_text: e.target.value }))}
              textareaClassName="resize-none"
              minHeight="120px"
            />
          </Fieldset>
        </div>
      </SectionGroup>
    </div>
  );
}

export function getEmailTemplateProfile(t = translateRuntime) {
  return {
    kind: "email",
    title: t("settings.email_template"),
    defaultTabId: "compose",
    samplePicker: { enabled: true },
    autoPreview: false,
    autoPreviewMode: "placeholder",
    desktopScrollableTabs: ["compose", "test", "history"],
    agentMessage: t("settings.template_studio.email_agent_message"),
    actions: [
      { id: "save", label: t("common.save"), kind: "secondary", onClick: (ctx) => ctx.saveNow?.() },
    ],
    rightTabs: [
    {
      id: "compose",
      label: t("settings.template_studio.compose"),
      render: ({ draft, setDraft, connections = [], setSample, entities }) => (
        <EmailTemplateComposeTab
          draft={draft}
          setDraft={setDraft}
          connections={connections}
          setSample={setSample}
          entities={entities}
          t={t}
        />
      ),
    },
    {
      id: "preview",
      label: t("common.preview"),
      render: ({ sample, setSample, entities, previewState, runPreview }) => (
        <EmailPreviewTab
          sample={sample}
          setSample={setSample}
          entities={entities}
          previewState={previewState}
          runPreview={runPreview}
        />
      ),
    },
    {
      id: "test",
      label: t("settings.template_studio.send_test"),
      render: ({ sample, setSample, entities, previewState, sendTest }) => (
        <EmailTestTab
          sample={sample}
          setSample={setSample}
          entities={entities}
          previewState={previewState}
          sendTest={sendTest}
        />
      ),
    },
    {
      id: "history",
      label: t("common.history"),
      render: ({ record, draft }) => (
        <EmailHistoryTab templateId={record?.id || draft?.id} />
      ),
    },
    ],
  };
}

export function getDocumentTemplateProfile(t = translateRuntime) {
  return {
    kind: "document",
    title: t("settings.document_template"),
    defaultTabId: "template",
    samplePicker: { enabled: true },
    autoPreview: true,
    autoPreviewMode: "placeholder",
    desktopScrollableTabs: ["template"],
    agentMessage: t("settings.template_studio.document_agent_message"),
    actions: [
      { id: "save", label: t("common.save"), kind: "secondary", onClick: (ctx) => ctx.saveNow?.() },
    ],
    rightTabs: [
    {
      id: "template",
      label: t("settings.template_studio.template"),
      render: (props) => <DocumentTemplateTab {...props} />,
    },
    {
      id: "preview",
      label: t("common.preview"),
      render: ({ sample, setSample, entities, previewState, setPreviewState, runPreviewOnce }) => (
        <DocPreviewTab
          sample={sample}
          setSample={setSample}
          entities={entities}
          previewState={previewState}
          setPreviewState={setPreviewState}
          runPreviewOnce={runPreviewOnce}
        />
      ),
    },
    ],
  };
}

export function getSmsTemplateProfile(t = translateRuntime) {
  return {
    kind: "sms",
    title: t("settings.template_studio.sms_template"),
    defaultTabId: "compose",
    samplePicker: { enabled: true },
    actions: [],
    rightTabs: [
    {
      id: "compose",
      label: t("settings.template_studio.compose"),
      render: () => (
        <div className="text-sm opacity-70">
          {t("settings.template_studio.sms_templates_coming_soon")}
        </div>
      ),
    },
    ],
  };
}

function EmailTestTab({ sample, setSample, entities, previewState, sendTest }) {
  const [toEmail, setToEmail] = React.useState("");
  const [status, setStatus] = React.useState(null);
  const [result, setResult] = React.useState(null);

  async function handleSend() {
    setStatus("sending");
    setResult(null);
    try {
      const res = await sendTest?.(toEmail, sample);
      setResult(res || null);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="border border-base-200 rounded-box p-3 bg-base-100 space-y-4">
      <label className="form-control">
        <span className="label-text">{translateRuntime("settings.template_studio.to_email_address")}</span>
        <input className="input input-bordered" value={toEmail} onChange={(e) => setToEmail(e.target.value)} />
      </label>
      <div>
        <SamplePicker
          sample={sample}
          setSample={setSample}
          entities={entities}
          showEntitySelect={false}
          size="sm"
          rightAction={
            <button
              className="btn btn-sm"
              onClick={handleSend}
              disabled={!toEmail || !sample?.entity_id || !sample?.record_id || status === "sending"}
            >
              {status === "sending" ? translateRuntime("settings.template_studio.sending") : translateRuntime("settings.template_studio.send_test")}
            </button>
          }
        />
      </div>
      <div className="space-y-2">
        {status === "sent" && <span className="text-xs text-success">{translateRuntime("common.sent")}</span>}
        {status === "error" && <span className="text-xs text-error">{translateRuntime("common.failed")}</span>}
        {result?.outbox_id && (
          <div className="text-xs opacity-70">{translateRuntime("settings.template_studio.outbox_id", { id: result.outbox_id })}</div>
        )}
        {previewState?.rendered_subject && (
          <div className="text-xs opacity-70">{translateRuntime("settings.template_studio.subject_value", { subject: previewState.rendered_subject })}</div>
        )}
      </div>
    </div>
  );
}

function EmailPreviewTab({
  sample,
  setSample,
  entities,
  previewState,
  runPreview,
}) {
  const [zoomPct, setZoomPct] = useState(100);
  const [rendering, setRendering] = useState(false);
  const zoom = Math.max(0.5, Math.min(1, zoomPct / 100));
  const showPreviewFrame = Boolean(previewState?.rendered_html);
  const previewError = typeof previewState?.error === "string" ? previewState.error.trim() : "";

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      <div className="border border-base-200 rounded-box p-3 bg-base-100">
        <SamplePicker
          sample={sample}
          setSample={setSample}
          entities={entities}
          showEntitySelect={false}
          size="sm"
          rightAction={
            <button
              className="btn btn-sm"
              disabled={!sample?.entity_id || rendering}
              onClick={async () => {
                setRendering(true);
                try {
                  await runPreview({
                    ...(sample || {}),
                    placeholder: !sample?.record_id,
                  });
                } finally {
                  setRendering(false);
                }
              }}
            >
              {rendering ? translateRuntime("settings.template_studio.rendering") : translateRuntime("settings.template_studio.render_preview")}
            </button>
          }
        />
      </div>
      {!sample?.entity_id && (
        <div className="text-sm opacity-70">
          {translateRuntime("settings.template_studio.choose_entity_preview_email")}
        </div>
      )}
      {previewError ? (
        <div className="rounded-box border border-error/30 bg-error/10 p-3 text-sm text-error">
          {previewError}
        </div>
      ) : null}
      <div className={`flex-1 min-h-0 border border-base-200 rounded-xl overflow-hidden bg-base-100 ${showPreviewFrame ? "" : "hidden"}`}>
        {showPreviewFrame && (
          <>
          <div className="px-3 py-2 border-b border-base-200 flex items-center justify-end gap-2">
            <span className="text-xs opacity-70">{translateRuntime("settings.template_studio.zoom")}</span>
            <AppSelect
              className="select select-bordered select-xs w-20"
              value={zoomPct}
              onChange={(e) => setZoomPct(Number(e.target.value) || 100)}
            >
              <option value={50}>50%</option>
              <option value={67}>67%</option>
              <option value={80}>80%</option>
              <option value={90}>90%</option>
              <option value={100}>100%</option>
            </AppSelect>
          </div>
          <iframe
            title={translateRuntime("settings.template_studio.email_preview")}
            className="w-full h-full min-h-[420px]"
            sandbox=""
            srcDoc={previewState.rendered_html}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              width: `${100 / zoom}%`,
              height: `${100 / zoom}%`,
            }}
          />
          </>
        )}
      </div>
    </div>
  );
}

function DocPreviewTab({
  sample,
  setSample,
  entities,
  previewState,
  setPreviewState,
  runPreviewOnce,
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    let revokedUrl = "";
    let inlineUrl = "";
    async function loadPdf() {
      const inlinePdf = typeof previewState?.pdf_base64 === "string" ? previewState.pdf_base64.trim() : "";
      if (inlinePdf) {
        try {
          const binary = atob(inlinePdf);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          inlineUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          setPreviewUrl(inlineUrl);
          setPreviewError("");
          return;
        } catch (err) {
          setPreviewUrl("");
          setPreviewError(err?.message || translateRuntime("settings.template_studio.preview_failed"));
          return;
        }
      }
      if (!previewState?.attachment_id) {
        setPreviewUrl("");
        setPreviewError(previewState?.error || "");
        return;
      }
      setLoading(true);
      setPreviewError("");
      try {
        const session = await getSafeSession();
        const token = session?.access_token;
        const workspaceId = previewState?.workspace_id || getActiveWorkspaceId();
        const res = await fetch(`${API_URL}/attachments/${previewState.attachment_id}/download`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
          },
        });
        if (!res.ok) {
          setPreviewUrl("");
          let message = translateRuntime("settings.template_studio.preview_failed");
          try {
            const payload = await res.json();
            if (payload?.message && typeof payload.message === "string" && payload.message.trim()) {
              message = payload.message.trim();
            }
          } catch {
            // ignore response parsing failures
          }
          setPreviewError(message);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        revokedUrl = url;
        setPreviewUrl(url);
      } catch (err) {
        setPreviewUrl("");
        setPreviewError(err?.message || translateRuntime("settings.template_studio.preview_failed"));
      } finally {
        setLoading(false);
      }
    }
    loadPdf();
    return () => {
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
      if (inlineUrl) {
        URL.revokeObjectURL(inlineUrl);
      }
    };
  }, [previewState?.attachment_id, previewState?.workspace_id, previewState?.pdf_base64, previewState?.error]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      {!sample?.entity_id && (
        <div className="text-sm opacity-70">
          {translateRuntime("settings.template_studio.select_entity_template_tab_preview")}
        </div>
      )}
      <div className="border border-base-200 rounded-box p-3 bg-base-100">
        <SamplePicker
          sample={sample}
          setSample={setSample}
          entities={entities}
          showEntitySelect={false}
          rightAction={
            <button
              className="btn btn-sm"
              disabled={!sample?.entity_id || !sample?.record_id || rendering}
              onClick={async () => {
                setRendering(true);
                try {
                  const res = await runPreviewOnce(sample);
                  if (res) setPreviewState?.(res);
                } finally {
                  setRendering(false);
                }
              }}
            >
              {rendering ? translateRuntime("settings.template_studio.rendering") : translateRuntime("settings.template_studio.rerender_preview")}
            </button>
          }
        />
      </div>
      <div className="flex-1 min-h-0 border border-base-200 rounded-box overflow-hidden bg-base-100">
        {loading && (
          <div className="w-full h-full flex items-center justify-center">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        )}
        {!loading && previewError && (
          <div className="w-full h-full flex items-center justify-center p-6 text-sm text-error text-center">
            {previewError}
          </div>
        )}
        {!loading && previewUrl && (
          <iframe title={translateRuntime("settings.template_studio.pdf_preview")} src={previewUrl} className="block w-full h-full min-h-0" />
        )}
      </div>
    </div>
  );
}

function EmailHistoryTab({ templateId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!templateId) return;
      setLoading(true);
      try {
        const res = await apiFetch(`/email/templates/${templateId}/history`);
        if (!mounted) return;
        setItems(res?.outbox || []);
      } catch (err) {
        if (mounted) setError(err?.message || translateRuntime("settings.template_studio.load_history_failed"));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [templateId]);

  const rows = useMemo(
    () => (items || []).map((row) => ({
      id: row.id,
      status: row.status || "",
      to: Array.isArray(row.to) ? row.to.join(", ") : "",
      subject: row.subject || "",
      created_at: row.created_at || "",
    })),
    [items],
  );

  const historyFieldIndex = useMemo(
    () => ({
      "outbox.status": { id: "outbox.status", label: t("common.status") },
      "outbox.to": { id: "outbox.to", label: t("common.to") },
      "outbox.subject": { id: "outbox.subject", label: t("common.subject") },
      "outbox.created_at": { id: "outbox.created_at", label: t("settings.template_studio.created") },
    }),
    [t],
  );

  const historyListView = useMemo(
    () => ({
      id: "email.template.history.list",
      kind: "list",
      columns: [
        { field_id: "outbox.status" },
        { field_id: "outbox.to" },
        { field_id: "outbox.subject" },
        { field_id: "outbox.created_at" },
      ],
    }),
    [],
  );

  const historyListRecords = useMemo(
    () => rows.map((row) => ({
      record_id: row.id,
      record: {
        "outbox.status": row.status,
        "outbox.to": row.to,
        "outbox.subject": row.subject,
        "outbox.created_at": row.created_at ? formatDateTime(row.created_at, row.created_at) : "",
      },
    })),
    [rows],
  );

  const historyFilters = useMemo(
    () => [
      { id: "all", label: t("common.all"), domain: null },
      { id: "queued", label: t("common.queued"), domain: { op: "eq", field: "outbox.status", value: "queued" } },
      { id: "sent", label: t("common.sent"), domain: { op: "eq", field: "outbox.status", value: "sent" } },
      { id: "failed", label: t("common.failed"), domain: { op: "eq", field: "outbox.status", value: "failed" } },
    ],
    [t],
  );

  const activeHistoryFilter = useMemo(
    () => historyFilters.find((flt) => flt.id === statusFilter) || null,
    [historyFilters, statusFilter],
  );

  if (!templateId) {
    return (
      <div className="rounded-box border border-base-300 bg-base-100 p-4">
        <div className="text-sm opacity-60">{translateRuntime("settings.template_studio.save_template_to_see_history")}</div>
      </div>
    );
  }
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="space-y-4">
        {error && <div className="alert alert-error text-sm">{error}</div>}
        {loading ? (
          <div className="text-sm opacity-60">{translateRuntime("settings.template_studio.loading_history")}</div>
        ) : (
          <>
            <SystemListToolbar
              title={translateRuntime("common.history")}
              searchValue={search}
              onSearchChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              filters={historyFilters}
              onFilterChange={(id) => {
                setStatusFilter(id);
                setPage(0);
              }}
              filterableFields={[]}
              onClearFilters={() => {
                setStatusFilter("all");
                setPage(0);
              }}
              onRefresh={async () => {
                setLoading(true);
                setError(null);
                try {
                  const res = await apiFetch(`/email/templates/${templateId}/history`);
                  setItems(res?.outbox || []);
                } catch (err) {
                  setError(err?.message || translateRuntime("settings.template_studio.load_history_failed"));
                } finally {
                  setLoading(false);
                }
              }}
              showSavedViews={false}
              pagination={{
                page,
                pageSize: 25,
                totalItems,
                onPageChange: setPage,
              }}
            />
            {rows.length === 0 ? (
              <div className="text-sm opacity-60">{translateRuntime("settings.template_studio.no_sends_yet")}</div>
            ) : (
              <ListViewRenderer
                view={historyListView}
                fieldIndex={historyFieldIndex}
                records={historyListRecords}
                hideHeader
                disableHorizontalScroll
                tableClassName="w-full table-fixed min-w-0"
                searchQuery={search}
                searchFields={["outbox.subject", "outbox.to"]}
                filters={historyFilters}
                activeFilter={activeHistoryFilter}
                clientFilters={[]}
                page={page}
                pageSize={25}
                onPageChange={setPage}
                onTotalItemsChange={setTotalItems}
                showPaginationControls={false}
                enableSelection={false}
                onSelectRow={(row) => {
                  const id = row?.record_id;
                  if (id) navigate(`/settings/email-outbox/${id}`);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DocHistoryTab({ templateId }) {
  const [items, setItems] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!templateId) return;
      setLoading(true);
      try {
        const res = await apiFetch(`/docs/templates/${templateId}/history`);
        if (!mounted) return;
        setItems(res?.links || []);
        setAttachments(res?.attachments || []);
      } catch (err) {
        if (mounted) setError(err?.message || translateRuntime("settings.template_studio.load_history_failed"));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [templateId]);

  if (!templateId) {
    return <div className="text-sm opacity-60">{translateRuntime("settings.template_studio.save_template_to_see_history")}</div>;
  }
  if (loading) {
    return <div className="text-sm opacity-60">{translateRuntime("settings.template_studio.loading_history")}</div>;
  }
  if (error) {
    return <div className="text-sm text-error">{error}</div>;
  }
  if (items.length === 0) {
    return <div className="text-sm opacity-60">{translateRuntime("settings.template_studio.no_generated_documents_yet")}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm min-w-max">
        <thead>
          <tr>
            <th>{translateRuntime("common.record")}</th>
            <th>{translateRuntime("settings.template_studio.filename")}</th>
            <th>{translateRuntime("settings.template_studio.created")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((link) => {
            const attachment = attachments.find((a) => a.id === link.attachment_id);
            return (
              <tr key={link.id}>
                <td className="text-xs whitespace-nowrap">{link.entity_id}:{link.record_id}</td>
                <td className="text-xs whitespace-nowrap">{attachment?.filename || link.attachment_id}</td>
                <td className="text-xs whitespace-nowrap">{formatDateTime(attachment?.created_at || link.created_at, attachment?.created_at || link.created_at || "")}</td>
                <td className="whitespace-nowrap">
                  {attachment?.id && (
                    <a className="btn btn-ghost btn-xs" href={`/attachments/${attachment.id}/download`} target="_blank" rel="noreferrer">
                      {translateRuntime("common.open")}
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DocJobsTab({ templateId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!templateId) return;
      setLoading(true);
      try {
        const res = await apiFetch(`/docs/templates/${templateId}/jobs`);
        if (!mounted) return;
        setItems(res?.jobs || []);
      } catch (err) {
        if (mounted) setError(err?.message || translateRuntime("settings.template_studio.load_jobs_failed"));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [templateId]);

  if (!templateId) {
    return <div className="text-sm opacity-60">{translateRuntime("settings.template_studio.save_template_to_see_jobs")}</div>;
  }
  if (loading) {
    return <div className="text-sm opacity-60">{translateRuntime("settings.template_studio.loading_jobs")}</div>;
  }
  if (error) {
    return <div className="text-sm text-error">{error}</div>;
  }
  if (items.length === 0) {
    return <div className="text-sm opacity-60">{translateRuntime("settings.template_studio.no_jobs_yet")}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm min-w-max">
        <thead>
          <tr>
            <th>{translateRuntime("common.status")}</th>
            <th>{translateRuntime("settings.template_studio.run_at")}</th>
            <th>{translateRuntime("settings.template_studio.attempt")}</th>
            <th>{translateRuntime("common.error")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((job) => (
            <tr key={job.id}>
              <td className="whitespace-nowrap">{job.status}</td>
              <td className="text-xs whitespace-nowrap">{job.run_at}</td>
              <td className="text-xs whitespace-nowrap">{job.attempt}</td>
              <td className="text-xs whitespace-nowrap">{job.last_error || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
