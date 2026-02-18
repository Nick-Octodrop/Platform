import React, { useEffect, useMemo, useState } from "react";
import { Paperclip, Send, Trash2 } from "lucide-react";
import { API_URL, apiFetch } from "../api.js";
import { supabase } from "../supabase.js";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { useAccessContext } from "../access.js";
import { formatDateTime } from "../utils/dateTime.js";

function authorLabel(author) {
  if (!author || typeof author !== "object") return "System";
  return author.name || author.email || "System";
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export default function ActivityPanel({ entityId, recordId, config = {} }) {
  const { hasCapability } = useAccessContext();
  const canWriteRecords = hasCapability("records.write");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [currentUserLabel, setCurrentUserLabel] = useState("You");

  const allowComments = config?.allow_comments !== false;
  const allowAttachments = config?.allow_attachments !== false;
  const showChanges = config?.show_changes !== false;
  const showComposer = canWriteRecords && (allowComments || allowAttachments);

  async function loadActivity() {
    if (!entityId || !recordId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/activity?entity_id=${encodeURIComponent(entityId)}&record_id=${encodeURIComponent(recordId)}&limit=100`
      );
      const rows = Array.isArray(res?.items) ? res.items : [];
      setItems(showChanges ? rows : rows.filter((item) => item?.event_type !== "change"));
    } catch (err) {
      setItems([]);
      setError(err?.message || "Failed to load activity.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, recordId, showChanges]);

  useEffect(() => {
    let mounted = true;
    async function loadCurrentUser() {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const user = session?.user;
        const label = user?.email || user?.user_metadata?.full_name || "You";
        if (mounted) setCurrentUserLabel(label);
      } catch {
        if (mounted) setCurrentUserLabel("You");
      }
    }
    loadCurrentUser();
    return () => {
      mounted = false;
    };
  }, []);

  const placeholderText = useMemo(() => {
    if (!showComposer) return "";
    if (allowComments && allowAttachments) return "Add a comment or attach a file...";
    if (allowComments) return "Add a comment...";
    return "Attachments only for this form.";
  }, [allowComments, allowAttachments, showComposer]);

  async function handlePostComment() {
    if (!canWriteRecords || !allowComments || !isNonEmptyText(comment) || !entityId || !recordId) return;
    setPosting(true);
    setError("");
    try {
      const res = await apiFetch("/api/activity/comment", {
        method: "POST",
        body: {
          entity_id: entityId,
          record_id: recordId,
          body: comment.trim(),
        },
      });
      const item = res?.item;
      if (item) {
        setItems((prev) => [item, ...prev]);
      } else {
        await loadActivity();
      }
      setComment("");
    } catch (err) {
      setError(err?.message || "Failed to post comment.");
    } finally {
      setPosting(false);
    }
  }

  async function handleUploadAttachment(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!canWriteRecords || !allowAttachments || files.length === 0 || !entityId || !recordId) return;
    setUploading(true);
    setError("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      const uploadedItems = [];
      const failures = [];
      for (const file of files) {
        const form = new FormData();
        form.append("entity_id", entityId);
        form.append("record_id", recordId);
        form.append("file", file);
        try {
          const response = await fetch(`${API_URL}/api/activity/attachment`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            body: form,
          });
          const data = await response.json();
          if (!response.ok || !data?.ok) {
            throw new Error(data?.errors?.[0]?.message || "Upload failed");
          }
          if (data?.item) uploadedItems.push(data.item);
        } catch (err) {
          const message = String(err?.message || "Upload failed");
          failures.push(
            `${file?.name || "file"}: ${message === "Failed to fetch" ? "Network error reaching upload API" : message}`
          );
        }
      }
      if (uploadedItems.length > 0) {
        setItems((prev) => [...uploadedItems, ...prev]);
      } else {
        await loadActivity();
      }
      if (failures.length > 0) setError(failures.join(" | "));
    } catch (err) {
      setError(err?.message || "Failed to upload attachment.");
    } finally {
      setUploading(false);
    }
  }

  async function openAttachment(attachmentId) {
    if (!attachmentId) return;
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) {
        window.open(`${API_URL}/attachments/${attachmentId}/download`, "_blank", "noopener,noreferrer");
        return;
      }
      const response = await fetch(`${API_URL}/attachments/${attachmentId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err?.message || "Failed to open attachment.");
    }
  }

  if (!entityId) return <div className="text-sm opacity-70">Activity unavailable: missing entity.</div>;
  if (!recordId) return <div className="text-sm opacity-70">Save this record to use Activity.</div>;

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {showComposer && (
        <div className="shrink-0 space-y-2 pt-4">
          {allowComments && (
            <div className="text-xs opacity-60">Comment as {currentUserLabel}</div>
          )}
          {allowComments && (
            <div className="join w-full">
              <textarea
                className="textarea textarea-bordered join-item w-full text-sm min-h-[72px]"
                placeholder={placeholderText}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <button
                className={`${SOFT_BUTTON_SM} join-item`}
                type="button"
                onClick={handlePostComment}
                disabled={posting || !isNonEmptyText(comment)}
                title="Post comment"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          )}
          {allowAttachments && (
            <label className={`${SOFT_BUTTON_SM} cursor-pointer inline-flex items-center gap-2`}>
              <Paperclip className="h-4 w-4" />
              <span>{uploading ? "Uploading..." : "Attach"}</span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={handleUploadAttachment}
                disabled={uploading}
              />
            </label>
          )}
          {error && <div className="text-xs text-error">{error}</div>}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto space-y-2 pr-1">
        {loading && <div className="text-xs opacity-60">Loading activity...</div>}
        {!loading && items.length === 0 && <div className="text-xs opacity-60">No activity yet.</div>}
        {items.map((item) => {
          const type = item?.event_type;
          const payload = item?.payload || {};
          const createdAt = formatDateTime(item?.created_at);
          const author = authorLabel(item?.author);
          if (type === "comment") {
            return (
              <div key={item.id} className="card card-compact rounded-box border border-base-300 bg-base-100">
                <div className="card-body gap-1 p-3">
                <div className="mb-1 text-xs opacity-70">{author} · {createdAt}</div>
                <div className="text-sm whitespace-pre-wrap">{payload?.body || ""}</div>
                </div>
              </div>
            );
          }
          if (type === "attachment") {
            const removed = payload?.action === "removed";
            return (
              <div key={item.id} className="card card-compact rounded-box border border-base-300 bg-base-100">
                <div className="card-body gap-1 p-3">
                <div className="mb-1 text-xs opacity-70">{author} · {createdAt}</div>
                {removed ? (
                  <div className="inline-flex items-center gap-2 text-sm opacity-80">
                    <Trash2 className="h-4 w-4" />
                    <span>Removed attachment: {payload?.filename || "Attachment"}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm justify-start normal-case px-0 min-h-0 h-auto inline-flex items-center gap-2"
                    onClick={() => openAttachment(payload?.attachment_id)}
                  >
                    <Paperclip className="h-4 w-4" />
                    <span>{payload?.filename || "Attachment"}</span>
                  </button>
                )}
                </div>
              </div>
            );
          }
          const changes = Array.isArray(payload?.changes) ? payload.changes : [];
          return (
            <div key={item.id} className="card card-compact rounded-box border border-base-300 bg-base-200">
              <div className="card-body gap-1 p-3">
              <div className="mb-1 text-xs opacity-70">{author} · {createdAt}</div>
              {changes.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {changes.map((change, index) => (
                    <li key={`${item.id}-${index}`}>
                      {change?.label || change?.field || "Field"} changed from {change?.from ?? "empty"} to {change?.to ?? "empty"}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm opacity-70">Record updated.</div>
              )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
