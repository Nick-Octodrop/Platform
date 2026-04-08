import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import SamplePicker from "./SamplePicker.jsx";
import { API_URL, getActiveWorkspaceId } from "../../api.js";
import { supabase } from "../../supabase.js";
import { apiFetch } from "../../api.js";
import CodeTextarea from "../../components/CodeTextarea.jsx";
import { formatDateTime } from "../../utils/dateTime.js";
import ListViewRenderer from "../../ui/ListViewRenderer.jsx";
import SystemListToolbar from "../../ui/SystemListToolbar.jsx";

function Fieldset({ label, hint, optional = false, className = "", children }) {
  return (
    <fieldset className={`fieldset ${className}`}>
      <legend className="fieldset-legend text-xs uppercase opacity-60 tracking-wide">
        {label}
      </legend>
      {children}
      {(hint || optional) && (
        <span className="label label-text-alt opacity-50">
          {hint || (optional ? "(optional)" : "")}
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
  return (
    <div className="space-y-4">
      <SectionGroup
        title="Template details"
        description="Set the name, description, entity, and filename pattern for this document template."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Fieldset label="Name">
            <input
              className="input input-bordered"
              value={draft?.name || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), name: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label="Description" optional>
            <input
              className="input input-bordered"
              value={draft?.description || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), description: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label="Entity" hint="Templates render fields from one entity.">
            <select
              className="select select-bordered"
              value={sample?.entity_id || ""}
              onChange={(e) => setSample({ ...sample, entity_id: e.target.value, record_id: "" })}
            >
              <option value="">Select entity</option>
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.label || ent.id}
                </option>
              ))}
            </select>
          </Fieldset>
          <Fieldset label="Filename pattern (Jinja)" hint="Tip: use record fields to make filenames unique." className="md:col-span-2">
            <input
              className="input input-bordered"
              value={draft?.filename_pattern || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), filename_pattern: e.target.value }))}
              placeholder="Contact - {{ record['contact.display_name'] }}"
            />
          </Fieldset>
        </div>
      </SectionGroup>
      <SectionGroup
        title="Document content"
        description="Write the main HTML plus any optional header and footer blocks."
      >
        <div className="grid grid-cols-1 gap-4">
          <Fieldset label="HTML Template (Jinja)">
            <CodeTextarea
              value={draft?.html || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), html: e.target.value }))}
              minHeight="260px"
            />
          </Fieldset>
          <Fieldset label="Header HTML" optional>
            <CodeTextarea
              value={draft?.header_html || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), header_html: e.target.value }))}
              minHeight="120px"
            />
          </Fieldset>
          <Fieldset label="Footer HTML" hint="Use pageNumber / totalPages for pagination.">
            <CodeTextarea
              value={draft?.footer_html || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), footer_html: e.target.value }))}
              minHeight="120px"
            />
          </Fieldset>
        </div>
      </SectionGroup>
      <SectionGroup
        title="Page setup"
        description="Choose the paper size and page margins for the generated PDF."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Fieldset label="Paper size">
            <select
              className="select select-bordered"
              value={draft?.paper_size || "A4"}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), paper_size: e.target.value }))}
            >
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </select>
          </Fieldset>
          <Fieldset label="Top margin">
            <input
              className="input input-bordered"
              value={draft?.margin_top || "12mm"}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), margin_top: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label="Right margin">
            <input
              className="input input-bordered"
              value={draft?.margin_right || "12mm"}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), margin_right: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label="Bottom margin">
            <input
              className="input input-bordered"
              value={draft?.margin_bottom || "12mm"}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), margin_bottom: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label="Left margin">
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

