import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  FolderPlus,
  Paperclip,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { API_URL, apiFetch, getActiveWorkspaceId } from "../api.js";
import { getSafeSession } from "../supabase.js";
import { formatDateTime } from "../utils/dateTime.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import DaisyTooltip from "../components/DaisyTooltip.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unitIdx = 0;
  while (amount >= 1024 && unitIdx < units.length - 1) {
    amount /= 1024;
    unitIdx += 1;
  }
  return `${amount.toFixed(amount < 10 ? 1 : 0)} ${units[unitIdx]}`;
}

function fileExtensionLabel(filename) {
  const name = String(filename || "").trim();
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return "";
  return name.slice(idx).toLowerCase();
}

function classifyMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("yaml") ||
    mime.includes("javascript")
  ) {
    return "text";
  }
  if (
    mime.includes("spreadsheet") ||
    mime.includes("csv") ||
    mime.includes("excel") ||
    mime.includes("sheet")
  ) {
    return "sheet";
  }
  if (
    mime.includes("zip") ||
    mime.includes("archive") ||
    mime.includes("tar") ||
    mime.includes("rar")
  ) {
    return "archive";
  }
  if (mime.includes("word") || mime.includes("document")) return "doc";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "doc";
  return "file";
}

function iconForType(type) {
  if (type === "image") return FileImage;
  if (type === "pdf") return FileText;
  if (type === "video") return FileVideo2;
  if (type === "audio") return FileAudio;
  if (type === "sheet") return FileSpreadsheet;
  if (type === "text") return FileCode2;
  if (type === "archive") return FileArchive;
  if (type === "doc") return FileText;
  return File;
}

async function fetchAttachmentBlob(attachmentId) {
  const session = await getSafeSession();
  const token = session?.access_token;
  const workspaceId = getActiveWorkspaceId();
  const response = await fetch(`${API_URL}/attachments/${attachmentId}/download`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    },
  });
  if (!response.ok) throw new Error("DOWNLOAD_FAILED");
  return response.blob();
}

async function fetchAttachmentThumbnailBlob(attachmentId) {
  const session = await getSafeSession();
  const token = session?.access_token;
  const workspaceId = getActiveWorkspaceId();
  const response = await fetch(`${API_URL}/attachments/${attachmentId}/thumbnail`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    },
  });
  if (!response.ok) throw new Error("THUMBNAIL_FAILED");
  return response.blob();
}

function hasStoredThumbnail(row) {
  return Boolean(row?.thumbnail_storage_key || row?.thumbnail_mime_type || row?.thumbnail_size);
}

