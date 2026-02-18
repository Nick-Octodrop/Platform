import React, { useEffect, useState } from "react";
import SamplePicker from "./SamplePicker.jsx";
import { API_URL } from "../../api.js";
import { supabase } from "../../supabase.js";
import { apiFetch } from "../../api.js";
import CodeTextarea from "../../components/CodeTextarea.jsx";
import { formatDateTime } from "../../utils/dateTime.js";

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

function DocumentTemplateTab({ draft, setDraft, sample, setSample, entities }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      <Fieldset label="Name">
        <input
          className="input input-bordered"
          value={draft?.name || ""}
          onChange={(e) => setDraft((prev) => ({ ...(prev || {}), name: e.target.value }))}
        />
      </Fieldset>
      <Fieldset label="Filename pattern (Jinja)" hint="Tip: use record fields to make filenames unique." className="md:col-span-2">
        <input
          className="input input-bordered"
          value={draft?.filename_pattern || ""}
          onChange={(e) => setDraft((prev) => ({ ...(prev || {}), filename_pattern: e.target.value }))}
          placeholder="Contact - {{ record['contact.display_name'] }}"
        />
      </Fieldset>
      <Fieldset label="HTML Template (Jinja)" className="md:col-span-2">
        <CodeTextarea
          value={draft?.html || ""}
          onChange={(e) => setDraft((prev) => ({ ...(prev || {}), html: e.target.value }))}
          minHeight="260px"
        />
      </Fieldset>
      <Fieldset label="Header HTML" optional className="md:col-span-2">
        <CodeTextarea
          value={draft?.header_html || ""}
          onChange={(e) => setDraft((prev) => ({ ...(prev || {}), header_html: e.target.value }))}
          minHeight="120px"
        />
      </Fieldset>
      <Fieldset label="Footer HTML" hint="Use pageNumber / totalPages for pagination." className="md:col-span-2">
        <CodeTextarea
          value={draft?.footer_html || ""}
          onChange={(e) => setDraft((prev) => ({ ...(prev || {}), footer_html: e.target.value }))}
          minHeight="120px"
        />
      </Fieldset>
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
  );
}

