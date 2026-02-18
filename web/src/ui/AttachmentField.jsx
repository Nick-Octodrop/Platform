import React, { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { API_URL, apiFetch } from "../api.js";
import { supabase } from "../supabase.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import AttachmentGallery from "./AttachmentGallery.jsx";

export default function AttachmentField({
  entityId,
  recordId,
  fieldId = "",
  readonly = false,
  previewMode = false,
  buttonLabel = "Attach",
  description = "",
}) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
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
      setAttachments(Array.isArray(res?.attachments) ? res.attachments : []);
    } catch (err) {
      setError(err?.message || "Failed to load attachments");
      setAttachments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, recordId]);

  async function uploadOne(file) {
    const session = (await supabase.auth.getSession()).data.session;
    const token = session?.access_token;

    const form = new FormData();
    form.append("file", file);
    const uploadRes = await fetch(`${API_URL}/attachments/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData?.ok) {
      throw new Error(uploadData?.errors?.[0]?.message || "Upload failed");
    }
    const attachmentId = uploadData?.attachment?.id;
    if (!attachmentId) throw new Error("Upload missing attachment id");

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
          failures.push(`${file?.name || "file"}: ${err?.message || "Upload failed"}`);
        }
      }
      if (failures.length > 0) setError(failures.join(" | "));
      await loadAttachments();
    } catch (err) {
      setError(err?.message || "Upload failed");
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
        `/records/${encodeURIComponent(entityId)}/${encodeURIComponent(recordId)}/attachments/${encodeURIComponent(toDelete.id)}?purpose=${encodeURIComponent(attachmentPurpose)}`,
        { method: "DELETE" }
      );
      setAttachments((prev) => prev.filter((a) => a?.id !== toDelete.id));
      setToDelete(null);
    } catch (err) {
      setError(err?.message || "Failed to delete attachment");
    } finally {
      setDeletingId("");
    }
  }

  if (!recordId) {
    return <div className="text-xs opacity-60">Save this record before adding attachments.</div>;
  }

  return (
    <div className="space-y-2">
      <label className={`${SOFT_BUTTON_SM} gap-2 cursor-pointer inline-flex`} aria-disabled={readonly || previewMode || uploading}>
        <Paperclip className="h-4 w-4" />
        {uploading ? "Uploading..." : buttonLabel}
        <input type="file" multiple className="hidden" onChange={handleUpload} disabled={readonly || previewMode || uploading} />
      </label>
      {description ? <div className="text-xs opacity-70">{description}</div> : null}
      {loading ? <div className="text-xs opacity-60">Loading attachments...</div> : null}
      {error ? <div className="text-xs text-error">{error}</div> : null}
      <AttachmentGallery
        attachments={attachments}
        uploading={uploading}
        deletingId={deletingId}
        canUpload={false}
        canDelete={!readonly && !previewMode}
        onUpload={() => {}}
        onDelete={(attachment) => setToDelete(attachment)}
        showUploadButton={false}
        showCount={false}
      />
      {toDelete ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-semibold text-base">Delete attachment?</h3>
            <p className="mt-2 text-sm opacity-80 break-all">
              This will remove <span className="font-medium">{toDelete.filename || "this file"}</span> from this record.
            </p>
            <div className="modal-action">
              <button className="btn btn-sm" type="button" onClick={() => setToDelete(null)} disabled={!!deletingId}>
                Cancel
              </button>
              <button className="btn btn-sm btn-error" type="button" onClick={handleDelete} disabled={!!deletingId}>
                {deletingId ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" onClick={() => setToDelete(null)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
