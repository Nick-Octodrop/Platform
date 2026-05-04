import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, emitRecordMutation } from "../api";
import { useToast } from "./Toast.jsx";
import { translateRuntime } from "../i18n/runtime.js";

export const AUTOMATION_RUNS_STARTED_EVENT = "octo:automation-runs-started";

const STORAGE_KEY = "octo.backgroundAutomationTasks";
const AUTO_DISMISS_DONE_MS = 3000;
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "dead", "cancelled"]);
const FAILED_STATUSES = new Set(["failed", "dead", "cancelled"]);

function automationRunUi(runOrTask) {
  const ui = runOrTask?.ui || runOrTask?.automation_ui || runOrTask?.notifications;
  return ui && typeof ui === "object" ? ui : {};
}

function shouldTrackAutomationRun(run, action = {}) {
  const ui = { ...automationRunUi(action), ...automationRunUi(run) };
  return ui.show_progress !== false && ui.track_progress !== false && ui.background_progress !== false;
}

function shouldToastAutomationRun(run, action = {}, phase = "start") {
  const ui = { ...automationRunUi(action), ...automationRunUi(run) };
  if (ui.show_toast === false || ui.toast === false || ui.notifications === false) return false;
  if (phase === "start" && ui.toast_on_start === false) return false;
  if (phase === "finish" && ui.toast_on_finish === false) return false;
  return true;
}

function safeTasksFromStorage() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - 5 * 60 * 1000;
    return parsed.filter((task) => task?.id && (!task.done || Number(task.finishedAt || 0) > cutoff));
  } catch {
    return [];
  }
}

function persistTasks(tasks) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify((tasks || []).slice(-20)));
  } catch {
    // Storage is best effort; polling state still works for the current render.
  }
}

