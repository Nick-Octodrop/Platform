import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { apiFetch } from "../api";
import TemplateStudioShell from "./templates/TemplateStudioShell.jsx";
import ResponsiveDrawer from "../ui/ResponsiveDrawer.jsx";
import CodeTextarea from "../components/CodeTextarea.jsx";
import ValidationPanel from "../components/ValidationPanel.jsx";
import { useToast } from "../components/Toast.jsx";
import AgentChatInput from "../ui/AgentChatInput.jsx";
import SystemListToolbar from "../ui/SystemListToolbar.jsx";
import ListViewRenderer from "../ui/ListViewRenderer.jsx";
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
  const domainSignature = JSON.stringify(fieldDef?.domain || null);
  const domain = useMemo(() => {
    try {
      return domainSignature ? JSON.parse(domainSignature) : null;
    } catch {
      return null;
    }
  }, [domainSignature]);

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
            domain,
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
  }, [entityId, labelField, debouncedSearch, opened, domain]);

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
          <span key={member.user_id} className="badge badge-outline badge-dismissible">
            {member.label}
            <button
              type="button"
              className="badge-remove"
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
  const [triggerDrawerOpen, setTriggerDrawerOpen] = useState(false);
  const [webhookTestOpen, setWebhookTestOpen] = useState(false);
  const [webhookTestSaving, setWebhookTestSaving] = useState(false);
  const [webhookTestError, setWebhookTestError] = useState("");
  const [webhookTestPayloadText, setWebhookTestPayloadText] = useState("{\n  \n}");
  const [webhookTestHeadersText, setWebhookTestHeadersText] = useState("{\n  \n}");
  const [webhookTestConnectionId, setWebhookTestConnectionId] = useState("");
  const [webhookTestEventKey, setWebhookTestEventKey] = useState("");
  const [webhookTestProviderEventId, setWebhookTestProviderEventId] = useState("");
  const [openStepKeys, setOpenStepKeys] = useState([]);
  const [draggedStepPath, setDraggedStepPath] = useState(null);
  const [dragOverKey, setDragOverKey] = useState("");
  const suppressStepClickRef = useRef(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");
  const [runsSearch, setRunsSearch] = useState("");
  const [runsStatusFilter, setRunsStatusFilter] = useState("all");
  const [runsClientFilters, setRunsClientFilters] = useState([]);
  const [runsPage, setRunsPage] = useState(0);
  const [runsTotalItems, setRunsTotalItems] = useState(0);
  const [editorDraftRows, setEditorDraftRows] = useState({});
  const [jsonEditorText, setJsonEditorText] = useState("");
  const [jsonEditorError, setJsonEditorError] = useState("");
  const [jsonEditorDirty, setJsonEditorDirty] = useState(false);
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
  const automationAddButtonClass = "btn btn-sm btn-ghost shrink-0";

  function buildAutomationDefinition(nextName = name, nextDescription = description, nextTrigger = trigger, nextTriggerExprText = triggerExprText, nextSteps = steps) {
    let normalizedTrigger = nextTrigger && typeof nextTrigger === "object" && !Array.isArray(nextTrigger)
      ? JSON.parse(JSON.stringify(nextTrigger))
      : { kind: "event", event_types: [], filters: [], every_minutes: 60 };
    if (normalizedTrigger.kind === "schedule") {
      normalizedTrigger.kind = "schedule";
      normalizedTrigger.event_types = [];
      normalizedTrigger.filters = [];
      normalizedTrigger.every_minutes = Number(normalizedTrigger.every_minutes) > 0 ? Number(normalizedTrigger.every_minutes) : 60;
      delete normalizedTrigger.expr;
    } else {
      normalizedTrigger.kind = "event";
      normalizedTrigger.event_types = Array.isArray(normalizedTrigger.event_types) ? normalizedTrigger.event_types.filter(Boolean) : [];
      normalizedTrigger.filters = Array.isArray(normalizedTrigger.filters) ? normalizedTrigger.filters : [];
      const rawExpr = String(nextTriggerExprText || "").trim();
      if (rawExpr) {
        try {
          normalizedTrigger.expr = JSON.parse(rawExpr);
        } catch {
          delete normalizedTrigger.expr;
        }
      } else {
        delete normalizedTrigger.expr;
      }
    }
    return {
      name: typeof nextName === "string" ? nextName : "",
      description: typeof nextDescription === "string" ? nextDescription : "",
      trigger: normalizedTrigger,
      steps: Array.isArray(nextSteps) ? JSON.parse(JSON.stringify(nextSteps)) : [],
    };
  }

  function applyAutomationDefinition(rawDefinition) {
    if (!rawDefinition || typeof rawDefinition !== "object" || Array.isArray(rawDefinition)) {
      throw new Error("Automation JSON must be an object.");
    }
    const nextName = typeof rawDefinition.name === "string" ? rawDefinition.name : "";
    const nextDescription = typeof rawDefinition.description === "string" ? rawDefinition.description : "";
    const rawTrigger = rawDefinition.trigger && typeof rawDefinition.trigger === "object" && !Array.isArray(rawDefinition.trigger)
      ? JSON.parse(JSON.stringify(rawDefinition.trigger))
      : { kind: "event", event_types: [], filters: [], every_minutes: 60 };
    const nextTrigger = rawTrigger.kind === "schedule"
      ? {
          ...rawTrigger,
          kind: "schedule",
          event_types: [],
          filters: [],
          every_minutes: Number(rawTrigger.every_minutes) > 0 ? Number(rawTrigger.every_minutes) : 60,
        }
      : {
          ...rawTrigger,
          kind: "event",
          event_types: Array.isArray(rawTrigger.event_types) ? rawTrigger.event_types.filter(Boolean) : [],
          filters: Array.isArray(rawTrigger.filters) ? rawTrigger.filters : [],
        };
    const nextTriggerExprText = nextTrigger.kind === "event" && nextTrigger.expr
      ? JSON.stringify(nextTrigger.expr, null, 2)
      : "";
    if (nextTrigger.kind !== "event") {
      delete nextTrigger.expr;
    }
    const nextSteps = Array.isArray(rawDefinition.steps) ? JSON.parse(JSON.stringify(rawDefinition.steps)) : [];
    setName(nextName);
    setDescription(nextDescription);
    setTrigger(nextTrigger);
    setTriggerExprText(nextTriggerExprText);
    setSteps(nextSteps);
    setEditorDraftRows({});
    setSelectedStepIndex(0);
    setSelectedStepPath(nextSteps.length ? [0] : []);
    setStepModalOpen(false);
    setJsonEditorText(JSON.stringify(buildAutomationDefinition(nextName, nextDescription, nextTrigger, nextTriggerExprText, nextSteps), null, 2));
    setJsonEditorError("");
    setJsonEditorDirty(false);
  }

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
      const nextTriggerExprText = automation?.trigger?.expr ? JSON.stringify(automation.trigger.expr, null, 2) : "";
      const nextSteps = automation?.steps || [];
      setTriggerExprText(nextTriggerExprText);
      setSteps(nextSteps);
      setEditorDraftRows({});
      setJsonEditorText(JSON.stringify(buildAutomationDefinition(automation?.name || "", automation?.description || "", automation?.trigger || { kind: "event", event_types: [], filters: [], every_minutes: 60 }, nextTriggerExprText, nextSteps), null, 2));
      setJsonEditorError("");
      setJsonEditorDirty(false);
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
      if (trigger?.kind === "event" && triggerExprText.trim()) {
        JSON.parse(triggerExprText);
      }
      const definition = buildAutomationDefinition();
      const res = await apiFetch(`/automations/${automationId}`, {
        method: "PUT",
        body: definition,
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
    setRunsError("");
    try {
      const res = await apiFetch(`/automations/${automationId}/runs`);
      setRuns(res?.runs || []);
    } catch (err) {
      setRuns([]);
      setRunsError(err?.message || "Failed to load runs");
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
    setTrigger((prev) => ({
      ...(prev || {}),
      kind: "event",
      event_types: [],
      filters: [],
    }));
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

  function getStepListAtPath(sourceSteps, listPath) {
    const normalized = normalizeStepPath(listPath);
    if (!normalized.length) return sourceSteps;
    const parentPath = normalized.slice(0, -1);
    const branchKey = normalized[normalized.length - 1];
    if (!["then_steps", "else_steps", "steps"].includes(branchKey)) return [];
    const parentStep = getStepAtPath(parentPath, sourceSteps);
    return Array.isArray(parentStep?.[branchKey]) ? parentStep[branchKey] : [];
  }

  function pathsEqual(leftPath, rightPath) {
    const left = normalizeStepPath(leftPath);
    const right = normalizeStepPath(rightPath);
    if (left.length !== right.length) return false;
    return left.every((part, idx) => part === right[idx]);
  }

  function isPathPrefix(prefixPath, fullPath) {
    const prefix = normalizeStepPath(prefixPath);
    const full = normalizeStepPath(fullPath);
    if (prefix.length > full.length) return false;
    return prefix.every((part, idx) => part === full[idx]);
  }

  function moveStepToList(sourcePath, targetListPath, targetIndex) {
    const normalizedSourcePath = normalizeStepPath(sourcePath);
    const normalizedTargetListPath = normalizeStepPath(targetListPath);
    if (!normalizedSourcePath.length) return;
    if (isPathPrefix(normalizedSourcePath, normalizedTargetListPath)) return;

    let nextSelectedPath = null;
    setSteps((prev) => {
      const stepToMove = getStepAtPath(normalizedSourcePath, prev);
      if (!stepToMove) return prev;

      const sourceListPath = normalizedSourcePath.slice(0, -1);
      const sourceIndex = normalizedSourcePath[normalizedSourcePath.length - 1];
      const targetList = getStepListAtPath(prev, normalizedTargetListPath);
      const boundedTargetIndex = Math.max(0, Math.min(targetIndex, targetList.length));

      let adjustedTargetIndex = boundedTargetIndex;
      if (pathsEqual(sourceListPath, normalizedTargetListPath) && typeof sourceIndex === "number" && sourceIndex < boundedTargetIndex) {
        adjustedTargetIndex -= 1;
      }
      if (pathsEqual(sourceListPath, normalizedTargetListPath) && adjustedTargetIndex === sourceIndex) {
        nextSelectedPath = normalizedSourcePath;
        return prev;
      }

      const nextWithoutSource = removeStepAtPath(prev, normalizedSourcePath);
      const nextSteps = insertStepAtListPath(nextWithoutSource, normalizedTargetListPath, adjustedTargetIndex, stepToMove);
      nextSelectedPath = [...normalizedTargetListPath, adjustedTargetIndex];
      return nextSteps;
    });

    if (nextSelectedPath) {
      setSelectedStepPath(nextSelectedPath);
      setStepModalOpen(false);
    }
  }

  function makeDropKey(listPath, insertIndex) {
    return `${normalizeStepPath(listPath).join(".") || "root"}::${insertIndex}`;
  }

  function handleStepDragStart(path, event) {
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", normalizeStepPath(path).join("."));
    }
    suppressStepClickRef.current = true;
    setDraggedStepPath(normalizeStepPath(path));
  }

  function handleStepDragEnd() {
    setDraggedStepPath(null);
    setDragOverKey("");
    setTimeout(() => {
      suppressStepClickRef.current = false;
    }, 0);
  }

  function handleDropIntoList(listPath, insertIndex) {
    if (!draggedStepPath) return;
    moveStepToList(draggedStepPath, listPath, insertIndex);
    handleStepDragEnd();
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
    const add = (value, label, type = "string", options = []) => fields.push({ value, label, type, options });
    add("entity_id", "Entity");
    add("record_id", "Record ID");
    add("user_id", "User ID");
    add("timestamp", "Timestamp", "datetime");
    add("changed_fields", "Changed fields", "text");
    add("from", "From status/value");
    add("to", "To status/value");
    if (triggerMode === "webhook") {
      add("connection_id", "Webhook: Connection ID");
      add("webhook_id", "Webhook: Webhook ID");
      add("provider_event_id", "Webhook: Provider Event ID");
      add("event_key", "Webhook: Event Key");
      add("signature_valid", "Webhook: Signature Valid", "boolean");
      add("payload", "Webhook: Payload object", "text");
      add("payload.customer.email", "Webhook: Payload field example");
      add("headers", "Webhook: Headers object", "text");
      add("headers.x-request-id", "Webhook: Header example");
    }
    if (defaultConditionEntityId) {
      const entity = entityById.get(defaultConditionEntityId);
      const entityFields = Array.isArray(entity?.fields) ? entity.fields : [];
      entityFields.forEach((field) => {
        const shortId = typeof field?.id === "string" ? field.id.split(".").pop() : "";
        const label = field?.label || field?.id;
        if (shortId) {
          add(`record.fields.${shortId}`, `Record: ${label}`, field?.type || "string", field?.options || []);
          add(`before.fields.${shortId}`, `Before: ${label}`, field?.type || "string", field?.options || []);
          add(`after.fields.${shortId}`, `After: ${label}`, field?.type || "string", field?.options || []);
        }
      });
    }
    return fields;
  }, [defaultConditionEntityId, entityById, triggerMode]);

  const triggerFieldOptionByValue = useMemo(() => {
    const map = new Map();
    for (const option of triggerFieldOptions) {
      if (option?.value) map.set(option.value, option);
    }
    return map;
  }, [triggerFieldOptions]);

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

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeRouteEntityId(entityId) {
    const raw = trimText(entityId);
    if (!raw) return "";
    return raw.startsWith("entity.") ? raw.slice("entity.".length) : raw;
  }

  function buildRecordLink(entityId, recordId) {
    const routeEntityId = normalizeRouteEntityId(entityId);
    const rawRecordId = trimText(recordId);
    if (!routeEntityId || !rawRecordId) return "";
    return `/data/${routeEntityId}/${rawRecordId}`;
  }

  function inferNotificationLinkConfig(inputs) {
    const linkTo = trimText(inputs?.link_to);
    const savedMode = trimText(inputs?.link_mode);
    const savedEntityId = trimText(inputs?.link_entity_id);
    const savedRecordId = trimText(inputs?.link_record_id);
    const savedCustomUrl = trimText(inputs?.link_custom_url);

    if (savedMode === "trigger_record") {
      return { mode: "trigger_record", entityId: savedEntityId, recordId: savedRecordId, customUrl: savedCustomUrl };
    }
    if (savedMode === "record") {
      return { mode: "record", entityId: savedEntityId, recordId: savedRecordId, customUrl: savedCustomUrl };
    }
    if (savedMode === "custom") {
      return { mode: "custom", entityId: savedEntityId, recordId: savedRecordId, customUrl: savedCustomUrl || linkTo };
    }
    if (!linkTo) {
      return { mode: "none", entityId: savedEntityId, recordId: savedRecordId, customUrl: savedCustomUrl };
    }
    if (linkTo === "/data/{{trigger.entity_id}}/{{trigger.record_id}}") {
      return { mode: "trigger_record", entityId: savedEntityId, recordId: savedRecordId, customUrl: savedCustomUrl };
    }
    const recordMatch = linkTo.match(/^\/data\/([^/]+)\/(.+)$/i);
    if (recordMatch) {
      return {
        mode: "record",
        entityId: savedEntityId || `entity.${recordMatch[1]}`,
        recordId: savedRecordId || recordMatch[2],
        customUrl: savedCustomUrl,
      };
    }
    return { mode: "custom", entityId: savedEntityId, recordId: savedRecordId, customUrl: savedCustomUrl || linkTo };
  }

  function updateNotificationLink(index, patch) {
    const stepPath = normalizeStepPath(index);
    setSteps((prev) =>
      updateStepAtPath(prev, stepPath, (step) => {
        const nextInputs = { ...(step.inputs || {}) };
        for (const [key, value] of Object.entries(patch || {})) {
          if (value === "" || value === null || value === undefined) {
            delete nextInputs[key];
          } else {
            nextInputs[key] = value;
          }
        }

        const mode = trimText(nextInputs.link_mode);
        let nextLinkTo = "";
        if (mode === "trigger_record") {
          nextLinkTo = "/data/{{trigger.entity_id}}/{{trigger.record_id}}";
        } else if (mode === "record") {
          nextLinkTo = buildRecordLink(nextInputs.link_entity_id, nextInputs.link_record_id);
        } else if (mode === "custom") {
          nextLinkTo = trimText(nextInputs.link_custom_url);
        }

        if (nextLinkTo) {
          nextInputs.link_to = nextLinkTo;
        } else {
          delete nextInputs.link_to;
        }
        return { ...step, inputs: nextInputs };
      })
    );
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

  function editorDraftKey(index, inputKey) {
    const stepPath = normalizeStepPath(index);
    return `${stepPath.join(".") || "root"}::${inputKey}`;
  }

  function readEditorDraftRows(index, inputKey, fallbackRows) {
    const key = editorDraftKey(index, inputKey);
    return Object.prototype.hasOwnProperty.call(editorDraftRows, key) ? editorDraftRows[key] : fallbackRows;
  }

  function clearEditorDraftRows(index, inputKey) {
    const key = editorDraftKey(index, inputKey);
    setEditorDraftRows((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function writeObjectEntries(index, inputKey, rows) {
    const key = editorDraftKey(index, inputKey);
    setEditorDraftRows((prev) => ({ ...prev, [key]: rows }));
    const nextObject = {};
    for (const row of rows) {
      const fieldId = String(row?.fieldId || "").trim();
      if (!fieldId) continue;
      nextObject[fieldId] = parseEditableValue(row?.value ?? "");
    }
    updateStepInput(index, inputKey, Object.keys(nextObject).length ? JSON.stringify(nextObject, null, 2) : "");
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

  function writeFilterRows(index, inputKey, rows) {
    const key = editorDraftKey(index, inputKey);
    setEditorDraftRows((prev) => ({ ...prev, [key]: rows }));
    updateStepInput(index, inputKey, buildFilterExprFromRows(rows));
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

  function shouldUseRefSuggestions(rawValue, placeholder = "") {
    const value = String(rawValue ?? "");
    const hint = String(placeholder ?? "");
    return value.includes("{{") || hint.includes("{{");
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

    return (
      <input
        className="input input-bordered"
        list={shouldUseRefSuggestions(rawValue, placeholder) ? "automation-ref-values" : undefined}
        value={rawValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
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

  useEffect(() => {
    if (jsonEditorDirty) return;
    setJsonEditorText(JSON.stringify(buildAutomationDefinition(), null, 2));
    setJsonEditorError("");
  }, [name, description, trigger, triggerExprText, steps, jsonEditorDirty]);

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

  const validationPanelErrors = useMemo(() => {
    const next = [...validationErrors];
    if (jsonEditorError) next.push(jsonEditorError);
    if (error) next.push(error);
    return next;
  }, [validationErrors, jsonEditorError, error]);

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
          <div className="shrink-0 border-t border-base-200 pt-3">
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
              placeholder="Describe an automation change..."
              minRows={4}
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
      title=""
      errors={validationPanelErrors}
      warnings={[]}
      idleMessage="Validation runs automatically while you edit."
      showSuccess={true}
      showFix={isSuperadmin}
      fixDisabled
    />
  ), [isSuperadmin, validationPanelErrors]);

  const validateRecord = useCallback(async () => ({
    compiled_ok: validationPanelErrors.length === 0,
    errors: validationPanelErrors.map((message) => ({ message })),
    warnings: [],
    undefined: [],
    validated_at: new Date().toISOString(),
  }), [validationPanelErrors]);

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

  function stepTone(step) {
    if (!step) {
      return {
        card: "border-primary/25 bg-primary/5 hover:bg-primary/10",
      };
    }
    return {
      card: "border-primary/25 bg-primary/5 hover:bg-primary/10",
    };
  }

  function stepListLabel(listPath) {
    const normalized = normalizeStepPath(listPath);
    const branchKey = normalized[normalized.length - 1];
    if (branchKey === "then_steps") return "Then";
    if (branchKey === "else_steps") return "Else";
    if (branchKey === "steps") return "Repeat steps";
    return "Flow";
  }

  function renderStepCards(items, pathPrefix = []) {
    const listLabel = stepListLabel(pathPrefix);
    if (!Array.isArray(items) || items.length === 0) {
      const emptyDropKey = makeDropKey(pathPrefix, 0);
      const isDropTarget = dragOverKey === emptyDropKey;
      return (
        <div
          className={`rounded-box border border-dashed p-3 transition ${isDropTarget ? "border-primary bg-primary/5" : "border-base-300 bg-base-100/40"}`}
          onDragOver={(event) => {
            if (!draggedStepPath) return;
            event.preventDefault();
            setDragOverKey(emptyDropKey);
          }}
          onDragLeave={() => {
            if (dragOverKey === emptyDropKey) setDragOverKey("");
          }}
          onDrop={(event) => {
            event.preventDefault();
            handleDropIntoList(pathPrefix, 0);
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs opacity-60">
              {draggedStepPath ? `Drop a step here to start ${listLabel.toLowerCase()}` : "No steps yet."}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => insertStepAfter(pathPrefix, -1)}
            >
              Add step
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {(() => {
          const topDropKey = makeDropKey(pathPrefix, 0);
          const isDropTarget = dragOverKey === topDropKey;
          return (
            <div
              className={`rounded-box border border-dashed px-3 py-2 transition ${draggedStepPath ? "block" : "hidden"} ${isDropTarget ? "border-primary bg-primary/5" : "border-base-300 bg-base-100/30"}`}
              onDragOver={(event) => {
                if (!draggedStepPath) return;
                event.preventDefault();
                setDragOverKey(topDropKey);
              }}
              onDragLeave={() => {
                if (dragOverKey === topDropKey) setDragOverKey("");
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleDropIntoList(pathPrefix, 0);
              }}
            >
              <div className="text-xs opacity-60">{`Drop here to place it first in ${listLabel.toLowerCase()}`}</div>
            </div>
          );
        })()}
        {items.map((step, index) => {
          const path = [...pathPrefix, index];
          const tone = stepTone(step);
          const nestedThen = Array.isArray(step?.then_steps) ? step.then_steps : [];
          const nestedElse = Array.isArray(step?.else_steps) ? step.else_steps : [];
          const nestedLoop = Array.isArray(step?.steps) ? step.steps : [];
          const canMoveUp = index > 0;
          const canMoveDown = index < items.length - 1;
          const afterDropKey = makeDropKey(pathPrefix, index + 1);
          const isAfterDropTarget = dragOverKey === afterDropKey;
          return (
            <div key={step.id || path.join(".")} className="space-y-2">
              <div
                className={`group rounded-2xl border p-4 transition-colors duration-150 cursor-grab active:cursor-grabbing ${tone.card} ${draggedStepPath && pathsEqual(draggedStepPath, path) ? "opacity-60" : ""}`}
                draggable
                onDragStart={(event) => handleStepDragStart(path, event)}
                onDragEnd={handleStepDragEnd}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (suppressStepClickRef.current) return;
                      setSelectedStepPath(path);
                      setSelectedStepIndex(index);
                      setStepModalOpen(true);
                    }}
                  >
                    <div className="text-xs uppercase tracking-wide opacity-60">Step {index + 1}</div>
                    <div className="font-semibold truncate text-base-content">{stepSummaryText(step)}</div>
                    <div className="text-xs opacity-75 mt-1">{stepDetailText(step) || stepHelpText(step)}</div>
                    {step.kind === "condition" && (
                      <div className="text-[11px] opacity-50 mt-1">This step can branch into `Then` and `Else` steps.</div>
                    )}
                  </button>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        title="Drag step"
                        aria-label="Drag step"
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
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
                    {step.store_as ? <div className="text-[10px] opacity-60">var: {step.store_as}</div> : null}
                  </div>
                </div>
              </div>

              {step.kind === "condition" && (
                <div className="ml-5 space-y-3 border-l border-base-300 pl-4">
                  {nestedThen.length > 0 ? (
                    <div className="rounded-box border border-base-300 bg-base-100/60 p-3">
                      <div
                        className={`flex items-center justify-between gap-2 mb-2 rounded-box px-2 py-2 transition ${dragOverKey === makeDropKey([...path, "then_steps"], nestedThen.length) ? "border border-primary bg-primary/5" : ""}`}
                        onDragOver={(event) => {
                          if (!draggedStepPath) return;
                          event.preventDefault();
                          setDragOverKey(makeDropKey([...path, "then_steps"], nestedThen.length));
                        }}
                        onDragLeave={() => {
                          if (dragOverKey === makeDropKey([...path, "then_steps"], nestedThen.length)) setDragOverKey("");
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDropIntoList([...path, "then_steps"], nestedThen.length);
                        }}
                      >
                        <div className="text-xs uppercase tracking-wide opacity-60">Then</div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "then_steps")}>Add step</button>
                      </div>
                      {renderStepCards(nestedThen, [...path, "then_steps"])}
                    </div>
                  ) : (
                    <div
                      className={`rounded-box border border-dashed bg-base-100/40 p-3 transition ${dragOverKey === makeDropKey([...path, "then_steps"], 0) ? "border-primary bg-primary/5" : "border-base-300"}`}
                      onDragOver={(event) => {
                        if (!draggedStepPath) return;
                        event.preventDefault();
                        setDragOverKey(makeDropKey([...path, "then_steps"], 0));
                      }}
                      onDragLeave={() => {
                        if (dragOverKey === makeDropKey([...path, "then_steps"], 0)) setDragOverKey("");
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        handleDropIntoList([...path, "then_steps"], 0);
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide opacity-50">Then</div>
                          <div className="text-xs opacity-60">{draggedStepPath ? "Drop a step here to run it when true." : "These steps run when the condition is true."}</div>
                        </div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "then_steps")}>Add then step</button>
                      </div>
                    </div>
                  )}
                  {nestedElse.length > 0 ? (
                    <div className="rounded-box border border-base-300 bg-base-100/60 p-3">
                      <div
                        className={`flex items-center justify-between gap-2 mb-2 rounded-box px-2 py-2 transition ${dragOverKey === makeDropKey([...path, "else_steps"], nestedElse.length) ? "border border-primary bg-primary/5" : ""}`}
                        onDragOver={(event) => {
                          if (!draggedStepPath) return;
                          event.preventDefault();
                          setDragOverKey(makeDropKey([...path, "else_steps"], nestedElse.length));
                        }}
                        onDragLeave={() => {
                          if (dragOverKey === makeDropKey([...path, "else_steps"], nestedElse.length)) setDragOverKey("");
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDropIntoList([...path, "else_steps"], nestedElse.length);
                        }}
                      >
                        <div className="text-xs uppercase tracking-wide opacity-60">Else</div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "else_steps")}>Add step</button>
                      </div>
                      {renderStepCards(nestedElse, [...path, "else_steps"])}
                    </div>
                  ) : (
                    <div
                      className={`rounded-box border border-dashed bg-base-100/40 p-3 transition ${dragOverKey === makeDropKey([...path, "else_steps"], 0) ? "border-primary bg-primary/5" : "border-base-300"}`}
                      onDragOver={(event) => {
                        if (!draggedStepPath) return;
                        event.preventDefault();
                        setDragOverKey(makeDropKey([...path, "else_steps"], 0));
                      }}
                      onDragLeave={() => {
                        if (dragOverKey === makeDropKey([...path, "else_steps"], 0)) setDragOverKey("");
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        handleDropIntoList([...path, "else_steps"], 0);
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide opacity-50">Else</div>
                          <div className="text-xs opacity-60">{draggedStepPath ? "Drop a step here to run it when false." : "These steps run when the condition is false."}</div>
                        </div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "else_steps")}>Add else step</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step.kind === "foreach" && (
                <div className="ml-5 rounded-box border border-base-300 bg-base-100/60 p-3 space-y-2">
                  <div
                    className={`flex items-center justify-between gap-2 rounded-box px-2 py-2 transition ${dragOverKey === makeDropKey([...path, "steps"], nestedLoop.length) ? "border border-primary bg-primary/5" : ""}`}
                    onDragOver={(event) => {
                      if (!draggedStepPath) return;
                      event.preventDefault();
                      setDragOverKey(makeDropKey([...path, "steps"], nestedLoop.length));
                    }}
                    onDragLeave={() => {
                      if (dragOverKey === makeDropKey([...path, "steps"], nestedLoop.length)) setDragOverKey("");
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDropIntoList([...path, "steps"], nestedLoop.length);
                    }}
                  >
                    <div className="text-xs uppercase tracking-wide opacity-60">Repeat Steps</div>
                    <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "steps")}>Add step</button>
                  </div>
                  {nestedLoop.length ? renderStepCards(nestedLoop, [...path, "steps"]) : (
                    <div
                      className={`rounded-box border border-dashed p-3 text-xs transition ${dragOverKey === makeDropKey([...path, "steps"], 0) ? "border-primary bg-primary/5" : "border-base-300 bg-base-100/30 opacity-50"}`}
                      onDragOver={(event) => {
                        if (!draggedStepPath) return;
                        event.preventDefault();
                        setDragOverKey(makeDropKey([...path, "steps"], 0));
                      }}
                      onDragLeave={() => {
                        if (dragOverKey === makeDropKey([...path, "steps"], 0)) setDragOverKey("");
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        handleDropIntoList([...path, "steps"], 0);
                      }}
                    >
                      {draggedStepPath ? "Drop a step here to repeat it for each item." : "No repeat steps yet."}
                    </div>
                  )}
                </div>
              )}

              <div
                className={`ml-2 rounded-box border border-dashed px-3 py-2 transition ${draggedStepPath ? "block" : "border-transparent"} ${isAfterDropTarget ? "border-primary bg-primary/5" : draggedStepPath ? "border-base-300 bg-base-100/30" : ""}`}
                onDragOver={(event) => {
                  if (!draggedStepPath) return;
                  event.preventDefault();
                  setDragOverKey(afterDropKey);
                }}
                onDragLeave={() => {
                  if (dragOverKey === afterDropKey) setDragOverKey("");
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDropIntoList(pathPrefix, index + 1);
                }}
              >
                {draggedStepPath ? (
                  <div className="text-xs opacity-60">Drop here to place this step between items</div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => insertStepAfter(pathPrefix, index)}
                  >
                    Add step after
                  </button>
                )}
              </div>
            </div>
          );
        })}
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
    const sectionCardClass = "rounded-box border border-base-300 bg-base-200/40 p-4";
    const insetCardClass = "rounded-box border border-base-300 bg-base-200/60 p-4";
    const detailCardClass = "rounded-box border border-base-300 bg-base-100 p-4 space-y-3";
    const builderSectionCardClass = "rounded-box border border-base-300 bg-base-200/40 p-4 space-y-3";
    const builderAddButtonClass = automationAddButtonClass;
    const builderRowCardClass = "rounded-box border border-base-300 bg-base-100 p-3 space-y-3";

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

        <div className={sectionCardClass}>
          <div className="font-medium text-sm">Step setup</div>
          <div className="text-xs opacity-60 mt-1">Start by choosing what kind of step this is and, for actions, what it should do.</div>
          <div className={`mt-3 ${wideGridClass}`}>
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
        </div>

        {step.kind === "foreach" && (
          <div className={sectionCardClass}>
            <div className="font-medium text-sm">Repeat settings</div>
            <div className="text-xs opacity-60 mt-1">Choose the list to loop over and how each repeated item should be referenced.</div>
            <div className={`mt-3 ${wideGridClass}`}>
              <label className="form-control md:col-span-6">
                <span className="label-text">Repeat over</span>
                <input
                  className="input input-bordered"
                  list="automation-loop-hints"
                  value={typeof step.over === "string" ? step.over : ""}
                  onChange={(e) => updateStep(index, { over: e.target.value })}
                  placeholder="{{steps.query_records.records}}"
                />
                <span className="label-text-alt mt-1 block opacity-50">Use a trigger list, query results, or stored variable.</span>
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
          </div>
        )}

        {isActionLike && step.action_id === "system.notify" && (
          <div className="space-y-4">
            {(() => {
              const selectedIds = Array.isArray(step.inputs?.recipient_user_ids)
                ? step.inputs.recipient_user_ids
                : step.inputs?.recipient_user_id
                  ? [step.inputs.recipient_user_id]
                  : [];
              const linkConfig = inferNotificationLinkConfig(step.inputs || {});
              const linkMode = linkConfig.mode || "none";
              return (
                <div className="space-y-4">
                  <div className={sectionCardClass}>
                    <div className="font-medium text-sm">Recipients</div>
                    <div className="text-xs opacity-60 mt-1">Choose which workspace users should receive this notification.</div>
                    <div className="mt-3 space-y-3">
                      <label className="form-control">
                        <span className="label-text">Recipient</span>
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
                          <option value="">Select workspace user…</option>
                          {memberOptions.map((member) => (
                            <option key={member.user_id} value={member.user_id}>
                              {member.name || member.email || member.user_email || member.user_id}
                            </option>
                          ))}
                        </select>
                        <span className="label-text-alt mt-1 block opacity-50">Add one or more workspace users to notify.</span>
                      </label>

                      {selectedIds.length > 0 && (
                        <div className={insetCardClass}>
                          <span className="label-text">Selected recipients</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedIds.map((userId) => {
                              const member = memberById.get(userId);
                              const label = member?.name || member?.email || member?.user_email || "Unknown user";
                              return (
                                <span key={userId} className="badge badge-outline badge-dismissible">
                                  {label}
                                  <button
                                    type="button"
                                    className="badge-remove"
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
                    </div>
                  </div>

                  <div className={sectionCardClass}>
                    <div className="font-medium text-sm">Notification content</div>
                    <div className="text-xs opacity-60 mt-1">Write the message and choose the visual severity.</div>
                    <div className="mt-3 space-y-3">
                      <label className="form-control">
                        <span className="label-text">Title</span>
                        <input className="input input-bordered" value={step.inputs?.title || ""} onChange={(e) => updateStepInput(index, "title", e.target.value)} />
                        <span className="label-text-alt mt-1 block opacity-50">What the user sees as the notification heading.</span>
                      </label>

                      <label className="form-control">
                        <span className="label-text">Body</span>
                        <CodeTextarea
                          value={step.inputs?.body || ""}
                          onChange={(e) => updateStepInput(index, "body", e.target.value)}
                          minHeight="140px"
                        />
                        <span className="label-text-alt mt-1 block opacity-50">Main message text. You can still use refs like {"{{trigger.record_id}}"}.</span>
                      </label>

                      <label className="form-control">
                        <span className="label-text">Severity</span>
                        <select className="select select-bordered" value={step.inputs?.severity || "info"} onChange={(e) => updateStepInput(index, "severity", e.target.value)}>
                          <option value="info">Info</option>
                          <option value="success">Success</option>
                          <option value="warning">Warning</option>
                          <option value="danger">Danger</option>
                        </select>
                        <span className="label-text-alt mt-1 block opacity-50">Optional. This changes the visual style only. Default is Info.</span>
                      </label>
                    </div>
                  </div>

                  <div className={sectionCardClass}>
                    <div className="font-medium text-sm">Link</div>
                    <div className="text-xs opacity-60 mt-1">Choose what should open when someone clicks the notification.</div>
                    <div className="mt-3 space-y-3">
                      <label className="form-control">
                        <span className="label-text">Link target</span>
                        <select
                          className="select select-bordered"
                          value={linkMode}
                          onChange={(e) => {
                            const nextMode = e.target.value;
                            if (nextMode === "record") {
                              updateNotificationLink(index, {
                                link_mode: "record",
                                link_entity_id: step.inputs?.link_entity_id || step.inputs?.entity_id || triggerEventMeta?.entity_id || "",
                                link_record_id: step.inputs?.link_record_id || step.inputs?.record_id || "{{trigger.record_id}}",
                                link_custom_url: undefined,
                              });
                              return;
                            }
                            if (nextMode === "custom") {
                              updateNotificationLink(index, {
                                link_mode: "custom",
                                link_custom_url: linkConfig.customUrl || "",
                                link_entity_id: undefined,
                                link_record_id: undefined,
                              });
                              return;
                            }
                            if (nextMode === "trigger_record") {
                              updateNotificationLink(index, {
                                link_mode: "trigger_record",
                                link_custom_url: undefined,
                                link_entity_id: undefined,
                                link_record_id: undefined,
                              });
                              return;
                            }
                            updateNotificationLink(index, {
                              link_mode: "none",
                              link_custom_url: undefined,
                              link_entity_id: undefined,
                              link_record_id: undefined,
                            });
                          }}
                        >
                          <option value="none">No link</option>
                          <option value="trigger_record">Current trigger record</option>
                          <option value="record">Specific record</option>
                          <option value="custom">Custom URL</option>
                        </select>
                        <span className="label-text-alt mt-1 block opacity-50">
                          {linkMode === "trigger_record"
                            ? "Optional. Opens the record from the trigger event."
                            : linkMode === "record"
                              ? `Optional. Opens a specific record. The record ID starts with {{trigger.record_id}} but you can change it.`
                              : linkMode === "custom"
                                ? "Optional. Opens an internal route or external website."
                                : "Optional. Choose what should open when someone clicks the notification."}
                        </span>
                      </label>

                      {linkMode === "record" && (
                        <div className="space-y-3">
                          <label className="form-control">
                            <span className="label-text">Record entity</span>
                            <select
                              className="select select-bordered"
                              value={linkConfig.entityId || ""}
                              onChange={(e) => updateNotificationLink(index, { link_entity_id: e.target.value })}
                            >
                              <option value="">Select entity…</option>
                              {entityOptions.map((ent) => (
                                <option key={ent.id} value={ent.id}>
                                  {ent.label || ent.id}
                                </option>
                              ))}
                            </select>
                            <span className="label-text-alt mt-1 block opacity-50">Choose the entity that should open from the notification.</span>
                          </label>

                          <label className="form-control">
                            <span className="label-text">Record ID</span>
                            <input
                              className="input input-bordered"
                              list="automation-record-hints"
                              value={linkConfig.recordId || ""}
                              onChange={(e) => updateNotificationLink(index, { link_record_id: e.target.value })}
                              placeholder="{{trigger.record_id}}"
                            />
                            <span className="label-text-alt mt-1 block opacity-50">Defaults to {"{{trigger.record_id}}"}. Change it if this notification should open a different record.</span>
                          </label>
                        </div>
                      )}

                      {linkMode === "custom" && (
                        <label className="form-control">
                          <span className="label-text">Custom URL</span>
                          <input
                            className="input input-bordered"
                            value={linkConfig.customUrl || ""}
                            onChange={(e) => updateNotificationLink(index, { link_custom_url: e.target.value })}
                            placeholder="https://example.com"
                          />
                          <span className="label-text-alt mt-1 block opacity-50">Use an internal route like /home or an external URL like https://example.com.</span>
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {isActionLike && step.action_id === "system.send_email" && (
          <div className="space-y-4">
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
              const hasTemplate = Boolean(step.inputs?.template_id);
              const includeAttachments = Boolean(
                step.inputs?.include_attachments
                || step.inputs?.attachment_purpose
                || step.inputs?.attachment_entity_id
                || step.inputs?.attachment_record_id
                || step.inputs?.attachment_field_id
              );

              return (
                <div className="space-y-4">
                  <div className={sectionCardClass}>
                    <div className="font-medium text-sm">Recipients</div>
                    <div className="text-xs opacity-60 mt-1">Choose who should receive this email, whether that comes from direct addresses, record fields, related records, or expressions.</div>
                    <div className="mt-3 space-y-3">
                      <label className="form-control">
                        <span className="label-text">Direct email addresses</span>
                        <input className="input input-bordered" value={(step.inputs?.to || []).join(", ")} onChange={(e) => updateStepInput(index, "to", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                        <span className="label-text-alt mt-1 block opacity-50">Optional comma-separated addresses. Leave blank if you only want to use recipients from fields or related records.</span>
                      </label>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="form-control">
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
                          <label className="form-control">
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
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        {lookupFields.length > 0 && (
                          <label className="form-control">
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
                          <label className="form-control">
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
                            <span className="label-text-alt mt-1 block opacity-50">Only needed if the related record has more than one email field.</span>
                          </label>
                        )}
                      </div>

                      <label className="form-control">
                        <span className="label-text">Recipient expression</span>
                        <input
                          className="input input-bordered"
                          list="automation-trigger-fields"
                          value={step.inputs?.to_expr || ""}
                          onChange={(e) => updateStepInput(index, "to_expr", e.target.value)}
                          placeholder="{{ record['contact_email'] }}, ops@example.com"
                        />
                        <span className="label-text-alt mt-1 block opacity-50">Optional. Add extra addresses, refs, or expressions in addition to the selected recipient sources.</span>
                      </label>

                      {(selectedInternalEmails.length || selectedRecordEmailFieldIds.length || selectedLookupIds.length) > 0 && (
                        <div className={insetCardClass}>
                          <span className="label-text">Selected recipient sources</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedInternalEmails.map((email) => {
                              const match = memberOptions.find((m) => (m.email || m.user_email) === email);
                              const label = match?.name ? `${match.name} (${email})` : email;
                              return (
                                <span key={`internal:${email}`} className="badge badge-outline badge-dismissible">
                                  Internal: {label}
                                  <button
                                    type="button"
                                    className="badge-remove"
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
                                <span key={`record:${fieldId}`} className="badge badge-outline badge-dismissible">
                                  Record field: {field?.label || fieldId}
                                  <button
                                    type="button"
                                    className="badge-remove"
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
                                <span key={`lookup:${fieldId}`} className="badge badge-outline badge-dismissible">
                                  Lookup: {field?.label || fieldId}
                                  <button
                                    type="button"
                                    className="badge-remove"
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
                    </div>
                  </div>

                  <div className={sectionCardClass}>
                    <div className="font-medium text-sm">Email content</div>
                    <div className="text-xs opacity-60 mt-1">Set how this email is sent, where merge fields should read from, and what the message should contain.</div>
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="form-control">
                          <span className="label-text">Connection</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.connection_id || ""}
                            onChange={(e) => updateStepInput(index, "connection_id", e.target.value)}
                          >
                            <option value="">Use default connection</option>
                            {emailConnectionOptions.map((conn) => (
                              <option key={conn.id} value={conn.id}>
                                {conn.name || conn.id}
                              </option>
                            ))}
                          </select>
                          <span className="label-text-alt mt-1 block opacity-50">Optional. Leave blank to use the workspace default.</span>
                        </label>
                        <label className="form-control">
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
                          <span className="label-text-alt mt-1 block opacity-50">Optional. Leave blank to write the subject and body here instead.</span>
                        </label>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="form-control">
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
                          <span className="label-text-alt mt-1 block opacity-50">Optional. Pick the entity whose fields should be available in this email.</span>
                        </label>
                        <label className="form-control">
                          <span className="label-text">Record for merge fields</span>
                          <input
                            className="input input-bordered"
                            list="automation-record-hints"
                            value={step.inputs?.record_id || ""}
                            onChange={(e) => updateStepInput(index, "record_id", e.target.value)}
                            placeholder="{{trigger.record_id}}"
                          />
                          <span className="label-text-alt mt-1 block opacity-50">
                            Optional. Use a record ID, a ref like <code>{'{{trigger.record_id}}'}</code>, or leave blank to follow the trigger context.
                          </span>
                        </label>
                      </div>

                      <label className="form-control">
                        <span className="label-text">{hasTemplate ? "Subject override" : "Subject"}</span>
                        <input className="input input-bordered" value={step.inputs?.subject || ""} onChange={(e) => updateStepInput(index, "subject", e.target.value)} />
                        <span className="label-text-alt mt-1 block opacity-50">
                          {hasTemplate ? "Optional. Leave blank to use the template subject." : "Required when no template is selected."}
                        </span>
                      </label>

                      {!hasTemplate && (
                        <label className="form-control">
                          <span className="label-text">Email body</span>
                          <CodeTextarea
                            value={step.inputs?.body_text || ""}
                            onChange={(e) => updateStepInput(index, "body_text", e.target.value)}
                            minHeight="160px"
                          />
                          <span className="label-text-alt mt-1 block opacity-50">Required when no template is selected. Write the plain-text body here.</span>
                        </label>
                      )}
                    </div>
                  </div>

                  <div className={sectionCardClass}>
                    <div className="font-medium text-sm">Attachments</div>
                    <div className="text-xs opacity-60 mt-1">Choose whether this email should include generated files or attachments from a record.</div>
                    <div className="mt-3 space-y-3">
                      <label className="form-control">
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
                        <span className="label-text-alt mt-1 block opacity-50">Turn this on only if the email should include generated files or attachments from a record.</span>
                      </label>

                      {includeAttachments && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="form-control">
                            <span className="label-text">Attachment purpose</span>
                            <input
                              className="input input-bordered"
                              value={step.inputs?.attachment_purpose || ""}
                              onChange={(e) => updateStepInput(index, "attachment_purpose", e.target.value)}
                              placeholder="invoice_pdf"
                            />
                            <span className="label-text-alt mt-1 block opacity-50">Optional. Attach linked files with this purpose from the selected record.</span>
                          </label>
                          <label className="form-control">
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
                            <span className="label-text-alt mt-1 block opacity-50">Optional. Leave blank to reuse the email merge entity above.</span>
                          </label>
                          <label className="form-control">
                            <span className="label-text">Attachment record</span>
                            <input
                              className="input input-bordered"
                              list="automation-record-hints"
                              value={step.inputs?.attachment_record_id || ""}
                              onChange={(e) => updateStepInput(index, "attachment_record_id", e.target.value)}
                              placeholder="{{trigger.record_id}}"
                            />
                            <span className="label-text-alt mt-1 block opacity-50">Optional. Use a record ID or a ref if the files live on a different record.</span>
                          </label>
                          <label className="form-control">
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
                            <span className="label-text-alt mt-1 block opacity-50">Optional extra source if files already live in an attachments field on the record.</span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {isActionLike && step.action_id === "system.generate_document" && (
          <div className={sectionCardClass}>
            <div className="font-medium text-sm">Document setup</div>
            <div className="text-xs opacity-60 mt-1">Choose the template, target record, and optional attachment purpose for the generated file.</div>
            <div className={`mt-3 ${standardGridClass}`}>
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
                <span className="label-text-alt mt-1 block opacity-50">Optional attachment purpose tag, like `handover_pdf` or `quote_pdf`.</span>
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
                <span className="label-text-alt mt-1 block opacity-50">Paste record ID or use trigger.</span>
              </label>
            </div>
          </div>
        )}

        {isActionLike && step.action_id === "system.integration_request" && (
          (() => {
            const headerRows = readEditorDraftRows(index, "headers", objectEntriesForEditor(step.inputs?.headers));
            const queryRows = readEditorDraftRows(index, "query", objectEntriesForEditor(step.inputs?.query));
            return (
              <div className="space-y-4">
                <div className={sectionCardClass}>
                  <div className="font-medium text-sm">Request setup</div>
                  <div className="text-xs opacity-60 mt-1">Choose the connection and the endpoint this request should call.</div>
                  <div className={`${standardGridClass} mt-3`}>
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
                      <span className="label-text-alt mt-1 block opacity-50">Use path for the provider base URL. Leave blank if you want to call a full URL directly.</span>
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
                  </div>
                </div>
                <div className={builderSectionCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">Headers</div>
                      <div className="text-xs opacity-60 mt-1">Add request headers one by one. Use Insert on the refs above when a header value should come from the trigger or an earlier step.</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
                      onClick={() => writeObjectEntries(index, "headers", [...headerRows, { fieldId: "", value: "" }])}
                    >
                      Add header
                    </button>
                  </div>
                  {headerRows.length === 0 ? (
                    <div className="text-xs opacity-60">No headers yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {headerRows.map((row, rowIndex) => {
                        const nextRows = headerRows.slice();
                        return (
                          <div key={`request-header-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">Header {rowIndex + 1}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeObjectEntries(index, "headers", headerRows.filter((_, idx) => idx !== rowIndex))}
                              >
                                Remove
                              </button>
                            </div>
                            <div className={standardGridClass}>
                              <label className="form-control">
                                <span className="label-text">Header name</span>
                                <input
                                  className="input input-bordered"
                                  value={row.fieldId}
                                  onChange={(e) => {
                                    nextRows[rowIndex] = { ...row, fieldId: e.target.value };
                                    writeObjectEntries(index, "headers", nextRows);
                                  }}
                                  placeholder="Authorization"
                                />
                              </label>
                              <label className="form-control">
                                <span className="label-text">Header value</span>
                                <input
                                  className="input input-bordered"
                                  list="automation-ref-values"
                                  value={row.value}
                                  onChange={(e) => {
                                    nextRows[rowIndex] = { ...row, value: e.target.value };
                                    writeObjectEntries(index, "headers", nextRows);
                                  }}
                                  placeholder="Bearer {{vars.token}}"
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={builderSectionCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">Query parameters</div>
                      <div className="text-xs opacity-60 mt-1">Add URL query parameters one by one. Leave this empty if the request does not need query values.</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
                      onClick={() => writeObjectEntries(index, "query", [...queryRows, { fieldId: "", value: "" }])}
                    >
                      Add parameter
                    </button>
                  </div>
                  {queryRows.length === 0 ? (
                    <div className="text-xs opacity-60">No query parameters yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {queryRows.map((row, rowIndex) => {
                        const nextRows = queryRows.slice();
                        return (
                          <div key={`request-query-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">Parameter {rowIndex + 1}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeObjectEntries(index, "query", queryRows.filter((_, idx) => idx !== rowIndex))}
                              >
                                Remove
                              </button>
                            </div>
                            <div className={standardGridClass}>
                              <label className="form-control">
                                <span className="label-text">Parameter name</span>
                                <input
                                  className="input input-bordered"
                                  value={row.fieldId}
                                  onChange={(e) => {
                                    nextRows[rowIndex] = { ...row, fieldId: e.target.value };
                                    writeObjectEntries(index, "query", nextRows);
                                  }}
                                  placeholder="updated_since"
                                />
                              </label>
                              <label className="form-control">
                                <span className="label-text">Parameter value</span>
                                <input
                                  className="input input-bordered"
                                  list="automation-ref-values"
                                  value={row.value}
                                  onChange={(e) => {
                                    nextRows[rowIndex] = { ...row, value: e.target.value };
                                    writeObjectEntries(index, "query", nextRows);
                                  }}
                                  placeholder="{{trigger.timestamp}}"
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={sectionCardClass}>
                  <div className="font-medium text-sm">Request body and raw objects</div>
                  <div className="text-xs opacity-60 mt-1">Use this if the request needs a JSON body, a raw body, or you want to edit the raw headers/query objects directly.</div>
                  <div className={`${standardGridClass} mt-3`}>
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
                      <label className="form-control">
                        <span className="label-text">Headers JSON</span>
                        <CodeTextarea
                          value={typeof step.inputs?.headers === "string" ? step.inputs.headers : JSON.stringify(step.inputs?.headers || {}, null, 2)}
                          onChange={(e) => {
                            clearEditorDraftRows(index, "headers");
                            updateStepInput(index, "headers", e.target.value);
                          }}
                          minHeight="120px"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text">Query JSON</span>
                        <CodeTextarea
                          value={typeof step.inputs?.query === "string" ? step.inputs.query : JSON.stringify(step.inputs?.query || {}, null, 2)}
                          onChange={(e) => {
                            clearEditorDraftRows(index, "query");
                            updateStepInput(index, "query", e.target.value);
                          }}
                          minHeight="120px"
                        />
                      </label>
                  </div>
                </div>
              </div>
            );
          })()
        )}

        {isActionLike && step.action_id === "system.integration_sync" && (
          (() => {
            const headerRows = readEditorDraftRows(index, "headers", objectEntriesForEditor(step.inputs?.headers));
            const queryRows = readEditorDraftRows(index, "query", objectEntriesForEditor(step.inputs?.query));
            return (
              <div className="space-y-4">
                <div className={sectionCardClass}>
                  <div className="font-medium text-sm">Sync setup</div>
                  <div className="text-xs opacity-60 mt-1">Choose the connection, checkpoint scope, and whether this sync should emit events or run in the background.</div>
                  <div className={`${standardGridClass} mt-3`}>
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
                      <span className="label-text-alt mt-1 block opacity-50">Use different scopes when one connection syncs more than one resource.</span>
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
                      <span className="label-text-alt mt-1 block opacity-50">Turn this on if later automations should react to each returned item.</span>
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
                      <span className="label-text-alt mt-1 block opacity-50">Use this when the sync might take a while and you do not need the result immediately.</span>
                    </label>
                  </div>
                </div>
                <div className={sectionCardClass}>
                  <div className="font-medium text-sm">Sync request options</div>
                  <div className="text-xs opacity-60 mt-1">Override the saved sync request or cursor settings for this automation run.</div>
                  <div className={`${standardGridClass} mt-3`}>
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
                      <div className={builderSectionCardClass}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-sm">Headers</div>
                            <div className="text-xs opacity-60 mt-1">Override or add sync request headers one by one.</div>
                          </div>
                          <button
                            type="button"
                            className={builderAddButtonClass}
                            onClick={() => writeObjectEntries(index, "headers", [...headerRows, { fieldId: "", value: "" }])}
                          >
                            Add header
                          </button>
                        </div>
                        {headerRows.length === 0 ? (
                          <div className="text-xs opacity-60">No override headers yet.</div>
                        ) : (
                          <div className="space-y-3">
                            {headerRows.map((row, rowIndex) => {
                              const nextRows = headerRows.slice();
                              return (
                                <div key={`sync-header-${rowIndex}`} className={builderRowCardClass}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs font-medium uppercase tracking-wide opacity-60">Header {rowIndex + 1}</div>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs text-error"
                                      onClick={() => writeObjectEntries(index, "headers", headerRows.filter((_, idx) => idx !== rowIndex))}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                  <div className={standardGridClass}>
                                    <label className="form-control">
                                      <span className="label-text">Header name</span>
                                      <input
                                        className="input input-bordered"
                                        value={row.fieldId}
                                        onChange={(e) => {
                                          nextRows[rowIndex] = { ...row, fieldId: e.target.value };
                                          writeObjectEntries(index, "headers", nextRows);
                                        }}
                                        placeholder="Authorization"
                                      />
                                    </label>
                                    <label className="form-control">
                                      <span className="label-text">Header value</span>
                                      <input
                                        className="input input-bordered"
                                        list="automation-ref-values"
                                        value={row.value}
                                        onChange={(e) => {
                                          nextRows[rowIndex] = { ...row, value: e.target.value };
                                          writeObjectEntries(index, "headers", nextRows);
                                        }}
                                        placeholder="Bearer {{vars.token}}"
                                      />
                                    </label>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className={builderSectionCardClass}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-sm">Query parameters</div>
                            <div className="text-xs opacity-60 mt-1">Override or add sync query parameters one by one.</div>
                          </div>
                          <button
                            type="button"
                            className={builderAddButtonClass}
                            onClick={() => writeObjectEntries(index, "query", [...queryRows, { fieldId: "", value: "" }])}
                          >
                            Add parameter
                          </button>
                        </div>
                        {queryRows.length === 0 ? (
                          <div className="text-xs opacity-60">No override query parameters yet.</div>
                        ) : (
                          <div className="space-y-3">
                            {queryRows.map((row, rowIndex) => {
                              const nextRows = queryRows.slice();
                              return (
                                <div key={`sync-query-${rowIndex}`} className={builderRowCardClass}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs font-medium uppercase tracking-wide opacity-60">Parameter {rowIndex + 1}</div>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs text-error"
                                      onClick={() => writeObjectEntries(index, "query", queryRows.filter((_, idx) => idx !== rowIndex))}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                  <div className={standardGridClass}>
                                    <label className="form-control">
                                      <span className="label-text">Parameter name</span>
                                      <input
                                        className="input input-bordered"
                                        value={row.fieldId}
                                        onChange={(e) => {
                                          nextRows[rowIndex] = { ...row, fieldId: e.target.value };
                                          writeObjectEntries(index, "query", nextRows);
                                        }}
                                        placeholder="updated_since"
                                      />
                                    </label>
                                    <label className="form-control">
                                      <span className="label-text">Parameter value</span>
                                      <input
                                        className="input input-bordered"
                                        list="automation-ref-values"
                                        value={row.value}
                                        onChange={(e) => {
                                          nextRows[rowIndex] = { ...row, value: e.target.value };
                                          writeObjectEntries(index, "query", nextRows);
                                        }}
                                        placeholder="{{trigger.timestamp}}"
                                      />
                                    </label>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <label className="form-control">
                        <span className="label-text">Headers JSON</span>
                        <CodeTextarea
                          value={typeof step.inputs?.headers === "string" ? step.inputs.headers : JSON.stringify(step.inputs?.headers || {}, null, 2)}
                          onChange={(e) => {
                            clearEditorDraftRows(index, "headers");
                            updateStepInput(index, "headers", e.target.value);
                          }}
                          minHeight="120px"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text">Query JSON</span>
                        <CodeTextarea
                          value={typeof step.inputs?.query === "string" ? step.inputs.query : JSON.stringify(step.inputs?.query || {}, null, 2)}
                          onChange={(e) => {
                            clearEditorDraftRows(index, "query");
                            updateStepInput(index, "query", e.target.value);
                          }}
                          minHeight="120px"
                        />
                      </label>
                  </div>
                </div>
              </div>
            );
          })()
        )}

        {isActionLike && step.action_id && !step.action_id.startsWith("system.") && (
          <div className={sectionCardClass}>
            <div className="font-medium text-sm">Action target</div>
            <div className="text-xs opacity-60 mt-1">Choose which record or records this module action should run against.</div>
            <div className={`mt-3 ${standardGridClass}`}>
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
                <span className="label-text-alt mt-1 block opacity-50">Paste record ID or use trigger.</span>
              </label>
              <label className="form-control md:col-span-2">
                <span className="label-text">Selected records (comma)</span>
                <input className="input input-bordered" value={(step.inputs?.selected_ids || []).join(", ")} onChange={(e) => updateStepInput(index, "selected_ids", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                <span className="label-text-alt mt-1 block opacity-50">Comma-separated record IDs.</span>
              </label>
            </div>
          </div>
        )}

        {isActionLike && step.action_id === "system.create_record" && (
          (() => {
            const selectedEntityId = step.inputs?.entity_id || "";
            const selectedEntity = selectedEntityId ? entityById.get(selectedEntityId) : null;
            const selectedEntityFields = Array.isArray(selectedEntity?.fields) ? selectedEntity.fields : [];
            const fieldDatalistId = `automation-step-fields-${normalizedPath.join("-") || "root"}-create`;
            const rows = readEditorDraftRows(index, "values", objectEntriesForEditor(step.inputs?.values));
            return (
              <div className="space-y-4">
                <div className={sectionCardClass}>
                  <div className="font-medium text-sm">Record setup</div>
                  <div className="text-xs opacity-60 mt-1">Choose which entity to create and where to store the result for later steps.</div>
                  <div className={`${standardGridClass} mt-3`}>
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
                  </div>
                </div>
                <div className={builderSectionCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">Field values</div>
                      <div className="text-xs opacity-60 mt-1">Fill out the record one field at a time. Use Insert on the refs above when a value should come from the trigger or an earlier step.</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
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
                          <div key={`create-value-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">Field {rowIndex + 1}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeObjectEntries(index, "values", rows.filter((_, idx) => idx !== rowIndex))}
                              >
                                Remove
                              </button>
                            </div>
                            <div className={standardGridClass}>
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
                            </div>
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
                  <div className={detailCardClass}>
                    <div className="font-medium text-sm">Raw values JSON</div>
                    <div className="text-xs opacity-60 mt-1">Use this only if you need nested objects or a shape that is easier to paste as raw JSON.</div>
                    <div className="mt-3">
                      <label className="form-control">
                        <span className="label-text">Values JSON</span>
                        <CodeTextarea
                          value={stringifyJsonObjectInput(step.inputs?.values)}
                          onChange={(e) => {
                            clearEditorDraftRows(index, "values");
                            updateStepInput(index, "values", e.target.value);
                          }}
                          minHeight="180px"
                          placeholder={`{\n  "field_id": "value",\n  "other_field": "{{trigger.record_id}}"\n}`}
                        />
                      </label>
                    </div>
                  </div>
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
            const rows = readEditorDraftRows(index, "patch", objectEntriesForEditor(step.inputs?.patch));
            return (
              <div className="space-y-4">
                <div className={sectionCardClass}>
                  <div className="font-medium text-sm">Record target</div>
                  <div className="text-xs opacity-60 mt-1">Choose the entity and record to update, and optionally store the returned record.</div>
                  <div className={`${standardGridClass} mt-3`}>
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
                  </div>
                </div>
                <div className={builderSectionCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">Field changes</div>
                      <div className="text-xs opacity-60 mt-1">Only add the fields you want to change. Anything you leave out is untouched.</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
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
                          <div key={`update-patch-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">Change {rowIndex + 1}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeObjectEntries(index, "patch", rows.filter((_, idx) => idx !== rowIndex))}
                              >
                                Remove
                              </button>
                            </div>
                            <div className={standardGridClass}>
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
                            </div>
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
                  <div className={detailCardClass}>
                    <div className="font-medium text-sm">Raw patch JSON</div>
                    <div className="text-xs opacity-60 mt-1">Use this only if you need nested objects or want to paste a prepared patch object.</div>
                    <div className="mt-3">
                      <label className="form-control">
                        <span className="label-text">Patch JSON</span>
                        <CodeTextarea
                          value={stringifyJsonObjectInput(step.inputs?.patch)}
                          onChange={(e) => {
                            clearEditorDraftRows(index, "patch");
                            updateStepInput(index, "patch", e.target.value);
                          }}
                          minHeight="180px"
                          placeholder={`{\n  "status": "approved"\n}`}
                        />
                      </label>
                    </div>
                  </div>
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
            const filterRows = readEditorDraftRows(index, "filter_expr", parseFilterRows(step.inputs?.filter_expr));
            return (
              <div className="space-y-4">
                <div className={sectionCardClass}>
                  <div className="font-medium text-sm">Query setup</div>
                  <div className="text-xs opacity-60 mt-1">Choose the entity, optional search text, and how many records should be returned.</div>
                  <div className={`${standardGridClass} mt-3`}>
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
                      <span className="label-text-alt mt-1 block opacity-50">Optional text search. Leave blank if you only want to use filter rules.</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text">Limit</span>
                      <input className="input input-bordered" type="number" min={1} max={200} value={step.inputs?.limit || 25} onChange={(e) => updateStepInput(index, "limit", Number(e.target.value || 25))} />
                      <span className="label-text-alt mt-1 block opacity-50">Only the first matching records are returned to later steps.</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text">Store output as</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="query_results" />
                    </label>
                  </div>
                </div>
                <div className={builderSectionCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">Quick filters</div>
                      <div className="text-xs opacity-60 mt-1">Add simple rules to narrow down records. These compile into the same advanced filter JSON behind the scenes.</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
                      onClick={() => writeFilterRows(index, "filter_expr", [...filterRows, { path: "", op: "eq", value: "" }])}
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
                          <div key={`query-filter-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">Rule {rowIndex + 1}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeFilterRows(index, "filter_expr", filterRows.filter((_, idx) => idx !== rowIndex))}
                              >
                                Remove
                              </button>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)]">
                              <label className="form-control">
                                <span className="label-text">Field path</span>
                                <input
                                  className="input input-bordered"
                                  list={fieldDatalistId}
                                  value={row.path}
                                  onChange={(e) => {
                                    nextRows[rowIndex] = { ...row, path: e.target.value };
                                    writeFilterRows(index, "filter_expr", nextRows);
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
                                    writeFilterRows(index, "filter_expr", nextRows);
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
                                      writeFilterRows(index, "filter_expr", nextRows);
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
                            </div>
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
                  <div className={sectionCardClass}>
                    <div className="font-medium text-sm">Search and raw filter options</div>
                    <div className="text-xs opacity-60 mt-1">Use this for search field limits or a more complex filter expression than the quick rules above can represent.</div>
                    <div className={`${standardGridClass} mt-3`}>
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
                          onChange={(e) => {
                            clearEditorDraftRows(index, "filter_expr");
                            updateStepInput(index, "filter_expr", e.target.value);
                          }}
                          minHeight="140px"
                          placeholder={`{\n  "op": "eq",\n  "left": { "var": "record.status" },\n  "right": { "literal": "open" }\n}`}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()
        )}

        {isActionLike && step.action_id === "system.add_chatter" && (
          <div className={sectionCardClass}>
            <div className="font-medium text-sm">Entry setup</div>
            <div className="text-xs opacity-60 mt-1">Choose the record, entry type, and message that should be added as chatter.</div>
            <div className={`mt-3 ${standardGridClass}`}>
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
          </div>
        )}

        {step.kind === "delay" && (
          <div className={sectionCardClass}>
            <div className="font-medium text-sm">Delay settings</div>
            <div className="text-xs opacity-60 mt-1">Choose whether the step should wait for a relative amount of time or until a specific datetime.</div>
            <div className={`mt-3 ${wideGridClass}`}>
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
          const commonOptions = triggerMode === "webhook"
            ? [
                { value: "trigger.event", label: "Trigger event", type: "string", options: [] },
                { value: "trigger.connection_id", label: "Webhook connection", type: "string", options: [] },
                { value: "trigger.event_key", label: "Webhook event key", type: "string", options: [] },
                { value: "trigger.provider_event_id", label: "Provider event id", type: "string", options: [] },
                { value: "trigger.signature_valid", label: "Signature valid", type: "boolean", options: [] },
                { value: "trigger.payload", label: "Payload object", type: "text", options: [] },
                { value: "trigger.payload.customer.email", label: "Payload example: customer email", type: "string", options: [] },
                { value: "trigger.headers", label: "Headers object", type: "text", options: [] },
                { value: "trigger.headers.x-request-id", label: "Header example: x-request-id", type: "string", options: [] },
              ]
            : [
                { value: "trigger.event", label: "Trigger event", type: "string", options: [] },
                { value: "trigger.entity_id", label: "Trigger entity", type: "string", options: [] },
                { value: "trigger.record_id", label: "Trigger record", type: "string", options: [] },
                { value: "trigger.user_id", label: "Trigger user", type: "string", options: [] },
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
            <div className={sectionCardClass}>
              <div className="font-medium text-sm">Condition rule</div>
              <div className="text-xs opacity-60 mt-1">Choose the field to check, how to compare it, and what value should be matched.</div>
              <div className={`mt-3 ${wideGridClass}`}>
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
            </div>
          );
        })()}
      </div>
    );
  }

  const builderTab = null && (
    <div className="space-y-5">
      {error && <div className="alert alert-error">{error}</div>}
      <div className="rounded-2xl border border-base-300 bg-base-100 p-4 md:p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="form-control">
            <span className="label-text">Name</span>
            <input className="input input-bordered" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="form-control md:col-span-2">
            <span className="label-text">Description</span>
            <textarea className="textarea textarea-bordered" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>

        <div className="rounded-box border border-base-300 bg-base-200/40 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide opacity-50">Trigger summary</div>
          <div className="mt-1 font-medium">{triggerSummaryText}</div>
          <div className="mt-1 text-xs opacity-60">
            {triggerMode === "schedule"
              ? "This automation runs from the shared scheduler."
              : "Keep this simple where possible. Most automations only need a trigger and a flow."}
          </div>
        </div>

        <div className="rounded-box border border-base-300 bg-base-200/40">
          <details>
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Trigger setup</div>
                <div className="text-xs opacity-60">Edit the trigger only when needed. The main work happens in the flow below.</div>
              </div>
              <span className="text-xs opacity-60">Show</span>
            </summary>
            <div className="px-4 pb-4 space-y-4">
              {triggerMode === "schedule" ? (
                <div className="space-y-3">
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
                <div className="space-y-4">
                  <div>
                    <div className="font-medium text-sm">Webhook trigger</div>
                    <div className="text-xs opacity-60 mt-1">
                      Run this automation when an inbound integration webhook is received. Narrow it only if you need to.
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
                    <span className="label label-text-alt opacity-50">Optional. Leave empty to react to any configured integration connection.</span>
                  </label>
                  <label className="form-control">
                    <span className="label-text">Event key</span>
                    <input
                      className="input input-bordered"
                      value={webhookTriggerEventKey}
                      onChange={(e) => upsertTriggerFilter("event_key", e.target.value)}
                      placeholder="invoice.created"
                    />
                    <span className="label label-text-alt opacity-50">Optional. Only set this if the flow should run for one webhook event type.</span>
                  </label>
                  <details className="rounded-box border border-base-300 bg-base-200/40">
                    <summary className="cursor-pointer list-none px-3 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Webhook data available to the flow</div>
                        <div className="text-xs opacity-60">Only open this if you need payload paths.</div>
                      </div>
                      <span className="text-xs opacity-60">Show</span>
                    </summary>
                    <div className="px-3 pb-3 text-xs leading-5 text-base-content/70">
                      <div className="font-mono">trigger.connection_id</div>
                      <div className="font-mono">trigger.event_key</div>
                      <div className="font-mono">trigger.provider_event_id</div>
                      <div className="font-mono">trigger.payload</div>
                      <div className="font-mono">trigger.headers</div>
                      <div className="font-mono">trigger.signature_valid</div>
                    </div>
                  </details>
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
                <div className="rounded-box border border-base-300 bg-base-200/40">
                  <details className="group">
                    <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Advanced trigger rules</div>
                        <div className="text-xs opacity-60">Optional. Use this only if the automation should run only in specific cases.</div>
                      </div>
                      <span className="text-xs opacity-60 group-[&[open]]:hidden">Show</span>
                      <span className="text-xs opacity-60 hidden group-[&[open]]:inline">Hide</span>
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
                <button type="button" className={automationAddButtonClass} onClick={addTriggerFilter}>Add rule</button>
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
                    const selectedFieldDef = triggerFieldOptionByValue.get(filt?.path || "") || null;
                    const supportsTypedValue = !["in", "not_in"].includes(op) && !noValue;
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
                          <span className="label label-text-alt opacity-50">
                            {selectedFieldDef
                              ? `Field type: ${selectedFieldDef.type || "string"}`
                              : "Pick a suggested field or type a custom path."}
                          </span>
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
                          {noValue ? (
                            <input className="input input-bordered" disabled value="No value needed" />
                          ) : supportsTypedValue ? (
                            renderTypedValueEditor({
                              fieldDef: selectedFieldDef,
                              value: Array.isArray(filt?.value) ? filt.value.join(", ") : (filt?.value ?? ""),
                              onChange: (nextValue) => updateTriggerFilter(idx, { value: nextValue }),
                              placeholder: triggerMode === "webhook" ? "ops@example.com" : "active",
                            })
                          ) : (
                            <input
                              className="input input-bordered"
                              value={Array.isArray(filt?.value) ? filt.value.join(", ") : (filt?.value ?? "")}
                              placeholder={triggerMode === "webhook" ? "one, two" : "active, pending"}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const value = ["in", "not_in"].includes(op)
                                  ? raw.split(",").map((part) => part.trim()).filter(Boolean)
                                  : raw;
                                updateTriggerFilter(idx, { value });
                              }}
                            />
                          )}
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
                  <span className="text-xs opacity-60 group-[&[open]]:hidden">Show</span>
                  <span className="text-xs opacity-60 hidden group-[&[open]]:inline">Hide</span>
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
            </div>
          </details>
        </div>
      </div>

      <div className="rounded-2xl border border-primary/30 bg-base-100 shadow-sm">
        <div className="border-b border-primary/15 bg-primary/5 px-4 py-4 md:px-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-primary/70">Automation Flow</div>
          <div className="mt-1 text-lg font-semibold">Build what happens after the trigger</div>
          <div className="mt-1 text-xs opacity-70">Click the trigger or a step to edit it in a focused drawer. Add steps where they belong. `Then / Else` branches only appear on Condition steps.</div>
        </div>
        <div className="space-y-3 min-w-0 p-4 md:p-5">
          <button
            type="button"
            className="w-full rounded-box border border-base-300 bg-base-200/40 p-4 text-left transition hover:border-primary/40 hover:bg-base-200/60"
            onClick={() => setTriggerDrawerOpen(true)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
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
              <span className="btn btn-sm btn-outline">Edit trigger</span>
            </div>
          </button>

          {steps.length === 0 ? (
            <div className="rounded-box border border-dashed border-base-300 bg-base-100 p-6 text-sm opacity-60">
              No steps yet. Add a step to start building the flow.
            </div>
          ) : (
            renderStepCards(steps)
          )}
        </div>
      </div>

      <ResponsiveDrawer
        open={Boolean(stepModalOpen && selectedStep)}
        onClose={() => setStepModalOpen(false)}
        title={selectedStep ? stepSummaryText(selectedStep) : "Step"}
        description={selectedStep ? stepHelpText(selectedStep) : ""}
        mobileHeightClass="h-[92dvh] max-h-[92dvh]"
        zIndexClass="z-[240]"
      >
        {selectedStep ? (
          <div onFocusCapture={rememberFocusedField}>
            {renderStepEditor(selectedStep, selectedStepPath, { showHeader: false, linear: true })}
          </div>
        ) : null}
      </ResponsiveDrawer>

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
                                <span key={userId} className="badge badge-outline badge-dismissible">
                                  {label}
                                  <button
                                    type="button"
                                    className="badge-remove"
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
                                <span key={`internal:${email}`} className="badge badge-outline badge-dismissible">
                                  Internal: {label}
                                  <button
                                    type="button"
                                    className="badge-remove"
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
                                <span key={`record:${fieldId}`} className="badge badge-outline badge-dismissible">
                                  Record field: {field?.label || fieldId}
                                  <button
                                    type="button"
                                    className="badge-remove"
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
                                <span key={`lookup:${fieldId}`} className="badge badge-outline badge-dismissible">
                                  Lookup: {field?.label || fieldId}
                                  <button
                                    type="button"
                                    className="badge-remove"
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
                        <input
                          className="input input-bordered"
                          list={`automation-condition-fields-${normalizedPath.join("-") || "root"}`}
                          value={leftVar}
                          onChange={(e) => updateStep(index, { expr: { ...expr, left: { var: e.target.value } } })}
                          placeholder={triggerMode === "webhook" ? "trigger.payload.customer.email" : "trigger.record.fields.status"}
                        />
                        <datalist id={`automation-condition-fields-${normalizedPath.join("-") || "root"}`}>
                          {availableFieldPaths.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </datalist>
                        <span className="label label-text-alt opacity-50">
                          {selectedFieldDef
                            ? `Field type: ${selectedFieldDef.type || "string"}`
                            : "Pick a suggested field or type a custom path."}
                        </span>
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
                        ) : !isInListOp ? (
                          renderTypedValueEditor({
                            fieldDef: selectedFieldDef || { type: fieldType, options: enumOptions },
                            value: Array.isArray(rightVal) ? rightVal.join(", ") : rightVal,
                            onChange: updateConditionValue,
                            placeholder: triggerMode === "webhook" ? "ops@example.com" : "",
                          })
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
      <datalist id="automation-ref-values">
        <option value="{{trigger.entity_id}}">Trigger entity ID</option>
        <option value="{{trigger.record_id}}">Trigger record ID</option>
        <option value="{{trigger.user_id}}">Trigger user ID</option>
        <option value="{{trigger.timestamp}}">Trigger timestamp</option>
        <option value="{{last.id}}">Last step ID</option>
        <option value="{{last.records}}">Last step records</option>
        <option value="{{vars.created_record.id}}">Created record ID</option>
        <option value="{{vars.query_results.records}}">Stored query records</option>
        <option value="{{item.id}}">Loop item ID</option>
        <option value="{{item.record_id}}">Loop item record ID</option>
        {triggerMode === "webhook" && (
          <>
            <option value="{{trigger.connection_id}}">Webhook connection ID</option>
            <option value="{{trigger.event_key}}">Webhook event key</option>
            <option value="{{trigger.provider_event_id}}">Webhook provider event ID</option>
            <option value="{{trigger.payload.id}}">Webhook payload ID</option>
            <option value="{{trigger.payload.record_id}}">Webhook payload record ID</option>
          </>
        )}
        {triggerFieldOptions.map((field) => (
          <option key={`ref:${field.value}`} value={`{{trigger.${field.value}}}`}>
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
      <datalist id="automation-attachment-fields">
        {attachmentFields.map((field) => (
          <option key={field.id} value={field.id}>
            {field.label || field.id}
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

  const triggerSectionCardClass = "rounded-box border border-base-300 bg-base-200/40 p-4 space-y-3";
  const triggerDetailCardClass = "rounded-box border border-base-300 bg-base-100 p-4 space-y-3";

  const triggerEditorContent = (
    <div className="automation-drawer-linear space-y-4">
      <div className={triggerSectionCardClass}>
        <div>
          <div className="font-medium text-sm">Trigger setup</div>
          <div className="text-xs opacity-60 mt-1">Choose what starts this automation and fill in the matching trigger details.</div>
        </div>
        <label className="form-control">
          <span className="label-text">Trigger type</span>
          <select className="select select-bordered" value={triggerMode} onChange={(e) => setTriggerMode(e.target.value)}>
            <option value="event">When an event happens</option>
            <option value="webhook">When a webhook is received</option>
            <option value="schedule">Run on a schedule</option>
          </select>
        </label>

        {triggerMode === "schedule" ? (
          <label className="form-control max-w-xs">
            <span className="label-text">Run every N minutes</span>
            <input
              className="input input-bordered"
              inputMode="numeric"
              value={trigger?.every_minutes ?? ""}
              onChange={(e) => setTrigger((prev) => ({ ...(prev || {}), kind: "schedule", every_minutes: e.target.value ? Number(e.target.value) : "" }))}
              placeholder="60"
            />
            <span className="label label-text-alt opacity-50">Use a simple interval first. The shared scheduler will enqueue this automation in the background.</span>
          </label>
        ) : triggerMode === "webhook" ? (
          <div className="space-y-3">
            <div className={triggerDetailCardClass}>
              <div>
                <div className="font-medium text-sm">Webhook setup</div>
                <div className="text-xs opacity-60 mt-1">Run this automation when an inbound integration webhook is received. Narrow it only if you need to.</div>
              </div>
              <label className="form-control">
                <span className="label-text">Connection</span>
                <select className="select select-bordered" value={webhookTriggerConnectionId} onChange={(e) => upsertTriggerFilter("connection_id", e.target.value)}>
                  <option value="">Any connection</option>
                  {webhookConnectionOptions.map((conn) => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name || conn.id}
                    </option>
                  ))}
                </select>
                <span className="label label-text-alt opacity-50">Optional. Leave empty to react to any configured integration connection.</span>
              </label>
              <label className="form-control">
                <span className="label-text">Event key</span>
                <input
                  className="input input-bordered"
                  value={webhookTriggerEventKey}
                  onChange={(e) => upsertTriggerFilter("event_key", e.target.value)}
                  placeholder="invoice.created"
                />
                <span className="label label-text-alt opacity-50">Optional. Only set this if the flow should run for one webhook event type.</span>
              </label>
            </div>
            <div className={triggerDetailCardClass}>
              <div className="font-medium text-sm">Webhook data available to the flow</div>
              <div className="text-xs opacity-60 mt-1">Use these payload and metadata paths in later steps.</div>
              <div className="mt-1 text-xs leading-5 text-base-content/70">
                <div className="font-mono">trigger.connection_id</div>
                <div className="font-mono">trigger.event_key</div>
                <div className="font-mono">trigger.provider_event_id</div>
                <div className="font-mono">trigger.payload</div>
                <div className="font-mono">trigger.headers</div>
                <div className="font-mono">trigger.signature_valid</div>
              </div>
            </div>
            <div className={triggerDetailCardClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs opacity-60">Queue a sample inbound webhook against the saved automation.</div>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setWebhookTestOpen(true)}>
                  Test webhook trigger
                </button>
              </div>
            </div>
          </div>
        ) : (
          <label className="form-control">
            <span className="label-text">Trigger event</span>
            <select className="select select-bordered" value={(trigger?.event_types || [])[0] || ""} onChange={(e) => updateTriggerEvent(e.target.value)}>
              <option value="">Select event…</option>
              {triggerOptions.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {Array.isArray(group.options) &&
                    group.options.map((evt) => {
                      if (typeof evt === "string") return <option key={evt} value={evt}>{evt}</option>;
                      const value = evt.id || "";
                      const label = evt.label || evt.id || "";
                      return <option key={value} value={value}>{label}</option>;
                    })}
                </optgroup>
              ))}
            </select>
          </label>
        )}
      </div>

      {(triggerMode === "event" || triggerMode === "webhook") && (
        <>
          <div className={triggerSectionCardClass}>
            <div>
              <div className="font-medium text-sm">Trigger rules</div>
              <div className="text-xs opacity-60 mt-1">Optional. Use these only if the automation should run only in specific cases.</div>
            </div>
            <div className="space-y-3">
              {((trigger?.filters || [])).length === 0 ? (
                <div className="rounded-box border border-dashed border-base-300 bg-base-100 p-5 text-center">
                  <div className="text-sm font-medium">No rules yet</div>
                  <div className="mt-1 text-xs opacity-60">
                    {triggerMode === "webhook"
                      ? "This automation will run whenever the selected webhook trigger matches."
                      : "This automation will run every time the selected trigger event happens."}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {(trigger?.filters || []).map((filt, idx) => {
                    const op = filt?.op || "eq";
                    const noValue = ["exists", "not_exists", "changed"].includes(op);
                    const selectedFieldDef = triggerFieldOptionByValue.get(filt?.path || "") || null;
                    const supportsTypedValue = !["in", "not_in"].includes(op) && !noValue;
                    return (
                      <div key={`trigger-filter-${idx}`} className={triggerDetailCardClass}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-medium uppercase tracking-wide opacity-60">Rule {idx + 1}</div>
                          <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => removeTriggerFilter(idx)}>
                            Remove
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                          <label className="form-control md:col-span-5">
                            <span className="label-text">Field</span>
                            <input
                              className="input input-bordered"
                              list="automation-trigger-fields"
                              value={filt?.path || ""}
                              onChange={(e) => updateTriggerFilter(idx, { path: e.target.value })}
                              placeholder={triggerMode === "webhook" ? "payload.customer.email" : "status"}
                            />
                            <span className="label label-text-alt opacity-50">
                              {selectedFieldDef ? `Field type: ${selectedFieldDef.type || "string"}` : "Pick a suggested field or type a custom path."}
                            </span>
                          </label>
                          <label className="form-control md:col-span-3">
                            <span className="label-text">Operator</span>
                            <select className="select select-bordered" value={op} onChange={(e) => updateTriggerFilter(idx, { op: e.target.value })}>
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
                          <label className="form-control md:col-span-4">
                            <span className="label-text">Value</span>
                            {noValue ? (
                              <input className="input input-bordered" disabled value="No value needed" />
                            ) : supportsTypedValue ? (
                              renderTypedValueEditor({
                                fieldDef: selectedFieldDef,
                                value: Array.isArray(filt?.value) ? filt.value.join(", ") : (filt?.value ?? ""),
                                onChange: (nextValue) => updateTriggerFilter(idx, { value: nextValue }),
                                placeholder: triggerMode === "webhook" ? "ops@example.com" : "active",
                              })
                            ) : (
                              <input
                                className="input input-bordered"
                                value={Array.isArray(filt?.value) ? filt.value.join(", ") : (filt?.value ?? "")}
                                placeholder={triggerMode === "webhook" ? "one, two" : "active, pending"}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const value = ["in", "not_in"].includes(op) ? raw.split(",").map((part) => part.trim()).filter(Boolean) : raw;
                                  updateTriggerFilter(idx, { value });
                                }}
                              />
                            )}
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div>
                <button type="button" className={automationAddButtonClass} onClick={addTriggerFilter}>
                  {((trigger?.filters || [])).length === 0 ? "Add first rule" : "Add rule"}
                </button>
              </div>
            </div>
          </div>

          <div className={triggerSectionCardClass}>
            <div>
              <div className="font-medium text-sm">Advanced logic</div>
              <div className="text-xs opacity-60 mt-1">Use this only if the simple rules above are not enough.</div>
            </div>
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
        </>
      )}
    </div>
  );

  const automationTabSectionClass = "rounded-box border border-base-300 bg-base-100 p-4";

  const flowTab = (
    <div className="space-y-5">
      <section className={automationTabSectionClass}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <label className="form-control md:col-span-4">
            <span className="label-text">Name</span>
            <input className="input input-bordered bg-base-100" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="form-control md:col-span-8">
            <span className="label-text">Description</span>
            <input className="input input-bordered bg-base-100" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
      </section>

      <section className={`${automationTabSectionClass} space-y-3 min-w-0`}>
        <button
          type="button"
          className="w-full rounded-box border border-base-300 bg-base-200/40 p-4 text-left transition-colors duration-150 hover:bg-base-200/70"
          onClick={() => setTriggerDrawerOpen(true)}
        >
          <div className="min-w-0">
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
        </button>

        {steps.length === 0 ? (
          <div className="rounded-box border border-dashed border-base-300 bg-base-100 p-6 text-sm opacity-60">
            No steps yet. Add a step to start building the flow.
          </div>
        ) : (
          renderStepCards(steps)
        )}
      </section>
    </div>
  );

  const runsTab = (
    (() => {
      const runRows = runs.map((run) => ({
        id: run.id || "",
        status: run.status || "run",
        started_at: run.started_at || run.created_at || "",
        ended_at: run.ended_at || "",
        last_error: run.last_error || "",
      }));
      const runFieldIndex = {
        "run.id": { id: "run.id", label: "Run ID", type: "text" },
        "run.status": { id: "run.status", label: "Status", type: "enum", options: ["queued", "running", "completed", "failed", "cancelled"] },
        "run.started_at": { id: "run.started_at", label: "Started", type: "datetime" },
        "run.ended_at": { id: "run.ended_at", label: "Ended", type: "datetime" },
        "run.last_error": { id: "run.last_error", label: "Last error", type: "text" },
      };
      const runListView = {
        id: "system.automation.runs.list",
        kind: "list",
        columns: [
          { field_id: "run.id" },
          { field_id: "run.status" },
          { field_id: "run.started_at" },
          { field_id: "run.ended_at" },
          { field_id: "run.last_error" },
        ],
      };
      const runListRecords = runRows.map((row) => ({
        record_id: row.id,
        record: {
          id: row.id,
          "run.id": row.id,
          "run.status": row.status,
          "run.started_at": row.started_at,
          "run.ended_at": row.ended_at,
          "run.last_error": row.last_error,
        },
      }));
      const runFilters = [
        { id: "all", label: "All", domain: null },
        { id: "queued", label: "Queued", domain: { op: "eq", field: "run.status", value: "queued" } },
        { id: "running", label: "Running", domain: { op: "eq", field: "run.status", value: "running" } },
        { id: "completed", label: "Completed", domain: { op: "eq", field: "run.status", value: "completed" } },
        { id: "failed", label: "Failed", domain: { op: "eq", field: "run.status", value: "failed" } },
      ];
      const activeRunFilter = runFilters.find((flt) => flt.id === runsStatusFilter) || null;
      const runFilterableFields = [
        { id: "run.id", label: "Run ID" },
        { id: "run.status", label: "Status" },
        { id: "run.last_error", label: "Last error" },
      ];

      return (
        <div className="h-full min-h-0 flex flex-col gap-4">
          {runsError && <div className="alert alert-error text-sm">{runsError}</div>}
          <section className={`${automationTabSectionClass} h-full min-h-0 flex flex-col gap-4`}>
            {runsLoading ? (
              <div className="text-sm opacity-60">Loading runs…</div>
            ) : (
              <>
                <SystemListToolbar
                title=""
                searchValue={runsSearch}
                onSearchChange={(value) => {
                  setRunsSearch(value);
                  setRunsPage(0);
                }}
                filters={runFilters}
                onFilterChange={(id) => {
                  setRunsStatusFilter(id);
                  setRunsPage(0);
                }}
                filterableFields={runFilterableFields}
                onAddCustomFilter={(field, value) => {
                  if (!field?.id) return;
                  setRunsClientFilters((prev) => [
                    ...prev,
                    { field_id: field.id, label: field.label || field.id, op: "contains", value },
                  ]);
                  setRunsPage(0);
                }}
                onClearFilters={() => {
                  setRunsStatusFilter("all");
                  setRunsClientFilters([]);
                  setRunsPage(0);
                }}
                onRefresh={loadRuns}
                pagination={{
                  page: runsPage,
                  pageSize: 25,
                  totalItems: runsTotalItems,
                  onPageChange: setRunsPage,
                }}
                showSavedViews={false}
              />

              <div className="min-h-0 flex-1">
                <ListViewRenderer
                  view={runListView}
                  fieldIndex={runFieldIndex}
                  records={runListRecords}
                  hideHeader
                  searchQuery={runsSearch}
                  searchFields={["run.id", "run.status", "run.last_error"]}
                  filters={runFilters}
                  activeFilter={activeRunFilter}
                  clientFilters={runsClientFilters}
                  page={runsPage}
                  pageSize={25}
                  onPageChange={setRunsPage}
                  onTotalItemsChange={setRunsTotalItems}
                  showPaginationControls={false}
                  enableSelection={false}
                  onSelectRow={(row) => {
                    const id = row?.record_id || row?.record?.["run.id"];
                    if (id) navigate(`/automation-runs/${id}`);
                  }}
                />
              </div>
              </>
            )}
          </section>
        </div>
      );
    })()
  );

  function resetJsonEditor() {
    setJsonEditorText(JSON.stringify(buildAutomationDefinition(), null, 2));
    setJsonEditorError("");
    setJsonEditorDirty(false);
  }

  function applyJsonEditor() {
    try {
      const parsed = JSON.parse(jsonEditorText);
      applyAutomationDefinition(parsed);
      pushToast("success", "Automation JSON applied");
    } catch (err) {
      setJsonEditorError(err?.message || "Automation JSON is invalid");
    }
  }

  const jsonTab = (
    <div className="h-full min-h-0 flex flex-col">
      <section className={`${automationTabSectionClass} h-full min-h-0 flex flex-col space-y-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Automation JSON</div>
            <div className="mt-1 text-xs opacity-60">Edit the full automation definition here, then apply it back into the flow.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={resetJsonEditor} disabled={!jsonEditorDirty}>
              Reset
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={applyJsonEditor}>
              Apply to flow
            </button>
          </div>
        </div>
        {jsonEditorDirty ? <div className="text-xs opacity-60">JSON has unapplied changes.</div> : null}
        <CodeTextarea
          value={jsonEditorText}
          onChange={(e) => {
            setJsonEditorText(e.target.value);
            setJsonEditorDirty(true);
            if (jsonEditorError) setJsonEditorError("");
          }}
          minHeight="70vh"
        />
      </section>
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

  const defaultAutomationTabId = "flow";

  const automationProfile = useMemo(() => ({
    kind: "automation",
    defaultTabId: defaultAutomationTabId,
    desktopScrollableTabs: ["flow", "runs"],
    rightTabs: [
      { id: "flow", label: "Flow", render: () => flowTab },
      { id: "json", label: "JSON", render: () => jsonTab },
      { id: "runs", label: "Runs", render: () => runsTab },
    ],
    actions: [
      { id: "save", label: "Save", kind: "secondary", onClick: save, disabled: saving },
      { id: "publish", label: "Publish", kind: "primary", onClick: publish, disabled: item?.status === "published" },
    ],
  }), [defaultAutomationTabId, flowTab, runsTab, jsonTab, save, publish, saving, item?.status]);

  return (
    <div className={isMobile ? "min-h-full bg-base-100 flex flex-col" : "h-full min-h-0 flex flex-col overflow-hidden"}>
      <TemplateStudioShell
        title={item?.name || "Automation"}
        recordId={automationId}
        profile={automationProfile}
        loadRecord={loadRecord}
        validate={validateRecord}
        enableAutosave={false}
        renderLeftPane={renderLeftPane}
        renderValidationPanel={renderValidationPanel}
      />
      <ResponsiveDrawer
        open={triggerDrawerOpen}
        onClose={() => setTriggerDrawerOpen(false)}
        title="Trigger"
        description="Choose what starts this automation and add any optional trigger rules."
        mobileHeightClass="h-[92dvh] max-h-[92dvh]"
        zIndexClass="z-[240]"
      >
        {triggerEditorContent}
      </ResponsiveDrawer>
      <ResponsiveDrawer
        open={Boolean(stepModalOpen && selectedStep)}
        onClose={() => setStepModalOpen(false)}
        title={selectedStep ? stepSummaryText(selectedStep) : "Step"}
        description={selectedStep ? stepHelpText(selectedStep) : ""}
        mobileHeightClass="h-[92dvh] max-h-[92dvh]"
        zIndexClass="z-[240]"
      >
        <div className="automation-drawer-linear" onFocusCapture={rememberFocusedField}>
          {selectedStep ? renderStepEditor(selectedStep, selectedStepPath, { showHeader: false, linear: true }) : null}
        </div>
      </ResponsiveDrawer>
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
