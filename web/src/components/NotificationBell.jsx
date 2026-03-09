import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { Bell } from "lucide-react";

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const latestSeenAtRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const deferCount = useMemo(() => {
    const path = location.pathname || "";
    return path.startsWith("/automations") || path.startsWith("/automation-runs");
  }, [location.pathname]);

  async function loadCount() {
    try {
      const res = await apiFetch("/notifications/unread_count", { trace: "notifications_unread_count" });
      setCount(res.count || 0);
    } catch {
      setCount(0);
    }
  }

  async function loadItems() {
    try {
      const res = await apiFetch("/notifications?unread_only=0&limit=30", { trace: "notifications_list" });
      const next = Array.isArray(res.notifications) ? res.notifications : [];
      setItems(next);
      latestSeenAtRef.current = next[0]?.created_at || latestSeenAtRef.current;
    } catch {
      setItems([]);
    }
  }

  function mergeNotifications(prev, incoming) {
    const merged = [...(Array.isArray(incoming) ? incoming : []), ...(Array.isArray(prev) ? prev : [])];
    const seen = new Set();
    return merged
      .filter((item) => {
        const id = String(item?.id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, 30);
  }

  async function pollIncremental() {
    try {
      const since = latestSeenAtRef.current;
      const qs = since
        ? `/notifications?unread_only=0&limit=20&since=${encodeURIComponent(String(since))}`
        : "/notifications?unread_only=0&limit=20";
      const res = await apiFetch(qs, { trace: "notifications_poll" });
      const incoming = Array.isArray(res.notifications) ? res.notifications : [];
      if (incoming.length > 0) {
        latestSeenAtRef.current = incoming[0]?.created_at || latestSeenAtRef.current;
        setItems((prev) => mergeNotifications(prev, incoming));
      }
      await loadCount();
    } catch {
      // no-op; next poll retries
    }
  }

  useEffect(() => {
    if (deferCount) return undefined;
    loadCount();
    loadItems();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      pollIncremental();
    }, 8000);
    return () => clearInterval(interval);
  }, [deferCount]);

  useEffect(() => {
    if (open) loadItems();
  }, [open]);

  async function markRead(id) {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "POST" });
      loadCount();
      loadItems();
    } catch {
      // ignore
    }
  }

  async function openNotification(item) {
    const id = item?.id;
    if (!id) return;
    await markRead(id);
    const rawTarget = typeof item?.link_to === "string" && item.link_to.trim() ? item.link_to.trim() : "/home";
    const legacyEntityMatch = rawTarget.match(/^\/data\/entity\.([^/]+)\/(.+)$/i);
    const target = legacyEntityMatch ? `/data/${legacyEntityMatch[1]}/${legacyEntityMatch[2]}` : rawTarget;
    setOpen(false);
    navigate(target);
  }

  return (
    <div className="dropdown dropdown-end">
      <button
        className="btn btn-ghost btn-sm relative"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="badge badge-xs badge-primary absolute -top-1 -right-1">{count}</span>
        )}
      </button>
      <div className="dropdown-content mt-2 w-80 card bg-base-100 shadow z-50">
        <div className="card-body p-3">
          <div className="font-semibold">Notifications</div>
          <div className="mt-2 space-y-2 max-h-80 overflow-auto">
            {items.length === 0 && <div className="text-xs opacity-60">No notifications</div>}
            {items.map((n) => (
              <button
                key={n.id}
                className={`w-full text-left p-2 rounded-md hover:bg-base-200 ${n.read_at ? "opacity-60" : ""}`}
                onClick={() => openNotification(n)}
                type="button"
              >
                <div className="text-sm font-medium">{n.title}</div>
                <div className="text-xs opacity-70 line-clamp-2">{n.body}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