function humanizeAutomationText(value) {
  if (!value) return "";
  return String(value)
    .replace(/^system\./, "")
    .replace(/[_:.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function isDocumentAutomation(action, runs) {
  const haystack = [
    action?.id,
    action?.label,
    action?.action_label,
    action?.kind,
    ...(Array.isArray(runs) ? runs.map((run) => `${run?.automation_name || ""} ${run?.trigger_type || ""}`) : []),
  ].join(" ").toLowerCase();
  return haystack.includes("document") || haystack.includes("pdf") || haystack.includes("generate_document");
}

function startedToastKey(action, runs) {
  if (isDocumentAutomation(action, runs)) return "common.app_shell.document_generation_started";
  return runs.length === 1 ? "common.app_shell.automation_started" : "common.app_shell.automations_started";
}

function initialActionFromRun(action, run) {
  if (action?.label) return action;
  const name = run?.automation_name || "";
  if (name) return { ...action, label: name };
  return action;
}

function automationAffectedRecords(runOrTask) {
  const payload = runOrTask?.triggerPayload || runOrTask?.trigger_payload || {};
  const records = [];
  const add = (entityId, recordId) => {
    if (!entityId || !recordId) return;
    const key = `${entityId}:${recordId}`;
    if (records.some((item) => item.key === key)) return;
    records.push({ key, entityId, recordId });
  };
  add(payload.entity_id, payload.record_id);
  add(payload.source_entity_id, payload.source_record_id);
  add(payload.target_entity_id, payload.target_record_id);
  return records;
}

function titleForTask(task) {
  return (
    task?.automationName ||
    task?.label ||
    humanizeAutomationText(task?.actionId || task?.triggerType) ||
    translateRuntime("common.app_shell.background_task_default_title", {}, { defaultValue: "Automation" })
  );
}

function titleForStep(step) {
  return (
    step?.label ||
    humanizeAutomationText(step?.action_id || step?.step_id || step?.kind) ||
    translateRuntime("common.app_shell.background_task_step_fallback", {}, { defaultValue: "Automation step" })
  );
}

function deriveTaskState(task, statusPayload) {
  const run = statusPayload?.run || {};
  const progress = statusPayload?.progress || {};
  const steps = Array.isArray(statusPayload?.steps) ? statusPayload.steps : [];
  const jobs = Array.isArray(statusPayload?.jobs) ? statusPayload.jobs : [];
  const activeJobs = Array.isArray(progress.active_jobs)
    ? progress.active_jobs
    : jobs.filter((job) => !TERMINAL_JOB_STATUSES.has(job?.status));
  const failedJob = jobs.find((job) => FAILED_STATUSES.has(job?.status));
  const runStatus = run.effective_status || run.status || task.status || "queued";
  const isRunTerminal = TERMINAL_RUN_STATUSES.has(run.status || runStatus);
  const scheduledForLater =
    !isRunTerminal &&
    runStatus === "queued" &&
    activeJobs.length === 0 &&
    steps.length > 0 &&
    steps.every((step) => TERMINAL_RUN_STATUSES.has(step?.status) || step?.status === "succeeded");
  const done = Boolean(progress.done) || (isRunTerminal && activeJobs.length === 0) || scheduledForLater;
  const failed = FAILED_STATUSES.has(runStatus) || Boolean(failedJob);
  const runUi = automationRunUi(run);
  return {
    ...task,
    status: runStatus,
    ui: Object.keys(runUi).length ? runUi : automationRunUi(task),
    automationName: run.automation_name || task.automationName,
    triggerType: run.trigger_type || task.triggerType,
    startedAt: run.started_at || task.startedAt,
    endedAt: run.ended_at || task.endedAt,
    updatedAt: run.updated_at || task.updatedAt,
    lastError: run.last_error || failedJob?.last_error || task.lastError || null,
    steps,
    jobs,
    progress: {
      totalSteps: Number(progress.total_steps || 0),
      completedSteps: Number(progress.completed_steps || 0),
      activeStep: progress.active_step || null,
      activeJobs,
    },
    done,
    failed,
    scheduledForLater,
    finishedAt: done && !task.finishedAt ? Date.now() : task.finishedAt,
    pollError: null,
  };
}

function taskDescription(task) {
  const activeJob = task?.progress?.activeJobs?.[0];
  if (task?.done) {
    if (task.failed) {
      return task.lastError || translateRuntime("common.app_shell.background_task_failed", {}, { defaultValue: "Automation failed" });
    }
    return translateRuntime("common.app_shell.background_task_done", {}, { defaultValue: "Automation complete" });
  }
  if (activeJob?.type === "doc.generate" || task?.isDocument) {
    return translateRuntime("common.app_shell.background_task_rendering_document", {}, { defaultValue: "Rendering document..." });
  }
  const activeStep = task?.progress?.activeStep;
  if (activeStep) {
    const stepIndex = Number(activeStep.step_index);
    const total = Number(task?.progress?.totalSteps || 0);
    const stepNumber = Number.isFinite(stepIndex) ? stepIndex + 1 : null;
    const prefix = stepNumber && total
      ? translateRuntime("common.app_shell.background_task_step_count", { current: stepNumber, total }, { defaultValue: `Step ${stepNumber} of ${total}` })
      : translateRuntime("common.app_shell.background_task_step", {}, { defaultValue: "Step" });
    return `${prefix}: ${titleForStep(activeStep)}`;
  }
  if (task?.pollError) {
    return translateRuntime("common.app_shell.background_task_checking_status", {}, { defaultValue: "Checking status..." });
  }
  return translateRuntime("common.app_shell.background_task_running", {}, { defaultValue: "Running..." });
}

function progressState(task) {
  const activeJob = task?.progress?.activeJobs?.[0];
  if (!task?.done && activeJob) {
    return { indeterminate: true };
  }
  const total = Math.max(1, Number(task?.progress?.totalSteps || task?.steps?.length || 1));
  if (task?.done) return { value: total, max: total };
  const completed = Number(task?.progress?.completedSteps || 0);
  const activeStepBonus = task?.progress?.activeStep ? 0.35 : 0;
  const value = Math.min(Math.max(0.1, completed + activeStepBonus), Math.max(0.1, total - 0.05));
  return { value, max: total };
}

export function notifyAutomationRunsStarted(runs, action = {}) {
  if (typeof window === "undefined" || !Array.isArray(runs) || runs.length === 0) return;
  window.dispatchEvent(
    new CustomEvent(AUTOMATION_RUNS_STARTED_EVENT, {
      detail: { runs, action },
    }),
  );
}

export default function BackgroundAutomationTracker() {
  const { pushToast } = useToast();
  const [tasks, setTasks] = useState(safeTasksFromStorage);
  const tasksRef = useRef(tasks);
  const notifiedRef = useRef(new Set());
  const startedRef = useRef(new Set(tasks.map((task) => task.id).filter(Boolean)));
  const pushToastRef = useRef(pushToast);

  useEffect(() => {
    tasksRef.current = tasks;
    persistTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    pushToastRef.current = pushToast;
  }, [pushToast]);

  const dismissTask = useCallback((taskId) => {
    setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, dismissed: true } : task)));
  }, []);

  useEffect(() => {
    const timeoutIds = [];
    const now = Date.now();
    for (const task of tasks) {
      if (!task?.id || !task.done || task.dismissed) continue;
      const finishedAt = Number(task.finishedAt || now);
      const delay = Math.max(0, AUTO_DISMISS_DONE_MS - (now - finishedAt));
      timeoutIds.push(window.setTimeout(() => dismissTask(task.id), delay));
    }
    return () => {
      for (const timeoutId of timeoutIds) window.clearTimeout(timeoutId);
    };
  }, [tasks, dismissTask]);

  useEffect(() => {
    function handleRunsStarted(event) {
      const runs = Array.isArray(event?.detail?.runs) ? event.detail.runs : [];
      const action = event?.detail?.action || {};
      if (runs.length === 0) return;
      const freshRuns = runs.filter((run) => run?.id && !startedRef.current.has(run.id));
      for (const run of freshRuns) startedRef.current.add(run.id);
      const toastRuns = freshRuns.filter((run) => shouldToastAutomationRun(run, action, "start"));
      if (toastRuns.length > 0) {
        pushToastRef.current("info", translateRuntime(startedToastKey(action, toastRuns), { count: toastRuns.length }));
      }
      const now = Date.now();
      const documentRun = isDocumentAutomation(action, runs);
      setTasks((prev) => {
        const byId = new Map(prev.map((task) => [task.id, task]));
        for (const run of runs) {
          if (!run?.id) continue;
          if (!shouldTrackAutomationRun(run, action)) {
            byId.delete(run.id);
            continue;
          }
          const existing = byId.get(run.id);
          const actionMeta = initialActionFromRun(action, run);
          byId.set(run.id, {
            id: run.id,
            ui: automationRunUi(run),
            automationName: run.automation_name || existing?.automationName || null,
            triggerType: run.trigger_type || existing?.triggerType || null,
            triggerPayload: run.trigger_payload || existing?.triggerPayload || null,
            actionId: actionMeta?.id || existing?.actionId || null,
            label: actionMeta?.label || actionMeta?.action_label || existing?.label || null,
            status: run.status || existing?.status || "queued",
            isDocument: documentRun || existing?.isDocument || false,
            createdAt: run.created_at || existing?.createdAt || now,
            startedAt: run.started_at || existing?.startedAt || null,
            updatedAt: run.updated_at || existing?.updatedAt || null,
            endedAt: run.ended_at || existing?.endedAt || null,
            steps: existing?.steps || [],
            jobs: existing?.jobs || [],
            progress: existing?.progress || { totalSteps: 0, completedSteps: 0, activeStep: null, activeJobs: [] },
            done: existing?.done || TERMINAL_RUN_STATUSES.has(run.status),
            failed: existing?.failed || FAILED_STATUSES.has(run.status),
            dismissed: existing?.dismissed || false,
            lastError: run.last_error || existing?.lastError || null,
            finishedAt: existing?.finishedAt || null,
            pollError: existing?.pollError || null,
          });
        }
        return Array.from(byId.values()).slice(-20);
      });
    }
    window.addEventListener(AUTOMATION_RUNS_STARTED_EVENT, handleRunsStarted);
    return () => window.removeEventListener(AUTOMATION_RUNS_STARTED_EVENT, handleRunsStarted);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const notifyCompleted = (task) => {
      if (!task?.id || !task.done || notifiedRef.current.has(task.id)) return;
      notifiedRef.current.add(task.id);
      if (!task.failed && !task.scheduledForLater) {
        for (const record of automationAffectedRecords(task)) {
          emitRecordMutation({
            source: "automation",
            operation: "automation_complete",
            entityId: record.entityId,
            recordId: record.recordId,
            recordIds: [record.recordId],
            broad: true,
          });
        }
      }
      if (task.scheduledForLater || shouldToastAutomationRun(task, {}, "finish") === false) return;
      const title = titleForTask(task);
      if (task.failed) {
        pushToastRef.current(
          "error",
          `${title}: ${task.lastError || translateRuntime("common.app_shell.background_task_failed", {}, { defaultValue: "Automation failed" })}`,
        );
      } else {
        pushToastRef.current(
          "success",
          `${title}: ${translateRuntime("common.app_shell.background_task_done", {}, { defaultValue: "Automation complete" })}`,
        );
      }
    };
    const poll = async () => {
      const activeTasks = tasksRef.current.filter((task) => task?.id && !task.done);
      if (activeTasks.length === 0) return;
      await Promise.all(
        activeTasks.map(async (task) => {
          try {
            const statusPayload = await apiFetch(`/automation-runs/${encodeURIComponent(task.id)}/status`, {
              cacheTtl: 0,
              trace: "automation_run_status",
            });
            if (cancelled) return;
            const completedTask = deriveTaskState(task, statusPayload);
            setTasks((prev) =>
              prev.map((item) => (item.id === task.id ? deriveTaskState(item, statusPayload) : item)),
            );
            if (completedTask.done && !task.done) notifyCompleted(completedTask);
          } catch (err) {
            if (cancelled) return;
            const terminalPollFailure = err?.status === 403 || err?.status === 404;
            let failedTask = null;
            setTasks((prev) =>
              prev.map((item) => {
                if (item.id !== task.id) return item;
                const next = {
                  ...item,
                  pollError: err?.message || "Unable to check automation status",
                  lastError: err?.message || item.lastError,
                  failed: terminalPollFailure ? true : item.failed,
                  done: terminalPollFailure ? true : item.done,
                  finishedAt: terminalPollFailure && !item.finishedAt ? Date.now() : item.finishedAt,
                };
                if (terminalPollFailure && !item.done) failedTask = next;
                return next;
              }),
            );
            if (failedTask) notifyCompleted(failedTask);
          }
        }),
      );
    };
    poll();
    const intervalId = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const visibleTasks = tasks.filter((task) => !task.dismissed);
  if (visibleTasks.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[255] w-[min(28rem,calc(100vw-2rem))] space-y-2" aria-live="polite">
      {visibleTasks.slice(-4).map((task) => {
        const progress = progressState(task);
        return (
          <div
            key={task.id}
            className="pointer-events-auto rounded-box border border-base-300 bg-base-100/95 p-3 shadow-xl backdrop-blur"
          >
            <div className="flex items-start gap-3">
              {!task.done ? <span className="loading loading-spinner loading-sm mt-1 text-primary" /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-semibold">{titleForTask(task)}</div>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-base-content/70">{taskDescription(task)}</div>
                {progress.indeterminate ? (
                  <div className="octo-indeterminate-progress mt-2" aria-hidden="true">
                    <div />
                  </div>
                ) : (
                  <progress className="progress progress-primary mt-2 h-1.5 w-full" value={progress.value} max={progress.max} />
                )}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => dismissTask(task.id)}
                aria-label={translateRuntime("common.close", {}, { defaultValue: "Close" })}
              >
                x
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
