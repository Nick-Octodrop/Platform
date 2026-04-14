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
  Paperclip,
  Trash2,
  X,
} from "lucide-react";
import { API_URL, getActiveWorkspaceId } from "../api.js";
import { supabase } from "../supabase.js";
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
  const session = (await supabase.auth.getSession()).data.session;
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

export default function AttachmentGallery({
  attachments,
  uploading,
  deletingId,
  canUpload,
  canDelete,
  onUpload,
  onDelete,
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
  const previewOpen = !!preview?.attachment;

  const imageRows = useMemo(() => rows.filter((row) => classifyMime(row?.mime_type) === "image" && row?.id), [rows]);

  useEffect(() => {
    let cancelled = false;

    async function loadThumbs() {
      for (const row of imageRows) {
        if (!row?.id || thumbUrls[row.id]) continue;
        try {
          const blob = await fetchAttachmentBlob(row.id);
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
  }, [imageRows, thumbUrls]);

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
            <label className={`${SOFT_BUTTON_SM} gap-2 cursor-pointer`} aria-disabled={!canUpload || uploading}>
              <Paperclip className="h-4 w-4" />
              {uploading ? t("common.uploading") : (buttonLabel || t("common.attach"))}
              <input type="file" multiple className="hidden" onChange={onUpload} disabled={!canUpload || uploading} />
            </label>
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
                {kind === "image" && thumb ? (
                  <img src={thumb} alt={attachment.filename || t("common.attachments.attachment")} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-base-content/60">
                    <Icon className="h-8 w-8" />
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
    </div>
  );
}
