import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import Tabs from "../components/Tabs.jsx";

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "dead"]);

export default function OpsJobPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { t, formatDateTime } = useI18n();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("preview");
  const [acting, setActing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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
      setError(err?.message || t("settings.ops.job_load_failed"));
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
      { id: "preview", label: t("common.preview") },
      { id: "details", label: t("common.details") },
      { id: "payload", label: t("common.payload") },
      { id: "events", label: t("common.events") },
    ],
    [t],
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
        setPreviewError(err?.message || t("common.attachments.preview_load_failed"));
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
      setError(err?.message || t("settings.ops.retry_failed"));
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
      setError(err?.message || t("settings.ops.cancel_failed"));
    } finally {
      setActing(false);
    }
  }

  async function deleteJob() {
    if (!job?.id || acting || !TERMINAL_JOB_STATUSES.has(job.status)) return;
    setActing(true);
    try {
      await apiFetch(`/ops/jobs/${job.id}`, { method: "DELETE" });
      navigate("/ops");
    } catch (err) {
      setError(err?.message || t("common.delete_failed"));
    } finally {
      setActing(false);
      setShowDeleteModal(false);
    }
  }

  const canDelete = Boolean(job?.id && TERMINAL_JOB_STATUSES.has(job.status));

  return (
    <TabbedPaneShell
      title={job?.type || t("common.job")}
      subtitle={job?.status ? t("settings.ops.status_value", { status: t(`common.${job.status}`, {}, { defaultValue: job.status }) }) : t("settings.ops.job_detail")}
      mobileOverflowActions={[
        {
          label: t("common.refresh"),
          onClick: load,
          disabled: loading || acting,
        },
        {
          label: t("settings.ops.retry"),
          onClick: retry,
          disabled: !job || acting,
        },
        {
          label: t("common.cancel"),
          onClick: cancel,
          disabled: !job || acting,
        },
        {
          label: canDelete ? t("common.delete") : t("settings.ops.delete_terminal_only_label"),
          onClick: () => setShowDeleteModal(true),
          disabled: !canDelete || acting,
        },
        {
          label: t("common.back"),
          onClick: () => navigate(-1),
        },
      ]}
      rightActions={(
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-ghost" type="button" onClick={load} disabled={loading || acting}>
            {t("common.refresh")}
          </button>
          <button className="btn btn-sm btn-outline" type="button" onClick={retry} disabled={!job || acting}>
            {t("settings.ops.retry")}
          </button>
          <button className="btn btn-sm btn-outline" type="button" onClick={cancel} disabled={!job || acting}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-sm btn-error" type="button" onClick={() => setShowDeleteModal(true)} disabled={!canDelete || acting}>
            {t("common.delete")}
          </button>
          <button className="btn btn-sm" type="button" onClick={() => navigate(-1)}>
            {t("common.back")}
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
          <div className="p-4 text-sm opacity-70">{t("common.loading")}</div>
        ) : !job ? (
          <div className="p-4 text-sm opacity-60">{t("settings.ops.job_not_found")}</div>
        ) : activeTab === "preview" ? (
          <div className="p-4">
            {previewLoading ? (
              <div className="text-sm opacity-70">{t("common.attachments.preview_loading")}</div>
            ) : previewError ? (
              <div className="text-sm text-error">{previewError}</div>
            ) : preview?.body_html ? (
              <div className="rounded-box border border-base-300 overflow-hidden">
                <iframe
                  title={t("settings.ops.email_preview")}
                  className="w-full h-[70vh] bg-base-100"
                  sandbox=""
                  srcDoc={String(preview.body_html || "")}
                />
              </div>
            ) : previewKind === "none" ? (
              <div className="text-sm opacity-60">{t("settings.ops.no_preview")}</div>
            ) : (
              <div className="text-sm opacity-60">
                {outboxId ? t("settings.ops.no_html_preview") : t("settings.ops.no_preview")}
              </div>
            )}
          </div>
        ) : activeTab === "payload" ? (
          <pre className="p-4 text-xs whitespace-pre-wrap">{JSON.stringify(job.payload || {}, null, 2)}</pre>
        ) : activeTab === "events" ? (
          <div className="p-4 space-y-1">
            {events.length === 0 ? (
              <div className="text-sm opacity-60">{t("settings.ops.no_events")}</div>
            ) : (
              events.map((evt) => (
                <div key={evt.id || `${evt.ts}-${evt.message}`} className="text-xs">
                  <span className="opacity-70">{formatDateTime(evt.ts) || evt.ts || ""}</span> {evt.level} — {evt.message}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="p-4 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs opacity-70">{t("settings.ops.job_id")}</div>
                <div className="text-sm font-mono break-all">{job.id}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("common.type")}</div>
                <div className="text-sm break-all">{job.type}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("common.status")}</div>
                <div className="text-sm">{job.status ? t(`common.${job.status}`, {}, { defaultValue: job.status }) : "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("common.attempts")}</div>
                <div className="text-sm">{job.attempt ?? "—"} / {job.max_attempts ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("settings.ops.run_at")}</div>
                <div className="text-sm">{job.run_at || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("settings.ops.locked_by")}</div>
                <div className="text-sm break-all">{job.locked_by || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("settings.ops.created")}</div>
                <div className="text-sm">{formatDateTime(job.created_at) || "—"}</div>
              </div>
              <div>
                <div className="text-xs opacity-70">{t("common.updated")}</div>
                <div className="text-sm">{formatDateTime(job.updated_at) || "—"}</div>
              </div>
            </div>
          </div>
        )}
      </div>
      {showDeleteModal ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-semibold">{t("settings.ops.delete_job_title")}</h3>
            <p className="mt-2 text-sm opacity-70">{t("settings.ops.delete_job_body")}</p>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowDeleteModal(false)} disabled={acting}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-error btn-sm" type="button" onClick={deleteJob} disabled={!canDelete || acting}>
                {acting ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => !acting && setShowDeleteModal(false)}>
            {t("common.close")}
          </button>
        </div>
      ) : null}
    </TabbedPaneShell>
  );
}
