import React, { useEffect, useState } from "react";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";

export default function EmailOutboxPage() {
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);

  async function load() {
    try {
      const res = await apiFetch("/email/outbox");
      setItems(res.outbox || []);
    } catch (err) {
      pushToast("error", err.message || "Failed to load outbox");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Email Outbox</h2>
          <button className="btn btn-sm" onClick={load}>Refresh</button>
        </div>
        {items.length === 0 && <div className="text-sm opacity-60">No emails sent</div>}
        <div className="space-y-2 mt-3">
          {items.map((o) => (
            <div key={o.id} className="p-3 border border-base-200 rounded-md">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{o.subject}</div>
                <div className="text-xs opacity-70">{o.status}</div>
              </div>
              <div className="text-xs opacity-70 mt-1">{Array.isArray(o.to) ? o.to.join(", ") : ""}</div>
              {o.last_error && <div className="text-xs text-error mt-1">{o.last_error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
