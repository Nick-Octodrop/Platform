import React, { useEffect, useMemo, useState } from "react";
import { Paperclip, Send, Trash2 } from "lucide-react";
import { API_URL, apiFetch, getActiveWorkspaceId } from "../api.js";
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

function parseMentionTokens(value, members = []) {
  if (typeof value !== "string" || !value.trim()) return [];
  const normalizeNameToken = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, "");
  const byEmail = new Map(
    (Array.isArray(members) ? members : [])
      .map((member) => [String(member?.email || "").trim().toLowerCase(), String(member?.user_id || "").trim()])
      .filter(([email]) => email)
  );
  const byName = new Map(
    (Array.isArray(members) ? members : [])
      .map((member) => [normalizeNameToken(member?.name), String(member?.user_id || "").trim()])
      .filter(([name, userId]) => name && userId)
  );
  const seen = new Set();
  const out = [];
  const matches = value.match(/@[A-Z0-9._%+\-@]+/gi) || [];
  for (const raw of matches) {
    const token = raw.slice(1).toLowerCase();
    const mapped = byEmail.get(token) || byName.get(normalizeNameToken(token)) || token;
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

function getActiveMentionQuery(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  return String(match[1] || "");
}

function replaceTrailingMention(value, token) {
  const source = typeof value === "string" ? value : "";
  return source.replace(/(^|\s)@[^\s@]*$/, `$1@${String(token).trim()} `);
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
  const [members, setMembers] = useState([]);
  const [mentionIndex, setMentionIndex] = useState(0);

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

  useEffect(() => {
    let mounted = true;
    async function loadMembers() {
      try {
        const res = await apiFetch("/access/members");
        const rows = Array.isArray(res?.members) ? res.members : [];
        if (mounted) {
          setMembers(
            rows.filter(
              (member) =>
                (typeof member?.email === "string" && member.email.trim()) ||
                (typeof member?.name === "string" && member.name.trim()) ||
                (typeof member?.user_id === "string" && member.user_id.trim())
            )
          );
        }
      } catch {
        if (mounted) setMembers([]);
      }
    }
    if (showComposer && allowComments) loadMembers();
    return () => {
      mounted = false;
    };
  }, [showComposer, allowComments]);

  const mentionQuery = useMemo(() => getActiveMentionQuery(comment), [comment]);
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.trim().toLowerCase();
    const rows = members.filter((member) => {
      const email = String(member?.email || "").toLowerCase();
      const name = String(member?.name || "").toLowerCase();
      const userId = String(member?.user_id || "").toLowerCase();
      if (!email && !name && !userId) return false;
      if (!q) return true;
      return email.includes(q) || name.includes(q) || userId.includes(q);
    });
    return rows.slice(0, 8);
  }, [members, mentionQuery]);
  const showMentionMenu = allowComments && mentionQuery !== null && mentionSuggestions.length > 0;

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);

  function applyMention(member) {
    const email = String(member?.email || "").trim();
    const nameToken = String(member?.name || "").trim().toLowerCase().replace(/\s+/g, "");
    const userId = String(member?.user_id || "").trim();
    const token = email || nameToken || userId;
    if (!token) return;
    setComment((prev) => replaceTrailingMention(prev, token));
  }

  function handleCommentKeyDown(event) {
    if (!showMentionMenu) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMentionIndex((prev) => Math.min(prev + 1, mentionSuggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMentionIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const picked = mentionSuggestions[mentionIndex];
      if (!picked) return;
      event.preventDefault();
      applyMention(picked);
    }
  }

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
          mentions: parseMentionTokens(comment, members),
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
            headers: workspaceHeaders(token),
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
      const response = await fetch(`${API_URL}/attachments/${attachmentId}/download`, {
        headers: workspaceHeaders(token),
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
                onKeyDown={handleCommentKeyDown}
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
          {showMentionMenu && (
            <div className="rounded-box border border-base-300 bg-base-100 p-1 max-h-48 overflow-auto">
              {mentionSuggestions.map((member, idx) => {
                const email = String(member?.email || "").trim();
                const userId = String(member?.user_id || "").trim();
                const label = member?.name || email || userId;
                if (!label) return null;
                return (
                  <button
                    key={String(member?.user_id || email || label)}
                    type="button"
                    className={`w-full text-left px-2 py-1 rounded ${idx === mentionIndex ? "bg-base-200" : "hover:bg-base-200"}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyMention(member);
                    }}
                  >
                    <div className="text-sm">{label}</div>
                    {email && label !== email && <div className="text-xs opacity-70">{email}</div>}
                  </button>
                );
              })}
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
          const systemMessage = typeof payload?.message === "string" ? payload.message.trim() : "";
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
              ) : systemMessage ? (
                <div className="text-sm opacity-80">{systemMessage}</div>
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
  function workspaceHeaders(token) {
    const workspaceId = getActiveWorkspaceId();
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    };
  }
