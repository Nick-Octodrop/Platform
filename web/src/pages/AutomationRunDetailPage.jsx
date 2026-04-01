import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import useMediaQuery from "../hooks/useMediaQuery.js";

export default function AutomationRunDetailPage() {
  const { runId } = useParams();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/automation-runs/${runId}`);
      setData({ run: res?.run || null, steps: Array.isArray(res?.steps) ? res.steps : [] });
    } catch (err) {
      setData(null);
      const detail = err?.detail ? ` ${JSON.stringify(err.detail)}` : "";
      setError(`${err?.message || "Failed to load run."}${detail}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [runId]);

  if (loading) {
    return <div className="text-sm opacity-70">Loading…</div>;
  }
  if (!data) {
    return (
      <div className={isMobile ? "min-h-full bg-base-100 p-4 space-y-4" : "space-y-6"}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Automation Run</h1>
            <div className="text-sm opacity-70 font-mono">{runId}</div>
          </div>
          <button className="btn" onClick={load}>Retry</button>
        </div>
        <div className="alert alert-error text-sm">
          {error || "Run not found."}
        </div>
      </div>
    );
  }

  const { run, steps } = data;

  return (
    <div className={isMobile ? "min-h-full bg-base-100 p-4 space-y-4" : "space-y-6"}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Run {run.id}</h1>
          <div className="text-sm opacity-70">Status: {run.status}</div>
        </div>
        <Link className="btn" to="/automations">Automations</Link>
      </div>

      {run.last_error ? (
        <div className="alert alert-error text-sm">
          {run.last_error}
        </div>
      ) : null}

      <div className={isMobile ? "bg-base-200/40 rounded-box border border-base-300 p-4" : "rounded-[1.75rem] border border-base-300 bg-base-200/40 p-5"}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm">
          <div><span className="opacity-60">Automation:</span> <span className="font-mono">{run.automation_id || "—"}</span></div>
          <div><span className="opacity-60">Trigger type:</span> {run.trigger_type || "—"}</div>
          <div><span className="opacity-60">Started:</span> {run.started_at || "—"}</div>
          <div><span className="opacity-60">Ended:</span> {run.ended_at || "—"}</div>
          <div><span className="opacity-60">Current step index:</span> {run.current_step_index ?? "—"}</div>
          <div><span className="opacity-60">Trigger event id:</span> <span className="font-mono">{run.trigger_event_id || "—"}</span></div>
        </div>
      </div>

      <div className={isMobile ? "bg-base-100" : "card bg-base-100 rounded-[1.75rem] border border-base-300 shadow-sm"}>
        <div className={isMobile ? "" : "card-body"}>
          <div className="text-sm opacity-70">Trigger</div>
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(run.trigger_payload || {}, null, 2)}</pre>
        </div>
      </div>

      <div className={isMobile ? "bg-base-100" : "card bg-base-100 rounded-[1.75rem] border border-base-300 shadow-sm"}>
        <div className={isMobile ? "" : "card-body"}>
          <h2 className="font-semibold mb-2">Steps</h2>
          {(steps || []).length === 0 && <div className="text-sm opacity-60">No steps recorded.</div>}
          <div className="space-y-3">
            {(steps || []).map((step) => (
              <div key={step.id} className="border border-base-300 rounded p-3">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-xs">{step.step_id}</div>
                  <div className="text-xs">{step.status}</div>
                </div>
                <div className="mt-2 text-[11px] opacity-60">
                  Step index: {step.step_index ?? "—"} · Attempt: {(step.attempt ?? 0) + 1}
                </div>
                {step.last_error && <div className="text-xs text-error mt-2">{step.last_error}</div>}
                {step.output && <pre className="text-xs mt-2 whitespace-pre-wrap">{JSON.stringify(step.output, null, 2)}</pre>}
                {step.input && <pre className="text-xs mt-2 whitespace-pre-wrap opacity-70">{JSON.stringify(step.input, null, 2)}</pre>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
