import React, { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useModuleStore } from "../state/moduleStore.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";

export default function AuditPage() {
  const { modules } = useModuleStore();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(50);
  const [moduleFilter, setModuleFilter] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(limit));
        if (moduleFilter) params.set("module_id", moduleFilter);
        const res = await apiFetch(`/audit?${params.toString()}`);
        setEvents(res.data?.events || []);
        setError(null);
      } catch (err) {
        setError(err.message || "Failed to load audit");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [limit, moduleFilter]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit</h1>
        <div className="text-sm opacity-70">System and module activity</div>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <select className="select select-bordered" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
          <option value="">All modules</option>
          {modules.map((m) => (
            <option key={m.module_id} value={m.module_id}>{m.module_id}</option>
          ))}
        </select>
        <select className="select select-bordered" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">Activity</h2>
          {error && <div className="alert alert-error mb-4">{error}</div>}
          {loading && <LoadingSpinner className="min-h-[16vh]" />}
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Target</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="opacity-70">No audit events.</td>
                  </tr>
                )}
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{e.ts || "—"}</td>
                    <td>{e.type || "—"}</td>
                    <td>{e.module_id || "—"}</td>
                    <td>{(e.detail?.action || "").toString() || "—"}</td>
                    <td>{e.status || "—"}</td>
                    <td><span className="text-xs opacity-70">{JSON.stringify(e.detail || {})}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-sm opacity-70 mt-2">Audit feed will populate as system activity grows.</div>
        </div>
      </div>
    </div>
  );
}
