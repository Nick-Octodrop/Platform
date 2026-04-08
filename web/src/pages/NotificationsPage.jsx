import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import { SOFT_BUTTON_SM } from "../components/buttonStyles.js";
import { formatDateTime } from "../utils/dateTime.js";
import { isExternalNotificationTarget, resolveNotificationTarget } from "../utils/notificationTargets.js";

function mergeNotifications(prev, incoming) {
  const merged = [...(Array.isArray(incoming) ? incoming : []), ...(Array.isArray(prev) ? prev : [])];
  const seen = new Set();
  return merged.filter((item) => {
    const id = String(item?.id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export default function NotificationsPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [activeTab, setActiveTab] = useState("unread");
  const [search, setSearch] = useState("");
  const [showClearModal, setShowClearModal] = useState(false);
  const latestSeenAtRef = useRef(null);

  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const unreadOnly = activeTab === "unread" ? 1 : 0;
      const res = await apiFetch(`/notifications?unread_only=${unreadOnly}&limit=200`);
      const rows = Array.isArray(res.notifications) ? res.notifications : [];
      setItems(rows);
      latestSeenAtRef.current = rows[0]?.created_at || latestSeenAtRef.current;
    } catch (err) {
      if (!quiet) pushToast("error", err.message || "Failed to load notifications");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function poll() {
    try {
      const unreadOnly = activeTab === "unread" ? 1 : 0;
      const since = latestSeenAtRef.current;
      const qs = since
        ? `/notifications?unread_only=${unreadOnly}&limit=100&since=${encodeURIComponent(String(since))}`
        : `/notifications?unread_only=${unreadOnly}&limit=100`;
      const res = await apiFetch(qs);
      const incoming = Array.isArray(res.notifications) ? res.notifications : [];
      if (incoming.length > 0) {
        latestSeenAtRef.current = incoming[0]?.created_at || latestSeenAtRef.current;
        setItems((prev) => mergeNotifications(prev, incoming));
      }
    } catch {
      // quiet retry next interval
    }
  }

  async function markRead(id) {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "POST" });
      setItems((prev) => prev.map((item) => (item?.id === id ? { ...item, read_at: new Date().toISOString() } : item)));
      if (activeTab === "unread") {
        setItems((prev) => prev.filter((item) => item?.id !== id));
      }
    } catch (err) {
      pushToast("error", err.message || "Failed to mark read");
    }
  }

  async function markAll() {
    try {
      await apiFetch("/notifications/read_all", { method: "POST" });
      if (activeTab === "unread") setItems([]);
      else setItems((prev) => prev.map((item) => ({ ...item, read_at: new Date().toISOString() })));
    } catch (err) {
      pushToast("error", err.message || "Failed to mark all seen");
    }
  }

  async function clearAll() {
    setClearing(true);
    try {
      await apiFetch("/notifications/clear_all", { method: "POST" });
      setItems([]);
      latestSeenAtRef.current = null;
      setShowClearModal(false);
      pushToast("success", "Notifications cleared");
    } catch (err) {
      pushToast("error", err.message || "Failed to clear notifications");
    } finally {
      setClearing(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      poll();
    }, 8000);
    return () => clearInterval(timer);
  }, [activeTab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const title = String(item?.title || "").toLowerCase();
      const body = String(item?.body || "").toLowerCase();
      return title.includes(q) || body.includes(q);
    });
  }, [items, search]);

  const unreadCount = useMemo(() => items.filter((item) => !item?.read_at).length, [items]);

  async function openNotification(item) {
    try {
      const target = await resolveNotificationTarget(item?.link_to, item?.source_event);
      if (/^https?:\/\//i.test(target)) {
        window.location.assign(target);
        return;
      }
      navigate(target);
    } catch (err) {
      pushToast("error", err?.message || "Failed to open notification");
    }
  }

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title">Notifications</h2>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm" onClick={() => load()} disabled={loading}>Refresh</button>
            <div className="dropdown dropdown-end">
              <button
                type="button"
                tabIndex={0}
                className={SOFT_BUTTON_SM}
                aria-label="Notification actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              <ul tabIndex={0} className="dropdown-content menu z-[60] mt-2 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow">
                <li>
                  <button type="button" onClick={markAll} disabled={loading || items.length === 0}>
                    Mark all seen
                  </button>
                </li>
                <li>
                  <button type="button" className="text-error" onClick={() => setShowClearModal(true)} disabled={loading || items.length === 0}>
                    Clear all
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`btn btn-sm ${activeTab === "unread" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab("unread")}
          >
            Unread {activeTab === "unread" ? `(${unreadCount})` : ""}
          </button>
          <button
            className={`btn btn-sm ${activeTab === "all" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab("all")}
          >
            All
          </button>
          <input
            className="input input-bordered input-sm ml-auto w-full md:w-72"
            placeholder="Search notifications..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          {loading && <div className="text-sm opacity-60">Loading notifications...</div>}
          {!loading && filtered.length === 0 && <div className="text-sm opacity-60">No notifications</div>}
          {filtered.map((n) => (
            <div key={n.id} className={`p-3 rounded-md border border-base-200 ${n.read_at ? "opacity-70" : "bg-base-200/30"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{n.title}</div>
                  <div className="text-xs opacity-70 mt-1 whitespace-pre-wrap">{n.body}</div>
                  <div className="text-xs opacity-60 mt-2">{formatDateTime(n.created_at)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {!n.read_at && (
                    <button className="btn btn-xs" onClick={() => markRead(n.id)}>
                      Mark seen
                    </button>
                  )}
                  {(n.link_to || n.source_event) && (
                    isExternalNotificationTarget(n.link_to, n.source_event) ? (
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => openNotification(n)}>
                        Open
                      </button>
                    ) : (
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => openNotification(n)}>
                        Open
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {showClearModal ? (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-base-content/40 px-4">
          <div className="w-full max-w-md rounded-box border border-base-300 bg-base-100 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold">Clear notifications</h3>
            <p className="mt-2 text-sm text-base-content/70">
              Remove all notifications from this list. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setShowClearModal(false)} disabled={clearing}>
                Cancel
              </button>
              <button type="button" className="btn btn-error" onClick={clearAll} disabled={clearing}>
                {clearing ? "Clearing..." : "Clear all"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
