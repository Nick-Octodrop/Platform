import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { DESKTOP_PAGE_SHELL, DESKTOP_PAGE_SHELL_BODY } from "../ui/pageShell.js";

export default function AutomationRunDetailPage() {
  const { runId } = useParams();
  const { t, formatDateTime } = useI18n();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [res, statusRes] = await Promise.all([
        apiFetch(`/automation-runs/${runId}`),
        apiFetch(`/automation-runs/${runId}/status`).catch(() => null),
      ]);
      const rawRun = res?.run || null;
      const statusRun = statusRes?.run || null;
      const statusSteps = Array.isArray(statusRes?.steps) ? statusRes.steps : [];
      const statusById = new Map(statusSteps.map((step) => [step.id || step.step_id, step]));
      const statusByStepId = new Map(statusSteps.map((step) => [step.step_id, step]));
      const rawSteps = Array.isArray(res?.steps) ? res.steps : [];
      const mergedSteps = rawSteps.map((step) => {
        const statusStep = statusById.get(step.id || step.step_id) || statusByStepId.get(step.step_id);
        return statusStep ? { ...step, ...statusStep, input: step.input, output: step.output } : step;
      });
      setData({
        run: rawRun ? { ...rawRun, ...(statusRun || {}) } : statusRun,
        steps: mergedSteps.length ? mergedSteps : statusSteps,
        jobs: Array.isArray(statusRes?.jobs) ? statusRes.jobs : [],
        progress: statusRes?.progress || null,
      });
    } catch (err) {
      setData(null);
      const detail = err?.detail ? ` ${JSON.stringify(err.detail)}` : "";
      setError(`${err?.message || t("settings.automation_run_detail.load_failed")}${detail}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [runId]);

  const run = data?.run || null;
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const displayStatus = run?.effective_status || run?.status || "";
  const displayRunId = run?.id || runId || "";

  const summaryItems = useMemo(
    () => [
      { label: t("common.status"), value: displayStatus ? t(`common.${displayStatus}`, {}, { defaultValue: displayStatus }) : "—" },
      { label: t("settings.automation_run_detail.automation"), value: run?.automation_id || "—", mono: true },
      { label: t("settings.automation_run_detail.trigger_type"), value: run?.trigger_type || "—" },
      { label: t("common.started"), value: formatDateTime(run?.started_at, { defaultValue: "—" }) || "—" },
      { label: t("common.ended"), value: formatDateTime(run?.ended_at, { defaultValue: "—" }) || "—" },
      { label: t("settings.automation_run_detail.current_step_index"), value: run?.current_step_index ?? "—" },
      { label: t("settings.automation_run_detail.trigger_event_id"), value: run?.trigger_event_id || "—", mono: true },
    ],
    [run, displayStatus, formatDateTime, t]
  );

  return (
    <div className="min-h-full md:h-full md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      <div className={DESKTOP_PAGE_SHELL}>
        <div className={DESKTOP_PAGE_SHELL_BODY}>
          <div className="md:mt-4 md:flex-1 md:min-h-0 md:overflow-auto md:overflow-x-hidden">
            <div className="flex flex-col gap-4 min-w-0">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold break-all">{displayRunId ? t("settings.automation_run_detail.run_named", { id: displayRunId }) : t("settings.automation_run_detail.title")}</h1>
                <div className="mt-1 text-sm opacity-70">
                  {displayStatus ? t("settings.automation_run_detail.status_value", { status: t(`common.${displayStatus}`, {}, { defaultValue: displayStatus }) }) : t("settings.automation_run_detail.subtitle")}
                </div>
              </div>

              {loading ? (
                <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">{t("common.loading")}</div>
              ) : !data ? (
                <>
                  {error ? <div className="alert alert-error text-sm">{error}</div> : null}
                  <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">{t("settings.automation_run_detail.not_found")}</div>
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
                      <h2 className="text-base font-semibold">{t("settings.automation_run_detail.trigger_payload")}</h2>
                      <div className="mt-1 text-sm opacity-70">{t("settings.automation_run_detail.trigger_payload_description")}</div>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded-box border border-base-300 bg-base-200/40 p-4 text-xs leading-5">
                      {JSON.stringify(run?.trigger_payload || {}, null, 2)}
                    </pre>
                  </section>

                  <section className="space-y-3">
                    <div>
                      <h2 className="text-base font-semibold">{t("settings.automation_run_detail.steps")}</h2>
                      <div className="mt-1 text-sm opacity-70">{t("settings.automation_run_detail.steps_description")}</div>
                    </div>
                    {steps.length === 0 ? (
                      <div className="text-sm opacity-60">{t("settings.automation_run_detail.no_steps")}</div>
                    ) : (
                      <div className="space-y-3">
                        {steps.map((step) => (
                          <div key={step.id} className="rounded-box border border-base-300 bg-base-200/40 p-4 space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.automation_run_detail.step_index", { index: step.step_index ?? "—" })}</div>
                                <div className="mt-1 font-medium break-all">{step.step_id || step.id}</div>
                                <div className="mt-1 text-xs opacity-70">{t("settings.automation_run_detail.attempt", { count: (step.attempt ?? 0) + 1 })}</div>
                              </div>
                              <div className="badge badge-outline">{step.status ? t(`common.${step.status}`, {}, { defaultValue: step.status }) : t("settings.automation_run_detail.unknown")}</div>
                            </div>
                            {step.last_error ? <div className="mt-3 text-sm text-error whitespace-pre-wrap">{step.last_error}</div> : null}
                            {step.output ? (
                              <div>
                                <div className="mb-2 text-xs uppercase tracking-wide opacity-60">{t("settings.automation_run_detail.output")}</div>
                                <pre className="overflow-x-auto whitespace-pre-wrap rounded-box bg-base-100 p-3 text-xs leading-5">
                                  {JSON.stringify(step.output, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                            {step.input ? (
                              <div>
                                <div className="mb-2 text-xs uppercase tracking-wide opacity-60">{t("settings.automation_run_detail.input")}</div>
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

                  {jobs.length ? (
                    <section className="space-y-3">
                      <div>
                        <h2 className="text-base font-semibold">Background jobs</h2>
                        <div className="mt-1 text-sm opacity-70">Queued worker jobs linked to this automation run.</div>
                      </div>
                      <div className="overflow-x-auto rounded-box border border-base-300">
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Status</th>
                              <th>Attempt</th>
                              <th>Last error</th>
                            </tr>
                          </thead>
                          <tbody>
                            {jobs.map((job) => (
                              <tr key={job.id}>
                                <td className="font-mono text-xs">{job.type || "—"}</td>
                                <td>{job.status ? t(`common.${job.status}`, {}, { defaultValue: job.status }) : "—"}</td>
                                <td>{job.attempt ?? "—"}/{job.max_attempts ?? "—"}</td>
                                <td className="max-w-xl whitespace-pre-wrap text-error">{job.last_error || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
