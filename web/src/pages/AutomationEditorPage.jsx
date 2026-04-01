import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { apiFetch } from "../api";
import TemplateStudioShell from "./templates/TemplateStudioShell.jsx";
import CodeTextarea from "../components/CodeTextarea.jsx";
import ValidationPanel from "../components/ValidationPanel.jsx";
import { useToast } from "../components/Toast.jsx";
import AgentChatInput from "../ui/AgentChatInput.jsx";
import { formatDateTime } from "../utils/dateTime.js";
import { useAccessContext } from "../access.js";
import useMediaQuery from "../hooks/useMediaQuery.js";

function AutomationLookupValueInput({ fieldDef, value, onChange, placeholder = "" }) {
  const [options, setOptions] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const containerRef = useRef(null);
  const entityId = fieldDef?.entity || null;
  const labelField = fieldDef?.display_field || null;

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      if (!entityId || !opened) return;
      setLoading(true);
      try {
        const res = await apiFetch(`/lookup/${entityId}/options`, {
          method: "POST",
          body: JSON.stringify({
            q: (debouncedSearch || "").trim() || null,
            limit: 20,
            domain: fieldDef?.domain || null,
            record_context: {},
          }),
        });
        const records = Array.isArray(res?.records) ? res.records : [];
        const nextOptions = records.map((item) => {
          const record = item?.record || {};
          const recordId = item?.record_id || record?.id;
          const label = (labelField && record?.[labelField]) || item?.label || recordId || "—";
          return { value: recordId, label };
        }).filter((item) => item.value);
        if (!cancelled) setOptions(nextOptions);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [entityId, labelField, debouncedSearch, opened, fieldDef?.domain]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedLabel() {
      if (!entityId || !value) {
        setSelectedLabel("");
        return;
      }
      const match = options.find((opt) => opt.value === value);
      if (match) {
        setSelectedLabel(match.label || "");
        return;
      }
      try {
        const res = await apiFetch(`/records/${entityId}/${value}`);
        const record = res?.record || res;
        const label = (labelField && record?.[labelField]) || record?.id || value;
        if (!cancelled) setSelectedLabel(label);
      } catch {
        if (!cancelled) setSelectedLabel(String(value));
      }
    }
    loadSelectedLabel();
    return () => {
      cancelled = true;
    };
  }, [entityId, value, options, labelField]);

  useEffect(() => {
    function handleOutside(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpened(false);
      }
    }
    if (!opened) return undefined;
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [opened]);

  const inputValue = opened ? search : search || selectedLabel || String(value || "");

  function handleSelect(option) {
    setSelectedLabel(option.label || "");
    setSearch(option.label || "");
    setOpened(false);
    onChange(option.value);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          className="input input-bordered w-full pr-10"
          value={inputValue}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => {
            setOpened(true);
            setSearch("");
          }}
          placeholder={placeholder || "Search records..."}
        />
        {Boolean(value) && (
          <button
            type="button"
            className="btn btn-ghost btn-xs absolute right-2 top-1/2 h-6 min-h-6 -translate-y-1/2 px-1"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setSelectedLabel("");
              setSearch("");
              onChange("");
            }}
          >
            ×
          </button>
        )}
      </div>
      {opened && (
        <div className="absolute z-30 mt-1 flex max-h-64 w-full flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow">
          <ul className="menu menu-compact menu-vertical block w-full flex-1 overflow-y-auto">
            {loading && <li className="menu-title"><span>Loading…</span></li>}
            {!loading && options.length === 0 && <li className="menu-title"><span>No results</span></li>}
            {options.map((option) => (
              <li key={option.value}>
                <button type="button" className={option.value === value ? "active" : ""} onClick={() => handleSelect(option)}>
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AutomationUsersValueInput({ members = [], value, onChange, placeholder = "" }) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  const normalizedMembers = useMemo(
    () => (Array.isArray(members) ? members : []).map((member) => ({
      user_id: member?.user_id,
      label: member?.name || member?.email || member?.user_email || member?.user_id || "Unknown user",
      search: `${member?.name || ""} ${member?.email || ""} ${member?.user_email || ""} ${member?.user_id || ""}`.trim().toLowerCase(),
    })).filter((member) => member.user_id),
    [members]
  );

  const selectedIds = useMemo(() => {
    if (Array.isArray(value)) return value.filter(Boolean);
    const raw = String(value || "").trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      return raw.split(",").map((part) => part.trim()).filter(Boolean);
    }
    return [];
  }, [value]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const available = normalizedMembers.filter((member) => !selectedSet.has(member.user_id));
    if (!normalizedSearch) return available.slice(0, 25);
    return available.filter((member) => member.search.includes(normalizedSearch)).slice(0, 25);
  }, [normalizedMembers, normalizedSearch, selectedSet]);

  useEffect(() => {
    function handleOutside(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpened(false);
      }
    }
    if (!opened) return undefined;
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [opened]);

  const selectedMembers = useMemo(
    () => selectedIds.map((id) => normalizedMembers.find((member) => member.user_id === id) || { user_id: id, label: id }),
    [normalizedMembers, selectedIds]
  );

  function writeIds(nextIds) {
    onChange(JSON.stringify(nextIds, null, 2));
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="input input-bordered w-full min-h-[3rem] h-auto pr-2 flex flex-wrap gap-1 items-center"
        onClick={() => setOpened(true)}
      >
        {selectedMembers.map((member) => (
          <span key={member.user_id} className="badge badge-outline gap-1">
            {member.label}
            <button
              type="button"
              className="opacity-70 hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                writeIds(selectedIds.filter((id) => id !== member.user_id));
              }}
              aria-label={`Remove ${member.label}`}
              title={`Remove ${member.label}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[7rem] bg-transparent outline-none"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpened(true);
          }}
          onFocus={() => setOpened(true)}
          placeholder={selectedMembers.length > 0 ? "Add another user..." : (placeholder || "Search workspace users...")}
        />
      </div>
      {opened && (
        <div className="absolute z-30 mt-1 w-full rounded-box border border-base-300 bg-base-100 shadow">
          <ul className="menu menu-compact menu-vertical w-full max-h-60 overflow-y-auto">
            {filtered.length === 0 && <li className="menu-title"><span>No matches</span></li>}
            {filtered.map((member) => (
              <li key={member.user_id}>
                <button
                  type="button"
                  onClick={() => {
                    writeIds([...selectedIds, member.user_id]);
                    setSearch("");
                    setOpened(true);
                  }}
                >
                  {member.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AutomationEditorPage({ user }) {
  const { automationId } = useParams();
  const navigate = useNavigate();
  const { isSuperadmin } = useAccessContext();
  const { pushToast } = useToast();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const lastFocusedFieldRef = useRef(null);

  const [item, setItem] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState({ kind: "event", event_types: [], filters: [], every_minutes: 60 });
  const [triggerExprText, setTriggerExprText] = useState("");
  const [steps, setSteps] = useState([]);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [selectedStepPath, setSelectedStepPath] = useState([0]);
  const [stepModalOpen, setStepModalOpen] = useState(false);
  const [webhookTestOpen, setWebhookTestOpen] = useState(false);
  const [webhookTestSaving, setWebhookTestSaving] = useState(false);
  const [webhookTestError, setWebhookTestError] = useState("");
  const [webhookTestPayloadText, setWebhookTestPayloadText] = useState("{\n  \n}");
  const [webhookTestHeadersText, setWebhookTestHeadersText] = useState("{\n  \n}");
  const [webhookTestConnectionId, setWebhookTestConnectionId] = useState("");
  const [webhookTestEventKey, setWebhookTestEventKey] = useState("");
  const [webhookTestProviderEventId, setWebhookTestProviderEventId] = useState("");
  const [openStepKeys, setOpenStepKeys] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [meta, setMeta] = useState({
    event_types: [],
    event_catalog: [],
    system_actions: [],
    module_actions: [],
    entities: [],
    members: [],
    connections: [],
    email_templates: [],
    doc_templates: [],
  });
  const EMAIL_CONNECTION_TYPES = new Set(["smtp", "postmark"]);

  const loadMeta = useCallback(async () => {
    setError("");
    try {
      const metaRes = await apiFetch("/automations/meta");
      setMeta(metaRes || {});
    } catch (err) {
      setError(err?.message || "Failed to load automation metadata");
    }
  }, []);

  const loadRecord = useCallback(async (id) => {
    setError("");
    try {
      const res = await apiFetch(`/automations/${id}`);
      const automation = res?.automation;
      if (!automation) {
        setError("Failed to load automation");
        return null;
      }
      setItem(automation);
      setName(automation?.name || "");
      setDescription(automation?.description || "");
      setTrigger(automation?.trigger || { kind: "event", event_types: [], filters: [], every_minutes: 60 });
      setTriggerExprText(automation?.trigger?.expr ? JSON.stringify(automation.trigger.expr, null, 2) : "");
      setSteps(automation?.steps || []);
      setSelectedStepIndex(0);
      setSelectedStepPath([0]);
      return automation;
    } catch (err) {
      setError(err?.message || "Failed to load automation");
      return null;
    }
  }, []);

  const save = useCallback(async () => {
    if (!automationId) return;
    setSaving(true);
    setError("");
    try {
      let nextTrigger = trigger;
      if (trigger?.kind === "event") {
        const rawExpr = triggerExprText.trim();
        if (rawExpr) {
          let parsedExpr;
          try {
            parsedExpr = JSON.parse(rawExpr);
          } catch {
            throw new Error("Trigger condition JSON is invalid");
          }
          nextTrigger = { ...(trigger || {}), expr: parsedExpr };
        } else if (trigger?.expr) {
          nextTrigger = { ...(trigger || {}) };
          delete nextTrigger.expr;
        }
      } else {
        nextTrigger = { ...(trigger || {}) };
        delete nextTrigger.expr;
      }
      const res = await apiFetch(`/automations/${automationId}`, {
        method: "PUT",
        body: { name, description, trigger: nextTrigger, steps },
      });
      setItem(res?.automation || null);
    } catch (err) {
      setError(err?.message || "Failed to save automation");
    }
    setSaving(false);
  }, [automationId, name, description, trigger, triggerExprText, steps]);

  const loadRuns = useCallback(async () => {
    if (!automationId) return;
    setRunsLoading(true);
    try {
      const res = await apiFetch(`/automations/${automationId}/runs`);
      setRuns(res?.runs || []);
    } catch (err) {
      setRuns([]);
    }
    setRunsLoading(false);
  }, [automationId]);

  const publish = useCallback(async () => {
    if (!automationId) return;
    try {
      const res = await apiFetch(`/automations/${automationId}/publish`, { method: "POST" });
      setItem(res?.automation || null);
    } catch (err) {
      setError(err?.message || "Failed to publish");
    }
  }, [automationId]);

  async function disable() {
    try {
      const res = await apiFetch(`/automations/${automationId}/disable`, { method: "POST" });
      setItem(res?.automation || null);
    } catch (err) {
      setError(err?.message || "Failed to disable");
    }
  }

  async function exportAutomation() {
    try {
      const res = await apiFetch(`/automations/${automationId}/export`);
      const payload = res?.automation || {};
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      pushToast("success", "Automation JSON copied");
    } catch (err) {
      setError(err?.message || "Failed to export");
    }
  }

  async function copyReferenceValue(value) {
    try {
      await navigator.clipboard.writeText(value);
      pushToast("success", "Reference copied");
    } catch {
      pushToast("error", "Copy failed");
    }
  }

  function isInsertableField(target) {
    if (!target || target.readOnly || target.disabled) return false;
    const tagName = String(target.tagName || "").toLowerCase();
    if (tagName === "textarea") return true;
    if (tagName !== "input") return false;
    const type = String(target.type || "text").toLowerCase();
    return ["", "text", "search", "email", "url", "tel"].includes(type);
  }

  function rememberFocusedField(event) {
    const target = event?.target;
    if (isInsertableField(target)) {
      lastFocusedFieldRef.current = target;
    }
  }

  function insertReferenceValue(value) {
    const field = lastFocusedFieldRef.current;
    if (!isInsertableField(field)) {
      pushToast("error", "Click into a text field first");
      return;
    }
    const currentValue = String(field.value ?? "");
    const start = typeof field.selectionStart === "number" ? field.selectionStart : currentValue.length;
    const end = typeof field.selectionEnd === "number" ? field.selectionEnd : currentValue.length;
    const nextValue = `${currentValue.slice(0, start)}${value}${currentValue.slice(end)}`;
    field.focus();
    field.value = nextValue;
    field.setSelectionRange?.(start + value.length, start + value.length);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    pushToast("success", "Reference inserted");
  }

  async function deleteAutomation() {
    const ok = window.confirm("Delete this automation? This cannot be undone.");
    if (!ok) return;
    try {
      await apiFetch(`/automations/${automationId}`, { method: "DELETE" });
      navigate("/automations");
    } catch (err) {
      setError(err?.message || "Failed to delete");
    }
  }

  function updateTriggerEvent(eventType) {
    const next = { ...(trigger || {}), kind: "event", event_types: eventType ? [eventType] : [] };
    setTrigger(next);
  }

  function setTriggerMode(mode) {
    if (mode === "schedule") {
      updateTriggerKind("schedule");
      return;
    }
    if (mode === "webhook") {
      setTrigger((prev) => {
        const next = {
          ...(prev || {}),
          kind: "event",
          event_types: ["integration.webhook.received"],
          filters: Array.isArray(prev?.filters) ? prev.filters : [],
        };
        delete next.expr;
        return next;
      });
      return;
    }
    updateTriggerKind("event");
  }

  function updateTriggerKind(kind) {
    setTrigger((prev) => {
      const next = { ...(prev || {}) };
      if (kind === "schedule") {
        next.kind = "schedule";
        delete next.expr;
        next.event_types = [];
        next.filters = [];
        next.every_minutes = Number(next.every_minutes) > 0 ? Number(next.every_minutes) : 60;
      } else {
        next.kind = "event";
        next.event_types = Array.isArray(next.event_types) ? next.event_types : [];
        next.filters = Array.isArray(next.filters) ? next.filters : [];
      }
      return next;
    });
  }

  function updateTriggerFilter(index, patch) {
    setTrigger((prev) => {
      const filters = Array.isArray(prev?.filters) ? prev.filters : [];
      return {
        ...(prev || {}),
        filters: filters.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
      };
    });
  }

  function addTriggerFilter() {
    setTrigger((prev) => ({
      ...(prev || {}),
      filters: [
        ...(Array.isArray(prev?.filters) ? prev.filters : []),
        { path: "", op: "eq", value: "" },
      ],
    }));
  }

  function removeTriggerFilter(index) {
    setTrigger((prev) => ({
      ...(prev || {}),
      filters: (Array.isArray(prev?.filters) ? prev.filters : []).filter((_, idx) => idx !== index),
    }));
  }

  function normalizeStepPath(pathOrIndex) {
    if (Array.isArray(pathOrIndex)) return pathOrIndex;
    if (typeof pathOrIndex === "number") return [pathOrIndex];
    return [];
  }

  function getStepAtPath(path, sourceSteps = steps) {
    const normalized = normalizeStepPath(path);
    let currentList = sourceSteps;
    let currentStep = null;
    let pointer = 0;
    while (pointer < normalized.length) {
      const idx = normalized[pointer];
      if (!Array.isArray(currentList) || typeof idx !== "number" || idx < 0 || idx >= currentList.length) return null;
      currentStep = currentList[idx];
      pointer += 1;
      if (pointer >= normalized.length) return currentStep;
      const branchKey = normalized[pointer];
      if (!["then_steps", "else_steps", "steps"].includes(branchKey)) return null;
      currentList = Array.isArray(currentStep?.[branchKey]) ? currentStep[branchKey] : [];
      pointer += 1;
    }
    return currentStep;
  }

  function updateStepAtPath(sourceSteps, path, updater) {
    const normalized = normalizeStepPath(path);
    if (!normalized.length) return sourceSteps;
    const [head, ...rest] = normalized;
    if (typeof head !== "number" || head < 0 || head >= sourceSteps.length) return sourceSteps;
    return sourceSteps.map((step, idx) => {
      if (idx !== head) return step;
      if (rest.length === 0) {
        return updater(step);
      }
      const [branchKey, ...tail] = rest;
      if (!["then_steps", "else_steps", "steps"].includes(branchKey)) return step;
      const branchItems = Array.isArray(step?.[branchKey]) ? step[branchKey] : [];
      return {
        ...step,
        [branchKey]: updateStepAtPath(branchItems, tail, updater),
      };
    });
  }

  function removeStepAtPath(sourceSteps, path) {
    const normalized = normalizeStepPath(path);
    if (!normalized.length) return sourceSteps;
    if (normalized.length === 1) {
      const [head] = normalized;
      return sourceSteps.filter((_, idx) => idx !== head);
    }
    const [head, branchKey, ...tail] = normalized;
    return sourceSteps.map((step, idx) => {
      if (idx !== head) return step;
      const branchItems = Array.isArray(step?.[branchKey]) ? step[branchKey] : [];
      return {
        ...step,
        [branchKey]: removeStepAtPath(branchItems, tail),
      };
    });
  }

  function moveStepAtPath(sourceSteps, path, direction) {
    const normalized = normalizeStepPath(path);
    if (!normalized.length) return sourceSteps;
    if (normalized.length === 1) {
      const [head] = normalized;
      const target = head + direction;
      if (target < 0 || target >= sourceSteps.length) return sourceSteps;
      const next = [...sourceSteps];
      const [itemToMove] = next.splice(head, 1);
      next.splice(target, 0, itemToMove);
      return next;
    }
    const [head, branchKey, ...tail] = normalized;
    return sourceSteps.map((step, idx) => {
      if (idx !== head) return step;
      const branchItems = Array.isArray(step?.[branchKey]) ? step[branchKey] : [];
      return {
        ...step,
        [branchKey]: moveStepAtPath(branchItems, tail, direction),
      };
    });
  }

  function insertStepIntoBranch(sourceSteps, containerPath, branchKey, nextStep) {
    const normalized = normalizeStepPath(containerPath);
    if (!normalized.length) return [...sourceSteps, nextStep];
    return updateStepAtPath(sourceSteps, normalized, (step) => ({
      ...step,
      [branchKey]: [...(Array.isArray(step?.[branchKey]) ? step[branchKey] : []), nextStep],
    }));
  }

  function insertStepAtListPath(sourceSteps, listPath, insertIndex, nextStep) {
    const normalized = normalizeStepPath(listPath);
    if (!normalized.length) {
      const next = [...sourceSteps];
      next.splice(insertIndex, 0, nextStep);
      return next;
    }
    const parentPath = normalized.slice(0, -1);
    const branchKey = normalized[normalized.length - 1];
    if (!["then_steps", "else_steps", "steps"].includes(branchKey)) return sourceSteps;
    return updateStepAtPath(sourceSteps, parentPath, (step) => {
      const branchItems = Array.isArray(step?.[branchKey]) ? [...step[branchKey]] : [];
      branchItems.splice(insertIndex, 0, nextStep);
      return {
        ...step,
        [branchKey]: branchItems,
      };
    });
  }

  function updateStep(index, patch) {
    const stepPath = normalizeStepPath(index);
    setSteps((prev) => updateStepAtPath(prev, stepPath, (step) => ({ ...step, ...patch })));
  }

  function updateStepInput(index, key, value) {
    const stepPath = normalizeStepPath(index);
    setSteps((prev) =>
      updateStepAtPath(prev, stepPath, (step) => {
        const nextInputs = { ...(step.inputs || {}) };
        if (value === "" || value === null || value === undefined) {
          delete nextInputs[key];
        } else {
          nextInputs[key] = value;
        }
        return { ...step, inputs: nextInputs };
      })
    );
  }

  function addStep() {
    const newStepId = `step_${steps.length + 1}`;
    setSteps((prev) => [
      ...prev,
      { id: newStepId, kind: "action", action_id: "system.notify", inputs: { title: "Automation", body: "" } },
    ]);
    setSelectedStepIndex(steps.length);
    setSelectedStepPath([steps.length]);
    setStepModalOpen(true);
    setOpenStepKeys((prev) => Array.from(new Set([...prev, newStepId])));
  }

  function insertStepAfter(listPath, afterIndex) {
    const newStepId = `step_${Date.now()}`;
    const nextStep = { id: newStepId, kind: "action", action_id: "system.notify", inputs: { title: "Automation", body: "" } };
    const insertIndex = afterIndex + 1;
    setSteps((prev) => insertStepAtListPath(prev, listPath, insertIndex, nextStep));
    const nextPath = [...normalizeStepPath(listPath), insertIndex];
    setSelectedStepPath(nextPath);
    setSelectedStepIndex(insertIndex);
    setStepModalOpen(true);
  }

  function addNestedStep(containerPath, branchKey) {
    const newStepId = `step_${Date.now()}`;
    const nextStep = { id: newStepId, kind: "action", action_id: "system.notify", inputs: { title: "Automation", body: "" } };
    setSteps((prev) => insertStepIntoBranch(prev, containerPath, branchKey, nextStep));
    const nextPath = [...normalizeStepPath(containerPath), branchKey];
    const container = getStepAtPath(containerPath);
    const branchItems = Array.isArray(container?.[branchKey]) ? container[branchKey] : [];
    nextPath.push(branchItems.length);
    setSelectedStepPath(nextPath);
    setStepModalOpen(true);
  }

  function removeStep(index) {
    const stepPath = normalizeStepPath(index);
    setSteps((prev) => {
      const target = getStepAtPath(stepPath, prev);
      const stepKey = target?.id || String(stepPath.join("."));
      setOpenStepKeys((openPrev) => openPrev.filter((k) => k !== stepKey));
      setSelectedStepIndex((current) => {
        if (prev.length <= 1) return 0;
        if (current > stepPath[0]) return current - 1;
        if (current === stepPath[0]) return Math.max(0, current - 1);
        return current;
      });
      setSelectedStepPath([0]);
      return removeStepAtPath(prev, stepPath);
    });
  }

  function moveStep(index, direction) {
    const stepPath = normalizeStepPath(index);
    setSteps((prev) => moveStepAtPath(prev, stepPath, direction));
    if (stepPath.length) {
      const nextPath = [...stepPath];
      nextPath[nextPath.length - 1] = Number(nextPath[nextPath.length - 1]) + direction;
      setSelectedStepPath(nextPath);
    }
  }

  function toggleStep(stepKey) {
    setOpenStepKeys((prev) => (prev.includes(stepKey) ? prev.filter((k) => k !== stepKey) : [...prev, stepKey]));
  }

  function delayUnitToSeconds(unit) {
    if (unit === "minutes") return 60;
    if (unit === "hours") return 3600;
    if (unit === "days") return 86400;
    return 1;
  }

  const actionOptions = useMemo(() => {
    const groups = [];
    if (Array.isArray(meta.system_actions)) {
      groups.push({ label: "System actions", options: meta.system_actions });
    }
    if (Array.isArray(meta.module_actions)) {
      for (const mod of meta.module_actions) {
        groups.push({ label: mod.module_name || mod.module_id, module_id: mod.module_id, options: mod.actions || [] });
      }
    }
    return groups;
  }, [meta]);

  const triggerOptions = useMemo(() => {
    const catalog = Array.isArray(meta.event_catalog) ? meta.event_catalog : [];
    if (catalog.length === 0) {
      return [{ label: "Events", options: meta.event_types || [] }];
    }
    const grouped = new Map();
    for (const evt of catalog) {
      const label = evt.source_module_name || evt.source_module_id || "Events";
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(evt);
    }
    return Array.from(grouped.entries()).map(([label, options]) => ({ label, options }));
  }, [meta]);

  const selectedTriggerEventId = (trigger?.event_types || [])[0] || "";
  const triggerMode = useMemo(() => {
    if (trigger?.kind === "schedule") return "schedule";
    if (
      selectedTriggerEventId === "integration.webhook.received" ||
      selectedTriggerEventId.startsWith("integration.webhook.")
    ) {
      return "webhook";
    }
    return "event";
  }, [trigger?.kind, selectedTriggerEventId]);
  const triggerEventMeta = useMemo(() => {
    const catalog = Array.isArray(meta.event_catalog) ? meta.event_catalog : [];
    return catalog.find((evt) => evt?.id === selectedTriggerEventId) || null;
  }, [meta.event_catalog, selectedTriggerEventId]);
  const defaultConditionEntityId = triggerEventMeta?.entity_id || "";

  const entityOptions = useMemo(() => {
    if (!Array.isArray(meta.entities)) return [];
    return meta.entities.slice().sort((a, b) => (a.label || a.id || "").localeCompare(b.label || b.id || ""));
  }, [meta.entities]);

  const entityById = useMemo(() => {
    const map = new Map();
    for (const ent of entityOptions) {
      if (ent?.id) map.set(ent.id, ent);
    }
    return map;
  }, [entityOptions]);

  const triggerFieldOptions = useMemo(() => {
    const fields = [];
    const add = (value, label) => fields.push({ value, label });
    add("entity_id", "Entity");
    add("record_id", "Record ID");
    add("user_id", "User ID");
    add("timestamp", "Timestamp");
    add("changed_fields", "Changed fields");
    add("from", "From status/value");
    add("to", "To status/value");
    add("record_id", "Record ID");
    if (triggerMode === "webhook") {
      add("connection_id", "Webhook: Connection ID");
      add("webhook_id", "Webhook: Webhook ID");
      add("provider_event_id", "Webhook: Provider Event ID");
      add("event_key", "Webhook: Event Key");
      add("signature_valid", "Webhook: Signature Valid");
      add("payload", "Webhook: Payload object");
      add("payload.customer.email", "Webhook: Payload field example");
      add("headers", "Webhook: Headers object");
      add("headers.x-request-id", "Webhook: Header example");
    }
    if (defaultConditionEntityId) {
      const entity = entityById.get(defaultConditionEntityId);
      const entityFields = Array.isArray(entity?.fields) ? entity.fields : [];
      entityFields.forEach((field) => {
        const shortId = typeof field?.id === "string" ? field.id.split(".").pop() : "";
        const label = field?.label || field?.id;
        if (shortId) {
          add(`record.fields.${shortId}`, `Record: ${label}`);
          add(`before.fields.${shortId}`, `Before: ${label}`);
          add(`after.fields.${shortId}`, `After: ${label}`);
        }
      });
    }
    return fields;
  }, [defaultConditionEntityId, entityById, triggerMode]);

  const automationVariableSections = useMemo(() => {
    const triggerItems = triggerMode === "webhook"
      ? [
          { path: "trigger.connection_id", description: "The integration connection that received the webhook." },
          { path: "trigger.event_key", description: "The webhook event key, such as invoice.created." },
          { path: "trigger.provider_event_id", description: "The provider's event identifier if one was supplied." },
          { path: "trigger.signature_valid", description: "Whether the inbound webhook signature passed verification." },
          { path: "trigger.payload", description: "The full webhook payload object." },
          { path: "trigger.payload.customer.email", description: "Example nested payload path you can adapt to your provider." },
          { path: "trigger.headers", description: "The inbound webhook headers object." },
          { path: "trigger.headers.x-request-id", description: "Example header path you can adapt to your provider." },
        ]
      : trigger?.kind === "schedule"
        ? [
            { path: "trigger.event", description: "The scheduled event name for this automation run." },
            { path: "trigger.scheduled_for", description: "The scheduled execution time for this run." },
            { path: "trigger.slot_key", description: "The scheduler slot key used for idempotency." },
          ]
        : [
            { path: "trigger.event", description: "The event that started this automation." },
            { path: "trigger.entity_id", description: "The entity tied to the trigger event." },
            { path: "trigger.record_id", description: "The record ID tied to the trigger event." },
            { path: "trigger.user_id", description: "The user involved in the triggering event, when available." },
            { path: "trigger.changed_fields", description: "The fields that changed for update-style events." },
            { path: "trigger.before", description: "The previous values snapshot, when the event includes one." },
            { path: "trigger.after", description: "The new values snapshot, when the event includes one." },
          ];

    return [
      {
        title: "Trigger data",
        description:
          triggerMode === "webhook"
            ? "These values come from the inbound webhook that started the automation."
            : trigger?.kind === "schedule"
              ? "These values come from the scheduler that queued this automation."
              : "These values come from the event that started this automation.",
        items: triggerItems,
      },
      {
        title: "Earlier step outputs",
        description: "Use these to reuse values returned by earlier steps in the same flow.",
        items: [
          { path: "last", description: "The most recent step output." },
          { path: "steps.query_records.records", description: "Example path for a named step output." },
          { path: "vars.query_results", description: "Example path for a step saved with Store output as." },
        ],
      },
      {
        title: "Loop data",
        description: "These are available inside repeat steps only.",
        items: [
          { path: "item", description: "The current item in the loop." },
          { path: "loop.index", description: "The zero-based index of the current loop item." },
          { path: "loop.count", description: "The number of items being repeated over." },
        ],
      },
    ];
  }, [trigger?.kind, triggerMode]);

  function parseJsonObjectInput(value) {
    if (typeof value === "string") {
      const raw = value.trim();
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function stringifyJsonObjectInput(value) {
    return JSON.stringify(parseJsonObjectInput(value), null, 2);
  }

  function formatEditableValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  }

  function parseEditableValue(raw) {
    const text = String(raw ?? "");
    const trimmed = text.trim();
    if (!trimmed) return "";
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return text;
      }
    }
    return text;
  }

  function objectEntriesForEditor(value) {
    const parsed = parseJsonObjectInput(value);
    return Object.entries(parsed).map(([fieldId, fieldValue]) => ({
      fieldId,
      value: formatEditableValue(fieldValue),
    }));
  }

  function writeObjectEntries(index, inputKey, rows) {
    const nextObject = {};
    for (const row of rows) {
      const fieldId = String(row?.fieldId || "").trim();
      if (!fieldId) continue;
      nextObject[fieldId] = parseEditableValue(row?.value ?? "");
    }
    updateStepInput(index, inputKey, JSON.stringify(nextObject, null, 2));
  }

  function parseFilterRows(value) {
    let expr = value;
    if (typeof expr === "string") {
      const raw = expr.trim();
      if (!raw) return [];
      try {
        expr = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    if (!expr || typeof expr !== "object" || Array.isArray(expr)) return [];
    const toRow = (cond) => {
      if (!cond || typeof cond !== "object") return null;
      const op = cond.op || "eq";
      const leftVar = cond?.left?.var;
      if (typeof leftVar !== "string" || !leftVar) return null;
      if (op === "exists" || op === "not_exists") {
        return { path: leftVar, op, value: "" };
      }
      if (!("right" in cond)) return null;
      const literal = cond?.right?.literal;
      return { path: leftVar, op, value: Array.isArray(literal) ? literal.join(", ") : formatEditableValue(literal) };
    };
    if (expr.op === "and" && Array.isArray(expr.children)) {
      const rows = expr.children.map(toRow).filter(Boolean);
      return rows;
    }
    const single = toRow(expr);
    return single ? [single] : [];
  }

  function buildFilterExprFromRows(rows) {
    const nextRows = rows
      .map((row) => ({
        path: String(row?.path || "").trim(),
        op: String(row?.op || "eq").trim() || "eq",
        value: row?.value ?? "",
      }))
      .filter((row) => row.path);
    if (!nextRows.length) return "";
    const conditions = nextRows.map((row) => {
      if (row.op === "exists" || row.op === "not_exists") {
        return { op: row.op, left: { var: row.path } };
      }
      const value = row.op === "in" || row.op === "not_in"
        ? String(row.value || "").split(",").map((part) => part.trim()).filter(Boolean).map(parseEditableValue)
        : parseEditableValue(row.value);
      return {
        op: row.op,
        left: { var: row.path },
        right: { literal: value },
      };
    });
    return JSON.stringify(
      conditions.length === 1 ? conditions[0] : { op: "and", children: conditions },
      null,
      2
    );
  }

  function normalizeFieldOptions(options) {
    if (!Array.isArray(options)) return [];
    return options
      .map((option) => {
        if (typeof option === "string") return { value: option, label: option };
        if (option && typeof option === "object") {
          const value = option.value ?? option.id ?? option.key;
          const label = option.label ?? option.value ?? option.id ?? option.key;
          return value ? { value, label } : null;
        }
        return null;
      })
      .filter(Boolean);
  }

  function getFieldShortId(fieldId) {
    if (typeof fieldId !== "string" || !fieldId) return "";
    return fieldId.split(".").pop() || fieldId;
  }

  function findEntityField(fields, fieldRef) {
    if (!Array.isArray(fields) || typeof fieldRef !== "string" || !fieldRef) return null;
    const normalized = fieldRef.replace(/^record\./, "");
    const shortId = getFieldShortId(normalized);
    return (
      fields.find((field) => field?.id === normalized)
      || fields.find((field) => getFieldShortId(field?.id) === shortId)
      || null
    );
  }

  function shouldUseTextInput(rawValue) {
    const value = String(rawValue ?? "");
    return value.includes("{{") || value.includes("}}");
  }

  function renderTypedValueEditor({ fieldDef, value, onChange, placeholder = "" }) {
    const rawValue = String(value ?? "");
    const fieldType = String(fieldDef?.type || "string").toLowerCase();
    const dynamicText = shouldUseTextInput(rawValue);
    const enumOptions = normalizeFieldOptions(fieldDef?.options);

    if (fieldType === "enum" && !dynamicText) {
      return (
        <select className="select select-bordered" value={rawValue} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select value…</option>
          {enumOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if ((fieldType === "bool" || fieldType === "boolean") && !dynamicText) {
      return (
        <select className="select select-bordered" value={rawValue} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select value…</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }

    if (fieldType === "user" && !dynamicText) {
      return (
        <select className="select select-bordered" value={rawValue} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select user…</option>
          {memberOptions.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.name || member.email || member.user_email || member.user_id}
            </option>
          ))}
        </select>
      );
    }

    if (fieldType === "users" && !dynamicText) {
      return (
        <AutomationUsersValueInput
          members={memberOptions}
          value={rawValue}
          onChange={onChange}
          placeholder={placeholder || "Search workspace users..."}
        />
      );
    }

    if (fieldType === "lookup" && !dynamicText && fieldDef?.entity) {
      return (
        <AutomationLookupValueInput
          fieldDef={fieldDef}
          value={rawValue}
          onChange={onChange}
          placeholder={placeholder || "Search records..."}
        />
      );
    }

    if (fieldType === "date" && !dynamicText) {
      return <input className="input input-bordered" type="date" value={rawValue} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
    }

    if (fieldType === "datetime" && !dynamicText) {
      return <input className="input input-bordered" type="datetime-local" value={rawValue} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
    }

    if (fieldType === "number" && !dynamicText) {
      return <input className="input input-bordered" type="number" value={rawValue} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
    }

    if (fieldType === "enum" && dynamicText) {
      const datalistId = `automation-enum-options-${String(fieldDef?.id || "field").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      return (
        <>
          <input className="input input-bordered" list={datalistId} value={rawValue} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || "{{trigger.value}}"} />
          <datalist id={datalistId}>
            {enumOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </datalist>
        </>
      );
    }

    return <input className="input input-bordered" value={rawValue} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
  }

  const memberOptions = useMemo(() => {
    if (!Array.isArray(meta.members)) return [];
    return meta.members
      .slice()
      .sort((a, b) =>
        (a.name || a.email || a.user_email || a.user_id || "").localeCompare(
          b.name || b.email || b.user_email || b.user_id || ""
        )
      );
  }, [meta.members]);

  const memberById = useMemo(() => {
    const map = new Map();
    for (const member of memberOptions) {
      if (member?.user_id) map.set(member.user_id, member);
    }
    return map;
  }, [memberOptions]);

  const connectionOptions = useMemo(() => {
    if (!Array.isArray(meta.connections)) return [];
    return meta.connections.slice().sort((a, b) => (a.name || a.id || "").localeCompare(b.name || b.id || ""));
  }, [meta.connections]);

  const emailConnectionOptions = useMemo(
    () => connectionOptions.filter((conn) => EMAIL_CONNECTION_TYPES.has(String(conn?.type || "").trim().toLowerCase())),
    [connectionOptions]
  );

  const integrationConnectionOptions = useMemo(
    () => connectionOptions.filter((conn) => !EMAIL_CONNECTION_TYPES.has(String(conn?.type || "").trim().toLowerCase())),
    [connectionOptions]
  );

  const webhookConnectionOptions = useMemo(
    () => integrationConnectionOptions,
    [integrationConnectionOptions]
  );

  const webhookTriggerConnectionId = useMemo(() => {
    const filters = Array.isArray(trigger?.filters) ? trigger.filters : [];
    const match = filters.find((item) => item?.path === "connection_id" && item?.op === "eq");
    return typeof match?.value === "string" ? match.value : "";
  }, [trigger?.filters]);

  const webhookTriggerEventKey = useMemo(() => {
    const filters = Array.isArray(trigger?.filters) ? trigger.filters : [];
    const match = filters.find((item) => item?.path === "event_key" && item?.op === "eq");
    return typeof match?.value === "string" ? match.value : "";
  }, [trigger?.filters]);

  function upsertTriggerFilter(path, value, op = "eq") {
    setTrigger((prev) => {
      const filters = Array.isArray(prev?.filters) ? [...prev.filters] : [];
      const nextFilters = filters.filter((item) => item?.path !== path);
      const normalized = typeof value === "string" ? value.trim() : value;
      if (normalized !== "" && normalized !== null && normalized !== undefined) {
        nextFilters.push({ path, op, value: normalized });
      }
      return {
        ...(prev || {}),
        filters: nextFilters,
      };
    });
  }

  const emailTemplateOptions = useMemo(() => {
    if (!Array.isArray(meta.email_templates)) return [];
    return meta.email_templates.slice().sort((a, b) => (a.name || a.id || "").localeCompare(b.name || b.id || ""));
  }, [meta.email_templates]);

  const docTemplateOptions = useMemo(() => {
    if (!Array.isArray(meta.doc_templates)) return [];
    return meta.doc_templates.slice().sort((a, b) => (a.name || a.id || "").localeCompare(b.name || b.id || ""));
  }, [meta.doc_templates]);

  useEffect(() => {
    if (!automationId) return;
    loadMeta();
  }, [automationId, loadMeta]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    setSelectedStepIndex((current) => {
      if (!steps.length) return 0;
      return Math.min(current, steps.length - 1);
    });
  }, [steps.length]);

  useEffect(() => {
    if (!steps.length) {
      setSelectedStepPath([]);
      setStepModalOpen(false);
      return;
    }
    if (!getStepAtPath(selectedStepPath, steps)) {
      setSelectedStepPath([0]);
    }
  }, [steps, selectedStepPath]);

  useEffect(() => {
    if (triggerMode !== "webhook") {
      setWebhookTestOpen(false);
      return;
    }
    setWebhookTestConnectionId(webhookTriggerConnectionId || "");
    setWebhookTestEventKey(webhookTriggerEventKey || "");
  }, [triggerMode, webhookTriggerConnectionId, webhookTriggerEventKey]);

  const validationErrors = useMemo(() => {
    const errs = [];
    if (!name.trim()) errs.push("Name is required.");
    if (trigger?.kind === "schedule") {
      if (!(Number(trigger?.every_minutes) > 0)) errs.push("Schedule interval must be greater than 0 minutes.");
    } else if (!trigger?.event_types || trigger.event_types.length === 0) {
      errs.push("Trigger event is required.");
    }
    if (!steps || steps.length === 0) errs.push("At least one step is required.");
    return errs;
  }, [name, trigger, steps]);

  const triggerSummaryText = useMemo(() => {
    if (trigger?.kind === "schedule") {
      const everyMinutes = Number(trigger?.every_minutes) > 0 ? Number(trigger.every_minutes) : null;
      return everyMinutes ? `Every ${everyMinutes} minute${everyMinutes === 1 ? "" : "s"}` : "Scheduled";
    }
    if (triggerMode === "webhook") {
      const connectionName =
        webhookConnectionOptions.find((conn) => conn.id === webhookTriggerConnectionId)?.name || webhookTriggerConnectionId || "any connection";
      const eventKey = webhookTriggerEventKey || "any webhook event";
      return `${connectionName} • ${eventKey}`;
    }
    return triggerOptions.flatMap((group) => group.options || []).find((evt) => (typeof evt === "string" ? evt : evt.id) === selectedTriggerEventId)?.label || selectedTriggerEventId || "Select event";
  }, [trigger, triggerMode, triggerOptions, selectedTriggerEventId, webhookConnectionOptions, webhookTriggerConnectionId, webhookTriggerEventKey]);

  const bubbleBase = "chat-bubble text-sm leading-5 max-w-[85%]";
  const userLabel = user?.email || "User";

  const renderLeftPane = useCallback(() => (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      {isSuperadmin ? (
        <>
          <div className="flex-1 min-h-0 overflow-auto space-y-4">
            {chatMessages.length === 0 && (
              <div className="chat chat-start">
                <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">assistant</div>
                <div className={`${bubbleBase} bg-base-200 text-base-content`}>
                  Describe the automation change you want and I will draft an update.
                </div>
              </div>
            )}
            {chatMessages.map((m, idx) => (
              <div key={`${m.role}-${idx}`} className={`chat ${m.role === "user" ? "chat-end" : "chat-start"}`}>
                <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">
                  {m.role === "user" ? userLabel : m.role}
                </div>
                <div className={`${bubbleBase} ${m.role === "user" ? "bg-primary text-primary-content" : "bg-base-200 text-base-content"}`}>
                  <div className="whitespace-pre-wrap text-sm">{m.text}</div>
                </div>
              </div>
            ))}
            {chatLoading && <div className="text-xs opacity-60">Agent is thinking…</div>}
          </div>
          <div className="shrink-0">
            <AgentChatInput
              value={chatInput}
              onChange={setChatInput}
              onSend={() => {
                const text = chatInput.trim();
                if (!text || chatLoading) return;
                setChatMessages((prev) => [...prev, { role: "user", text }]);
                setChatInput("");
                setChatLoading(true);
                setTimeout(() => {
                  setChatMessages((prev) => [...prev, { role: "assistant", text: "Agent wiring coming soon." }]);
                  setChatLoading(false);
                }, 500);
              }}
              disabled={chatLoading}
              minRows={1}
            />
          </div>
        </>
      ) : (
        <div className="alert alert-info text-sm">Automation AI is currently disabled for non-superadmins.</div>
      )}
    </div>
  ), [bubbleBase, chatInput, chatLoading, chatMessages, isSuperadmin, userLabel]);

  const renderValidationPanel = useCallback(() => (
    <ValidationPanel
      title="Validation"
      errors={validationErrors}
      warnings={[]}
      idleMessage="Validation runs automatically while you edit."
      showSuccess={true}
      showFix={isSuperadmin}
      fixDisabled
    />
  ), [isSuperadmin, validationErrors]);

  const selectedStep = getStepAtPath(selectedStepPath, steps);

  const actionLabelByValue = useMemo(() => {
    const map = new Map();
    for (const group of actionOptions) {
      for (const action of group.options || []) {
        const value = group.module_id ? `${group.module_id}::${action.id}` : action.id;
        map.set(value, action.label || action.display_id || action.id);
        if (!group.module_id) {
          map.set(action.id, action.label || action.display_id || action.id);
        }
      }
    }
    return map;
  }, [actionOptions]);

  function stepSummaryText(step) {
    if (!step) return "Select a step";
    if (step.kind === "condition") return "Condition";
    if (step.kind === "delay") return step.target_time ? "Wait until time" : "Wait for a period";
    const actionValue = step.module_id ? `${step.module_id}::${step.action_id}` : step.action_id || "";
    const actionLabel = actionLabelByValue.get(actionValue) || step.action_id || "action";
    if (step.kind === "foreach") return `Repeat ${actionLabel} over a list`;
    return actionLabel || "Select action";
  }

  function stepHelpText(step) {
    if (!step) return "Select a step from the flow to edit it.";
    if (step.kind === "foreach") return "Run the selected action once for each item in a list, such as query results or selected records.";
    if (step.kind === "condition") return "Only continue if this rule matches the trigger or prior-step data.";
    if (step.kind === "delay") return step.target_time
      ? "Pause this automation until a specific date and time."
      : "Pause this automation for a relative amount of time.";
    if (step.action_id === "system.notify") return "Send an in-app notification to one or more workspace users.";
    if (step.action_id === "system.send_email") return "Send an email using direct addresses, record fields, related records, or a template.";
    if (step.action_id === "system.generate_document") return "Generate a document from a template and attach it to a record.";
    if (step.action_id === "system.create_record") return "Create a new record in any entity using dynamic values from the trigger or earlier steps.";
    if (step.action_id === "system.update_record") return "Update an existing record by applying a patch of field changes.";
    if (step.action_id === "system.query_records") return "Find records from an entity so later steps can branch, loop, or update them.";
    if (step.action_id === "system.add_chatter") return "Post an activity note or comment onto a record.";
    if (step.action_id === "system.integration_request") return "Call a configured integration connection using its provider settings and authentication.";
    if (step.action_id === "system.integration_sync") return "Run a polling sync against a configured integration connection and optionally emit item events.";
    if (step.action_id && !step.action_id.startsWith("system.")) return "Run a module action against a target record or selection.";
    return "Configure what this step should do and what later steps can reuse.";
  }

  function stepDetailText(step) {
    if (!step) return "";
    if (step.kind === "condition") {
      const left = step?.expr?.left?.var || "a field";
      const op = step?.expr?.op || "eq";
      const right = step?.expr?.right?.literal;
      return `If ${left} ${op}${right !== undefined && right !== "" ? ` ${Array.isArray(right) ? right.join(", ") : right}` : ""}`;
    }
    if (step.kind === "delay") {
      if (step.target_time) return `Until ${step.target_time}`;
      if (step.delay_value && step.delay_unit) return `${step.delay_value} ${step.delay_unit}`;
      if (step.seconds) return `${step.seconds} seconds`;
    }
    if (step.kind === "foreach") {
      return step.over ? `Over ${typeof step.over === "string" ? step.over : "selected list"}` : "Choose a list";
    }
    if (step.action_id === "system.notify") {
      const count = Array.isArray(step.inputs?.recipient_user_ids)
        ? step.inputs.recipient_user_ids.length
        : step.inputs?.recipient_user_id ? 1 : 0;
      return count ? `To ${count} workspace user${count === 1 ? "" : "s"}` : "Choose recipients";
    }
    if (step.action_id === "system.send_email") {
      return step.inputs?.subject || (step.inputs?.template_id ? "Uses email template" : "Set recipients and message");
    }
    if (step.action_id === "system.query_records") {
      return `${step.inputs?.entity_id || "Trigger entity"}${step.inputs?.limit ? `, up to ${step.inputs.limit}` : ""}`;
    }
    if (step.action_id === "system.integration_request") {
      const connectionName = connectionOptions.find((conn) => conn.id === step.inputs?.connection_id)?.name || step.inputs?.connection_id || "Choose connection";
      const method = step.inputs?.method || "GET";
      const target = step.inputs?.path || step.inputs?.url || "/";
      return `${connectionName} • ${method} ${target}`;
    }
    if (step.action_id === "system.integration_sync") {
      const connectionName = connectionOptions.find((conn) => conn.id === step.inputs?.connection_id)?.name || step.inputs?.connection_id || "Choose connection";
      return `${connectionName} • ${step.inputs?.scope_key || step.inputs?.resource_key || "default scope"}`;
    }
    if (step.action_id === "system.create_record") {
      return step.inputs?.entity_id || "Choose target entity";
    }
    if (step.action_id === "system.update_record") {
      return step.inputs?.entity_id || "Trigger entity";
    }
    return "";
  }

  function renderStepCards(items, pathPrefix = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return <div className="text-xs opacity-50">No steps yet.</div>;
    }
    return (
      <div className="space-y-3">
        {items.map((step, index) => {
          const path = [...pathPrefix, index];
          const isSelected = JSON.stringify(path) === JSON.stringify(selectedStepPath);
          const nestedThen = Array.isArray(step?.then_steps) ? step.then_steps : [];
          const nestedElse = Array.isArray(step?.else_steps) ? step.else_steps : [];
          const nestedLoop = Array.isArray(step?.steps) ? step.steps : [];
          const canMoveUp = index > 0;
          const canMoveDown = index < items.length - 1;
          return (
            <div key={step.id || path.join(".")} className="space-y-2">
              <div className={`rounded-box border p-4 transition ${isSelected ? "border-primary bg-primary/5 shadow-sm" : "border-base-300 bg-base-100"}`}>
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setSelectedStepPath(path);
                      setSelectedStepIndex(index);
                      setStepModalOpen(true);
                    }}
                  >
                    <div className="text-xs uppercase tracking-wide opacity-60">Step {index + 1}</div>
                    <div className="font-medium truncate">{stepSummaryText(step)}</div>
                    <div className="text-xs opacity-70 mt-1">{stepDetailText(step) || stepHelpText(step)}</div>
                    {step.kind === "condition" && (
                      <div className="text-[11px] opacity-50 mt-1">This step can branch into `Then` and `Else` steps.</div>
                    )}
                  </button>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={!canMoveUp}
                        onClick={() => moveStep(path, -1)}
                        title="Move up"
                        aria-label="Move step up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={!canMoveDown}
                        onClick={() => moveStep(path, 1)}
                        title="Move down"
                        aria-label="Move step down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        onClick={() => removeStep(path)}
                        title="Remove step"
                        aria-label="Remove step"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="badge badge-outline">{step.kind}</span>
                      {step.store_as ? <span className="text-[10px] opacity-60">var: {step.store_as}</span> : null}
                    </div>
                  </div>
                </div>
              </div>

              {step.kind === "condition" && (
                <div className="ml-5 space-y-3 border-l border-base-300 pl-4">
                  {nestedThen.length > 0 ? (
                    <div className="rounded-box border border-base-300 bg-base-100/60 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-xs uppercase tracking-wide opacity-60">Then</div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "then_steps")}>Add step</button>
                      </div>
                      {renderStepCards(nestedThen, [...path, "then_steps"])}
                    </div>
                  ) : (
                    <div className="rounded-box border border-dashed border-base-300 bg-base-100/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide opacity-50">Then</div>
                          <div className="text-xs opacity-60">These steps run when the condition is true.</div>
                        </div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "then_steps")}>Add then step</button>
                      </div>
                    </div>
                  )}
                  {nestedElse.length > 0 ? (
                    <div className="rounded-box border border-base-300 bg-base-100/60 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-xs uppercase tracking-wide opacity-60">Else</div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "else_steps")}>Add step</button>
                      </div>
                      {renderStepCards(nestedElse, [...path, "else_steps"])}
                    </div>
                  ) : (
                    <div className="rounded-box border border-dashed border-base-300 bg-base-100/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide opacity-50">Else</div>
                          <div className="text-xs opacity-60">These steps run when the condition is false.</div>
                        </div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "else_steps")}>Add else step</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step.kind === "foreach" && (
                <div className="ml-5 rounded-box border border-base-300 bg-base-100/60 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-wide opacity-60">Repeat Steps</div>
                    <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "steps")}>Add step</button>
                  </div>
                  {nestedLoop.length ? renderStepCards(nestedLoop, [...path, "steps"]) : <div className="text-xs opacity-50">No repeat steps yet.</div>}
                </div>
              )}

              <div className="ml-2">
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => insertStepAfter(pathPrefix, index)}
                >
                  Add step after
                </button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost justify-start"
            onClick={() => insertStepAfter(pathPrefix, -1)}
          >
            Add step
          </button>
        )}
      </div>
    );
  }

  function renderStepEditor(step, stepPath, options = {}) {
    if (!step) {
      return <div className="text-sm opacity-60">Select a step from the flow to edit it.</div>;
    }
    const showHeader = options.showHeader !== false;
    const linear = options.linear !== false;
    const normalizedPath = normalizeStepPath(stepPath);
    const displayIndex = typeof normalizedPath[normalizedPath.length - 1] === "number" ? normalizedPath[normalizedPath.length - 1] : 0;
    let index = normalizedPath;
    const actionValue = step.module_id ? `${step.module_id}::${step.action_id}` : step.action_id || "";
    const isActionLike = step.kind === "action" || step.kind === "foreach";
    const standardGridClass = linear ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 md:grid-cols-2 gap-3";
    const wideGridClass = linear ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 md:grid-cols-12 gap-3";
    const referenceIntro = step.kind === "condition"
      ? "Condition rules use plain paths like `trigger.event_key` or `trigger.payload.customer.email`."
      : "Paste refs like `{{trigger.event_key}}` into inputs, message bodies, and JSON fields.";
    const beginnerHelp = step.kind === "condition"
      ? "Pick the field to check, choose how to compare it, and set the value it should match. If the rule is true, the Then branch runs."
      : step.kind === "foreach"
        ? "Choose the list to repeat over. Each item in that list will run the nested repeat steps once."
        : step.kind === "delay"
          ? "Choose whether this automation should pause for a duration or wait until a specific date and time."
          : step.action_id === "system.notify"
            ? "Start with the essentials: who should get the notification, a title, and the message body."
            : step.action_id === "system.send_email"
              ? "Start with recipients and the message. Only open advanced options if you need templates, merge fields, or attachments."
              : step.action_id === "system.integration_request"
                ? "Choose the integration connection first, then define the request method, endpoint, and any headers, query values, or payload."
                : step.action_id === "system.integration_sync"
                  ? "Choose the integration connection first, then define which sync scope to run. Only open advanced options if you need to override the saved sync request."
                : step.action_id === "system.query_records"
                  ? "Choose which entity to search, optionally add search text, and decide how many matching records to return."
                : step.action_id === "system.create_record"
                  ? "Choose the entity to create in, then enter the values the new record should be created with."
                  : step.action_id === "system.update_record"
                    ? "Choose the record to update, then define only the field changes you want to apply."
                    : "Fill this out from top to bottom. Start with the basic fields and only open advanced options if you need them.";

    return (
      <div className="space-y-4">
        {showHeader && (
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide opacity-60">Step {displayIndex + 1}</div>
              <div className="text-base font-semibold">{stepSummaryText(step)}</div>
              <div className="text-xs opacity-60">{stepHelpText(step)}</div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="btn btn-ghost btn-xs" disabled={displayIndex === 0} onClick={() => moveStep(normalizedPath, -1)}>Up</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => moveStep(normalizedPath, 1)}>Down</button>
              <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => removeStep(normalizedPath)}>Remove</button>
            </div>
          </div>
        )}

        <div className="rounded-box border border-base-300 bg-base-100/70 p-3">
          <div className="text-xs uppercase tracking-wide opacity-60">How To Fill This Out</div>
          <div className="text-sm opacity-80 mt-1">{beginnerHelp}</div>
        </div>

        <div className="rounded-box border border-base-300 bg-base-100/70 p-3">
          <div className="text-xs uppercase tracking-wide opacity-60">Available Data</div>
          <div className="text-sm opacity-80 mt-1">{referenceIntro}</div>
          <div className="mt-3 space-y-3">
            {automationVariableSections.map((section) => (
              <div key={section.title}>
                <div className="text-sm font-medium">{section.title}</div>
                <div className="text-xs opacity-60 mt-1">{section.description}</div>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {section.items.map((item) => {
                    const displayValue = step.kind === "condition" ? item.path : `{{${item.path}}}`;
                    return (
                      <div key={`${section.title}:${item.path}`} className="rounded-box border border-base-300 bg-base-100 px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-mono text-xs break-all">{displayValue}</div>
                            <div className="text-xs opacity-70 mt-1">{item.description}</div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => insertReferenceValue(displayValue)}
                              title="Insert into the last focused text field"
                            >
                              Insert
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => copyReferenceValue(displayValue)}
                              title="Copy reference"
                              aria-label={`Copy ${displayValue}`}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={wideGridClass}>
          <label className="form-control md:col-span-4">
            <span className="label-text">Kind</span>
            <select
              className="select select-bordered"
              value={step.kind || "action"}
              onChange={(e) => updateStep(index, { kind: e.target.value })}
            >
              <option value="action">Action</option>
              <option value="foreach">Repeat action</option>
              <option value="condition">Condition</option>
              <option value="delay">Delay</option>
            </select>
          </label>

          {isActionLike && (
            <label className="form-control md:col-span-8">
              <span className="label-text">Action</span>
              <select
                className="select select-bordered"
                value={actionValue}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) return;
                  const nextInputs = { ...(step.inputs || {}) };
                  if (value === "system.generate_document") {
                    if (!nextInputs.entity_id) nextInputs.entity_id = "{{trigger.entity_id}}";
                    if (!nextInputs.record_id) nextInputs.record_id = "{{trigger.record_id}}";
                  }
              if (value === "system.integration_request") {
                if (!nextInputs.method) nextInputs.method = "GET";
                if (!nextInputs.path) nextInputs.path = "/";
              }
              if (value === "system.integration_sync") {
                if (!nextInputs.scope_key) nextInputs.scope_key = "default";
                if (!nextInputs.method) nextInputs.method = "GET";
                if (!nextInputs.path) nextInputs.path = "/";
              }
              if (value.includes("::")) {
                    const [moduleId, actionId] = value.split("::");
                    updateStep(index, { action_id: actionId, module_id: moduleId, inputs: nextInputs });
                  } else {
                    updateStep(index, { action_id: value, module_id: undefined, inputs: nextInputs });
                  }
                }}
              >
                <option value="">Select action…</option>
                {actionOptions.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {(group.options || []).map((action) => (
                      <option
                        key={`${group.module_id || "system"}:${action.id}`}
                        value={group.module_id ? `${group.module_id}::${action.id}` : action.id}
                      >
                        {action.display_id ? `${action.label || action.id} (${action.display_id})` : (action.label || action.id)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
        </div>

        {step.kind === "foreach" && (
          <div className={wideGridClass}>
            <label className="form-control md:col-span-6">
              <span className="label-text">Repeat over</span>
              <input
                className="input input-bordered"
                list="automation-loop-hints"
                value={typeof step.over === "string" ? step.over : ""}
                onChange={(e) => updateStep(index, { over: e.target.value })}
                placeholder="{{steps.query_records.records}}"
              />
              <span className="label label-text-alt opacity-50">Use a trigger list, query results, or stored variable.</span>
            </label>
            <label className="form-control md:col-span-3">
              <span className="label-text">Item name</span>
              <input
                className="input input-bordered"
                value={step.item_name || "item"}
                onChange={(e) => updateStep(index, { item_name: e.target.value })}
                placeholder="item"
              />
            </label>
            <label className="form-control md:col-span-3">
              <span className="label-text">Store output as</span>
              <input
                className="input input-bordered"
                value={step.store_as || ""}
                onChange={(e) => updateStep(index, { store_as: e.target.value })}
                placeholder="loop_results"
              />
            </label>
          </div>
        )}

        {isActionLike && step.action_id === "system.notify" && (
          <div className={standardGridClass}>
            {(() => {
              const selectedIds = Array.isArray(step.inputs?.recipient_user_ids)
                ? step.inputs.recipient_user_ids
                : step.inputs?.recipient_user_id
                  ? [step.inputs.recipient_user_id]
                  : [];
              return (
                <label className="form-control">
                  <span className="label-text">Add recipient user</span>
                  <select
                    className="select select-bordered"
                    value=""
                    onChange={(e) => {
                      const nextId = e.target.value;
                      if (!nextId) return;
                      const next = Array.from(new Set([...selectedIds, nextId]));
                      updateStepInput(index, "recipient_user_ids", next);
                      updateStepInput(index, "recipient_user_id", next[0] || "");
                    }}
                  >
                    <option value="">Select user…</option>
                    {memberOptions.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.name || member.email || member.user_email || member.user_id}
                      </option>
                    ))}
                  </select>
                  <span className="label label-text-alt opacity-50">You can add multiple recipients.</span>
                </label>
              );
            })()}
            <label className="form-control md:col-span-2">
              <span className="label-text">Title</span>
              <input className="input input-bordered" value={step.inputs?.title || ""} onChange={(e) => updateStepInput(index, "title", e.target.value)} />
            </label>
            <label className="form-control md:col-span-2">
              <span className="label-text">Body</span>
              <CodeTextarea
                value={step.inputs?.body || ""}
                onChange={(e) => updateStepInput(index, "body", e.target.value)}
                minHeight="140px"
              />
            </label>
            {(Array.isArray(step.inputs?.recipient_user_ids)
              ? step.inputs.recipient_user_ids
              : step.inputs?.recipient_user_id
                ? [step.inputs.recipient_user_id]
                : []
            ).length > 0 && (
              <div className="md:col-span-2">
                <span className="label-text">Selected recipients</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(Array.isArray(step.inputs?.recipient_user_ids)
                    ? step.inputs.recipient_user_ids
                    : step.inputs?.recipient_user_id
                      ? [step.inputs.recipient_user_id]
                      : []
                  ).map((userId) => {
                    const member = memberById.get(userId);
                    const label = member?.name || member?.email || member?.user_email || "Unknown user";
                    return (
                      <span key={userId} className="badge badge-outline gap-2 py-3">
                        {label}
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => {
                            const current = Array.isArray(step.inputs?.recipient_user_ids)
                              ? step.inputs.recipient_user_ids
                              : step.inputs?.recipient_user_id
                                ? [step.inputs.recipient_user_id]
                                : [];
                            const next = current.filter((id) => id !== userId);
                            updateStepInput(index, "recipient_user_ids", next);
                            updateStepInput(index, "recipient_user_id", next[0] || "");
                          }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="md:col-span-2 rounded-box border border-base-300 bg-base-100">
              <details className="group">
                <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">Advanced options</div>
                    <div className="text-xs opacity-60">Only set these if you want different styling or a clickable link.</div>
                  </div>
                  <span className="text-xs opacity-60 group-open:hidden">Show</span>
                  <span className="text-xs opacity-60 hidden group-open:inline">Hide</span>
                </summary>
                <div className={`${standardGridClass} px-4 pb-4`}>
                  <label className="form-control">
                    <span className="label-text">Severity</span>
                    <select className="select select-bordered" value={step.inputs?.severity || "info"} onChange={(e) => updateStepInput(index, "severity", e.target.value)}>
                      <option value="info">Info</option>
                      <option value="success">Success</option>
                      <option value="warning">Warning</option>
                      <option value="danger">Danger</option>
                    </select>
                  </label>
                  <label className="form-control">
                    <span className="label-text">Link</span>
                    <input className="input input-bordered" value={step.inputs?.link_to || ""} onChange={(e) => updateStepInput(index, "link_to", e.target.value)} />
                  </label>
                </div>
              </details>
            </div>
          </div>
        )}

        {isActionLike && step.action_id === "system.send_email" && (
          <div className={wideGridClass}>
            {(() => {
              const selectedEntityId = step.inputs?.entity_id || triggerEventMeta?.entity_id || "";
              const activeEntity = selectedEntityId ? entityById.get(selectedEntityId) : null;
              const fields = Array.isArray(activeEntity?.fields) ? activeEntity.fields : [];
              const emailFields = fields.filter((f) => {
                const id = (f?.id || "").toLowerCase();
                const label = (f?.label || "").toLowerCase();
                return id.includes("email") || label.includes("email");
              });
              const attachmentFields = fields.filter((f) => f?.type === "attachments");
              const lookupFields = fields.filter((f) => f?.type === "lookup");
              const selectedLookupIdsRaw = step.inputs?.to_lookup_field_ids;
              const selectedLookupIds = Array.isArray(selectedLookupIdsRaw)
                ? selectedLookupIdsRaw
                : typeof selectedLookupIdsRaw === "string"
                  ? selectedLookupIdsRaw.split(",").map((v) => v.trim()).filter(Boolean)
                  : (step.inputs?.to_lookup_field_id ? [step.inputs.to_lookup_field_id] : []);
              const selectedRecordEmailFieldIds = Array.isArray(step.inputs?.to_field_ids)
                ? step.inputs.to_field_ids
                : (step.inputs?.to_field_id ? [step.inputs.to_field_id] : []);
              const selectedInternalEmails = Array.isArray(step.inputs?.to_internal_emails)
                ? step.inputs.to_internal_emails
                : typeof step.inputs?.to_internal_emails === "string"
                  ? step.inputs.to_internal_emails.split(",").map((v) => v.trim()).filter(Boolean)
                  : [];
              const primaryLookupField = selectedLookupIds[0] || step.inputs?.to_lookup_field_id || "";
              const selectedLookupFieldDef = lookupFields.find((f) => f.id === primaryLookupField);
              const targetEntityId = step.inputs?.to_lookup_entity_id || selectedLookupFieldDef?.entity;
              const targetEntity = targetEntityId ? entityById.get(targetEntityId) : null;
              const targetFields = Array.isArray(targetEntity?.fields) ? targetEntity.fields : [];
              const targetEmailFields = targetFields.filter((f) => {
                const id = (f?.id || "").toLowerCase();
                const label = (f?.label || "").toLowerCase();
                return id.includes("email") || label.includes("email");
              });
              const includeAttachments = Boolean(
                step.inputs?.include_attachments
                || step.inputs?.attachment_purpose
                || step.inputs?.attachment_entity_id
                || step.inputs?.attachment_record_id
                || step.inputs?.attachment_field_id
              );

              return (
                <>
                  <label className="form-control md:col-span-12">
                    <span className="label-text">Direct email addresses</span>
                    <input className="input input-bordered" value={(step.inputs?.to || []).join(", ")} onChange={(e) => updateStepInput(index, "to", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                    <span className="label label-text-alt opacity-50">Optional comma-separated addresses. Leave blank if you only want to use recipients from fields or related records.</span>
                  </label>
                  <label className="form-control md:col-span-6">
                    <span className="label-text">Add internal recipient</span>
                    <select
                      className="select select-bordered"
                      value=""
                      onChange={(e) => {
                        const email = e.target.value;
                        if (!email) return;
                        const next = Array.from(new Set([...(selectedInternalEmails || []), email]));
                        updateStepInput(index, "to_internal_emails", next);
                      }}
                    >
                      <option value="">Select workspace member…</option>
                      {memberOptions.map((member) => {
                        const memberEmail = member.email || member.user_email || "";
                        return (
                          <option key={member.user_id} value={memberEmail} disabled={!memberEmail}>
                            {member.name || memberEmail || member.user_id}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {emailFields.length > 0 && (
                    <label className="form-control md:col-span-6">
                      <span className="label-text">Add record email field</span>
                      <select
                        className="select select-bordered"
                        value=""
                        onChange={(e) => {
                          const fieldId = e.target.value;
                          if (!fieldId) return;
                          const next = Array.from(new Set([...(selectedRecordEmailFieldIds || []), fieldId]));
                          updateStepInput(index, "to_field_ids", next);
                          updateStepInput(index, "to_field_id", next[0] || "");
                        }}
                      >
                        <option value="">Select email field…</option>
                        {emailFields.map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.label || field.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {lookupFields.length > 0 && (
                    <label className="form-control md:col-span-6">
                      <span className="label-text">Add lookup recipient field</span>
                      <select
                        className="select select-bordered"
                        value=""
                        onChange={(e) => {
                          const fieldId = e.target.value;
                          if (!fieldId) return;
                          const next = Array.from(new Set([...(selectedLookupIds || []), fieldId]));
                          updateStepInput(index, "to_lookup_field_ids", next);
                          updateStepInput(index, "to_lookup_field_id", next[0] || "");
                        }}
                      >
                        <option value="">Select lookup field…</option>
                        {lookupFields.map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.label || field.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {selectedLookupIds.length > 0 && targetEmailFields.length > 0 && (
                    <label className="form-control md:col-span-6">
                      <span className="label-text">Target email field</span>
                      <select
                        className="select select-bordered"
                        value={step.inputs?.to_lookup_email_field || ""}
                        onChange={(e) => updateStepInput(index, "to_lookup_email_field", e.target.value)}
                      >
                        <option value="">Auto-detect email</option>
                        {targetEmailFields.map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.label || field.id}
                          </option>
                        ))}
                      </select>
                      <span className="label label-text-alt opacity-50">Only needed if the related record has more than one email field.</span>
                    </label>
                  )}
                  {(selectedInternalEmails.length || selectedRecordEmailFieldIds.length || selectedLookupIds.length) > 0 && (
                    <div className="md:col-span-12">
                      <span className="label-text">Selected recipient sources</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedInternalEmails.map((email) => {
                          const match = memberOptions.find((m) => (m.email || m.user_email) === email);
                          const label = match?.name ? `${match.name} (${email})` : email;
                          return (
                            <span key={`internal:${email}`} className="badge badge-outline gap-2 py-3">
                              Internal: {label}
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={() => updateStepInput(index, "to_internal_emails", selectedInternalEmails.filter((v) => v !== email))}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                        {selectedRecordEmailFieldIds.map((fieldId) => {
                          const field = emailFields.find((f) => f.id === fieldId);
                          return (
                            <span key={`record:${fieldId}`} className="badge badge-outline gap-2 py-3">
                              Record field: {field?.label || fieldId}
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={() => {
                                  const next = selectedRecordEmailFieldIds.filter((v) => v !== fieldId);
                                  updateStepInput(index, "to_field_ids", next);
                                  updateStepInput(index, "to_field_id", next[0] || "");
                                }}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                        {selectedLookupIds.map((fieldId) => {
                          const field = lookupFields.find((f) => f.id === fieldId);
                          return (
                            <span key={`lookup:${fieldId}`} className="badge badge-outline gap-2 py-3">
                              Lookup: {field?.label || fieldId}
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={() => {
                                  const next = selectedLookupIds.filter((v) => v !== fieldId);
                                  updateStepInput(index, "to_lookup_field_ids", next);
                                  updateStepInput(index, "to_lookup_field_id", next[0] || "");
                                }}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <label className="form-control md:col-span-12">
                    <label className="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={includeAttachments}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          updateStepInput(index, "include_attachments", checked ? true : undefined);
                          if (!checked) {
                            updateStepInput(index, "attachment_purpose", undefined);
                            updateStepInput(index, "attachment_entity_id", undefined);
                            updateStepInput(index, "attachment_record_id", undefined);
                            updateStepInput(index, "attachment_field_id", undefined);
                          }
                        }}
                      />
                      <span className="label-text">Include attachments</span>
                    </label>
                    <span className="label label-text-alt opacity-50">Turn this on only if the email should include generated files or attachments from a record.</span>
                  </label>
                  {includeAttachments && (
                    <>
                      <label className="form-control md:col-span-4">
                        <span className="label-text">Attachment purpose</span>
                        <input
                          className="input input-bordered"
                          value={step.inputs?.attachment_purpose || ""}
                          onChange={(e) => updateStepInput(index, "attachment_purpose", e.target.value)}
                          placeholder="invoice_pdf"
                        />
                        <span className="label label-text-alt opacity-50">Attach linked files with this purpose from the selected record.</span>
                      </label>
                      <label className="form-control md:col-span-4">
                        <span className="label-text">Attachment entity</span>
                        <select
                          className="select select-bordered"
                          value={step.inputs?.attachment_entity_id || ""}
                          onChange={(e) => updateStepInput(index, "attachment_entity_id", e.target.value)}
                        >
                          <option value="">Use email entity</option>
                          {entityOptions.map((ent) => (
                            <option key={ent.id} value={ent.id}>
                              {ent.label || ent.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-control md:col-span-4">
                        <span className="label-text">Attachment record</span>
                        <input
                          className="input input-bordered"
                          list="automation-record-hints"
                          value={step.inputs?.attachment_record_id || ""}
                          onChange={(e) => updateStepInput(index, "attachment_record_id", e.target.value)}
                          placeholder="{{trigger.record_id}}"
                        />
                      </label>
                      <label className="form-control md:col-span-12">
                        <span className="label-text">Attachment field</span>
                        <select
                          className="select select-bordered"
                          value={step.inputs?.attachment_field_id || ""}
                          onChange={(e) => updateStepInput(index, "attachment_field_id", e.target.value)}
                        >
                          <option value="">No record attachment field</option>
                          {attachmentFields.map((field) => (
                            <option key={field.id} value={field.id}>
                              {field.label || field.id}
                            </option>
                          ))}
                        </select>
                        <span className="label label-text-alt opacity-50">Optional extra source if files already live in an attachments field on the record.</span>
                      </label>
                    </>
                  )}
                  <div className="md:col-span-12 rounded-box border border-base-300 bg-base-100">
                    <details className="group">
                      <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">Advanced email options</div>
                          <div className="text-xs opacity-60">Connection, template, merge-record context, subject override, and recipient expression.</div>
                        </div>
                        <span className="text-xs opacity-60 group-open:hidden">Show</span>
                        <span className="text-xs opacity-60 hidden group-open:inline">Hide</span>
                      </summary>
                      <div className={`${wideGridClass} px-4 pb-4`}>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Connection</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.connection_id || ""}
                            onChange={(e) => updateStepInput(index, "connection_id", e.target.value)}
                          >
                            <option value="">Use default</option>
                            {emailConnectionOptions.map((conn) => (
                              <option key={conn.id} value={conn.id}>
                                {conn.name || conn.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Template</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.template_id || ""}
                            onChange={(e) => updateStepInput(index, "template_id", e.target.value)}
                          >
                            <option value="">No template</option>
                            {emailTemplateOptions.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name || tpl.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Entity for merge fields</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.entity_id || ""}
                            onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                          >
                            <option value="">Use trigger entity</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Record for merge fields</span>
                          <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                          <span className="label label-text-alt opacity-50">Optional record for merge fields, attachments, or lookup recipients.</span>
                        </label>
                        <label className="form-control md:col-span-12">
                          <span className="label-text">Recipient expression</span>
                          <input
                            className="input input-bordered"
                            value={step.inputs?.to_expr || ""}
                            onChange={(e) => updateStepInput(index, "to_expr", e.target.value)}
                            placeholder="{{ record['contact_email'] }}, ops@example.com"
                          />
                        </label>
                        <label className="form-control md:col-span-12">
                          <span className="label-text">Subject override</span>
                          <input className="input input-bordered" value={step.inputs?.subject || ""} onChange={(e) => updateStepInput(index, "subject", e.target.value)} />
                          <span className="label label-text-alt opacity-50">Leave blank to use the template subject.</span>
                        </label>
                      </div>
                    </details>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {isActionLike && step.action_id === "system.generate_document" && (
          <div className={standardGridClass}>
            <label className="form-control">
              <span className="label-text">Template</span>
              <select
                className="select select-bordered"
                value={step.inputs?.template_id || ""}
                onChange={(e) => updateStepInput(index, "template_id", e.target.value)}
              >
                <option value="">Select template…</option>
                {docTemplateOptions.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name || tpl.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">Purpose</span>
              <input className="input input-bordered" value={step.inputs?.purpose || ""} onChange={(e) => updateStepInput(index, "purpose", e.target.value)} />
              <span className="label label-text-alt opacity-50">Optional attachment purpose tag, like `handover_pdf` or `quote_pdf`.</span>
            </label>
            <label className="form-control">
              <span className="label-text">Entity</span>
              <select
                className="select select-bordered"
                value={step.inputs?.entity_id || ""}
                onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
              >
                <option value="">Select entity…</option>
                <option value="{{trigger.entity_id}}">Use trigger entity</option>
                {entityOptions.map((ent) => (
                  <option key={ent.id} value={ent.id}>
                    {ent.label || ent.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">Record</span>
              <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
              <span className="label label-text-alt opacity-50">Paste record ID or use trigger.</span>
            </label>
          </div>
        )}

        {isActionLike && step.action_id === "system.integration_request" && (
          <div className={standardGridClass}>
            <label className="form-control">
              <span className="label-text">Connection</span>
              <select
                className="select select-bordered"
                value={step.inputs?.connection_id || ""}
                onChange={(e) => updateStepInput(index, "connection_id", e.target.value)}
              >
                <option value="">Select connection…</option>
                {integrationConnectionOptions.map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {conn.name || conn.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">Method</span>
              <select
                className="select select-bordered"
                value={step.inputs?.method || "GET"}
                onChange={(e) => updateStepInput(index, "method", e.target.value)}
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">Path</span>
              <input
                className="input input-bordered"
                value={step.inputs?.path || ""}
                onChange={(e) => updateStepInput(index, "path", e.target.value)}
                placeholder="/contacts"
              />
              <span className="label label-text-alt opacity-50">Use path for provider base URLs. Leave blank if you use a full URL below.</span>
            </label>
            <label className="form-control">
              <span className="label-text">Full URL override</span>
              <input
                className="input input-bordered"
                value={step.inputs?.url || ""}
                onChange={(e) => updateStepInput(index, "url", e.target.value)}
                placeholder="https://api.example.com/custom/path"
              />
            </label>
            <label className="form-control">
              <span className="label-text">Headers JSON</span>
              <CodeTextarea
                value={typeof step.inputs?.headers === "string" ? step.inputs.headers : JSON.stringify(step.inputs?.headers || {}, null, 2)}
                onChange={(e) => updateStepInput(index, "headers", e.target.value)}
                minHeight="120px"
              />
            </label>
            <label className="form-control">
              <span className="label-text">Query JSON</span>
              <CodeTextarea
                value={typeof step.inputs?.query === "string" ? step.inputs.query : JSON.stringify(step.inputs?.query || {}, null, 2)}
                onChange={(e) => updateStepInput(index, "query", e.target.value)}
                minHeight="120px"
              />
            </label>
            <label className="form-control">
              <span className="label-text">JSON body</span>
              <CodeTextarea
                value={typeof step.inputs?.json === "string" ? step.inputs.json : JSON.stringify(step.inputs?.json || {}, null, 2)}
                onChange={(e) => updateStepInput(index, "json", e.target.value)}
                minHeight="140px"
              />
              <span className="label label-text-alt opacity-50">Use this for structured payloads. Leave empty and use raw body only if the endpoint does not expect JSON.</span>
            </label>
            <label className="form-control">
              <span className="label-text">Raw body</span>
              <CodeTextarea
                value={step.inputs?.body || ""}
                onChange={(e) => updateStepInput(index, "body", e.target.value)}
                minHeight="120px"
              />
            </label>
          </div>
        )}

        {isActionLike && step.action_id === "system.integration_sync" && (
          <div className={standardGridClass}>
            <label className="form-control">
              <span className="label-text">Connection</span>
              <select
                className="select select-bordered"
                value={step.inputs?.connection_id || ""}
                onChange={(e) => updateStepInput(index, "connection_id", e.target.value)}
              >
                <option value="">Select connection…</option>
                {integrationConnectionOptions.map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {conn.name || conn.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">Checkpoint scope</span>
              <input
                className="input input-bordered"
                value={step.inputs?.scope_key || ""}
                onChange={(e) => updateStepInput(index, "scope_key", e.target.value)}
                placeholder="contacts"
              />
              <span className="label label-text-alt opacity-50">Use different scopes when one connection syncs more than one resource.</span>
            </label>
            <label className="form-control">
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  checked={Boolean(step.inputs?.emit_events)}
                  onChange={(e) => updateStepInput(index, "emit_events", e.target.checked ? true : undefined)}
                />
                <span className="label-text">Emit item events</span>
              </label>
              <span className="label label-text-alt opacity-50">Turn this on if later automations should react to each returned item.</span>
            </label>
            <label className="form-control">
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  checked={Boolean(step.inputs?.async)}
                  onChange={(e) => updateStepInput(index, "async", e.target.checked ? true : undefined)}
                />
                <span className="label-text">Queue in background</span>
              </label>
              <span className="label label-text-alt opacity-50">Use this when the sync might take a while and you do not need the result immediately.</span>
            </label>
            <div className="rounded-box border border-base-300 bg-base-100">
              <details className="group">
                <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">Advanced sync options</div>
                    <div className="text-xs opacity-60">Override the saved sync request or cursor settings for this automation run.</div>
                  </div>
                  <span className="text-xs opacity-60 group-open:hidden">Show</span>
                  <span className="text-xs opacity-60 hidden group-open:inline">Hide</span>
                </summary>
                <div className={`${standardGridClass} px-4 pb-4`}>
                  <label className="form-control">
                    <span className="label-text">Method</span>
                    <select
                      className="select select-bordered"
                      value={step.inputs?.method || "GET"}
                      onChange={(e) => updateStepInput(index, "method", e.target.value)}
                    >
                      {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-control">
                    <span className="label-text">Path</span>
                    <input
                      className="input input-bordered"
                      value={step.inputs?.path || ""}
                      onChange={(e) => updateStepInput(index, "path", e.target.value)}
                      placeholder="/contacts"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Items path</span>
                    <input
                      className="input input-bordered"
                      value={step.inputs?.items_path || ""}
                      onChange={(e) => updateStepInput(index, "items_path", e.target.value)}
                      placeholder="items"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Cursor query parameter</span>
                    <input
                      className="input input-bordered"
                      value={step.inputs?.cursor_param || ""}
                      onChange={(e) => updateStepInput(index, "cursor_param", e.target.value)}
                      placeholder="updated_since"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Next cursor path</span>
                    <input
                      className="input input-bordered"
                      value={step.inputs?.cursor_value_path || ""}
                      onChange={(e) => updateStepInput(index, "cursor_value_path", e.target.value)}
                      placeholder="meta.next_cursor"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Last item cursor path</span>
                    <input
                      className="input input-bordered"
                      value={step.inputs?.last_item_cursor_path || ""}
                      onChange={(e) => updateStepInput(index, "last_item_cursor_path", e.target.value)}
                      placeholder="updated_at"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Max items</span>
                    <input
                      className="input input-bordered"
                      value={step.inputs?.max_items || ""}
                      onChange={(e) => updateStepInput(index, "max_items", e.target.value)}
                      placeholder="100"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Headers JSON</span>
                    <CodeTextarea
                      value={typeof step.inputs?.headers === "string" ? step.inputs.headers : JSON.stringify(step.inputs?.headers || {}, null, 2)}
                      onChange={(e) => updateStepInput(index, "headers", e.target.value)}
                      minHeight="120px"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Query JSON</span>
                    <CodeTextarea
                      value={typeof step.inputs?.query === "string" ? step.inputs.query : JSON.stringify(step.inputs?.query || {}, null, 2)}
                      onChange={(e) => updateStepInput(index, "query", e.target.value)}
                      minHeight="120px"
                    />
                  </label>
                </div>
              </details>
            </div>
          </div>
        )}

        {isActionLike && step.action_id && !step.action_id.startsWith("system.") && (
          <div className={standardGridClass}>
            <label className="form-control">
              <span className="label-text">Entity</span>
              <select
                className="select select-bordered"
                value={step.inputs?.entity_id || ""}
                onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
              >
                <option value="">Use trigger entity</option>
                {entityOptions.map((ent) => (
                  <option key={ent.id} value={ent.id}>
                    {ent.label || ent.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">Record</span>
              <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
              <span className="label label-text-alt opacity-50">Paste record ID or use trigger.</span>
            </label>
            <label className="form-control md:col-span-2">
              <span className="label-text">Selected records (comma)</span>
              <input className="input input-bordered" value={(step.inputs?.selected_ids || []).join(", ")} onChange={(e) => updateStepInput(index, "selected_ids", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
              <span className="label label-text-alt opacity-50">Comma-separated record IDs.</span>
            </label>
          </div>
        )}

        {isActionLike && step.action_id === "system.create_record" && (
          (() => {
            const selectedEntityId = step.inputs?.entity_id || "";
            const selectedEntity = selectedEntityId ? entityById.get(selectedEntityId) : null;
            const selectedEntityFields = Array.isArray(selectedEntity?.fields) ? selectedEntity.fields : [];
            const fieldDatalistId = `automation-step-fields-${normalizedPath.join("-") || "root"}-create`;
            const rows = objectEntriesForEditor(step.inputs?.values);
            return (
              <div className={standardGridClass}>
                <label className="form-control">
                  <span className="label-text">Entity</span>
                  <select className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                    <option value="">Select entity…</option>
                    {entityOptions.map((ent) => (
                      <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                    ))}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text">Store output as</span>
                  <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="new_record" />
                </label>
                <div className="md:col-span-2 rounded-box border border-base-300 bg-base-100/70 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">Field values</div>
                      <div className="text-xs opacity-60 mt-1">Fill out the record one field at a time. Use Insert on the refs above when a value should come from the trigger or an earlier step.</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      onClick={() => writeObjectEntries(index, "values", [...rows, { fieldId: "", value: "" }])}
                    >
                      Add field
                    </button>
                  </div>
                  {rows.length === 0 ? (
                    <div className="text-xs opacity-60">No field values yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {rows.map((row, rowIndex) => {
                        const nextRows = rows.slice();
                        const fieldDef = findEntityField(selectedEntityFields, row.fieldId);
                        return (
                          <div key={`create-value-${rowIndex}`} className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                            <label className="form-control">
                              <span className="label-text">Field</span>
                              <input
                                className="input input-bordered"
                                list={fieldDatalistId}
                                value={row.fieldId}
                                onChange={(e) => {
                                  nextRows[rowIndex] = { ...row, fieldId: e.target.value };
                                  writeObjectEntries(index, "values", nextRows);
                                }}
                                placeholder="field_id"
                              />
                            </label>
                            <label className="form-control">
                              <span className="label-text">Value</span>
                              {renderTypedValueEditor({
                                fieldDef,
                                value: row.value,
                                onChange: (nextValue) => {
                                  nextRows[rowIndex] = { ...row, value: nextValue };
                                  writeObjectEntries(index, "values", nextRows);
                                },
                                placeholder: "{{trigger.record_id}}",
                              })}
                              <span className="label label-text-alt opacity-50">
                                {fieldDef
                                  ? `Field type: ${fieldDef.type || "string"}`
                                  : "Pick a field first to get a type-aware value input."}
                              </span>
                            </label>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-error self-end"
                              onClick={() => writeObjectEntries(index, "values", rows.filter((_, idx) => idx !== rowIndex))}
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <datalist id={fieldDatalistId}>
                    {selectedEntityFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label || field.id}
                      </option>
                    ))}
                  </datalist>
                  <details className="group rounded-box border border-base-300 bg-base-100">
                    <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Advanced values JSON</div>
                        <div className="text-xs opacity-60">Use this only if you need nested objects or a shape that is easier to paste as raw JSON.</div>
                      </div>
                      <span className="text-xs opacity-60 group-open:hidden">Show</span>
                      <span className="text-xs opacity-60 hidden group-open:inline">Hide</span>
                    </summary>
                    <div className="px-4 pb-4">
                      <label className="form-control">
                        <span className="label-text">Values JSON</span>
                        <CodeTextarea
                          value={stringifyJsonObjectInput(step.inputs?.values)}
                          onChange={(e) => updateStepInput(index, "values", e.target.value)}
                          minHeight="180px"
                          placeholder={`{\n  "field_id": "value",\n  "other_field": "{{trigger.record_id}}"\n}`}
                        />
                      </label>
                    </div>
                  </details>
                </div>
              </div>
            );
          })()
        )}

        {isActionLike && step.action_id === "system.update_record" && (
          (() => {
            const selectedEntityId = step.inputs?.entity_id || "";
            const selectedEntity = selectedEntityId ? entityById.get(selectedEntityId) : null;
            const selectedEntityFields = Array.isArray(selectedEntity?.fields) ? selectedEntity.fields : [];
            const fieldDatalistId = `automation-step-fields-${normalizedPath.join("-") || "root"}-update`;
            const rows = objectEntriesForEditor(step.inputs?.patch);
            return (
              <div className={standardGridClass}>
                <label className="form-control">
                  <span className="label-text">Entity</span>
                  <select className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                    <option value="">Use trigger entity</option>
                    {entityOptions.map((ent) => (
                      <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                    ))}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text">Record</span>
                  <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} placeholder="{{trigger.record_id}}" />
                </label>
                <label className="form-control">
                  <span className="label-text">Store output as</span>
                  <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="updated_record" />
                </label>
                <div className="md:col-span-2 rounded-box border border-base-300 bg-base-100/70 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">Field changes</div>
                      <div className="text-xs opacity-60 mt-1">Only add the fields you want to change. Anything you leave out is untouched.</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      onClick={() => writeObjectEntries(index, "patch", [...rows, { fieldId: "", value: "" }])}
                    >
                      Add change
                    </button>
                  </div>
                  {rows.length === 0 ? (
                    <div className="text-xs opacity-60">No changes yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {rows.map((row, rowIndex) => {
                        const nextRows = rows.slice();
                        const fieldDef = findEntityField(selectedEntityFields, row.fieldId);
                        return (
                          <div key={`update-patch-${rowIndex}`} className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                            <label className="form-control">
                              <span className="label-text">Field</span>
                              <input
                                className="input input-bordered"
                                list={fieldDatalistId}
                                value={row.fieldId}
                                onChange={(e) => {
                                  nextRows[rowIndex] = { ...row, fieldId: e.target.value };
                                  writeObjectEntries(index, "patch", nextRows);
                                }}
                                placeholder="field_id"
                              />
                            </label>
                            <label className="form-control">
                              <span className="label-text">New value</span>
                              {renderTypedValueEditor({
                                fieldDef,
                                value: row.value,
                                onChange: (nextValue) => {
                                  nextRows[rowIndex] = { ...row, value: nextValue };
                                  writeObjectEntries(index, "patch", nextRows);
                                },
                                placeholder: "{{trigger.record_id}}",
                              })}
                              <span className="label label-text-alt opacity-50">
                                {fieldDef
                                  ? `Field type: ${fieldDef.type || "string"}`
                                  : "Pick a field first to get a type-aware value input."}
                              </span>
                            </label>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-error self-end"
                              onClick={() => writeObjectEntries(index, "patch", rows.filter((_, idx) => idx !== rowIndex))}
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <datalist id={fieldDatalistId}>
                    {selectedEntityFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label || field.id}
                      </option>
                    ))}
                  </datalist>
                  <details className="group rounded-box border border-base-300 bg-base-100">
                    <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Advanced patch JSON</div>
                        <div className="text-xs opacity-60">Use this only if you need nested objects or want to paste a prepared patch object.</div>
                      </div>
                      <span className="text-xs opacity-60 group-open:hidden">Show</span>
                      <span className="text-xs opacity-60 hidden group-open:inline">Hide</span>
                    </summary>
                    <div className="px-4 pb-4">
                      <label className="form-control">
                        <span className="label-text">Patch JSON</span>
                        <CodeTextarea
                          value={stringifyJsonObjectInput(step.inputs?.patch)}
                          onChange={(e) => updateStepInput(index, "patch", e.target.value)}
                          minHeight="180px"
                          placeholder={`{\n  "status": "approved"\n}`}
                        />
                      </label>
                    </div>
                  </details>
                </div>
              </div>
            );
          })()
        )}

        {isActionLike && step.action_id === "system.query_records" && (
          (() => {
            const selectedEntityId = step.inputs?.entity_id || defaultConditionEntityId || "";
            const selectedEntity = selectedEntityId ? entityById.get(selectedEntityId) : null;
            const selectedEntityFields = Array.isArray(selectedEntity?.fields) ? selectedEntity.fields : [];
            const fieldDatalistId = `automation-step-fields-${normalizedPath.join("-") || "root"}-query`;
            const filterRows = parseFilterRows(step.inputs?.filter_expr);
            return (
              <div className={standardGridClass}>
                <label className="form-control">
                  <span className="label-text">Entity</span>
                  <select className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                    <option value="">Use trigger entity</option>
                    {entityOptions.map((ent) => (
                      <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                    ))}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text">Search text</span>
                  <input className="input input-bordered" value={step.inputs?.q || ""} onChange={(e) => updateStepInput(index, "q", e.target.value)} />
                  <span className="label label-text-alt opacity-50">Optional text search. Leave blank if you only want to use filter rules.</span>
                </label>
                <label className="form-control">
                  <span className="label-text">Limit</span>
                  <input className="input input-bordered" type="number" min={1} max={200} value={step.inputs?.limit || 25} onChange={(e) => updateStepInput(index, "limit", Number(e.target.value || 25))} />
                  <span className="label label-text-alt opacity-50">Only the first matching records are returned to later steps.</span>
                </label>
                <label className="form-control">
                  <span className="label-text">Store output as</span>
                  <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="query_results" />
                </label>
                <div className="md:col-span-2 rounded-box border border-base-300 bg-base-100/70 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">Quick filters</div>
                      <div className="text-xs opacity-60 mt-1">Add simple rules to narrow down records. These compile into the same advanced filter JSON behind the scenes.</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      onClick={() => updateStepInput(index, "filter_expr", buildFilterExprFromRows([...filterRows, { path: "", op: "eq", value: "" }]))}
                    >
                      Add rule
                    </button>
                  </div>
                  {filterRows.length === 0 ? (
                    <div className="text-xs opacity-60">No quick filters yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {filterRows.map((row, rowIndex) => {
                        const nextRows = filterRows.slice();
                        const fieldDef = findEntityField(selectedEntityFields, row.path);
                        return (
                          <div key={`query-filter-${rowIndex}`} className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto]">
                            <label className="form-control">
                              <span className="label-text">Field path</span>
                              <input
                                className="input input-bordered"
                                list={fieldDatalistId}
                                value={row.path}
                                onChange={(e) => {
                                  nextRows[rowIndex] = { ...row, path: e.target.value };
                                  updateStepInput(index, "filter_expr", buildFilterExprFromRows(nextRows));
                                }}
                                placeholder="record.status"
                              />
                            </label>
                            <label className="form-control">
                              <span className="label-text">Operator</span>
                              <select
                                className="select select-bordered"
                                value={row.op || "eq"}
                                onChange={(e) => {
                                  nextRows[rowIndex] = { ...row, op: e.target.value };
                                  updateStepInput(index, "filter_expr", buildFilterExprFromRows(nextRows));
                                }}
                              >
                                <option value="eq">equals</option>
                                <option value="neq">not equals</option>
                                <option value="gt">greater than</option>
                                <option value="gte">greater or equal</option>
                                <option value="lt">less than</option>
                                <option value="lte">less or equal</option>
                                <option value="contains">contains</option>
                                <option value="in">in list</option>
                                <option value="not_in">not in list</option>
                                <option value="exists">exists</option>
                                <option value="not_exists">not exists</option>
                              </select>
                            </label>
                            <label className="form-control">
                              <span className="label-text">Value</span>
                              {row.op === "exists" || row.op === "not_exists" ? (
                                <input className="input input-bordered" disabled value="No value needed" />
                              ) : (
                                renderTypedValueEditor({
                                  fieldDef,
                                  value: row.value,
                                  onChange: (nextValue) => {
                                    nextRows[rowIndex] = { ...row, value: nextValue };
                                    updateStepInput(index, "filter_expr", buildFilterExprFromRows(nextRows));
                                  },
                                  placeholder: row.op === "in" || row.op === "not_in" ? "open, pending" : "open",
                                })
                              )}
                              <span className="label label-text-alt opacity-50">
                                {fieldDef
                                  ? `Field type: ${fieldDef.type || "string"}`
                                  : "Use record.field_name format to get a type-aware value input."}
                              </span>
                            </label>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-error self-end"
                              onClick={() => updateStepInput(index, "filter_expr", buildFilterExprFromRows(filterRows.filter((_, idx) => idx !== rowIndex)))}
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <datalist id={fieldDatalistId}>
                    <option value="record.id">Record ID</option>
                    {selectedEntityFields.map((field) => {
                      const shortId = typeof field.id === "string" ? field.id.split(".").pop() : field.id;
                      const value = shortId ? `record.${shortId}` : "";
                      if (!value) return null;
                      return (
                        <option key={field.id} value={value}>
                          {field.label || field.id}
                        </option>
                      );
                    })}
                  </datalist>
                  <details className="group rounded-box border border-base-300 bg-base-100">
                    <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Advanced query options</div>
                        <div className="text-xs opacity-60">Use this for search field limits or a more complex filter expression than the quick rules above can represent.</div>
                      </div>
                      <span className="text-xs opacity-60 group-open:hidden">Show</span>
                      <span className="text-xs opacity-60 hidden group-open:inline">Hide</span>
                    </summary>
                    <div className={`${standardGridClass} px-4 pb-4`}>
                      <label className="form-control">
                        <span className="label-text">Search fields</span>
                        <input className="input input-bordered" value={step.inputs?.search_fields || ""} onChange={(e) => updateStepInput(index, "search_fields", e.target.value)} placeholder="field.one, field.two" />
                        <span className="label label-text-alt opacity-50">Optional comma-separated field IDs to limit text search.</span>
                      </label>
                      <div />
                      <label className="form-control md:col-span-2">
                        <span className="label-text">Filter condition JSON</span>
                        <CodeTextarea
                          value={typeof step.inputs?.filter_expr === "string" ? step.inputs.filter_expr : JSON.stringify(step.inputs?.filter_expr || {}, null, 2)}
                          onChange={(e) => updateStepInput(index, "filter_expr", e.target.value)}
                          minHeight="140px"
                          placeholder={`{\n  "op": "eq",\n  "left": { "var": "record.status" },\n  "right": { "literal": "open" }\n}`}
                        />
                      </label>
                    </div>
                  </details>
                </div>
              </div>
            );
          })()
        )}

        {isActionLike && step.action_id === "system.add_chatter" && (
            <div className={standardGridClass}>
            <label className="form-control">
              <span className="label-text">Entity</span>
              <select className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                <option value="">Use trigger entity</option>
                {entityOptions.map((ent) => (
                  <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">Record</span>
              <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} placeholder="{{trigger.record_id}}" />
            </label>
            <label className="form-control">
              <span className="label-text">Entry type</span>
              <select className="select select-bordered" value={step.inputs?.entry_type || "note"} onChange={(e) => updateStepInput(index, "entry_type", e.target.value)}>
                <option value="note">Note</option>
                <option value="comment">Comment</option>
                <option value="system">System</option>
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">Store output as</span>
              <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="activity_note" />
            </label>
            <label className="form-control md:col-span-2">
              <span className="label-text">Body</span>
              <CodeTextarea value={step.inputs?.body || ""} onChange={(e) => updateStepInput(index, "body", e.target.value)} minHeight="140px" />
            </label>
          </div>
        )}

        {step.kind === "delay" && (
          <div className={wideGridClass}>
            <label className="form-control md:col-span-4">
              <span className="label-text">Delay mode</span>
              <select
                className="select select-bordered"
                value={step.target_time ? "until_time" : "relative"}
                onChange={(e) => {
                  if (e.target.value === "until_time") {
                    updateStep(index, { seconds: undefined, target_time: step.target_time || "" });
                  } else {
                    updateStep(index, { target_time: undefined, seconds: step.seconds || 60 });
                  }
                }}
              >
                <option value="relative">Wait relative time</option>
                <option value="until_time">Wait until datetime</option>
              </select>
            </label>
            {!step.target_time ? (
              <>
                <label className="form-control md:col-span-4">
                  <span className="label-text">Amount</span>
                  <input
                    className="input input-bordered"
                    type="number"
                    min={0}
                    value={step.delay_value || step.seconds || 60}
                    onChange={(e) => {
                      const amount = Math.max(0, Number(e.target.value || 0));
                      const unit = step.delay_unit || "seconds";
                      updateStep(index, { delay_value: amount, delay_unit: unit, seconds: amount * delayUnitToSeconds(unit) });
                    }}
                  />
                </label>
                <label className="form-control md:col-span-4">
                  <span className="label-text">Unit</span>
                  <select
                    className="select select-bordered"
                    value={step.delay_unit || "seconds"}
                    onChange={(e) => {
                      const unit = e.target.value;
                      const amount = Number(step.delay_value || step.seconds || 60);
                      updateStep(index, { delay_unit: unit, delay_value: amount, seconds: amount * delayUnitToSeconds(unit) });
                    }}
                  >
                    <option value="seconds">Seconds</option>
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </label>
              </>
            ) : (
              <label className="form-control md:col-span-8">
                <span className="label-text">Resume at</span>
                <input
                  className="input input-bordered"
                  type="datetime-local"
                  value={step.target_time ? new Date(step.target_time).toISOString().slice(0, 16) : ""}
                  onChange={(e) => {
                    const value = e.target.value ? new Date(e.target.value).toISOString() : "";
                    updateStep(index, { target_time: value, seconds: undefined });
                  }}
                />
              </label>
            )}
          </div>
        )}

        {step.kind === "condition" && (() => {
          const expr = step.expr || { op: "eq", left: { var: "trigger.record_id" }, right: { literal: "" } };
          const selectedEntityId = step.inputs?.entity_id || defaultConditionEntityId || "";
          const selectedEntity = selectedEntityId ? entityById.get(selectedEntityId) : null;
          const selectedEntityFields = Array.isArray(selectedEntity?.fields) ? selectedEntity.fields : [];
          const leftVar = expr?.left?.var || "";
          const op = expr?.op || "eq";
          const rightVal = expr?.right?.literal ?? "";
          const fieldPathPrefix = "trigger.record.fields.";
          const fieldPathOptions = selectedEntityFields.map((field) => ({
            value: `${fieldPathPrefix}${field.id}`,
            label: field.label || field.id,
            type: field.type,
            options: field.options || [],
          }));
          const commonOptions = [
            { value: "trigger.event", label: "Trigger event", type: "string", options: [] },
            { value: "trigger.entity_id", label: "Trigger entity", type: "string", options: [] },
            { value: "trigger.record_id", label: "Trigger record", type: "string", options: [] },
          ];
          const availableFieldPaths = [...commonOptions, ...fieldPathOptions];
          const selectedFieldDef = availableFieldPaths.find((item) => item.value === leftVar) || null;
          const isExistsOp = op === "exists" || op === "not_exists";
          const isInListOp = op === "in" || op === "not_in";
          const isNumericOp = ["gt", "gte", "lt", "lte"].includes(op);
          const enumOptions = Array.isArray(selectedFieldDef?.options) ? selectedFieldDef.options : [];
          const hasEnumOptions = enumOptions.length > 0;
          const fieldType = selectedFieldDef?.type || "string";
          const stopOnFalse = Boolean(step.stop_on_false);

          function updateConditionValue(raw) {
            let nextValue = raw;
            if (isInListOp) {
              nextValue = String(raw || "")
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean);
            } else if (fieldType === "number" || isNumericOp) {
              nextValue = raw === "" ? "" : Number(raw);
            } else if (fieldType === "boolean") {
              nextValue = raw === "true";
            }
            updateStep(index, { expr: { ...expr, right: { literal: nextValue } } });
          }

          return (
            <div className={wideGridClass}>
              <label className="form-control md:col-span-4">
                <span className="label-text">Entity context</span>
                <select
                  className="select select-bordered"
                  value={selectedEntityId}
                  onChange={(e) => {
                    updateStepInput(index, "entity_id", e.target.value);
                    updateStep(index, { expr: { ...expr, left: { var: "trigger.record_id" } } });
                  }}
                >
                  <option value="">Use trigger entity</option>
                  {entityOptions.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.label || ent.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control md:col-span-4">
                <span className="label-text">Check</span>
                <select
                  className="select select-bordered"
                  value={leftVar}
                  onChange={(e) => updateStep(index, { expr: { ...expr, left: { var: e.target.value } } })}
                >
                  <option value="">Select field…</option>
                  <optgroup label="Trigger">
                    {commonOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                  {fieldPathOptions.length > 0 && (
                    <optgroup label="Record fields">
                      {fieldPathOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <label className="form-control md:col-span-4">
                <span className="label-text">Compare using</span>
                <select
                  className="select select-bordered"
                  value={op}
                  onChange={(e) => updateStep(index, { expr: { ...expr, op: e.target.value } })}
                >
                  <option value="eq">equals</option>
                  <option value="neq">not equals</option>
                  <option value="gt">greater than</option>
                  <option value="gte">greater or equal</option>
                  <option value="lt">less than</option>
                  <option value="lte">less or equal</option>
                  <option value="contains">contains</option>
                  <option value="in">is in list</option>
                  <option value="not_in">is not in list</option>
                  <option value="exists">exists</option>
                  <option value="not_exists">not exists</option>
                </select>
              </label>
              <label className="form-control md:col-span-12">
                <span className="label-text">Against</span>
                {isExistsOp ? (
                  <input className="input input-bordered" value="No value needed for this operator" disabled />
                ) : hasEnumOptions && !isInListOp ? (
                  <select
                    className="select select-bordered"
                    value={String(rightVal ?? "")}
                    onChange={(e) => updateConditionValue(e.target.value)}
                  >
                    <option value="">Select value…</option>
                    {enumOptions.map((opt) => {
                      const value = typeof opt === "string" ? opt : opt?.value;
                      const label = typeof opt === "string" ? opt : opt?.label || opt?.value;
                      if (!value) return null;
                      return (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                ) : fieldType === "boolean" ? (
                  <select
                    className="select select-bordered"
                    value={String(Boolean(rightVal))}
                    onChange={(e) => updateConditionValue(e.target.value)}
                  >
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                ) : (
                  <input
                    className="input input-bordered"
                    type={isNumericOp || fieldType === "number" ? "number" : "text"}
                    value={Array.isArray(rightVal) ? rightVal.join(", ") : rightVal}
                    onChange={(e) => updateConditionValue(e.target.value)}
                    placeholder={isInListOp ? "value1, value2, value3" : ""}
                  />
                )}
                <span className="label label-text-alt opacity-50">
                  {isInListOp ? "Use comma-separated values." : "Condition runs against trigger data."}
                </span>
              </label>
            </div>
          );
        })()}
      </div>
    );
  }

  const builderTab = (
    <div className="space-y-4">
      {error && <div className="alert alert-error">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="form-control">
          <span className="label-text">Name</span>
          <input className="input input-bordered" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="form-control">
          <span className="label-text">Trigger type</span>
          <select className="select select-bordered" value={triggerMode} onChange={(e) => setTriggerMode(e.target.value)}>
            <option value="event">When an event happens</option>
            <option value="webhook">When a webhook is received</option>
            <option value="schedule">Run on a schedule</option>
          </select>
        </div>

        <label className="form-control md:col-span-2">
          <span className="label-text">Description</span>
          <textarea className="textarea textarea-bordered" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>

      {triggerMode === "schedule" ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <div>
            <div className="font-medium text-sm">Schedule</div>
            <div className="text-xs opacity-60 mt-1">Use a simple interval first. The shared scheduler will enqueue this automation in the background.</div>
          </div>
          <label className="form-control max-w-xs">
            <span className="label-text">Run every N minutes</span>
            <input
              className="input input-bordered"
              inputMode="numeric"
              value={trigger?.every_minutes ?? ""}
              onChange={(e) => setTrigger((prev) => ({ ...(prev || {}), kind: "schedule", every_minutes: e.target.value ? Number(e.target.value) : "" }))}
              placeholder="60"
            />
          </label>
        </div>
      ) : triggerMode === "webhook" ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 space-y-4">
          <div>
            <div className="font-medium text-sm">Webhook trigger</div>
            <div className="text-xs opacity-60 mt-1">
              Run this automation when an inbound integration webhook is received. You can narrow it by connection and event key.
            </div>
          </div>
          <label className="form-control">
            <span className="label-text">Connection</span>
            <select
              className="select select-bordered"
              value={webhookTriggerConnectionId}
              onChange={(e) => upsertTriggerFilter("connection_id", e.target.value)}
            >
              <option value="">Any connection</option>
              {webhookConnectionOptions.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {conn.name || conn.id}
                </option>
              ))}
            </select>
            <span className="label label-text-alt opacity-50">Optional. Leave empty to react to webhooks from any configured integration connection.</span>
          </label>
          <label className="form-control">
            <span className="label-text">Event key</span>
            <input
              className="input input-bordered"
              value={webhookTriggerEventKey}
              onChange={(e) => upsertTriggerFilter("event_key", e.target.value)}
              placeholder="invoice.created"
            />
            <span className="label label-text-alt opacity-50">Optional. This matches the event key stored on the inbound webhook definition.</span>
          </label>
          <div className="rounded-box border border-base-300 bg-base-200/40 p-3 text-xs leading-5 text-base-content/70">
            <div className="font-medium text-sm text-base-content">Available trigger data</div>
            <div className="mt-2">Use these paths in conditions, action inputs, and templates:</div>
            <div className="mt-2 font-mono">trigger.connection_id</div>
            <div className="font-mono">trigger.event_key</div>
            <div className="font-mono">trigger.provider_event_id</div>
            <div className="font-mono">trigger.payload</div>
            <div className="font-mono">trigger.headers</div>
            <div className="font-mono">trigger.signature_valid</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setWebhookTestOpen(true)}>
              Test webhook trigger
            </button>
            <div className="self-center text-xs opacity-60">Queue a sample inbound webhook against the saved automation.</div>
          </div>
        </div>
      ) : (
        <div className="form-control">
          <span className="label-text">Trigger event</span>
          <select
            className="select select-bordered"
            value={(trigger?.event_types || [])[0] || ""}
            onChange={(e) => updateTriggerEvent(e.target.value)}
          >
            <option value="">Select event…</option>
            {triggerOptions.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {Array.isArray(group.options) &&
                  group.options.map((evt) => {
                    if (typeof evt === "string") {
                      return <option key={evt} value={evt}>{evt}</option>;
                    }
                    const value = evt.id || "";
                    const label = evt.label || evt.id || "";
                    return <option key={value} value={value}>{label}</option>;
                  })}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {(triggerMode === "event" || triggerMode === "webhook") && (
      <div className="space-y-3">
        <div className="rounded-box border border-base-300 bg-base-100">
          <details className="group">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Advanced trigger rules</div>
                <div className="text-xs opacity-60">Optional. Use this only if the automation should run only in specific cases.</div>
              </div>
              <span className="text-xs opacity-60 group-open:hidden">Show</span>
              <span className="text-xs opacity-60 hidden group-open:inline">Hide</span>
            </summary>
            <div className="px-4 pb-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="label-text">Only run when</div>
                  <div className="text-xs opacity-60 mt-1">
                    {triggerMode === "webhook"
                      ? "Use extra rules only if connection and event key are not enough. These rules run against webhook payload data."
                      : "Most automations can leave this empty and run whenever the trigger happens."}
                  </div>
                </div>
                <button type="button" className="btn btn-sm" onClick={addTriggerFilter}>Add rule</button>
              </div>
              {((trigger?.filters || [])).length === 0 ? (
                <div className="text-xs opacity-60">
                  {triggerMode === "webhook"
                    ? "No extra rules yet. This automation will run whenever the selected webhook trigger matches."
                    : "No extra rules yet. This automation will run every time the selected trigger event happens."}
                </div>
              ) : (
                <div className="space-y-3">
                  {(trigger?.filters || []).map((filt, idx) => {
                    const op = filt?.op || "eq";
                    const noValue = ["exists", "not_exists", "changed"].includes(op);
                    return (
                      <div key={`trigger-filter-${idx}`} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <label className="form-control md:col-span-5">
                          <span className="label-text">Field</span>
                          <input
                            className="input input-bordered"
                            list="automation-trigger-fields"
                            value={filt?.path || ""}
                            onChange={(e) => updateTriggerFilter(idx, { path: e.target.value })}
                            placeholder={triggerMode === "webhook" ? "payload.customer.email" : "status"}
                          />
                        </label>
                        <label className="form-control md:col-span-3">
                          <span className="label-text">Operator</span>
                          <select
                            className="select select-bordered"
                            value={op}
                            onChange={(e) => updateTriggerFilter(idx, { op: e.target.value })}
                          >
                            <option value="eq">equals</option>
                            <option value="neq">not equals</option>
                            <option value="gt">greater than</option>
                            <option value="gte">greater or equal</option>
                            <option value="lt">less than</option>
                            <option value="lte">less or equal</option>
                            <option value="contains">contains</option>
                            <option value="in">in list</option>
                            <option value="not_in">not in list</option>
                            <option value="exists">exists</option>
                            <option value="not_exists">not exists</option>
                            <option value="changed">changed</option>
                            <option value="changed_from">changed from</option>
                            <option value="changed_to">changed to</option>
                          </select>
                        </label>
                        <label className="form-control md:col-span-3">
                          <span className="label-text">Value</span>
                          <input
                            className="input input-bordered"
                            disabled={noValue}
                            value={Array.isArray(filt?.value) ? filt.value.join(", ") : (filt?.value ?? "")}
                            placeholder={noValue ? "No value needed" : triggerMode === "webhook" ? "ops@example.com" : "active"}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const value = ["in", "not_in"].includes(op)
                                ? raw.split(",").map((part) => part.trim()).filter(Boolean)
                                : raw;
                              updateTriggerFilter(idx, { value });
                            }}
                          />
                        </label>
                        <button type="button" className="btn btn-ghost btn-sm md:col-span-1" onClick={() => removeTriggerFilter(idx)}>
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <details className="group">
                <summary className="cursor-pointer list-none py-1 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">Advanced logic</div>
                    <div className="text-xs opacity-60">Only use this if the simple rules above are not enough.</div>
                  </div>
                  <span className="text-xs opacity-60 group-open:hidden">Show</span>
                  <span className="text-xs opacity-60 hidden group-open:inline">Hide</span>
                </summary>
                <div className="pt-3">
                  <label className="form-control">
                    <span className="label-text">Advanced trigger condition JSON</span>
                    <CodeTextarea
                      value={triggerExprText}
                      onChange={(e) => setTriggerExprText(e.target.value)}
                      minHeight="120px"
                      placeholder={`{\n  "op": "and",\n  "children": []\n}`}
                    />
                    <span className="label label-text-alt opacity-50">Optional full condition DSL over `trigger.*` values. Leave empty unless you need advanced branching logic.</span>
                  </label>
                </div>
              </details>
            </div>
          </details>
        </div>
      </div>
      )}

      <div className="space-y-4">
        <div>
          <div className="font-medium">Flow</div>
          <div className="text-xs opacity-60">Click a step to edit it in a focused modal. Add new steps between or after existing steps where they belong. `Then / Else` branches only appear on Condition steps.</div>
        </div>

        <div className="space-y-3 min-w-0">
          <div className="rounded-box border border-base-300 bg-base-100 p-4">
            <div className="text-xs uppercase tracking-wide opacity-60">Trigger</div>
            <div className="font-medium">{triggerSummaryText}</div>
            <div className="text-xs opacity-60 mt-1">
              {trigger?.kind === "schedule"
                ? "Runs on the shared scheduler"
                : triggerMode === "webhook"
                ? [
                    webhookTriggerConnectionId ? "Connection selected" : "Any connection",
                    webhookTriggerEventKey ? `Event key: ${webhookTriggerEventKey}` : "Any webhook event",
                  ].join(" • ")
                : (trigger?.filters || []).length > 0
                ? `${trigger.filters.length} trigger rule${trigger.filters.length === 1 ? "" : "s"}`
                : "Runs for every matching event"}
            </div>
          </div>

          {steps.length === 0 ? (
            <div className="rounded-box border border-dashed border-base-300 bg-base-100 p-6 text-sm opacity-60">
              No steps yet. Add a step to start building the flow.
            </div>
          ) : (
            renderStepCards(steps)
          )}
        </div>
      </div>

      {stepModalOpen && selectedStep && (
        <div className="modal modal-open">
          <div
            className={`modal-box ${isMobile ? "w-full max-w-none h-dvh rounded-none" : "max-w-5xl"}`}
            onFocusCapture={rememberFocusedField}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold text-lg">{stepSummaryText(selectedStep)}</h3>
                <p className="text-sm opacity-70">{stepHelpText(selectedStep)}</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStepModalOpen(false)}>Close</button>
            </div>
            {renderStepEditor(selectedStep, selectedStepPath, { showHeader: false, linear: true })}
          </div>
          <div className="modal-backdrop" onClick={() => setStepModalOpen(false)} />
        </div>
      )}

      <div className="hidden">
        <div className="flex items-center justify-between">
          <span className="label-text">Steps</span>
          <button className="btn btn-sm" onClick={addStep}>Add step</button>
        </div>
        {steps.map((step, index) => {
          const stepKey = step.id || String(index);
          const actionValue = step.module_id ? `${step.module_id}::${step.action_id}` : step.action_id || "";
          const isActionLike = step.kind === "action" || step.kind === "foreach";
          const stepSummary = step.kind === "action"
            ? (step.action_id || "Select action")
            : step.kind === "foreach"
              ? `Repeat ${step.action_id || "action"}`
            : step.kind === "condition"
              ? "Condition"
              : "Delay";
          const isOpen = openStepKeys.includes(stepKey);
          return (
            <div
              key={stepKey}
              className={`collapse border border-base-300 bg-base-200 ${isOpen ? "collapse-open" : "collapse-close"}`}
            >
              <div className="collapse-title pr-2" onClick={() => toggleStep(stepKey)}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Step {index + 1}</div>
                    <div className="text-xs opacity-60">{stepSummary}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveStep(index, -1);
                      }}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={index === steps.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveStep(index, 1);
                      }}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeStep(index);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
              <div className="collapse-content space-y-3 pt-0">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <label className="form-control md:col-span-4">
                    <span className="label-text">Kind</span>
                    <select
                      className="select select-bordered"
                      value={step.kind || "action"}
                      onChange={(e) => updateStep(index, { kind: e.target.value })}
                    >
                      <option value="action">Action</option>
                      <option value="foreach">Repeat action</option>
                      <option value="condition">Condition</option>
                      <option value="delay">Delay</option>
                    </select>
                  </label>

                  {isActionLike && (
                    <label className="form-control md:col-span-8">
                      <span className="label-text">Action</span>
                      <select
                        className="select select-bordered"
                        value={actionValue}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (!value) return;
                          const nextInputs = { ...(step.inputs || {}) };
                          if (value === "system.generate_document") {
                            if (!nextInputs.entity_id) nextInputs.entity_id = "{{trigger.entity_id}}";
                            if (!nextInputs.record_id) nextInputs.record_id = "{{trigger.record_id}}";
                          }
                          if (value.includes("::")) {
                            const [moduleId, actionId] = value.split("::");
                            updateStep(index, { action_id: actionId, module_id: moduleId, inputs: nextInputs });
                          } else {
                            updateStep(index, { action_id: value, module_id: undefined, inputs: nextInputs });
                          }
                        }}
                      >
                        <option value="">Select action…</option>
                        {actionOptions.map((group) => (
                          <optgroup key={group.label} label={group.label}>
                            {(group.options || []).map((action) => (
                              <option
                                key={`${group.module_id || "system"}:${action.id}`}
                                value={group.module_id ? `${group.module_id}::${action.id}` : action.id}
                              >
                                {action.display_id ? `${action.label || action.id} (${action.display_id})` : (action.label || action.id)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {step.kind === "foreach" && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <label className="form-control md:col-span-6">
                      <span className="label-text">Repeat over</span>
                      <input
                        className="input input-bordered"
                        list="automation-loop-hints"
                        value={typeof step.over === "string" ? step.over : ""}
                        onChange={(e) => updateStep(index, { over: e.target.value })}
                        placeholder="{{steps.query_records.records}}"
                      />
                      <span className="label label-text-alt opacity-50">Use a trigger list, query results, or stored variable.</span>
                    </label>
                    <label className="form-control md:col-span-3">
                      <span className="label-text">Item name</span>
                      <input
                        className="input input-bordered"
                        value={step.item_name || "item"}
                        onChange={(e) => updateStep(index, { item_name: e.target.value })}
                        placeholder="item"
                      />
                    </label>
                    <label className="form-control md:col-span-3">
                      <span className="label-text">Store output as</span>
                      <input
                        className="input input-bordered"
                        value={step.store_as || ""}
                        onChange={(e) => updateStep(index, { store_as: e.target.value })}
                        placeholder="loop_results"
                      />
                    </label>
                  </div>
                )}

                {isActionLike && step.action_id === "system.notify" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {(() => {
                          const selectedIds = Array.isArray(step.inputs?.recipient_user_ids)
                            ? step.inputs.recipient_user_ids
                            : step.inputs?.recipient_user_id
                              ? [step.inputs.recipient_user_id]
                              : [];
                          return (
                            <label className="form-control">
                              <span className="label-text">Add recipient user</span>
                              <select
                                className="select select-bordered"
                                value=""
                                onChange={(e) => {
                                  const nextId = e.target.value;
                                  if (!nextId) return;
                                  const next = Array.from(new Set([...selectedIds, nextId]));
                                  updateStepInput(index, "recipient_user_ids", next);
                                  updateStepInput(index, "recipient_user_id", next[0] || "");
                                }}
                              >
                                <option value="">Select user…</option>
                                {memberOptions.map((member) => (
                                  <option key={member.user_id} value={member.user_id}>
                                    {member.name || member.email || member.user_email || member.user_id}
                                  </option>
                                ))}
                              </select>
                              <span className="label label-text-alt opacity-50">You can add multiple recipients.</span>
                            </label>
                          );
                        })()}
                        <div className="md:col-span-2">
                          <span className="label-text">Selected recipients</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(Array.isArray(step.inputs?.recipient_user_ids)
                              ? step.inputs.recipient_user_ids
                              : step.inputs?.recipient_user_id
                                ? [step.inputs.recipient_user_id]
                                : []
                            ).map((userId) => {
                              const member = memberById.get(userId);
                              const label = member?.name || member?.email || member?.user_email || "Unknown user";
                              return (
                                <span key={userId} className="badge badge-outline gap-2 py-3">
                                  {label}
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    onClick={() => {
                                      const current = Array.isArray(step.inputs?.recipient_user_ids)
                                        ? step.inputs.recipient_user_ids
                                        : step.inputs?.recipient_user_id
                                          ? [step.inputs.recipient_user_id]
                                          : [];
                                      const next = current.filter((id) => id !== userId);
                                      updateStepInput(index, "recipient_user_ids", next);
                                      updateStepInput(index, "recipient_user_id", next[0] || "");
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                            {!((Array.isArray(step.inputs?.recipient_user_ids)
                              ? step.inputs.recipient_user_ids
                              : step.inputs?.recipient_user_id
                                ? [step.inputs.recipient_user_id]
                                : []
                            ).length) && <span className="text-xs opacity-60">No recipients selected</span>}
                          </div>
                        </div>
                        <label className="form-control">
                          <span className="label-text">Severity</span>
                          <select className="select select-bordered" value={step.inputs?.severity || "info"} onChange={(e) => updateStepInput(index, "severity", e.target.value)}>
                            <option value="info">Info</option>
                            <option value="success">Success</option>
                            <option value="warning">Warning</option>
                            <option value="danger">Danger</option>
                          </select>
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text">Title</span>
                          <input className="input input-bordered" value={step.inputs?.title || ""} onChange={(e) => updateStepInput(index, "title", e.target.value)} />
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text">Body</span>
                          <CodeTextarea
                            value={step.inputs?.body || ""}
                            onChange={(e) => updateStepInput(index, "body", e.target.value)}
                            minHeight="140px"
                          />
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text">Link</span>
                          <input className="input input-bordered" value={step.inputs?.link_to || ""} onChange={(e) => updateStepInput(index, "link_to", e.target.value)} />
                        </label>
                  </div>
                )}

                {isActionLike && step.action_id === "system.send_email" && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                        {(() => {
                          const selectedEntityId = step.inputs?.entity_id || triggerEventMeta?.entity_id || "";
                          const activeEntity = selectedEntityId ? entityById.get(selectedEntityId) : null;
                          const fields = Array.isArray(activeEntity?.fields) ? activeEntity.fields : [];
                          const emailFields = fields.filter((f) => {
                            const id = (f?.id || "").toLowerCase();
                            const label = (f?.label || "").toLowerCase();
                            return id.includes("email") || label.includes("email");
                          });
                          const attachmentFields = fields.filter((f) => f?.type === "attachments");
                          const lookupFields = fields.filter((f) => f?.type === "lookup");
                          const selectedLookupIdsRaw = step.inputs?.to_lookup_field_ids;
                          const selectedLookupIds = Array.isArray(selectedLookupIdsRaw)
                            ? selectedLookupIdsRaw
                            : typeof selectedLookupIdsRaw === "string"
                              ? selectedLookupIdsRaw.split(",").map((v) => v.trim()).filter(Boolean)
                              : (step.inputs?.to_lookup_field_id ? [step.inputs.to_lookup_field_id] : []);
                          const selectedRecordEmailFieldIds = Array.isArray(step.inputs?.to_field_ids)
                            ? step.inputs.to_field_ids
                            : (step.inputs?.to_field_id ? [step.inputs.to_field_id] : []);
                          const selectedInternalEmails = Array.isArray(step.inputs?.to_internal_emails)
                            ? step.inputs.to_internal_emails
                            : typeof step.inputs?.to_internal_emails === "string"
                              ? step.inputs.to_internal_emails.split(",").map((v) => v.trim()).filter(Boolean)
                              : [];
                          const primaryLookupField = selectedLookupIds[0] || step.inputs?.to_lookup_field_id || "";
                          const selectedLookupFieldDef = lookupFields.find((f) => f.id === primaryLookupField);
                          const targetEntityId = step.inputs?.to_lookup_entity_id || selectedLookupFieldDef?.entity;
                          const targetEntity = targetEntityId ? entityById.get(targetEntityId) : null;
                          const targetFields = Array.isArray(targetEntity?.fields) ? targetEntity.fields : [];
                          const targetEmailFields = targetFields.filter((f) => {
                            const id = (f?.id || "").toLowerCase();
                            const label = (f?.label || "").toLowerCase();
                            return id.includes("email") || label.includes("email");
                          });

                          return (
                            <>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Connection (optional)</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.connection_id || ""}
                            onChange={(e) => updateStepInput(index, "connection_id", e.target.value)}
                          >
                            <option value="">Use default</option>
                            {emailConnectionOptions.map((conn) => (
                              <option key={conn.id} value={conn.id}>
                                {conn.name || conn.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Template (optional)</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.template_id || ""}
                            onChange={(e) => updateStepInput(index, "template_id", e.target.value)}
                          >
                            <option value="">No template</option>
                            {emailTemplateOptions.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name || tpl.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Entity (optional)</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.entity_id || ""}
                            onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                          >
                            <option value="">Use trigger entity</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Record (optional)</span>
                          <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                          <span className="label label-text-alt opacity-50">Optional record for merge fields (paste ID or use trigger).</span>
                        </label>
                        <label className="form-control md:col-span-4">
                          <span className="label-text">Attachment purpose (optional)</span>
                          <input
                            className="input input-bordered"
                            value={step.inputs?.attachment_purpose || ""}
                            onChange={(e) => updateStepInput(index, "attachment_purpose", e.target.value)}
                            placeholder="invoice_pdf"
                          />
                          <span className="label label-text-alt opacity-50">Attach linked files with this purpose from the selected record.</span>
                        </label>
                        <label className="form-control md:col-span-4">
                          <span className="label-text">Attachment entity (optional)</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.attachment_entity_id || ""}
                            onChange={(e) => updateStepInput(index, "attachment_entity_id", e.target.value)}
                          >
                            <option value="">Use email entity</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control md:col-span-4">
                          <span className="label-text">Attachment record (optional)</span>
                          <input
                            className="input input-bordered"
                            list="automation-record-hints"
                            value={step.inputs?.attachment_record_id || ""}
                            onChange={(e) => updateStepInput(index, "attachment_record_id", e.target.value)}
                            placeholder="{{trigger.record_id}}"
                          />
                        </label>
                        <label className="form-control md:col-span-12">
                          <span className="label-text">Attachment field (optional)</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.attachment_field_id || ""}
                            onChange={(e) => updateStepInput(index, "attachment_field_id", e.target.value)}
                          >
                            <option value="">No record attachment field</option>
                            {attachmentFields.map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.label || field.id}
                              </option>
                            ))}
                          </select>
                          <span className="label label-text-alt opacity-50">Optional extra source if files already live in an attachments field on the record.</span>
                        </label>
                        <label className="form-control md:col-span-12">
                          <span className="label-text">Manual email recipients (comma separated)</span>
                          <input className="input input-bordered" value={(step.inputs?.to || []).join(", ")} onChange={(e) => updateStepInput(index, "to", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                          <span className="label label-text-alt opacity-50">These are always included.</span>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Add internal recipient</span>
                          <select
                            className="select select-bordered"
                            value=""
                            onChange={(e) => {
                              const email = e.target.value;
                              if (!email) return;
                              const next = Array.from(new Set([...(selectedInternalEmails || []), email]));
                              updateStepInput(index, "to_internal_emails", next);
                            }}
                          >
                            <option value="">Select workspace member…</option>
                            {memberOptions.map((member) => {
                              const memberEmail = member.email || member.user_email || "";
                              return (
                              <option key={member.user_id} value={memberEmail} disabled={!memberEmail}>
                                {member.name || memberEmail || member.user_id}
                              </option>
                              );
                            })}
                          </select>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Add record email field</span>
                          <select
                            className="select select-bordered"
                            value=""
                            onChange={(e) => {
                              const fieldId = e.target.value;
                              if (!fieldId) return;
                              const next = Array.from(new Set([...(selectedRecordEmailFieldIds || []), fieldId]));
                              updateStepInput(index, "to_field_ids", next);
                              updateStepInput(index, "to_field_id", next[0] || "");
                            }}
                          >
                            <option value="">Select email field…</option>
                            {emailFields.map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.label || field.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Add lookup recipient field</span>
                          <select
                            className="select select-bordered"
                            value=""
                            onChange={(e) => {
                              const fieldId = e.target.value;
                              if (!fieldId) return;
                              const next = Array.from(new Set([...(selectedLookupIds || []), fieldId]));
                              updateStepInput(index, "to_lookup_field_ids", next);
                              updateStepInput(index, "to_lookup_field_id", next[0] || "");
                            }}
                          >
                            <option value="">Select lookup field…</option>
                            {lookupFields.map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.label || field.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Target email field</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.to_lookup_email_field || ""}
                            onChange={(e) => updateStepInput(index, "to_lookup_email_field", e.target.value)}
                          >
                            <option value="">Auto-detect email</option>
                            {targetEmailFields.map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.label || field.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="md:col-span-12">
                          <span className="label-text">Selected recipient sources</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedInternalEmails.map((email) => {
                              const match = memberOptions.find((m) => (m.email || m.user_email) === email);
                              const label = match?.name ? `${match.name} (${email})` : email;
                              return (
                                <span key={`internal:${email}`} className="badge badge-outline gap-2 py-3">
                                  Internal: {label}
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    onClick={() => updateStepInput(index, "to_internal_emails", selectedInternalEmails.filter((v) => v !== email))}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                            {selectedRecordEmailFieldIds.map((fieldId) => {
                              const field = emailFields.find((f) => f.id === fieldId);
                              return (
                                <span key={`record:${fieldId}`} className="badge badge-outline gap-2 py-3">
                                  Record field: {field?.label || fieldId}
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    onClick={() => {
                                      const next = selectedRecordEmailFieldIds.filter((v) => v !== fieldId);
                                      updateStepInput(index, "to_field_ids", next);
                                      updateStepInput(index, "to_field_id", next[0] || "");
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                            {selectedLookupIds.map((fieldId) => {
                              const field = lookupFields.find((f) => f.id === fieldId);
                              return (
                                <span key={`lookup:${fieldId}`} className="badge badge-outline gap-2 py-3">
                                  Lookup: {field?.label || fieldId}
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    onClick={() => {
                                      const next = selectedLookupIds.filter((v) => v !== fieldId);
                                      updateStepInput(index, "to_lookup_field_ids", next);
                                      updateStepInput(index, "to_lookup_field_id", next[0] || "");
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                            {!selectedInternalEmails.length && !selectedRecordEmailFieldIds.length && !selectedLookupIds.length && (
                              <span className="text-xs opacity-60">No dynamic recipient sources selected</span>
                            )}
                          </div>
                        </div>
                          <label className="form-control md:col-span-12">
                            <span className="label-text">Recipient expression</span>
                            <input
                              className="input input-bordered"
                              value={step.inputs?.to_expr || ""}
                              onChange={(e) => updateStepInput(index, "to_expr", e.target.value)}
                              placeholder="{{ record['workorder.contact_email'] }}, ops@octodrop.com"
                            />
                            <span className="label label-text-alt opacity-50">Rendered with Jinja context: record, trigger, branding.</span>
                          </label>
                        <label className="form-control md:col-span-12">
                          <span className="label-text">Subject (optional)</span>
                          <input className="input input-bordered" value={step.inputs?.subject || ""} onChange={(e) => updateStepInput(index, "subject", e.target.value)} />
                          <span className="label label-text-alt opacity-50">Leave blank to use the template subject.</span>
                        </label>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {isActionLike && step.action_id === "system.generate_document" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="form-control">
                          <span className="label-text">Template</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.template_id || ""}
                            onChange={(e) => updateStepInput(index, "template_id", e.target.value)}
                          >
                            <option value="">Select template…</option>
                            {docTemplateOptions.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name || tpl.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control">
                          <span className="label-text">Purpose</span>
                          <input className="input input-bordered" value={step.inputs?.purpose || ""} onChange={(e) => updateStepInput(index, "purpose", e.target.value)} />
                        </label>
                        <label className="form-control">
                          <span className="label-text">Entity</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.entity_id || ""}
                            onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                          >
                            <option value="">Select entity…</option>
                            <option value="{{trigger.entity_id}}">Use trigger entity</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control">
                          <span className="label-text">Record</span>
                          <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                          <span className="label label-text-alt opacity-50">Paste record ID or use trigger.</span>
                        </label>
                  </div>
                )}

                    {isActionLike && step.action_id && !step.action_id.startsWith("system.") && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="form-control">
                          <span className="label-text">Entity</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.entity_id || ""}
                            onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                          >
                            <option value="">Use trigger entity</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control">
                          <span className="label-text">Record</span>
                          <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                          <span className="label label-text-alt opacity-50">Paste record ID or use trigger.</span>
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text">Selected records (comma)</span>
                          <input className="input input-bordered" value={(step.inputs?.selected_ids || []).join(", ")} onChange={(e) => updateStepInput(index, "selected_ids", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                          <span className="label label-text-alt opacity-50">Comma-separated record IDs.</span>
                        </label>
                  </div>
                )}

                {isActionLike && step.action_id === "system.create_record" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text">Entity</span>
                      <select className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">Select entity…</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-control">
                      <span className="label-text">Store output as</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="new_record" />
                    </label>
                    <label className="form-control md:col-span-2">
                      <span className="label-text">Values JSON</span>
                      <CodeTextarea
                        value={typeof step.inputs?.values === "string" ? step.inputs.values : JSON.stringify(step.inputs?.values || {}, null, 2)}
                        onChange={(e) => updateStepInput(index, "values", e.target.value)}
                        minHeight="180px"
                      />
                    </label>
                  </div>
                )}

                {isActionLike && step.action_id === "system.update_record" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text">Entity</span>
                      <select className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">Use trigger entity</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-control">
                      <span className="label-text">Record</span>
                      <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} placeholder="{{trigger.record_id}}" />
                    </label>
                    <label className="form-control">
                      <span className="label-text">Store output as</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="updated_record" />
                    </label>
                    <label className="form-control md:col-span-2">
                      <span className="label-text">Patch JSON</span>
                      <CodeTextarea
                        value={typeof step.inputs?.patch === "string" ? step.inputs.patch : JSON.stringify(step.inputs?.patch || {}, null, 2)}
                        onChange={(e) => updateStepInput(index, "patch", e.target.value)}
                        minHeight="180px"
                      />
                    </label>
                  </div>
                )}

                {isActionLike && step.action_id === "system.query_records" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text">Entity</span>
                      <select className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">Use trigger entity</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-control">
                      <span className="label-text">Search text</span>
                      <input className="input input-bordered" value={step.inputs?.q || ""} onChange={(e) => updateStepInput(index, "q", e.target.value)} />
                    </label>
                    <label className="form-control">
                      <span className="label-text">Search fields</span>
                      <input className="input input-bordered" value={step.inputs?.search_fields || ""} onChange={(e) => updateStepInput(index, "search_fields", e.target.value)} placeholder="field.one, field.two" />
                    </label>
                    <label className="form-control">
                      <span className="label-text">Limit</span>
                      <input className="input input-bordered" type="number" min={1} max={200} value={step.inputs?.limit || 25} onChange={(e) => updateStepInput(index, "limit", Number(e.target.value || 25))} />
                    </label>
                    <label className="form-control">
                      <span className="label-text">Store output as</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="query_results" />
                    </label>
                    <label className="form-control md:col-span-2">
                      <span className="label-text">Filter condition JSON</span>
                      <CodeTextarea
                        value={typeof step.inputs?.filter_expr === "string" ? step.inputs.filter_expr : JSON.stringify(step.inputs?.filter_expr || {}, null, 2)}
                        onChange={(e) => updateStepInput(index, "filter_expr", e.target.value)}
                        minHeight="140px"
                      />
                    </label>
                  </div>
                )}

                {isActionLike && step.action_id === "system.add_chatter" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text">Entity</span>
                      <select className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">Use trigger entity</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-control">
                      <span className="label-text">Record</span>
                      <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} placeholder="{{trigger.record_id}}" />
                    </label>
                    <label className="form-control">
                      <span className="label-text">Entry type</span>
                      <input className="input input-bordered" value={step.inputs?.entry_type || "note"} onChange={(e) => updateStepInput(index, "entry_type", e.target.value)} />
                    </label>
                    <label className="form-control">
                      <span className="label-text">Store output as</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="activity_note" />
                    </label>
                    <label className="form-control md:col-span-2">
                      <span className="label-text">Body</span>
                      <CodeTextarea value={step.inputs?.body || ""} onChange={(e) => updateStepInput(index, "body", e.target.value)} minHeight="140px" />
                    </label>
                  </div>
                )}

                {step.kind === "delay" && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <label className="form-control md:col-span-4">
                      <span className="label-text">Delay mode</span>
                      <select
                        className="select select-bordered"
                        value={step.target_time ? "until_time" : "relative"}
                        onChange={(e) => {
                          if (e.target.value === "until_time") {
                            updateStep(index, { seconds: undefined, target_time: step.target_time || "" });
                          } else {
                            updateStep(index, { target_time: undefined, seconds: step.seconds || 60 });
                          }
                        }}
                      >
                        <option value="relative">Wait relative time</option>
                        <option value="until_time">Wait until datetime</option>
                      </select>
                    </label>
                    {!step.target_time ? (
                      <>
                        <label className="form-control md:col-span-4">
                          <span className="label-text">Amount</span>
                          <input
                            className="input input-bordered"
                            type="number"
                            min={0}
                            value={step.delay_value || step.seconds || 60}
                            onChange={(e) => {
                              const amount = Math.max(0, Number(e.target.value || 0));
                              const unit = step.delay_unit || "seconds";
                              updateStep(index, { delay_value: amount, delay_unit: unit, seconds: amount * delayUnitToSeconds(unit) });
                            }}
                          />
                        </label>
                        <label className="form-control md:col-span-4">
                          <span className="label-text">Unit</span>
                          <select
                            className="select select-bordered"
                            value={step.delay_unit || "seconds"}
                            onChange={(e) => {
                              const unit = e.target.value;
                              const amount = Number(step.delay_value || step.seconds || 60);
                              updateStep(index, { delay_unit: unit, delay_value: amount, seconds: amount * delayUnitToSeconds(unit) });
                            }}
                          >
                            <option value="seconds">Seconds</option>
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                        </label>
                      </>
                    ) : (
                      <label className="form-control md:col-span-8">
                        <span className="label-text">Resume at</span>
                        <input
                          className="input input-bordered"
                          type="datetime-local"
                          value={step.target_time ? new Date(step.target_time).toISOString().slice(0, 16) : ""}
                          onChange={(e) => {
                            const value = e.target.value ? new Date(e.target.value).toISOString() : "";
                            updateStep(index, { target_time: value, seconds: undefined });
                          }}
                        />
                      </label>
                    )}
                  </div>
                )}

                {step.kind === "condition" && (() => {
                  const expr = step.expr || { op: "eq", left: { var: "trigger.record_id" }, right: { literal: "" } };
                  const selectedEntityId = step.inputs?.entity_id || defaultConditionEntityId || "";
                  const selectedEntity = selectedEntityId ? entityById.get(selectedEntityId) : null;
                  const selectedEntityFields = Array.isArray(selectedEntity?.fields) ? selectedEntity.fields : [];
                  const leftVar = expr?.left?.var || "";
                  const op = expr?.op || "eq";
                  const rightVal = expr?.right?.literal ?? "";
                  const fieldPathPrefix = "trigger.record.fields.";
                  const fieldPathOptions = selectedEntityFields.map((field) => ({
                    value: `${fieldPathPrefix}${field.id}`,
                    label: field.label || field.id,
                    type: field.type,
                    options: field.options || [],
                  }));
                  const commonOptions = [
                    { value: "trigger.event", label: "Trigger event", type: "string", options: [] },
                    { value: "trigger.entity_id", label: "Trigger entity", type: "string", options: [] },
                    { value: "trigger.record_id", label: "Trigger record", type: "string", options: [] },
                  ];
                  const availableFieldPaths = [...commonOptions, ...fieldPathOptions];
                  const selectedFieldDef = availableFieldPaths.find((item) => item.value === leftVar) || null;
                  const isExistsOp = op === "exists" || op === "not_exists";
                  const isInListOp = op === "in" || op === "not_in";
                  const isNumericOp = ["gt", "gte", "lt", "lte"].includes(op);
                  const enumOptions = Array.isArray(selectedFieldDef?.options) ? selectedFieldDef.options : [];
                  const hasEnumOptions = enumOptions.length > 0;
                  const fieldType = selectedFieldDef?.type || "string";
                  const stopOnFalse = Boolean(step.stop_on_false);

                  function updateConditionValue(raw) {
                    let nextValue = raw;
                    if (isInListOp) {
                      nextValue = String(raw || "")
                        .split(",")
                        .map((part) => part.trim())
                        .filter(Boolean);
                    } else if (fieldType === "number" || isNumericOp) {
                      nextValue = raw === "" ? "" : Number(raw);
                    } else if (fieldType === "boolean") {
                      nextValue = raw === "true";
                    }
                    updateStep(index, { expr: { ...expr, right: { literal: nextValue } } });
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                      <label className="form-control md:col-span-4">
                        <span className="label-text">Entity context</span>
                        <select
                          className="select select-bordered"
                          value={selectedEntityId}
                          onChange={(e) => {
                            updateStepInput(index, "entity_id", e.target.value);
                            updateStep(index, { expr: { ...expr, left: { var: "trigger.record_id" } } });
                          }}
                        >
                          <option value="">Use trigger entity</option>
                          {entityOptions.map((ent) => (
                            <option key={ent.id} value={ent.id}>
                              {ent.label || ent.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-control md:col-span-4">
                        <span className="label-text">Field</span>
                        <select
                          className="select select-bordered"
                          value={leftVar}
                          onChange={(e) => updateStep(index, { expr: { ...expr, left: { var: e.target.value } } })}
                        >
                          <option value="">Select field…</option>
                          <optgroup label="Trigger">
                            {commonOptions.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </optgroup>
                          {fieldPathOptions.length > 0 && (
                            <optgroup label="Record fields">
                              {fieldPathOptions.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                      <label className="form-control md:col-span-4">
                        <span className="label-text">Operator</span>
                        <select
                          className="select select-bordered"
                          value={op}
                          onChange={(e) => updateStep(index, { expr: { ...expr, op: e.target.value } })}
                        >
                          <option value="eq">equals</option>
                          <option value="neq">not equals</option>
                          <option value="gt">greater than</option>
                          <option value="gte">greater or equal</option>
                          <option value="lt">less than</option>
                          <option value="lte">less or equal</option>
                          <option value="contains">contains</option>
                          <option value="in">is in list</option>
                          <option value="not_in">is not in list</option>
                          <option value="exists">exists</option>
                          <option value="not_exists">not exists</option>
                        </select>
                      </label>
                      <label className="form-control md:col-span-12">
                        <span className="label-text">Value</span>
                        {isExistsOp ? (
                          <input className="input input-bordered" value="No value needed for this operator" disabled />
                        ) : hasEnumOptions && !isInListOp ? (
                          <select
                            className="select select-bordered"
                            value={String(rightVal ?? "")}
                            onChange={(e) => updateConditionValue(e.target.value)}
                          >
                            <option value="">Select value…</option>
                            {enumOptions.map((opt) => {
                              const value = typeof opt === "string" ? opt : opt?.value;
                              const label = typeof opt === "string" ? opt : opt?.label || opt?.value;
                              if (!value) return null;
                              return (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              );
                            })}
                          </select>
                        ) : fieldType === "boolean" ? (
                          <select
                            className="select select-bordered"
                            value={String(Boolean(rightVal))}
                            onChange={(e) => updateConditionValue(e.target.value)}
                          >
                            <option value="true">True</option>
                            <option value="false">False</option>
                          </select>
                        ) : (
                          <input
                            className="input input-bordered"
                            type={isNumericOp || fieldType === "number" ? "number" : "text"}
                            value={Array.isArray(rightVal) ? rightVal.join(", ") : rightVal}
                            onChange={(e) => updateConditionValue(e.target.value)}
                            placeholder={isInListOp ? "value1, value2, value3" : ""}
                          />
                        )}
                        <span className="label label-text-alt opacity-50">
                          {isInListOp ? "Use comma-separated values." : "Condition runs against trigger data."}
                        </span>
                      </label>
                      <label className="form-control md:col-span-12">
                        <span className="label-text">If false</span>
                        <label className="label cursor-pointer justify-start gap-3">
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={stopOnFalse}
                            onChange={(e) => updateStep(index, { stop_on_false: e.target.checked })}
                          />
                          <span className="label-text">Stop automation if condition is false</span>
                        </label>
                      </label>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      <datalist id="automation-users">
        {memberOptions.map((member) => (
          <option key={member.user_id} value={member.user_id}>
            {member.name || member.email || member.user_email || member.user_id}
          </option>
        ))}
      </datalist>
      <datalist id="automation-entities">
        <option value="{{trigger.entity_id}}">Use trigger entity</option>
        {entityOptions.map((ent) => (
          <option key={ent.id} value={ent.id}>
            {ent.label || ent.id}
          </option>
        ))}
      </datalist>
      <datalist id="automation-record-hints">
        <option value="{{trigger.record_id}}">Use trigger.record_id</option>
        <option value="{{last.id}}">Use the last step's ID output</option>
        <option value="{{vars.created_record.id}}">Use a stored record ID</option>
        {triggerMode === "webhook" && (
          <>
            <option value="{{trigger.payload.id}}">Use webhook payload id</option>
            <option value="{{trigger.payload.record_id}}">Use webhook payload record_id</option>
          </>
        )}
      </datalist>
      <datalist id="automation-loop-hints">
        <option value="{{trigger.record_ids}}">Use trigger record IDs</option>
        <option value="{{steps.query_records.records}}">Use records from a query step</option>
        <option value="{{vars.query_results.records}}">Use records from a stored variable</option>
        {triggerMode === "webhook" && (
          <>
            <option value="{{trigger.payload.items}}">Use items from webhook payload</option>
            <option value="{{trigger.payload.records}}">Use records from webhook payload</option>
          </>
        )}
      </datalist>
      <datalist id="automation-trigger-fields">
        {triggerFieldOptions.map((field) => (
          <option key={field.value} value={field.value}>
            {field.label}
          </option>
        ))}
      </datalist>
      <datalist id="automation-connections">
        {connectionOptions.map((conn) => (
          <option key={conn.id} value={conn.id}>
            {conn.name || conn.id}
          </option>
        ))}
      </datalist>
      <datalist id="automation-email-templates">
        {emailTemplateOptions.map((tpl) => (
          <option key={tpl.id} value={tpl.id}>
            {tpl.name || tpl.id}
          </option>
        ))}
      </datalist>
      <datalist id="automation-doc-templates">
        {docTemplateOptions.map((tpl) => (
          <option key={tpl.id} value={tpl.id}>
            {tpl.name || tpl.id}
          </option>
        ))}
      </datalist>
    </div>
  );

  const runsTab = (
    <div className="h-full min-h-0">
      {runsLoading && <div className="text-sm opacity-60">Loading runs…</div>}
      {!runsLoading && runs.length === 0 && (
        <div className="text-sm opacity-60">No runs yet.</div>
      )}
      {!runsLoading && runs.length > 0 && (
        <div className="space-y-2 text-xs">
          {runs.map((run) => (
            <div key={run.id} className="flex items-center justify-between gap-2 border border-base-200 rounded-box px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="badge badge-outline">{run.status || "run"}</span>
                <span className="font-mono">{run.id}</span>
                <span className="opacity-60">{formatDateTime(run.started_at || run.created_at || "", "")}</span>
              </div>
              <button className="btn btn-xs btn-outline" onClick={() => navigate(`/automation-runs/${run.id}`)}>
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const jsonTab = (
    <div className="h-full min-h-0 flex flex-col">
      <div className="text-sm font-semibold mb-2">Automation JSON</div>
      <CodeTextarea
        readOnly
        value={JSON.stringify({ name, description, trigger, steps }, null, 2)}
        fill
      />
    </div>
  );

  async function runWebhookTest() {
    if (!automationId) return;
    setWebhookTestSaving(true);
    setWebhookTestError("");
    try {
      const rawPayload = webhookTestPayloadText.trim();
      const rawHeaders = webhookTestHeadersText.trim();
      const payload = rawPayload ? JSON.parse(rawPayload) : {};
      const headers = rawHeaders ? JSON.parse(rawHeaders) : {};
      const res = await apiFetch(`/automations/${automationId}/test-trigger`, {
        method: "POST",
        body: {
          event_type: "integration.webhook.received",
          connection_id: webhookTestConnectionId || undefined,
          event_key: webhookTestEventKey || undefined,
          provider_event_id: webhookTestProviderEventId || undefined,
          headers,
          payload,
        },
      });
      setWebhookTestOpen(false);
      await loadRuns();
      const runId = res?.run?.id;
      if (runId) navigate(`/automation-runs/${runId}`);
    } catch (err) {
      setWebhookTestError(err?.message || "Failed to queue webhook test");
    }
    setWebhookTestSaving(false);
  }

  const automationProfile = useMemo(() => ({
    kind: "automation",
    defaultTabId: "builder",
    rightTabs: [
      { id: "builder", label: "Builder", render: () => builderTab },
      { id: "runs", label: "Runs", render: () => runsTab },
      { id: "json", label: "JSON", render: () => jsonTab },
    ],
    actions: [
      { id: "save", label: "Save", kind: "secondary", onClick: save, disabled: saving },
      { id: "publish", label: "Publish", kind: "primary", onClick: publish, disabled: item?.status === "published" },
    ],
  }), [builderTab, runsTab, jsonTab, save, publish, saving, item?.status]);

  return (
    <div className={isMobile ? "min-h-full bg-base-100 flex flex-col" : "h-full min-h-0 flex flex-col overflow-hidden"}>
      <TemplateStudioShell
        title={item?.name || "Automation"}
        recordId={automationId}
        profile={automationProfile}
        loadRecord={loadRecord}
        enableAutosave={false}
        renderLeftPane={renderLeftPane}
        renderValidationPanel={renderValidationPanel}
      />
      {webhookTestOpen && (
        <div className="modal modal-open">
          <div className={`modal-box ${isMobile ? "w-full max-w-none h-dvh rounded-none" : "max-w-4xl"}`}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Test webhook trigger</h3>
                <p className="text-sm opacity-70">Queue a test run using a sample inbound webhook event against the saved automation.</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWebhookTestOpen(false)}>
                Close
              </button>
            </div>
            <div className="space-y-4">
              {webhookTestError ? <div className="alert alert-error text-sm">{webhookTestError}</div> : null}
              <label className="form-control">
                <span className="label-text">Connection</span>
                <select className="select select-bordered" value={webhookTestConnectionId} onChange={(e) => setWebhookTestConnectionId(e.target.value)}>
                  <option value="">Any connection</option>
                  {webhookConnectionOptions.map((conn) => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name || conn.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control">
                <span className="label-text">Event key</span>
                <input
                  className="input input-bordered"
                  value={webhookTestEventKey}
                  onChange={(e) => setWebhookTestEventKey(e.target.value)}
                  placeholder="invoice.created"
                />
              </label>
              <label className="form-control">
                <span className="label-text">Provider event ID</span>
                <input
                  className="input input-bordered"
                  value={webhookTestProviderEventId}
                  onChange={(e) => setWebhookTestProviderEventId(e.target.value)}
                  placeholder="evt_12345"
                />
              </label>
              <label className="form-control">
                <span className="label-text">Headers JSON</span>
                <CodeTextarea value={webhookTestHeadersText} onChange={(e) => setWebhookTestHeadersText(e.target.value)} minHeight="140px" />
              </label>
              <label className="form-control">
                <span className="label-text">Payload JSON</span>
                <CodeTextarea value={webhookTestPayloadText} onChange={(e) => setWebhookTestPayloadText(e.target.value)} minHeight="220px" />
                <span className="label label-text-alt opacity-50">This becomes `trigger.payload` in the automation context.</span>
              </label>
              <div className="rounded-box border border-base-300 bg-base-200/40 p-3 text-xs leading-5 text-base-content/70">
                <div className="font-medium text-sm text-base-content">What this test creates</div>
                <div className="mt-2 font-mono">trigger.connection_id = selected connection</div>
                <div className="font-mono">trigger.event_key = entered event key</div>
                <div className="font-mono">trigger.provider_event_id = entered provider event id</div>
                <div className="font-mono">trigger.headers = headers JSON</div>
                <div className="font-mono">trigger.payload = payload JSON</div>
                <div className="font-mono">trigger.event = integration.webhook.received</div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setWebhookTestOpen(false)} disabled={webhookTestSaving}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={runWebhookTest} disabled={webhookTestSaving}>
                  {webhookTestSaving ? "Queueing..." : "Run test"}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setWebhookTestOpen(false)} />
        </div>
      )}
    </div>
  );
}