export const emailTemplateProfile = {
  kind: "email",
  title: "Email Template",
  defaultTabId: "compose",
  samplePicker: { enabled: true },
  autoPreview: false,
  autoPreviewMode: "placeholder",
  desktopScrollableTabs: ["compose", "test", "history"],
  agentMessage: "Describe the email template change you want and I will draft an update.",
  actions: [
    { id: "save", label: "Save", kind: "secondary", onClick: (ctx) => ctx.saveNow?.() },
  ],
  rightTabs: [
    {
      id: "compose",
      label: "Compose",
      render: ({ draft, setDraft, connections = [], sample, setSample, entities }) => (
        <div className="space-y-4">
          <SectionGroup
            title="Template details"
            description="Set the name, description, entity, and default sending connection for this template."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Fieldset label="Name">
                <input
                  className="input input-bordered"
                  value={draft?.name || ""}
                  onChange={(e) => setDraft((prev) => ({ ...(prev || {}), name: e.target.value }))}
                />
              </Fieldset>
              <Fieldset label="Description" optional>
                <input
                  className="input input-bordered"
                  value={draft?.description || ""}
                  onChange={(e) => setDraft((prev) => ({ ...(prev || {}), description: e.target.value }))}
                />
              </Fieldset>
              <Fieldset label="Entity" hint="Templates render fields from one entity." className="md:col-start-1">
                <select
                  className="select select-bordered"
                  value={sample?.entity_id || ""}
                  onChange={(e) => setSample({ ...sample, entity_id: e.target.value, record_id: "" })}
                >
                  <option value="">Select entity</option>
                  {entities.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.label || ent.id}
                    </option>
                  ))}
                </select>
              </Fieldset>
              <Fieldset label="Default connection" optional>
                {connections.length > 0 ? (
                  <select
                    className="select select-bordered"
                    value={draft?.default_connection_id || ""}
                    onChange={(e) => setDraft((prev) => ({ ...(prev || {}), default_connection_id: e.target.value || null }))}
                  >
                    <option value="">Use default</option>
                    {connections.map((conn) => (
                      <option key={conn.id} value={conn.id}>
                        {conn.name || conn.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input input-bordered"
                    placeholder="Connection ID"
                    value={draft?.default_connection_id || ""}
                    onChange={(e) => setDraft((prev) => ({ ...(prev || {}), default_connection_id: e.target.value }))}
                  />
                )}
              </Fieldset>
            </div>
          </SectionGroup>
          <SectionGroup
            title="Message content"
            description="Write the subject and HTML body for the email template."
          >
            <div className="grid grid-cols-1 gap-4">
              <Fieldset label="Subject (Jinja)">
                <input
                  className="input input-bordered"
                  value={draft?.subject || ""}
                  onChange={(e) => setDraft((prev) => ({ ...(prev || {}), subject: e.target.value }))}
                />
              </Fieldset>
              <Fieldset label="Body HTML (Jinja)">
                <CodeTextarea
                  value={draft?.body_html || ""}
                  onChange={(e) => setDraft((prev) => ({ ...(prev || {}), body_html: e.target.value }))}
                  textareaClassName="resize-none"
                  minHeight="260px"
                />
              </Fieldset>
              <Fieldset label="Text fallback" optional>
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
      ),
    },
    {
      id: "preview",
      label: "Preview",
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
      label: "Send Test",
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
      label: "History",
      render: ({ record, draft }) => (
        <EmailHistoryTab templateId={record?.id || draft?.id} />
      ),
    },
  ],
};

export const documentTemplateProfile = {
  kind: "document",
  title: "Document Template",
  defaultTabId: "template",
  samplePicker: { enabled: true },
  autoPreview: true,
  autoPreviewMode: "placeholder",
  desktopScrollableTabs: ["template"],
  agentMessage: "Describe the document template change you want and I will draft an update.",
  actions: [
    { id: "save", label: "Save", kind: "secondary", onClick: (ctx) => ctx.saveNow?.() },
  ],
  rightTabs: [
    {
      id: "template",
      label: "Template",
      render: (props) => <DocumentTemplateTab {...props} />,
    },
    {
      id: "preview",
      label: "Preview",
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

export const smsTemplateProfile = {
  kind: "sms",
  title: "SMS Template",
  defaultTabId: "compose",
  samplePicker: { enabled: true },
  actions: [],
  rightTabs: [
    {
      id: "compose",
      label: "Compose",
      render: () => (
        <div className="text-sm opacity-70">
          SMS templates coming soon.
        </div>
      ),
    },
  ],
};

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
        <span className="label-text">To email address</span>
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
              {status === "sending" ? "Sending..." : "Send Test"}
            </button>
          }
        />
      </div>
      <div className="space-y-2">
        {status === "sent" && <span className="text-xs text-success">Sent</span>}
        {status === "error" && <span className="text-xs text-error">Failed</span>}
        {result?.outbox_id && (
          <div className="text-xs opacity-70">Outbox: {result.outbox_id}</div>
        )}
        {previewState?.rendered_subject && (
          <div className="text-xs opacity-70">Subject: {previewState.rendered_subject}</div>
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
              {rendering ? "Rendering..." : "Render preview"}
            </button>
          }
        />
      </div>
      {!sample?.entity_id && (
        <div className="text-sm opacity-70">
          Choose an entity above to render this email with placeholders, or choose a record to preview real data.
        </div>
      )}
      <div className={`flex-1 min-h-0 border border-base-200 rounded-xl overflow-hidden bg-base-100 ${showPreviewFrame ? "" : "hidden"}`}>
        {showPreviewFrame && (
          <>
          <div className="px-3 py-2 border-b border-base-200 flex items-center justify-end gap-2">
            <span className="text-xs opacity-70">Zoom</span>
            <select
              className="select select-bordered select-xs w-20"
              value={zoomPct}
              onChange={(e) => setZoomPct(Number(e.target.value) || 100)}
            >
              <option value={50}>50%</option>
              <option value={67}>67%</option>
              <option value={80}>80%</option>
              <option value={90}>90%</option>
              <option value={100}>100%</option>
            </select>
          </div>
          <iframe
            title="Email Preview"
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

  useEffect(() => {
    let revokedUrl = "";
    async function loadPdf() {
      if (!previewState?.attachment_id) {
        setPreviewUrl("");
        return;
      }
      setLoading(true);
      try {
        const session = (await supabase.auth.getSession()).data.session;
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
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        revokedUrl = url;
        setPreviewUrl(url);
      } finally {
        setLoading(false);
      }
    }
    loadPdf();
    return () => {
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [previewState?.attachment_id, previewState?.workspace_id]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      {!sample?.entity_id && (
        <div className="text-sm opacity-70">
          Select an entity in the Template tab to see a placeholder preview.
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
              {rendering ? "Rendering..." : "Re-render preview"}
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
        {!loading && previewUrl && (
          <iframe title="PDF preview" src={previewUrl} className="block w-full h-full min-h-0" />
        )}
      </div>
    </div>
  );
}

function EmailHistoryTab({ templateId }) {
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
        if (mounted) setError(err?.message || "Failed to load history");
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
      "outbox.status": { id: "outbox.status", label: "Status" },
      "outbox.to": { id: "outbox.to", label: "To" },
      "outbox.subject": { id: "outbox.subject", label: "Subject" },
      "outbox.created_at": { id: "outbox.created_at", label: "Created" },
    }),
    [],
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
      { id: "all", label: "All", domain: null },
      { id: "queued", label: "Queued", domain: { op: "eq", field: "outbox.status", value: "queued" } },
      { id: "sent", label: "Sent", domain: { op: "eq", field: "outbox.status", value: "sent" } },
      { id: "failed", label: "Failed", domain: { op: "eq", field: "outbox.status", value: "failed" } },
    ],
    [],
  );

  const activeHistoryFilter = useMemo(
    () => historyFilters.find((flt) => flt.id === statusFilter) || null,
    [historyFilters, statusFilter],
  );

  if (!templateId) {
    return (
      <div className="rounded-box border border-base-300 bg-base-100 p-4">
        <div className="text-sm opacity-60">Save the template to see history.</div>
      </div>
    );
  }
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="space-y-4">
        {error && <div className="alert alert-error text-sm">{error}</div>}
        {loading ? (
          <div className="text-sm opacity-60">Loading history…</div>
        ) : (
          <>
            <SystemListToolbar
              title="History"
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
                  setError(err?.message || "Failed to load history");
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
              <div className="text-sm opacity-60">No sends yet.</div>
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
        if (mounted) setError(err?.message || "Failed to load history");
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
    return <div className="text-sm opacity-60">Save the template to see history.</div>;
  }
  if (loading) {
    return <div className="text-sm opacity-60">Loading history…</div>;
  }
  if (error) {
    return <div className="text-sm text-error">{error}</div>;
  }
  if (items.length === 0) {
    return <div className="text-sm opacity-60">No generated documents yet.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm min-w-max">
        <thead>
          <tr>
            <th>Record</th>
            <th>Filename</th>
            <th>Created</th>
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
                      Open
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
        if (mounted) setError(err?.message || "Failed to load jobs");
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
    return <div className="text-sm opacity-60">Save the template to see jobs.</div>;
  }
  if (loading) {
    return <div className="text-sm opacity-60">Loading jobs…</div>;
  }
  if (error) {
    return <div className="text-sm text-error">{error}</div>;
  }
  if (items.length === 0) {
    return <div className="text-sm opacity-60">No jobs yet.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm min-w-max">
        <thead>
          <tr>
            <th>Status</th>
            <th>Run At</th>
            <th>Attempt</th>
            <th>Error</th>
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
