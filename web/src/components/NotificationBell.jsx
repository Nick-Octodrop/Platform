import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../api.js";
import { Bell, MoreHorizontal } from "lucide-react";
import { SOFT_BUTTON_XS } from "../components/buttonStyles.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { resolveNotificationTarget } from "../utils/notificationTargets.js";

export default function NotificationBell() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearing, setClearing] = useState(false);
  const panelRef = useRef(null);
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

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open || isMobile) return undefined;
    function handlePointerDown(event) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open || !isMobile) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isMobile]);

  async function markRead(id) {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "POST" });
      loadCount();
      loadItems();
    } catch {
      // ignore
    }
  }

  async function markAllSeen() {
    try {
      await apiFetch("/notifications/read_all", { method: "POST" });
      setItems((prev) => prev.map((item) => ({ ...item, read_at: new Date().toISOString() })));
      setCount(0);
    } catch {
      // ignore
    }
  }

  async function clearAll() {
    setClearing(true);
    try {
      await apiFetch("/notifications/clear_all", { method: "POST" });
      setItems([]);
      latestSeenAtRef.current = null;
      setCount(0);
      setShowClearModal(false);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  }

  async function openNotification(item) {
    const id = item?.id;
    if (!id) return;
    await markRead(id);
    const target = await resolveNotificationTarget(item?.link_to, item?.source_event);
    setOpen(false);
    if (/^https?:\/\//i.test(target)) {
      window.location.assign(target);
      return;
    }
    navigate(target);
  }

  return (
    <div className="relative" ref={panelRef}>
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
      {open && !isMobile && (
        <div className="absolute right-0 mt-2 w-80 card bg-base-100 shadow z-50">
          <div className="card-body p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Notifications</div>
              <div className="dropdown dropdown-end">
                <button
                  type="button"
                  tabIndex={0}
                  className={SOFT_BUTTON_XS}
                  aria-label="Notification actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                <ul tabIndex={0} className="dropdown-content menu z-[240] mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow">
                  <li>
                    <button type="button" onClick={markAllSeen} disabled={items.length === 0}>
                      Mark all seen
                    </button>
                  </li>
                  <li>
                    <button type="button" className="text-error" onClick={() => setShowClearModal(true)} disabled={items.length === 0}>
                      Clear all
                    </button>
                  </li>
                </ul>
              </div>
            </div>
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
      )}
      {open && isMobile && (
        <div className="fixed inset-0 z-[220]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/35"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-base-100 border-t border-base-300 shadow-2xl p-4">
            <div className="mx-auto mb-4 h-1.5 w-24 rounded-full bg-base-300" />
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="font-semibold">Notifications</div>
              <div className="dropdown dropdown-end">
                <button
                  type="button"
                  tabIndex={0}
                  className={SOFT_BUTTON_XS}
                  aria-label="Notification actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                <ul tabIndex={0} className="dropdown-content menu z-[240] mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow">
                  <li>
                    <button type="button" onClick={markAllSeen} disabled={items.length === 0}>
                      Mark all seen
                    </button>
                  </li>
                  <li>
                    <button type="button" className="text-error" onClick={() => setShowClearModal(true)} disabled={items.length === 0}>
                      Clear all
                    </button>
                  </li>
                </ul>
              </div>
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-auto">
              {items.length === 0 && <div className="text-sm opacity-60 px-2 py-4">No notifications</div>}
              {items.map((n) => (
                <button
                  key={n.id}
                  className={`w-full text-left rounded-2xl px-4 py-3 hover:bg-base-200 ${n.read_at ? "opacity-60" : ""}`}
                  onClick={() => openNotification(n)}
                  type="button"
                >
                  <div className="text-sm font-medium">{n.title}</div>
                  <div className="text-xs opacity-70 line-clamp-2 mt-1">{n.body}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {showClearModal ? (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-base-content/40 px-4">
          <div className="w-full max-w-sm rounded-box border border-base-300 bg-base-100 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold">Clear notifications</h3>
            <p className="mt-2 text-sm text-base-content/70">
              Remove all notifications from your list. This cannot be undone.
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
