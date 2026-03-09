import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";
import { formatDateTime } from "../utils/dateTime.js";

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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("unread");
  const [search, setSearch] = useState("");
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
      pushToast("error", err.message || "Failed to mark all read");
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

  function normalizeNotificationTarget(target) {
    const raw = typeof target === "string" ? target.trim() : "";
    if (!raw) return "/home";
    const legacyEntityMatch = raw.match(/^\/data\/entity\.([^/]+)\/(.+)$/i);
    return legacyEntityMatch ? `/data/${legacyEntityMatch[1]}/${legacyEntityMatch[2]}` : raw;
  }

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title">Notifications</h2>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm" onClick={() => load()} disabled={loading}>Refresh</button>
            <button className="btn btn-sm btn-primary" onClick={markAll}>Mark all read</button>
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
                      Mark read
                    </button>
                  )}
                  {n.link_to && (
                    <Link className="btn btn-xs btn-ghost" to={normalizeNotificationTarget(n.link_to)}>
                      Open
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
