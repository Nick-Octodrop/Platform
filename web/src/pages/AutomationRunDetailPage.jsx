import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";

export default function AutomationRunDetailPage() {
  const { runId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await apiFetch(`/automation-runs/${runId}`);
    if (res.ok) {
      setData(res.data || null);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [runId]);

  if (loading) {
    return <div className="text-sm opacity-70">Loading…</div>;
  }
  if (!data) {
    return <div className="text-sm opacity-70">Run not found.</div>;
  }

  const { run, steps } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Run {run.id}</h1>
          <div className="text-sm opacity-70">Status: {run.status}</div>
        </div>
        <Link className="btn" to="/automations">Automations</Link>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="text-sm opacity-70">Trigger</div>
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(run.trigger_payload || {}, null, 2)}</pre>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="font-semibold mb-2">Steps</h2>
          {(steps || []).length === 0 && <div className="text-sm opacity-60">No steps recorded.</div>}
          <div className="space-y-3">
            {(steps || []).map((step) => (
              <div key={step.id} className="border border-base-300 rounded p-3">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-xs">{step.step_id}</div>
                  <div className="text-xs">{step.status}</div>
                </div>
                {step.last_error && <div className="text-xs text-error mt-2">{step.last_error}</div>}
                {step.output && <pre className="text-xs mt-2 whitespace-pre-wrap">{JSON.stringify(step.output, null, 2)}</pre>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
