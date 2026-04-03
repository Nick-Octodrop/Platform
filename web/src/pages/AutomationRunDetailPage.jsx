import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";
import { formatDateTime } from "../utils/dateTime.js";

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

  const run = data?.run || null;
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const displayRunId = run?.id || runId || "";

  const summaryItems = useMemo(
    () => [
      { label: "Status", value: run?.status || "—" },
      { label: "Automation", value: run?.automation_id || "—", mono: true },
      { label: "Trigger type", value: run?.trigger_type || "—" },
      { label: "Started", value: formatDateTime(run?.started_at, "—") },
      { label: "Ended", value: formatDateTime(run?.ended_at, "—") },
      { label: "Current step index", value: run?.current_step_index ?? "—" },
      { label: "Trigger event ID", value: run?.trigger_event_id || "—", mono: true },
    ],
    [run]
  );

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            <div className="flex flex-col gap-4 min-w-0">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold break-all">{displayRunId ? `Run ${displayRunId}` : "Automation run"}</h1>
                <div className="mt-1 text-sm opacity-70">
                  {run?.status ? `Status: ${run.status}` : "Run details"}
                </div>
              </div>

              {loading ? (
                <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">Loading…</div>
              ) : !data ? (
                <>
                  {error ? <div className="alert alert-error text-sm">{error}</div> : null}
                  <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">Run not found.</div>
                </>
              ) : (
                <>
                  {run?.last_error ? (
                    <div className="alert alert-error text-sm">{run.last_error}</div>
                  ) : null}

                  <section className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {summaryItems.map((item) => (
                        <div key={item.label} className="rounded-box border border-base-300 bg-base-200/40 p-3">
                          <div className="text-xs uppercase tracking-wide opacity-60">{item.label}</div>
                          <div className={`mt-1 text-sm ${item.mono ? "font-mono break-all" : ""}`}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <div>
                      <h2 className="text-base font-semibold">Trigger payload</h2>
                      <div className="mt-1 text-sm opacity-70">The payload and trigger data that started this automation run.</div>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded-box border border-base-300 bg-base-200/40 p-4 text-xs leading-5">
                      {JSON.stringify(run?.trigger_payload || {}, null, 2)}
                    </pre>
                  </section>

                  <section className="space-y-3">
                    <div>
                      <h2 className="text-base font-semibold">Steps</h2>
                      <div className="mt-1 text-sm opacity-70">Recorded step execution output for this run.</div>
                    </div>
                    {steps.length === 0 ? (
                      <div className="text-sm opacity-60">No steps recorded.</div>
                    ) : (
                      <div className="space-y-3">
                        {steps.map((step) => (
                          <div key={step.id} className="rounded-box border border-base-300 bg-base-200/40 p-4 space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs uppercase tracking-wide opacity-60">Step {step.step_index ?? "—"}</div>
                                <div className="mt-1 font-medium break-all">{step.step_id || step.id}</div>
                                <div className="mt-1 text-xs opacity-70">Attempt {(step.attempt ?? 0) + 1}</div>
                              </div>
                              <div className="badge badge-outline">{step.status || "unknown"}</div>
                            </div>
                            {step.last_error ? <div className="mt-3 text-sm text-error whitespace-pre-wrap">{step.last_error}</div> : null}
                            {step.output ? (
                              <div>
                                <div className="mb-2 text-xs uppercase tracking-wide opacity-60">Output</div>
                                <pre className="overflow-x-auto whitespace-pre-wrap rounded-box bg-base-100 p-3 text-xs leading-5">
                                  {JSON.stringify(step.output, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                            {step.input ? (
                              <div>
                                <div className="mb-2 text-xs uppercase tracking-wide opacity-60">Input</div>
                                <pre className="overflow-x-auto whitespace-pre-wrap rounded-box bg-base-100 p-3 text-xs leading-5 opacity-80">
                                  {JSON.stringify(step.input, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
