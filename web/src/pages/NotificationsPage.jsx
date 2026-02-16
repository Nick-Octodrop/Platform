import React, { useEffect, useState } from "react";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";

export default function NotificationsPage() {
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);

  async function load() {
    try {
      const res = await apiFetch("/notifications?unread_only=0");
      setItems(res.notifications || []);
    } catch (err) {
      pushToast("error", err.message || "Failed to load notifications");
    }
  }

  async function markRead(id) {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "POST" });
      load();
    } catch (err) {
      pushToast("error", err.message || "Failed to mark read");
    }
  }

  async function markAll() {
    try {
      await apiFetch("/notifications/read_all", { method: "POST" });
      load();
    } catch (err) {
      pushToast("error", err.message || "Failed to mark all read");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Notifications</h2>
          <button className="btn btn-sm" onClick={markAll}>Mark all read</button>
        </div>
        <div className="mt-4 space-y-2">
          {items.length === 0 && <div className="text-sm opacity-60">No notifications</div>}
          {items.map((n) => (
            <div key={n.id} className={`p-3 rounded-md border border-base-200 ${n.read_at ? "opacity-60" : ""}`}>
              <div className="text-sm font-semibold">{n.title}</div>
              <div className="text-xs opacity-70 mt-1">{n.body}</div>
              <div className="mt-2">
                <button className="btn btn-xs" onClick={() => markRead(n.id)}>Mark read</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
