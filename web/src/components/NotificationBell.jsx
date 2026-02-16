import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiFetch } from "../api.js";
import { Bell } from "lucide-react";

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const location = useLocation();
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
      const res = await apiFetch("/notifications?unread_only=0", { trace: "notifications_list" });
      setItems(res.notifications || []);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    if (deferCount) return undefined;
    loadCount();
    const interval = setInterval(loadCount, 30000);
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
          <div className="flex items-center justify-between">
            <div className="font-semibold">Notifications</div>
            <Link className="text-xs link" to="/notifications">Open</Link>
          </div>
          <div className="mt-2 space-y-2 max-h-80 overflow-auto">
            {items.length === 0 && <div className="text-xs opacity-60">No notifications</div>}
            {items.map((n) => (
              <button
                key={n.id}
                className={`w-full text-left p-2 rounded-md hover:bg-base-200 ${n.read_at ? "opacity-60" : ""}`}
                onClick={() => markRead(n.id)}
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