export const emailTemplateProfile = {
  kind: "email",
  title: "Email Template",
  defaultTabId: "compose",
  samplePicker: { enabled: true },
  autoPreview: true,
  autoPreviewMode: "placeholder",
  agentMessage: "Describe the email template change you want and I will draft an update.",
  actions: [
    { id: "preview", label: "Preview", kind: "secondary", onClick: (ctx) => ctx.openRenderModal() },
  ],
  rightTabs: [
    {
      id: "compose",
      label: "Compose",
      render: ({ draft, setDraft, connections = [], sample, setSample, entities }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <Fieldset label="Name">
            <input
              className="input input-bordered"
              value={draft?.name || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), name: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label="Subject (Jinja)" className="md:col-span-2">
            <input
              className="input input-bordered"
              value={draft?.subject || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), subject: e.target.value }))}
            />
          </Fieldset>
          <Fieldset label="Body HTML (Jinja)" className="md:col-span-2">
            <CodeTextarea
              value={draft?.body_html || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), body_html: e.target.value }))}
              minHeight="220px"
            />
          </Fieldset>
          <Fieldset label="Text fallback" optional className="md:col-span-2">
            <CodeTextarea
              value={draft?.body_text || ""}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), body_text: e.target.value }))}
              minHeight="120px"
            />
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
          <Fieldset label="Active">
            <input
              type="checkbox"
              className="toggle"
              checked={draft?.is_active ?? true}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), is_active: e.target.checked }))}
            />
          </Fieldset>
        </div>
      ),
    },
    {
      id: "preview",
      label: "Preview",
      render: ({ sample, setSample, entities, previewState, runPreview, renderModalOpen, setRenderModalOpen, renderSample, setRenderSample }) => (
        <EmailPreviewTab
          sample={sample}
          setSample={setSample}
          entities={entities}
          previewState={previewState}
          runPreview={runPreview}
          renderModalOpen={renderModalOpen}
          setRenderModalOpen={setRenderModalOpen}
          renderSample={renderSample}
          setRenderSample={setRenderSample}
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
  agentMessage: "Describe the document template change you want and I will draft an update.",
  actions: [
    { id: "save", label: "Save", kind: "primary", onClick: (ctx) => ctx.saveNow?.() },
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
    <div className="space-y-4">
      <label className="form-control">
        <span className="label-text">To email address</span>
        <input className="input input-bordered" value={toEmail} onChange={(e) => setToEmail(e.target.value)} />
      </label>
      <SamplePicker sample={sample} setSample={setSample} entities={entities} />
      <div>
        <button className="btn btn-sm" onClick={handleSend} disabled={!toEmail}>
          Send Test
        </button>
        {status === "sent" && <span className="ml-3 text-xs text-success">Sent</span>}
        {status === "error" && <span className="ml-3 text-xs text-error">Failed</span>}
      </div>
      {result?.outbox_id && (
        <div className="text-xs opacity-70">Outbox: {result.outbox_id}</div>
      )}
      {previewState?.error && <div className="text-xs text-error">{previewState.error}</div>}
      {previewState?.rendered_subject && (
        <div className="text-xs opacity-70">Subject: {previewState.rendered_subject}</div>
      )}
    </div>
  );
}

function EmailPreviewTab({
  sample,
  setSample,
  entities,
  previewState,
  runPreview,
  renderModalOpen,
  setRenderModalOpen,
  renderSample,
  setRenderSample,
}) {
  const [zoomPct, setZoomPct] = useState(100);
  const zoom = Math.max(0.5, Math.min(1, zoomPct / 100));

  return (
    <div className="h-full flex flex-col gap-4">
      {!sample?.entity_id && (
        <div className="text-sm opacity-70">
          Select an entity in the Compose tab to see a placeholder preview.
        </div>
      )}
      {previewState?.rendered_html && (
        <div className="flex-1 border border-base-200 rounded-xl overflow-hidden min-h-[420px] bg-base-100">
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
        </div>
      )}
      {previewState?.rendered_text && (
        <div className="text-xs whitespace-pre-wrap border border-base-200 rounded-xl p-3">
          {previewState.rendered_text}
        </div>
      )}
      {renderModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Select record to preview</h3>
            <div className="mt-3">
              <SamplePicker sample={renderSample} setSample={setRenderSample} entities={entities} size="sm" />
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setRenderModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn"
                disabled={!renderSample?.entity_id || !renderSample?.record_id}
                onClick={async () => {
                  setSample?.(renderSample);
                  await runPreview(renderSample);
                  setRenderModalOpen(false);
                }}
              >
                Preview
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setRenderModalOpen(false)} />
        </div>
      )}
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
        const res = await fetch(`${API_URL}/attachments/${previewState.attachment_id}/download`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  }, [previewState?.attachment_id]);

  return (
    <div className="h-full flex flex-col gap-4">
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
      <div className="flex-1 border border-base-200 rounded-box overflow-hidden min-h-[420px] bg-base-100">
        {loading && (
          <div className="w-full h-full flex items-center justify-center">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        )}
        {!loading && previewUrl && (
          <iframe title="PDF preview" src={previewUrl} className="w-full h-full min-h-[520px]" />
        )}
      </div>
    </div>
  );
}

function EmailHistoryTab({ templateId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
    return <div className="text-sm opacity-60">No sends yet.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Status</th>
            <th>To</th>
            <th>Subject</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              <td>{row.status}</td>
              <td className="text-xs">{(row.to || []).join(", ")}</td>
              <td className="text-xs">{row.subject}</td>
              <td className="text-xs">{formatDateTime(row.created_at, row.created_at || "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <table className="table table-sm">
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
                <td className="text-xs">{link.entity_id}:{link.record_id}</td>
                <td className="text-xs">{attachment?.filename || link.attachment_id}</td>
                <td className="text-xs">{formatDateTime(attachment?.created_at || link.created_at, attachment?.created_at || link.created_at || "")}</td>
                <td>
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
      <table className="table table-sm">
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
              <td>{job.status}</td>
              <td className="text-xs">{job.run_at}</td>
              <td className="text-xs">{job.attempt}</td>
              <td className="text-xs">{job.last_error || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