function AttachmentPreviewModal({ preview, onClose, onDownload, t }) {
  const attachment = preview?.attachment || null;
  const kind = preview?.kind || "file";
  const blobUrl = preview?.blobUrl || "";
  const textPreview = preview?.text || "";

  if (!attachment) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-base-content/40 backdrop-blur-sm p-3 md:p-8" onClick={onClose}>
      <div
        className="mx-auto h-full w-full max-w-6xl rounded-box border border-base-300 bg-base-100 shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-base-300 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold" title={attachment.filename || t("common.attachments.attachment")}>
              {attachment.filename || t("common.attachments.attachment")}
            </div>
            <div className="mt-1 text-xs text-base-content/60">
              {attachment.mime_type || t("common.attachments.file")}
              {attachment.size ? ` · ${formatSize(attachment.size)}` : ""}
              {attachment.created_at ? ` · ${formatDateTime(attachment.created_at)}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={onDownload}>
              <Download className="h-4 w-4" />
              {t("common.download")}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label={t("common.attachments.close_preview")}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-3 md:p-4 bg-base-200/40">
          {preview?.loading ? <div className="text-sm opacity-70">{t("common.attachments.preview_loading")}</div> : null}
          {preview?.error ? <div className="alert alert-error text-sm">{preview.error}</div> : null}

          {!preview?.loading && !preview?.error && kind === "image" && blobUrl ? (
            <img src={blobUrl} alt={attachment.filename || t("common.attachments.attachment")} className="mx-auto max-h-full w-auto rounded-box border border-base-300 bg-base-100" />
          ) : null}

          {!preview?.loading && !preview?.error && kind === "pdf" && blobUrl ? (
            <iframe title={attachment.filename || t("common.attachments.pdf_preview")} src={blobUrl} className="h-full min-h-[65vh] w-full rounded-box border border-base-300 bg-base-100" />
          ) : null}

          {!preview?.loading && !preview?.error && kind === "video" && blobUrl ? (
            <video src={blobUrl} controls className="mx-auto max-h-[70vh] w-auto max-w-full rounded-box border border-base-300 bg-black" />
          ) : null}

          {!preview?.loading && !preview?.error && kind === "audio" && blobUrl ? (
            <div className="rounded-box border border-base-300 bg-base-100 p-6">
              <audio src={blobUrl} controls className="w-full" />
            </div>
          ) : null}

          {!preview?.loading && !preview?.error && kind === "text" && (
            <pre className="rounded-box border border-base-300 bg-base-100 p-4 text-xs whitespace-pre-wrap break-words">{textPreview || t("common.attachments.no_preview_content")}</pre>
          )}

          {!preview?.loading && !preview?.error && !["image", "pdf", "video", "audio", "text"].includes(kind) ? (
            <div className="rounded-box border border-base-300 bg-base-100 p-8 text-center">
              <File className="mx-auto mb-3 h-10 w-10 opacity-60" />
              <div className="text-sm opacity-70">{t("common.attachments.preview_unavailable")}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DocumentAttachmentPickerModal({ open, onClose, onConfirm, busy = false, t }) {
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState("");
  const [documents, setDocuments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const label = (key, fallback, params) => {
    const value = t(key, params);
    return value === key ? fallback : value;
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    setSelectedIds([]);
    apiFetch("/attachments/document-sources", { cacheTtl: 0 })
      .then((res) => {
        if (cancelled) return;
        const nextSources = Array.isArray(res?.sources) ? res.sources : [];
        setSources(nextSources);
        setSourceId((prev) => (
          nextSources.some((source) => source?.entity_id === prev)
            ? prev
            : nextSources[0]?.entity_id || ""
        ));
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || label("common.attachments.document_sources_failed", "Failed to load document sources"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !sourceId) {
      setDocuments([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const qs = new URLSearchParams({ limit: "50" });
      if (query.trim()) qs.set("q", query.trim());
      apiFetch(`/attachments/document-sources/${encodeURIComponent(sourceId)}/documents?${qs.toString()}`, { cacheTtl: 0 })
        .then((res) => {
          if (cancelled) return;
          setDocuments(Array.isArray(res?.documents) ? res.documents : []);
        })
        .catch((err) => {
          if (!cancelled) {
            setDocuments([]);
            setError(err?.message || label("common.attachments.documents_load_failed", "Failed to load documents"));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceId, query]);

  if (!open) return null;

  const selectedSource = sources.find((source) => source?.entity_id === sourceId) || null;
  const selectedCount = selectedIds.length;

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{label("common.attachments.add_from_documents", "Add from Documents")}</h3>
            <p className="mt-1 text-sm text-base-content/60">
              {label("common.attachments.add_from_documents_hint", "Select existing document files to attach to this record.")}
            </p>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[220px_1fr]">
          <label className="form-control">
            <span className="label-text">{label("common.attachments.document_source", "Document source")}</span>
            <select
              className="select select-bordered w-full"
              value={sourceId}
              onChange={(event) => {
                setSourceId(event.target.value);
                setSelectedIds([]);
              }}
              disabled={busy || sources.length <= 1}
            >
              {sources.map((source) => (
                <option key={`${source.entity_id}:${source.attachment_field}`} value={source.entity_id}>
                  {source.label || source.entity_id}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text">{label("common.search", "Search")}</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/45" />
              <input
                className="input input-bordered w-full pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={label("common.attachments.search_documents", "Search documents...")}
                disabled={busy || !selectedSource}
              />
            </div>
          </label>
        </div>

        <div className="mt-4 max-h-[48vh] overflow-auto rounded-box border border-base-300">
          {error ? <div className="p-4 text-sm text-error">{error}</div> : null}
          {!error && sources.length === 0 ? (
            <div className="p-4 text-sm text-base-content/60">
              {label("common.attachments.no_document_sources", "No document sources are available.")}
            </div>
          ) : null}
          {!error && loading ? (
            <div className="p-4 text-sm text-base-content/60">{label("common.loading", "Loading...")}</div>
          ) : null}
          {!error && !loading && sourceId && documents.length === 0 ? (
            <div className="p-4 text-sm text-base-content/60">
              {label("common.attachments.no_documents_found", "No documents found.")}
            </div>
          ) : null}
          {!error && !loading && documents.map((document) => {
            const attachmentCount = Number(document?.attachment_count || 0);
            const disabled = attachmentCount <= 0;
            const checked = selectedIds.includes(document.id);
            return (
              <label
                key={document.id}
                className={`flex cursor-pointer items-start gap-3 border-b border-base-300 px-4 py-3 last:border-b-0 ${disabled ? "opacity-50" : "hover:bg-base-200/60"}`}
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm mt-1"
                  checked={checked}
                  disabled={disabled || busy}
                  onChange={(event) => {
                    setSelectedIds((prev) => {
                      if (event.target.checked) return Array.from(new Set([...prev, document.id]));
                      return prev.filter((id) => id !== document.id);
                    });
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{document.title || document.id}</div>
                  <div className="mt-1 text-xs text-base-content/60">
                    {label("common.attachments.document_file_count", "{{count}} file(s)", { count: attachmentCount })}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {label("common.cancel", "Cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onConfirm?.({ documentIds: selectedIds, sourceEntityId: sourceId })}
            disabled={busy || selectedIds.length === 0}
          >
            {busy
              ? label("common.saving", "Saving...")
              : label("common.attachments.add_selected_documents", "Add selected", { count: selectedCount })}
          </button>
        </div>
      </div>
      <button className="modal-backdrop" type="button" onClick={onClose}>
        {label("common.close", "Close")}
      </button>
    </div>
  );
}

export default function AttachmentGallery({
  attachments,
  uploading,
  deletingId,
  canUpload,
  canDelete,
  onUpload,
  onDelete,
  canAddFromDocuments = false,
  addingFromDocuments = false,
  onAddFromDocuments = null,
  buttonLabel = "",
  showUploadButton = true,
  showCount = true,
  className = "",
}) {
  const { t } = useI18n();
  const rows = Array.isArray(attachments) ? attachments : [];
  const [thumbUrls, setThumbUrls] = useState({});
  const thumbUrlsRef = useRef({});
  const [preview, setPreview] = useState({
    attachment: null,
    kind: "file",
    loading: false,
    blobUrl: "",
    text: "",
    error: "",
  });
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const previewOpen = !!preview?.attachment;

  const thumbnailRows = useMemo(
    () => rows.filter((row) => row?.id && (classifyMime(row?.mime_type) === "image" || hasStoredThumbnail(row))),
    [rows],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadThumbs() {
      for (const row of thumbnailRows) {
        if (!row?.id || thumbUrls[row.id]) continue;
        try {
          const blob = hasStoredThumbnail(row)
            ? await fetchAttachmentThumbnailBlob(row.id)
            : await fetchAttachmentBlob(row.id);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          setThumbUrls((prev) => ({ ...prev, [row.id]: url }));
        } catch {
          // No thumbnail available.
        }
      }
    }

    loadThumbs();
    return () => {
      cancelled = true;
    };
  }, [thumbnailRows, thumbUrls]);

  useEffect(() => {
    thumbUrlsRef.current = thumbUrls;
  }, [thumbUrls]);

  useEffect(() => {
    const activeIds = new Set(rows.map((row) => row?.id).filter(Boolean));
    setThumbUrls((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, url] of Object.entries(prev)) {
        if (!activeIds.has(id)) {
          URL.revokeObjectURL(url);
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  useEffect(() => {
    return () => {
      Object.values(thumbUrlsRef.current || {}).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore cleanup errors.
        }
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      if (preview?.blobUrl) URL.revokeObjectURL(preview.blobUrl);
    };
  }, [preview]);

  async function handleDownload(attachment) {
    if (!attachment?.id) return;
    const blob = await fetchAttachmentBlob(attachment.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = attachment.filename || t("common.attachments.download_default_filename");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function handleOpenPreview(attachment) {
    if (!attachment?.id) return;
    const kind = classifyMime(attachment.mime_type);
    setPreview({ attachment, kind, loading: true, blobUrl: "", text: "", error: "" });

    try {
      if (["image", "pdf", "video", "audio", "text"].includes(kind)) {
        const blob = await fetchAttachmentBlob(attachment.id);
        const url = URL.createObjectURL(blob);
        if (kind === "text") {
          const text = await blob.text();
          setPreview({ attachment, kind, loading: false, blobUrl: "", text: text.slice(0, 20000), error: "" });
          URL.revokeObjectURL(url);
          return;
        }
        setPreview({ attachment, kind, loading: false, blobUrl: url, text: "", error: "" });
        return;
      }
      setPreview({ attachment, kind, loading: false, blobUrl: "", text: "", error: "" });
    } catch (err) {
      setPreview({
        attachment,
        kind,
        loading: false,
        blobUrl: "",
        text: "",
        error: err?.message === "DOWNLOAD_FAILED"
          ? t("common.activity_panel.download_failed")
          : (err?.message || t("common.attachments.preview_load_failed")),
      });
    }
  }

  return (
    <div className={className}>
      {(showUploadButton || showCount) ? (
        <div className="flex items-center justify-between gap-2 mb-3">
          {showUploadButton ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${SOFT_BUTTON_SM} gap-2 cursor-pointer`} aria-disabled={!canUpload || uploading}>
                <Paperclip className="h-4 w-4" />
                {uploading ? t("common.uploading") : (buttonLabel || t("common.attach"))}
                <input type="file" multiple className="hidden" onChange={onUpload} disabled={!canUpload || uploading} />
              </label>
              {canAddFromDocuments && typeof onAddFromDocuments === "function" ? (
                <button
                  type="button"
                  className={`${SOFT_BUTTON_SM} gap-2`}
                  onClick={() => setDocumentPickerOpen(true)}
                  disabled={addingFromDocuments}
                >
                  <FolderPlus className="h-4 w-4" />
                  {addingFromDocuments ? t("common.saving") : (t("common.attachments.add_from_documents") === "common.attachments.add_from_documents" ? "Add from Documents" : t("common.attachments.add_from_documents"))}
                </button>
              ) : null}
            </div>
          ) : (
            <span />
          )}
          {showCount ? (
            <div className="text-xs text-base-content/60">{t("common.attachments.count", { count: rows.length })}</div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {rows.map((attachment) => {
          const kind = classifyMime(attachment?.mime_type);
          const Icon = iconForType(kind);
          const thumb = attachment?.id ? thumbUrls[attachment.id] : "";
          const ext = fileExtensionLabel(attachment?.filename);
          const tip = `${attachment?.filename || t("common.attachments.attachment")}${ext ? ` (${ext})` : ""}`;
          return (
            <DaisyTooltip key={attachment.id} label={previewOpen ? "" : tip} className="w-full" placement="bottom">
              <div className="group aspect-square rounded-box border border-base-300 bg-base-100 hover:border-primary/40 transition-colors flex flex-col overflow-hidden">
              <button
                type="button"
                className="relative flex-1 min-h-0 w-full bg-base-200/50 overflow-hidden"
                onClick={() => handleOpenPreview(attachment)}
              >
                {thumb ? (
                  <img src={thumb} alt={attachment.filename || t("common.attachments.attachment")} className="h-full w-full object-cover bg-white" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-gradient-to-b from-base-100 to-base-200/70 p-5 text-base-content/60">
                    <div className="relative flex h-full w-full max-h-40 max-w-32 items-center justify-center rounded-md border border-base-300 bg-base-100 shadow-sm">
                      <Icon className="h-8 w-8" />
                      {ext ? (
                        <span className="absolute bottom-2 right-2 rounded border border-base-300 bg-base-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-base-content/70">
                          {ext.replace(".", "")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}

                <div className="absolute inset-x-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className={`grid ${canDelete ? "grid-cols-3" : "grid-cols-2"} items-center justify-items-center rounded-2xl border border-base-300 bg-base-100 px-2 py-1.5 shadow-md`}>
                    <DaisyTooltip label={t("common.attachments.preview")} placement="top">
                      <button
                        type="button"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base-content transition-colors hover:bg-base-200"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpenPreview(attachment);
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </DaisyTooltip>
                    <DaisyTooltip label={t("common.download")} placement="top">
                      <button
                        type="button"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base-content transition-colors hover:bg-base-200"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDownload(attachment);
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </DaisyTooltip>
                    {canDelete ? (
                      <DaisyTooltip label={t("common.delete")} placement="top">
                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-error transition-colors hover:bg-error/10"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDelete?.(attachment);
                          }}
                          disabled={deletingId === attachment.id}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </DaisyTooltip>
                    ) : null}
                  </div>
                </div>
              </button>
              </div>
            </DaisyTooltip>
          );
        })}
      </div>

      <AttachmentPreviewModal
        preview={preview}
        t={t}
        onClose={() => {
          if (preview?.blobUrl) URL.revokeObjectURL(preview.blobUrl);
          setPreview({ attachment: null, kind: "file", loading: false, blobUrl: "", text: "", error: "" });
        }}
        onDownload={() => {
          const attachment = preview?.attachment;
          if (!attachment) return;
          handleDownload(attachment);
        }}
      />
      <DocumentAttachmentPickerModal
        open={documentPickerOpen}
        busy={addingFromDocuments}
        t={t}
        onClose={() => {
          if (!addingFromDocuments) setDocumentPickerOpen(false);
        }}
        onConfirm={async ({ documentIds, sourceEntityId }) => {
          await onAddFromDocuments?.({ documentIds, sourceEntityId });
          setDocumentPickerOpen(false);
        }}
      />
    </div>
  );
}
