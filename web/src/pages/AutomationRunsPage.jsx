import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import PaginationControls from "../components/PaginationControls.jsx";

export default function AutomationRunsPage() {
  const { automationId } = useParams();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const totalPages = useMemo(() => Math.max(1, Math.ceil(runs.length / pageSize)), [runs.length]);

  useEffect(() => {
    setPage((prev) => Math.min(Math.max(0, prev), totalPages - 1));
  }, [totalPages]);

  const pagedRuns = useMemo(() => {
    const start = page * pageSize;
    return runs.slice(start, start + pageSize);
  }, [runs, page]);

  async function load() {
    setLoading(true);
    const res = await apiFetch(`/automations/${automationId}/runs`);
    if (res.ok) {
      setRuns(res.data?.runs || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [automationId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Automation Runs</h1>
        <Link className="btn" to={`/automations/${automationId}`}>Back</Link>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          {loading ? (
            <div className="text-sm opacity-70">Loading…</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-end">
                <PaginationControls
                  page={page}
                  pageSize={pageSize}
                  totalItems={runs.length}
                  onPageChange={setPage}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="table w-full">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Ended</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRuns.map((run) => (
                    <tr key={run.id}>
                      <td>{run.status}</td>
                      <td className="opacity-70 text-sm">{run.started_at || "-"}</td>
                      <td className="opacity-70 text-sm">{run.ended_at || "-"}</td>
                      <td className="text-right">
                        <Link className="btn btn-sm" to={`/automation-runs/${run.id}`}>View</Link>
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="opacity-60 text-sm">No runs yet.</td>
                    </tr>
                  )}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
