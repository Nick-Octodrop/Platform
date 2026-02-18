import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import Tabs from "../components/Tabs.jsx";

export default function OpsJobPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("preview");
  const [acting, setActing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewKind, setPreviewKind] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  async function load() {
    if (!jobId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/ops/jobs/${jobId}`);
      setDetail(res || null);
    } catch (err) {
      setDetail(null);
      setError(err?.message || "Failed to load job");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const tabs = useMemo(
    () => [
      { id: "preview", label: "Preview" },
      { id: "details", label: "Details" },
      { id: "payload", label: "Payload" },
      { id: "events", label: "Events" },
    ],
    [],
  );

  const job = detail?.job || null;
  const events = Array.isArray(detail?.events) ? detail.events : [];
  const outboxId = job?.payload?.outbox_id || "";

  useEffect(() => {
    let mounted = true;
    async function loadPreview() {
      setPreview(null);
      setPreviewKind("");
      setPreviewError("");
      if (activeTab !== "preview") return;
      setPreviewLoading(true);
      try {
        const res = await apiFetch(`/ops/jobs/${encodeURIComponent(jobId)}/preview`);
        if (!mounted) return;
        setPreviewKind(res?.kind || "");
        setPreview(res?.outbox || null);
      } catch (err) {
        if (!mounted) return;
        setPreviewKind("");
        setPreview(null);
        setPreviewError(err?.message || "Failed to load preview");
      } finally {
        if (mounted) setPreviewLoading(false);
      }
    }
    loadPreview();
    return () => {
      mounted = false;
    };
  }, [activeTab, jobId]);

  async function retry() {
    if (!job?.id || acting) return;
    setActing(true);
    try {
      await apiFetch(`/ops/jobs/${job.id}/retry`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err?.message || "Retry failed");
    } finally {
      setActing(false);
    }
  }

  async function cancel() {
    if (!job?.id || acting) return;
    setActing(true);
    try {
      await apiFetch(`/ops/jobs/${job.id}/cancel`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err?.message || "Cancel failed");
    } finally {
      setActing(false);
    }
  }

  return (
    <TabbedPaneShell
      title={job?.type || "Job"}
      subtitle={job?.status ? `Status: ${job.status}` : "Job detail"}
      rightActions={(
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-ghost" type="button" onClick={load} disabled={loading || acting}>
            Refresh
          </button>
          <button className="btn btn-sm btn-outline" type="button" onClick={retry} disabled={!job || acting}>
            Retry
          </button>
          <button className="btn btn-sm btn-outline" type="button" onClick={cancel} disabled={!job || acting}>
            Cancel
          </button>
          <button className="btn btn-sm" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      )}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      <div className="rounded-box border border-base-300 bg-base-100 p-4">
        {job?.last_error ? (
          <div className="text-xs text-error whitespace-pre-wrap">{job.last_error}</div>
        ) : null}
        <div className={job?.last_error ? "mt-4" : ""}>
          <Tabs tabs={tabs} activeId={activeTab} onChange={setActiveTab} />
        </div>
      </div>

      <div className="mt-4 rounded-box border border-base-300 bg-base-100 overflow-hidden min-h-[28rem]">
        {loading ? (
          <div className="p-4 text-sm opacity-70">Loading…</div>
        ) : !job ? (
          <div className="p-4 text-sm opacity-60">Job not found.</div>
        ) : activeTab === "preview" ? (
          <div className="p-4">
            {previewLoading ? (
              <div className="text-sm opacity-70">Loading preview…</div>
            ) : previewError ? (
              <div className="text-sm text-error">{previewError}</div>
            ) : preview?.body_html ? (
              <div className="rounded-box border border-base-300 overflow-hidden">
                <iframe
                  title="Email preview"
                  className="w-full h-[70vh] bg-base-100"
                  sandbox=""
                  srcDoc={String(preview.body_html || "")}
                />
              </div>
            ) : previewKind === "none" ? (
              <div className="text-sm opacity-60">No preview available for this job.</div>
            ) : (
              <div className="text-sm opacity-60">
                {outboxId ? "No HTML preview available." : "No preview available for this job."}
              </div>
            )}
          </div>
        ) : activeTab === "payload" ? (
          <pre className="p-4 text-xs whitespace-pre-wrap">{JSON.stringify(job.payload || {}, null, 2)}</pre>
        ) : activeTab === "events" ? (
          <div className="p-4 space-y-1">
            {events.length === 0 ? (
              <div className="text-sm opacity-60">No events.</div>
            ) : (
              events.map((evt) => (
                <div key={evt.id || `${evt.ts}-${evt.message}`} className="text-xs">
                  <span className="opacity-70">{evt.ts}</span> {evt.level} — {evt.message}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="p-4 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs opacity-70">Job ID</div>
                <div className="text-sm font-mono break-all">{job.id}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Type</div>
                <div className="text-sm break-all">{job.type}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Status</div>
                <div className="text-sm">{job.status || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Attempts</div>
                <div className="text-sm">{job.attempt ?? "—"} / {job.max_attempts ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Run At</div>
                <div className="text-sm">{job.run_at || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Locked By</div>
                <div className="text-sm break-all">{job.locked_by || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Created</div>
                <div className="text-sm">{job.created_at || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">Updated</div>
                <div className="text-sm">{job.updated_at || "—"}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TabbedPaneShell>
  );
}
