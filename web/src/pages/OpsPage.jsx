import React, { useEffect, useState } from "react";
import { apiFetch } from "../api.js";
import { useToast } from "../components/Toast.jsx";

export default function OpsPage() {
  const { pushToast } = useToast();
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("");
  const [jobType, setJobType] = useState("");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  async function loadJobs() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.append("status", status);
      if (jobType) params.append("job_type", jobType);
      const res = await apiFetch(`/ops/jobs?${params.toString()}`);
      setJobs(res.jobs || []);
      if (!selectedId && res.jobs?.length) {
        setSelectedId(res.jobs[0].id);
      }
    } catch (err) {
      pushToast("error", err.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    if (!id) return;
    try {
      const res = await apiFetch(`/ops/jobs/${id}`);
      setDetail(res);
    } catch (err) {
      pushToast("error", err.message || "Failed to load job detail");
    }
  }

  async function retryJob(id) {
    try {
      await apiFetch(`/ops/jobs/${id}/retry`, { method: "POST" });
      await loadJobs();
      await loadDetail(id);
    } catch (err) {
      pushToast("error", err.message || "Retry failed");
    }
  }

  async function cancelJob(id) {
    try {
      await apiFetch(`/ops/jobs/${id}/cancel`, { method: "POST" });
      await loadJobs();
      await loadDetail(id);
    } catch (err) {
      pushToast("error", err.message || "Cancel failed");
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">Jobs</h2>
          <div className="flex flex-col gap-2">
            <select className="select select-bordered w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
              <option value="dead">Dead</option>
            </select>
            <input
              className="input input-bordered w-full"
              placeholder="Type (email.send)"
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
            />
            <button className="btn btn-sm" onClick={loadJobs} disabled={loading}>Refresh</button>
          </div>
          <div className="mt-4 space-y-2 max-h-[60vh] overflow-auto">
            {jobs.length === 0 && <div className="text-sm opacity-60">No jobs</div>}
            {jobs.map((job) => (
              <button
                key={job.id}
                className={`btn btn-ghost justify-start w-full ${selectedId === job.id ? "bg-base-200" : ""}`}
                onClick={() => setSelectedId(job.id)}
              >
                <div className="flex flex-col items-start">
                  <span className="font-medium text-sm">{job.type}</span>
                  <span className="text-xs opacity-70">{job.status} · attempts {job.attempt}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title">Job Detail</h2>
            {detail?.job && (
              <div className="flex gap-2">
                <button className="btn btn-xs" onClick={() => retryJob(detail.job.id)}>Retry</button>
                <button className="btn btn-xs" onClick={() => cancelJob(detail.job.id)}>Cancel</button>
              </div>
            )}
          </div>
          {!detail?.job && <div className="text-sm opacity-60">Select a job to view details.</div>}
          {detail?.job && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div><span className="opacity-70">ID:</span> {detail.job.id}</div>
                <div><span className="opacity-70">Type:</span> {detail.job.type}</div>
                <div><span className="opacity-70">Status:</span> {detail.job.status}</div>
                <div><span className="opacity-70">Attempts:</span> {detail.job.attempt}</div>
              </div>
              <div>
                <div className="text-sm font-semibold">Payload</div>
                <pre className="text-xs bg-base-200 p-2 rounded overflow-auto">{JSON.stringify(detail.job.payload, null, 2)}</pre>
              </div>
              <div>
                <div className="text-sm font-semibold">Events</div>
                <div className="space-y-1">
                  {(detail.events || []).map((evt) => (
                    <div key={evt.id} className="text-xs">
                      <span className="opacity-70">{evt.ts}</span> {evt.level} — {evt.message}
                    </div>
                  ))}
                  {(detail.events || []).length === 0 && <div className="text-xs opacity-60">No events</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
