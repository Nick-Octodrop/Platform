import React, { useEffect, useState } from "react";
import { API_URL, apiFetch, getActiveWorkspaceId } from "../api.js";
import { getSafeSession } from "../supabase.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import AttachmentGallery from "./AttachmentGallery.jsx";

export default function AttachmentField({
  entityId,
  recordId,
  fieldId = "",
  readonly = false,
  previewMode = false,
  buttonLabel = "",
  description = "",
  onAttachmentsChange = null,
  refreshKey = "",
}) {
  const { t } = useI18n();
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [addingFromDocuments, setAddingFromDocuments] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState(null);

  const attachmentPurpose = fieldId ? `field:${fieldId}` : "field";

  async function loadAttachments() {
    if (!entityId || !recordId) {
      setAttachments([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qs = `purpose=${encodeURIComponent(attachmentPurpose)}`;
      const res = await apiFetch(`/records/${encodeURIComponent(entityId)}/${encodeURIComponent(recordId)}/attachments?${qs}`);
      const nextAttachments = Array.isArray(res?.attachments) ? res.attachments : [];
      setAttachments(nextAttachments);
      onAttachmentsChange?.(nextAttachments);
    } catch (err) {
      setError(err?.message || t("common.attachments.load_failed"));
      setAttachments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, recordId, fieldId, refreshKey]);

  async function uploadOne(file) {
    const session = await getSafeSession();
    const token = session?.access_token;
    const workspaceId = getActiveWorkspaceId();

    const form = new FormData();
    form.append("file", file);
    const uploadRes = await fetch(`${API_URL}/attachments/upload`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      },
      body: form,
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData?.ok) {
      throw new Error(uploadData?.errors?.[0]?.message || t("common.attachments.upload_failed"));
    }
    const attachmentId = uploadData?.attachment?.id;
    if (!attachmentId) throw new Error(t("common.attachments.upload_missing_id"));

    await apiFetch("/attachments/link", {
      method: "POST",
      body: {
        attachment_id: attachmentId,
        entity_id: entityId,
        record_id: recordId,
        purpose: attachmentPurpose,
      },
    });
  }

  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!entityId || !recordId || files.length === 0 || readonly || previewMode) return;

    setUploading(true);
    setError("");
    try {
      const failures = [];
      for (const file of files) {
        try {
          await uploadOne(file);
        } catch (err) {
          failures.push(`${file?.name || t("common.attachments.file")}: ${err?.message || t("common.attachments.upload_failed")}`);
        }
      }
      if (failures.length > 0) setError(failures.join(" | "));
      await loadAttachments();
    } catch (err) {
      setError(err?.message || t("common.attachments.upload_failed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (!toDelete?.id || !entityId || !recordId || deletingId) return;
    setDeletingId(toDelete.id);
    setError("");
    try {
      await apiFetch(
        `/records/${encodeURIComponent(entityId)}/${encodeURIComponent(recordId)}/attachments/${encodeURIComponent(toDelete.id)}?purpose=${encodeURIComponent(attachmentPurpose)}&field_id=${encodeURIComponent(fieldId)}&delete_scope=record`,
        { method: "DELETE" }
      );
      setAttachments((prev) => {
        const nextAttachments = prev.filter((a) => a?.id !== toDelete.id);
        onAttachmentsChange?.(nextAttachments);
        return nextAttachments;
      });
      setToDelete(null);
    } catch (err) {
      setError(err?.message || t("common.attachments.delete_failed"));
    } finally {
      setDeletingId("");
    }
  }

  async function handleAddFromDocuments({ documentIds, sourceEntityId }) {
    if (!entityId || !recordId || readonly || previewMode || addingFromDocuments) return;
    setAddingFromDocuments(true);
    setError("");
    try {
      await apiFetch(
        `/records/${encodeURIComponent(entityId)}/${encodeURIComponent(recordId)}/attachments/from-documents`,
        {
          method: "POST",
          body: {
            document_entity_id: sourceEntityId,
            document_ids: documentIds,
            attachment_field_id: fieldId,
            purpose: attachmentPurpose,
          },
        }
      );
      await loadAttachments();
    } catch (err) {
      setError(err?.message || t("common.attachments.add_from_documents_failed"));
      throw err;
    } finally {
      setAddingFromDocuments(false);
    }
  }

  if (!recordId) {
    return <div className="text-xs opacity-60">{t("common.attachments.save_record_before_adding")}</div>;
  }

  return (
    <div className="space-y-2">
      {description ? <div className="text-xs opacity-70">{description}</div> : null}
      {loading ? <div className="text-xs opacity-60">{t("common.attachments.loading")}</div> : null}
      {error ? <div className="text-xs text-error">{error}</div> : null}
      <AttachmentGallery
        attachments={attachments}
        uploading={uploading}
        addingFromDocuments={addingFromDocuments}
        deletingId={deletingId}
        canUpload={!readonly && !previewMode}
        canDelete={!readonly && !previewMode}
        canAddFromDocuments={!readonly && !previewMode}
        onUpload={handleUpload}
        onAddFromDocuments={handleAddFromDocuments}
        onDelete={(attachment) => setToDelete(attachment)}
        buttonLabel={buttonLabel}
        showUploadButton
        showCount={false}
      />
      {toDelete ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-semibold text-base">{t("common.attachments.delete_title")}</h3>
            <p className="mt-2 text-sm opacity-80 break-all">
              {t("common.attachments.delete_body_prefix")} <span className="font-medium">{toDelete.filename || t("common.attachments.this_file")}</span> {t("common.attachments.delete_body_suffix")}
            </p>
            <div className="modal-action">
              <button className="btn btn-sm" type="button" onClick={() => setToDelete(null)} disabled={!!deletingId}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-sm btn-error" type="button" onClick={handleDelete} disabled={!!deletingId}>
                {deletingId ? t("common.deleting") : t("common.delete")}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => setToDelete(null)}>
            {t("common.close")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
