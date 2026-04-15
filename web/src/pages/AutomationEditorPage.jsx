import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { apiFetch } from "../api";
import TemplateStudioShell from "./templates/TemplateStudioShell.jsx";
import AppSelect from "../components/AppSelect.jsx";
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
import useWorkspaceProviderStatus from "../hooks/useWorkspaceProviderStatus.js";
import ProviderSecretModal from "../components/ProviderSecretModal.jsx";
import ProviderUnavailableState from "../components/ProviderUnavailableState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import { translateRuntime } from "../i18n/runtime.js";

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
          placeholder={placeholder || translateRuntime("settings.automation_editor.search_records")}
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
            {loading && <li className="menu-title"><span>{translateRuntime("common.loading")}</span></li>}
            {!loading && options.length === 0 && <li className="menu-title"><span>{translateRuntime("empty.no_results")}</span></li>}
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
      label: member?.name || member?.email || member?.user_email || member?.user_id || translateRuntime("settings.automation_editor.unknown_user"),
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
              aria-label={`${translateRuntime("common.remove")} ${member.label}`}
              title={`${translateRuntime("common.remove")} ${member.label}`}
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
          placeholder={selectedMembers.length > 0 ? translateRuntime("common.add_another_user") : (placeholder || translateRuntime("common.search_workspace_users"))}
        />
      </div>
      {opened && (
        <div className="absolute z-30 mt-1 w-full rounded-box border border-base-300 bg-base-100 shadow">
          <ul className="menu menu-compact menu-vertical w-full max-h-60 overflow-y-auto">
            {filtered.length === 0 && <li className="menu-title"><span>{translateRuntime("empty.no_matches")}</span></li>}
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
  const { t } = useI18n();
  const { hasCapability, isSuperadmin } = useAccessContext();
  const { pushToast } = useToast();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { providers: aiProviders, loading: providerStatusLoading, reload: reloadProviderStatus } = useWorkspaceProviderStatus(["openai"]);
  const automationAiEnabled = isSuperadmin && Boolean(aiProviders?.openai?.connected);
  const canManageSettings = hasCapability("workspace.manage_settings");
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
  const [openAiModalOpen, setOpenAiModalOpen] = useState(false);
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
      throw new Error(t("settings.automation_editor.json_must_be_object"));
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
      setError(err?.message || t("settings.automation_editor.load_metadata_failed"));
    }
  }, []);

  const loadRecord = useCallback(async (id) => {
    setError("");
    try {
      const res = await apiFetch(`/automations/${id}`);
      const automation = res?.automation;
      if (!automation) {
        setError(t("settings.automation_editor.load_failed"));
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
      setError(err?.message || t("settings.automation_editor.load_failed"));
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
      setError(err?.message || t("settings.automation_editor.save_failed"));
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
      setRunsError(err?.message || t("settings.automation_editor.load_runs_failed"));
    }
    setRunsLoading(false);
  }, [automationId]);

  const publish = useCallback(async () => {
    if (!automationId) return;
    try {
      const res = await apiFetch(`/automations/${automationId}/publish`, { method: "POST" });
      setItem(res?.automation || null);
    } catch (err) {
      setError(err?.message || t("settings.automation_editor.publish_failed"));
    }
  }, [automationId, t]);

  async function disable() {
    try {
      const res = await apiFetch(`/automations/${automationId}/disable`, { method: "POST" });
      setItem(res?.automation || null);
    } catch (err) {
      setError(err?.message || t("settings.automation_editor.disable_failed"));
    }
  }

  async function exportAutomation() {
    try {
      const res = await apiFetch(`/automations/${automationId}/export`);
      const payload = res?.automation || {};
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      pushToast("success", t("settings.automation_editor.automation_json_copied"));
    } catch (err) {
      setError(err?.message || t("settings.automation_editor.export_failed"));
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
    const ok = window.confirm(t("settings.automation_editor.delete_confirmation"));
    if (!ok) return;
    try {
      await apiFetch(`/automations/${automationId}`, { method: "DELETE" });
      navigate("/automations");
    } catch (err) {
      setError(err?.message || t("settings.automation_editor.delete_failed"));
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
      { id: newStepId, kind: "action", action_id: "system.notify", inputs: { title: t("settings.automation_editor.automation"), body: "" } },
    ]);
    setSelectedStepIndex(steps.length);
    setSelectedStepPath([steps.length]);
    setStepModalOpen(true);
    setOpenStepKeys((prev) => Array.from(new Set([...prev, newStepId])));
  }

  function insertStepAfter(listPath, afterIndex) {
    const newStepId = `step_${Date.now()}`;
    const nextStep = { id: newStepId, kind: "action", action_id: "system.notify", inputs: { title: t("settings.automation_editor.automation"), body: "" } };
    const insertIndex = afterIndex + 1;
    setSteps((prev) => insertStepAtListPath(prev, listPath, insertIndex, nextStep));
    const nextPath = [...normalizeStepPath(listPath), insertIndex];
    setSelectedStepPath(nextPath);
    setSelectedStepIndex(insertIndex);
    setStepModalOpen(true);
  }

  function addNestedStep(containerPath, branchKey) {
    const newStepId = `step_${Date.now()}`;
    const nextStep = { id: newStepId, kind: "action", action_id: "system.notify", inputs: { title: t("settings.automation_editor.automation"), body: "" } };
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
      groups.push({ label: t("settings.automation_editor.system_actions"), options: meta.system_actions });
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
      return [{ label: t("settings.automation_editor.events"), options: meta.event_types || [] }];
    }
    const grouped = new Map();
    for (const evt of catalog) {
      const label = evt.source_module_name || evt.source_module_id || t("settings.automation_editor.events");
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(evt);
    }
    return Array.from(grouped.entries()).map(([label, options]) => ({ label, options }));
  }, [meta, t]);

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
    add("entity_id", t("common.entity"));
    add("record_id", t("settings.automation_editor.record_id"));
    add("user_id", t("common.user_id"));
    add("timestamp", t("settings.automation_editor.timestamp"), "datetime");
    add("changed_fields", t("settings.automation_editor.changed_fields"), "text");
    add("from", t("common.from"));
    add("to", t("common.to"));
    if (triggerMode === "webhook") {
      add("connection_id", t("settings.automation_editor.webhook_connection_id"));
      add("webhook_id", t("settings.automation_editor.webhook_id"));
      add("provider_event_id", t("settings.automation_editor.webhook_provider_event_id"));
      add("event_key", t("settings.automation_editor.webhook_event_key"));
      add("signature_valid", t("settings.automation_editor.webhook_signature_valid"), "boolean");
      add("payload", t("settings.automation_editor.webhook_payload_object"), "text");
      add("payload.customer.email", t("settings.automation_editor.webhook_payload_field_example"));
      add("headers", t("settings.automation_editor.webhook_headers_object"), "text");
      add("headers.x-request-id", t("settings.automation_editor.webhook_header_example"));
    }
    if (defaultConditionEntityId) {
      const entity = entityById.get(defaultConditionEntityId);
      const entityFields = Array.isArray(entity?.fields) ? entity.fields : [];
      entityFields.forEach((field) => {
        const shortId = typeof field?.id === "string" ? field.id.split(".").pop() : "";
        const label = field?.label || field?.id;
        if (shortId) {
          add(`record.fields.${shortId}`, t("settings.automation_editor.record_field_label", { label }), field?.type || "string", field?.options || []);
          add(`before.fields.${shortId}`, t("settings.automation_editor.before_field_label", { label }), field?.type || "string", field?.options || []);
          add(`after.fields.${shortId}`, t("settings.automation_editor.after_field_label", { label }), field?.type || "string", field?.options || []);
        }
      });
    }
    return fields;
  }, [defaultConditionEntityId, entityById, triggerMode, t]);

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
        <AppSelect className="select select-bordered" value={rawValue} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("settings.automation_editor.select_value")}</option>
          {enumOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </AppSelect>
      );
    }

    if ((fieldType === "bool" || fieldType === "boolean") && !dynamicText) {
      return (
        <AppSelect className="select select-bordered" value={rawValue} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("settings.automation_editor.select_value")}</option>
          <option value="true">{t("settings.automation_editor.true_label")}</option>
          <option value="false">{t("settings.automation_editor.false_label")}</option>
        </AppSelect>
      );
    }

    if (fieldType === "user" && !dynamicText) {
      return (
        <AppSelect className="select select-bordered" value={rawValue} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("settings.automation_editor.select_user")}</option>
          {memberOptions.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.name || member.email || member.user_email || member.user_id}
            </option>
          ))}
        </AppSelect>
      );
    }

    if (fieldType === "users" && !dynamicText) {
      return (
        <AutomationUsersValueInput
          members={memberOptions}
          value={rawValue}
          onChange={onChange}
          placeholder={placeholder || t("common.search_workspace_users")}
        />
      );
    }

    if (fieldType === "lookup" && !dynamicText && fieldDef?.entity) {
      return (
        <AutomationLookupValueInput
          fieldDef={fieldDef}
          value={rawValue}
          onChange={onChange}
          placeholder={placeholder || t("settings.automation_editor.search_records")}
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

  function buildConditionFieldOptions(selectedEntityFields, commonOptions, fieldPathPrefix = "trigger.record.fields.") {
    const entityFields = Array.isArray(selectedEntityFields) ? selectedEntityFields : [];
    const recordFieldOptions = entityFields.map((field) => ({
      value: `${fieldPathPrefix}${field.id}`,
      label: field.label || field.id,
      type: field.type,
      options: field.options || [],
      entity: field.entity,
      display_field: field.display_field,
      id: field.id,
    }));
    return [...(Array.isArray(commonOptions) ? commonOptions : []), ...recordFieldOptions];
  }

  function coerceConditionLiteralValue(raw, { fieldDef, op, isNumericOp }) {
    const fieldType = String(fieldDef?.type || "string").toLowerCase();
    if (op === "in" || op === "not_in") {
      return String(raw || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map(parseEditableValue);
    }
    if (fieldType === "number" || isNumericOp) {
      return raw === "" ? "" : Number(raw);
    }
    if (fieldType === "boolean" || fieldType === "bool") {
      return raw === "true";
    }
    return raw;
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
    if (!name.trim()) errs.push(t("settings.automation_editor.name_required"));
    if (trigger?.kind === "schedule") {
      if (!(Number(trigger?.every_minutes) > 0)) errs.push(t("settings.automation_editor.schedule_interval_required"));
    } else if (!trigger?.event_types || trigger.event_types.length === 0) {
      errs.push(t("settings.automation_editor.trigger_event_required"));
    }
    if (!steps || steps.length === 0) errs.push(t("settings.automation_editor.at_least_one_step_required"));
    return errs;
  }, [name, steps, t, trigger]);

  const validationPanelErrors = useMemo(() => {
    const next = [...validationErrors];
    if (jsonEditorError) next.push(jsonEditorError);
    if (error) next.push(error);
    return next;
  }, [validationErrors, jsonEditorError, error]);

  const triggerSummaryText = useMemo(() => {
    if (trigger?.kind === "schedule") {
      const everyMinutes = Number(trigger?.every_minutes) > 0 ? Number(trigger.every_minutes) : null;
      return everyMinutes ? t("settings.automation_editor.every_minutes", { count: everyMinutes }) : t("settings.automation_editor.scheduled");
    }
    if (triggerMode === "webhook") {
      const connectionName =
        webhookConnectionOptions.find((conn) => conn.id === webhookTriggerConnectionId)?.name || webhookTriggerConnectionId || t("settings.automation_editor.any_connection");
      const eventKey = webhookTriggerEventKey || t("settings.automation_editor.any_webhook_event");
      return `${connectionName} • ${eventKey}`;
    }
    return triggerOptions.flatMap((group) => group.options || []).find((evt) => (typeof evt === "string" ? evt : evt.id) === selectedTriggerEventId)?.label || selectedTriggerEventId || t("settings.automation_editor.select_event");
  }, [t, trigger, triggerMode, triggerOptions, selectedTriggerEventId, webhookConnectionOptions, webhookTriggerConnectionId, webhookTriggerEventKey]);

  const bubbleBase = "chat-bubble text-sm leading-5 max-w-[85%]";
  const userLabel = user?.email || t("settings.automation_editor.user");

  const renderLeftPane = useCallback(() => (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      {!isSuperadmin ? (
        <div className="flex-1 min-h-0 overflow-auto space-y-4">
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{t("settings.template_studio.assistant")}</div>
            <div className={`${bubbleBase} bg-base-200 text-base-content`}>
              Automation AI is currently limited to superadmins.
            </div>
          </div>
        </div>
      ) : automationAiEnabled ? (
        <>
          <div className="flex-1 min-h-0 overflow-auto space-y-4">
            {chatMessages.length === 0 && (
              <div className="chat chat-start">
                <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">{t("settings.template_studio.assistant")}</div>
                <div className={`${bubbleBase} bg-base-200 text-base-content`}>
                  {t("settings.automation_editor.default_agent_message")}
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
            {chatLoading && <div className="text-xs opacity-60">{t("settings.automation_editor.agent_thinking")}</div>}
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
                  setChatMessages((prev) => [...prev, { role: "assistant", text: t("settings.automation_editor.agent_wiring_soon") }]);
                  setChatLoading(false);
                }, 500);
              }}
              disabled={chatLoading}
              placeholder={t("settings.automation_editor.describe_change")}
              minRows={4}
            />
          </div>
        </>
      ) : (
        providerStatusLoading ? (
          <LoadingSpinner className="min-h-0 h-full" />
        ) : (
          <ProviderUnavailableState
            title={t("settings.template_studio.openai_not_connected")}
            description={t("settings.automation_editor.openai_not_connected_description")}
            actionLabel={t("settings.template_studio.connect_openai")}
            canManageSettings={canManageSettings}
            loading={providerStatusLoading}
            onAction={() => setOpenAiModalOpen(true)}
          />
        )
      )}
    </div>
  ), [automationAiEnabled, bubbleBase, canManageSettings, chatInput, chatLoading, chatMessages, isSuperadmin, providerStatusLoading, t, userLabel]);

  const renderValidationPanel = useCallback(() => (
    <ValidationPanel
      title=""
      errors={validationPanelErrors}
      warnings={[]}
      idleMessage={t("settings.automation_editor.validation_idle")}
      showSuccess={true}
      showFix={automationAiEnabled}
      fixDisabled
    />
  ), [automationAiEnabled, t, validationPanelErrors]);

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
    if (!step) return t("settings.automation_editor.select_step");
    if (step.kind === "condition") return t("settings.automation_editor.condition");
    if (step.kind === "delay") return step.target_time ? t("settings.automation_editor.wait_until_time") : t("settings.automation_editor.wait_for_period");
    const actionValue = step.module_id ? `${step.module_id}::${step.action_id}` : step.action_id || "";
    const actionLabel = actionLabelByValue.get(actionValue) || step.action_id || t("settings.automation_editor.action");
    if (step.kind === "foreach") return t("settings.automation_editor.repeat_action_over_list", { action: actionLabel });
    return actionLabel || t("settings.automation_editor.select_action");
  }

  function stepHelpText(step) {
    if (!step) return t("settings.automation_editor.select_step_to_edit");
    if (step.kind === "foreach") return t("settings.automation_editor.foreach_help");
    if (step.kind === "condition") return t("settings.automation_editor.condition_help");
    if (step.kind === "delay") return step.target_time
      ? t("settings.automation_editor.delay_until_help")
      : t("settings.automation_editor.delay_for_help");
    if (step.action_id === "system.notify") return t("settings.automation_editor.notify_help");
    if (step.action_id === "system.send_email") return t("settings.automation_editor.send_email_help");
    if (step.action_id === "system.generate_document") return t("settings.automation_editor.generate_document_help");
    if (step.action_id === "system.create_record") return t("settings.automation_editor.create_record_help");
    if (step.action_id === "system.update_record") return t("settings.automation_editor.update_record_help");
    if (step.action_id === "system.query_records") return t("settings.automation_editor.query_records_help");
    if (step.action_id === "system.add_chatter") return t("settings.automation_editor.add_chatter_help");
    if (step.action_id === "system.integration_request") return t("settings.automation_editor.integration_request_help");
    if (step.action_id === "system.integration_sync") return t("settings.automation_editor.integration_sync_help");
    if (step.action_id && !step.action_id.startsWith("system.")) return t("settings.automation_editor.module_action_help");
    return t("settings.automation_editor.configure_step_help");
  }

  function stepDetailText(step) {
    if (!step) return "";
    if (step.kind === "condition") {
      const left = step?.expr?.left?.var || t("settings.automation_editor.a_field");
      const op = step?.expr?.op || "eq";
      const right = step?.expr?.right?.literal;
      return t("settings.automation_editor.if_expression", {
        left,
        op,
        right: right !== undefined && right !== "" ? ` ${Array.isArray(right) ? right.join(", ") : right}` : "",
      });
    }
    if (step.kind === "delay") {
      if (step.target_time) return t("settings.automation_editor.until_value", { value: step.target_time });
      if (step.delay_value && step.delay_unit) return `${step.delay_value} ${step.delay_unit}`;
      if (step.seconds) return t("settings.automation_editor.seconds_value", { count: step.seconds });
    }
    if (step.kind === "foreach") {
      return step.over ? t("settings.automation_editor.over_value", { value: typeof step.over === "string" ? step.over : t("settings.automation_editor.selected_list") }) : t("settings.automation_editor.choose_list");
    }
    if (step.action_id === "system.notify") {
      const count = Array.isArray(step.inputs?.recipient_user_ids)
        ? step.inputs.recipient_user_ids.length
        : step.inputs?.recipient_user_id ? 1 : 0;
      return count ? t("settings.automation_editor.to_workspace_users", { count }) : t("settings.automation_editor.choose_recipients");
    }
    if (step.action_id === "system.send_email") {
      return step.inputs?.subject || (step.inputs?.template_id ? t("settings.automation_editor.uses_email_template") : t("settings.automation_editor.set_recipients_and_message"));
    }
    if (step.action_id === "system.query_records") {
      return `${step.inputs?.entity_id || t("settings.automation_editor.trigger_entity")}${step.inputs?.limit ? t("settings.automation_editor.up_to_limit", { count: step.inputs.limit }) : ""}`;
    }
    if (step.action_id === "system.integration_request") {
      const connectionName = connectionOptions.find((conn) => conn.id === step.inputs?.connection_id)?.name || step.inputs?.connection_id || t("settings.automation_editor.choose_connection");
      const method = step.inputs?.method || "GET";
      const target = step.inputs?.path || step.inputs?.url || "/";
      return `${connectionName} • ${method} ${target}`;
    }
    if (step.action_id === "system.integration_sync") {
      const connectionName = connectionOptions.find((conn) => conn.id === step.inputs?.connection_id)?.name || step.inputs?.connection_id || t("settings.automation_editor.choose_connection");
      return `${connectionName} • ${step.inputs?.scope_key || step.inputs?.resource_key || t("settings.automation_editor.default_scope")}`;
    }
    if (step.action_id === "system.create_record") {
      return step.inputs?.entity_id || t("settings.automation_editor.choose_target_entity");
    }
    if (step.action_id === "system.update_record") {
      return step.inputs?.entity_id || t("settings.automation_editor.trigger_entity");
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
    if (branchKey === "then_steps") return t("settings.automation_editor.then");
    if (branchKey === "else_steps") return t("settings.automation_editor.else");
    if (branchKey === "steps") return t("settings.automation_editor.repeat_steps");
    return t("settings.automation_editor.flow");
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
              {draggedStepPath ? t("settings.automation_editor.drop_step_to_start", { name: listLabel.toLowerCase() }) : t("settings.automation_editor.no_steps_yet")}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => insertStepAfter(pathPrefix, -1)}
            >
              {t("settings.automation_editor.add_step")}
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
              <div className="text-xs opacity-60">{t("settings.automation_editor.drop_here_first", { name: listLabel.toLowerCase() })}</div>
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
                    <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.automation_editor.step_number", { count: index + 1 })}</div>
                    <div className="font-semibold truncate text-base-content">{stepSummaryText(step)}</div>
                    <div className="text-xs opacity-75 mt-1">{stepDetailText(step) || stepHelpText(step)}</div>
                    {step.kind === "condition" && (
                      <div className="text-[11px] opacity-50 mt-1">{t("settings.automation_editor.condition_branch_help")}</div>
                    )}
                  </button>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        title={t("settings.automation_editor.drag_step")}
                        aria-label={t("settings.automation_editor.drag_step")}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={!canMoveUp}
                        onClick={() => moveStep(path, -1)}
                        title={t("settings.automation_editor.move_up")}
                        aria-label={t("settings.automation_editor.move_step_up")}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={!canMoveDown}
                        onClick={() => moveStep(path, 1)}
                        title={t("settings.automation_editor.move_down")}
                        aria-label={t("settings.automation_editor.move_step_down")}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        onClick={() => removeStep(path)}
                        title={t("settings.automation_editor.remove_step")}
                        aria-label={t("settings.automation_editor.remove_step")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {step.store_as ? <div className="text-[10px] opacity-60">{t("settings.automation_editor.variable_short", { value: step.store_as })}</div> : null}
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
                        <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.automation_editor.then")}</div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "then_steps")}>{t("settings.automation_editor.add_step")}</button>
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
                          <div className="text-[11px] uppercase tracking-wide opacity-50">{t("settings.automation_editor.then")}</div>
                          <div className="text-xs opacity-60">{draggedStepPath ? t("settings.automation_editor.drop_step_when_true") : t("settings.automation_editor.steps_run_when_true")}</div>
                        </div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "then_steps")}>{t("settings.automation_editor.add_then_step")}</button>
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
                        <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.automation_editor.else")}</div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "else_steps")}>{t("settings.automation_editor.add_step")}</button>
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
                          <div className="text-[11px] uppercase tracking-wide opacity-50">{t("settings.automation_editor.else")}</div>
                          <div className="text-xs opacity-60">{draggedStepPath ? t("settings.automation_editor.drop_step_when_false") : t("settings.automation_editor.steps_run_when_false")}</div>
                        </div>
                        <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "else_steps")}>{t("settings.automation_editor.add_else_step")}</button>
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
                    <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.automation_editor.repeat_steps")}</div>
                    <button type="button" className="btn btn-xs btn-ghost" onClick={() => addNestedStep(path, "steps")}>{t("settings.automation_editor.add_step")}</button>
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
                      {draggedStepPath ? t("settings.automation_editor.drop_step_repeat_each_item") : t("settings.automation_editor.no_repeat_steps_yet")}
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
                  <div className="text-xs opacity-60">{t("settings.automation_editor.drop_between_items")}</div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => insertStepAfter(pathPrefix, index)}
                  >
                    {t("settings.automation_editor.add_step_after")}
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
      return <div className="text-sm opacity-60">{t("settings.automation_editor.select_step_to_edit")}</div>;
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
              <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.automation_editor.step_number", { count: displayIndex + 1 })}</div>
              <div className="text-base font-semibold">{stepSummaryText(step)}</div>
              <div className="text-xs opacity-60">{stepHelpText(step)}</div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="btn btn-ghost btn-xs" disabled={displayIndex === 0} onClick={() => moveStep(normalizedPath, -1)}>{t("settings.automation_editor.up")}</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => moveStep(normalizedPath, 1)}>{t("settings.automation_editor.down")}</button>
              <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => removeStep(normalizedPath)}>{t("common.remove")}</button>
            </div>
          </div>
        )}

        <div className={sectionCardClass}>
          <div className="font-medium text-sm">{t("settings.automation_editor.step_setup")}</div>
          <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.step_setup_help")}</div>
          <div className={`mt-3 ${wideGridClass}`}>
            <label className="form-control md:col-span-4">
              <span className="label-text">{t("settings.automation_editor.kind")}</span>
              <AppSelect
                className="select select-bordered"
                value={step.kind || "action"}
                onChange={(e) => updateStep(index, { kind: e.target.value })}
              >
                <option value="action">{t("settings.automation_editor.action")}</option>
                <option value="foreach">{t("settings.automation_editor.repeat_action")}</option>
                <option value="condition">{t("settings.automation_editor.condition")}</option>
                <option value="delay">{t("settings.automation_editor.delay")}</option>
              </AppSelect>
            </label>

            {isActionLike && (
              <label className="form-control md:col-span-8">
                <span className="label-text">{t("settings.automation_editor.action")}</span>
                <AppSelect
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
                  <option value="">{t("settings.automation_editor.select_action")}</option>
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
                </AppSelect>
              </label>
            )}
          </div>
        </div>

        {step.kind === "foreach" && (
          <div className={sectionCardClass}>
            <div className="font-medium text-sm">{t("settings.automation_editor.repeat_settings")}</div>
            <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.repeat_settings_help")}</div>
            <div className={`mt-3 ${wideGridClass}`}>
              <label className="form-control md:col-span-6">
                <span className="label-text">{t("settings.automation_editor.repeat_over")}</span>
                <input
                  className="input input-bordered"
                  list="automation-loop-hints"
                  value={typeof step.over === "string" ? step.over : ""}
                  onChange={(e) => updateStep(index, { over: e.target.value })}
                  placeholder="{{steps.query_records.records}}"
                />
                <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.repeat_over_help")}</span>
              </label>
              <label className="form-control md:col-span-3">
                <span className="label-text">{t("settings.automation_editor.item_name")}</span>
                <input
                  className="input input-bordered"
                  value={step.item_name || "item"}
                  onChange={(e) => updateStep(index, { item_name: e.target.value })}
                  placeholder={t("settings.automation_editor.item_placeholder")}
                />
              </label>
              <label className="form-control md:col-span-3">
                <span className="label-text">{t("settings.automation_editor.store_output_as")}</span>
                <input
                  className="input input-bordered"
                  value={step.store_as || ""}
                  onChange={(e) => updateStep(index, { store_as: e.target.value })}
                  placeholder={t("settings.automation_editor.loop_results_placeholder")}
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
                    <div className="font-medium text-sm">{t("settings.automation_editor.recipients")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.recipients_help")}</div>
                    <div className="mt-3 space-y-3">
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.recipient")}</span>
                        <AppSelect
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
                          <option value="">{t("settings.automation_editor.select_workspace_user")}</option>
                          {memberOptions.map((member) => (
                            <option key={member.user_id} value={member.user_id}>
                              {member.name || member.email || member.user_email || member.user_id}
                            </option>
                          ))}
                        </AppSelect>
                        <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.add_workspace_users_help")}</span>
                      </label>

                      {selectedIds.length > 0 && (
                        <div className={insetCardClass}>
                          <span className="label-text">{t("settings.automation_editor.selected_recipients")}</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedIds.map((userId) => {
                              const member = memberById.get(userId);
                              const label = member?.name || member?.email || member?.user_email || t("settings.automation_editor.unknown_user");
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
                    <div className="font-medium text-sm">{t("settings.automation_editor.notification_content")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.notification_content_help")}</div>
                    <div className="mt-3 space-y-3">
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.title")}</span>
                        <input className="input input-bordered" value={step.inputs?.title || ""} onChange={(e) => updateStepInput(index, "title", e.target.value)} />
                        <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.notification_title_help")}</span>
                      </label>

                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.body")}</span>
                        <CodeTextarea
                          value={step.inputs?.body || ""}
                          onChange={(e) => updateStepInput(index, "body", e.target.value)}
                          minHeight="140px"
                        />
                        <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.notification_body_help")}</span>
                      </label>

                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.severity")}</span>
                        <AppSelect className="select select-bordered" value={step.inputs?.severity || "info"} onChange={(e) => updateStepInput(index, "severity", e.target.value)}>
                          <option value="info">{t("settings.automation_editor.info")}</option>
                          <option value="success">{t("settings.automation_editor.success")}</option>
                          <option value="warning">{t("settings.automation_editor.warning")}</option>
                          <option value="danger">{t("settings.automation_editor.danger")}</option>
                        </AppSelect>
                        <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.severity_help")}</span>
                      </label>
                    </div>
                  </div>

                  <div className={sectionCardClass}>
                    <div className="font-medium text-sm">{t("settings.automation_editor.link")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.link_help")}</div>
                    <div className="mt-3 space-y-3">
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.link_target")}</span>
                        <AppSelect
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
                          <option value="none">{t("settings.automation_editor.no_link")}</option>
                          <option value="trigger_record">{t("settings.automation_editor.current_trigger_record")}</option>
                          <option value="record">{t("settings.automation_editor.specific_record")}</option>
                          <option value="custom">{t("settings.automation_editor.custom_url")}</option>
                        </AppSelect>
                        <span className="label-text-alt mt-1 block opacity-50">
                          {linkMode === "trigger_record"
                            ? t("settings.automation_editor.trigger_record_link_help")
                            : linkMode === "record"
                              ? t("settings.automation_editor.specific_record_link_help")
                              : linkMode === "custom"
                                ? t("settings.automation_editor.custom_url_link_help")
                                : t("settings.automation_editor.no_link_help")}
                        </span>
                      </label>

                      {linkMode === "record" && (
                        <div className="space-y-3">
                          <label className="form-control">
                            <span className="label-text">{t("settings.automation_editor.record_entity")}</span>
                            <AppSelect
                              className="select select-bordered"
                              value={linkConfig.entityId || ""}
                              onChange={(e) => updateNotificationLink(index, { link_entity_id: e.target.value })}
                            >
                              <option value="">{t("settings.automation_editor.select_entity")}</option>
                              {entityOptions.map((ent) => (
                                <option key={ent.id} value={ent.id}>
                                  {ent.label || ent.id}
                                </option>
                              ))}
                            </AppSelect>
                            <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.record_entity_help")}</span>
                          </label>

                          <label className="form-control">
                            <span className="label-text">{t("settings.automation_editor.record_id")}</span>
                            <input
                              className="input input-bordered"
                              list="automation-record-hints"
                              value={linkConfig.recordId || ""}
                              onChange={(e) => updateNotificationLink(index, { link_record_id: e.target.value })}
                              placeholder="{{trigger.record_id}}"
                            />
                            <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.record_id_help")}</span>
                          </label>
                        </div>
                      )}

                      {linkMode === "custom" && (
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.custom_url")}</span>
                          <input
                            className="input input-bordered"
                            value={linkConfig.customUrl || ""}
                            onChange={(e) => updateNotificationLink(index, { link_custom_url: e.target.value })}
                            placeholder="https://example.com"
                          />
                          <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.custom_url_help")}</span>
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
                    <div className="font-medium text-sm">{t("settings.automation_editor.email_recipients_title")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.email_recipients_help")}</div>
                    <div className="mt-3 space-y-3">
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.direct_email_addresses")}</span>
                        <input className="input input-bordered" value={(step.inputs?.to || []).join(", ")} onChange={(e) => updateStepInput(index, "to", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                        <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.direct_email_addresses_help")}</span>
                      </label>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.add_internal_recipient")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value=""
                            onChange={(e) => {
                              const email = e.target.value;
                              if (!email) return;
                              const next = Array.from(new Set([...(selectedInternalEmails || []), email]));
                              updateStepInput(index, "to_internal_emails", next);
                            }}
                          >
                            <option value="">{t("settings.automation_editor.select_workspace_member")}</option>
                            {memberOptions.map((member) => {
                              const memberEmail = member.email || member.user_email || "";
                              return (
                                <option key={member.user_id} value={memberEmail} disabled={!memberEmail}>
                                  {member.name || memberEmail || member.user_id}
                                </option>
                              );
                            })}
                          </AppSelect>
                        </label>

                        {emailFields.length > 0 && (
                          <label className="form-control">
                            <span className="label-text">{t("settings.automation_editor.add_record_email_field")}</span>
                            <AppSelect
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
                              <option value="">{t("settings.automation_editor.select_email_field")}</option>
                              {emailFields.map((field) => (
                                <option key={field.id} value={field.id}>
                                  {field.label || field.id}
                                </option>
                              ))}
                            </AppSelect>
                          </label>
                        )}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        {lookupFields.length > 0 && (
                          <label className="form-control">
                            <span className="label-text">{t("settings.automation_editor.add_lookup_recipient_field")}</span>
                            <AppSelect
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
                              <option value="">{t("settings.automation_editor.select_lookup_field")}</option>
                              {lookupFields.map((field) => (
                                <option key={field.id} value={field.id}>
                                  {field.label || field.id}
                                </option>
                              ))}
                            </AppSelect>
                          </label>
                        )}

                        {selectedLookupIds.length > 0 && targetEmailFields.length > 0 && (
                          <label className="form-control">
                            <span className="label-text">{t("settings.automation_editor.target_email_field")}</span>
                            <AppSelect
                              className="select select-bordered"
                              value={step.inputs?.to_lookup_email_field || ""}
                              onChange={(e) => updateStepInput(index, "to_lookup_email_field", e.target.value)}
                            >
                              <option value="">{t("settings.automation_editor.auto_detect_email")}</option>
                              {targetEmailFields.map((field) => (
                                <option key={field.id} value={field.id}>
                                  {field.label || field.id}
                                </option>
                              ))}
                            </AppSelect>
                            <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.target_email_field_help")}</span>
                          </label>
                        )}
                      </div>

                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.recipient_expression")}</span>
                        <input
                          className="input input-bordered"
                          list="automation-trigger-fields"
                          value={step.inputs?.to_expr || ""}
                          onChange={(e) => updateStepInput(index, "to_expr", e.target.value)}
                          placeholder="{{ record['contact_email'] }}, ops@example.com"
                        />
                        <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.recipient_expression_help")}</span>
                      </label>

                      {(selectedInternalEmails.length || selectedRecordEmailFieldIds.length || selectedLookupIds.length) > 0 && (
                        <div className={insetCardClass}>
                          <span className="label-text">{t("settings.automation_editor.selected_recipient_sources")}</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedInternalEmails.map((email) => {
                              const match = memberOptions.find((m) => (m.email || m.user_email) === email);
                              const label = match?.name ? `${match.name} (${email})` : email;
                              return (
                                <span key={`internal:${email}`} className="badge badge-outline badge-dismissible">
                                  {t("settings.automation_editor.internal_recipient_badge", { label })}
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
                                  {t("settings.automation_editor.record_field_badge", { label: field?.label || fieldId })}
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
                                  {t("settings.automation_editor.lookup_badge", { label: field?.label || fieldId })}
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
                    <div className="font-medium text-sm">{t("settings.automation_editor.email_content_title")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.email_content_help")}</div>
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="form-control">
                          <span className="label-text">{t("common.connection")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.connection_id || ""}
                            onChange={(e) => updateStepInput(index, "connection_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.use_default_connection")}</option>
                            {emailConnectionOptions.map((conn) => (
                              <option key={conn.id} value={conn.id}>
                                {conn.name || conn.id}
                              </option>
                            ))}
                          </AppSelect>
                          <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.default_connection_help")}</span>
                        </label>
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.template")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.template_id || ""}
                            onChange={(e) => updateStepInput(index, "template_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.no_template")}</option>
                            {emailTemplateOptions.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name || tpl.id}
                              </option>
                            ))}
                          </AppSelect>
                          <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.email_template_help")}</span>
                        </label>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.entity_for_merge_fields")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.entity_id || ""}
                            onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </AppSelect>
                          <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.entity_for_merge_fields_help")}</span>
                        </label>
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.record_for_merge_fields")}</span>
                          <input
                            className="input input-bordered"
                            list="automation-record-hints"
                            value={step.inputs?.record_id || ""}
                            onChange={(e) => updateStepInput(index, "record_id", e.target.value)}
                            placeholder="{{trigger.record_id}}"
                          />
                          <span className="label-text-alt mt-1 block opacity-50">
                            {t("settings.automation_editor.record_for_merge_fields_help")}
                          </span>
                        </label>
                      </div>

                      <label className="form-control">
                        <span className="label-text">{hasTemplate ? t("settings.automation_editor.subject_override") : t("common.subject")}</span>
                        <input className="input input-bordered" value={step.inputs?.subject || ""} onChange={(e) => updateStepInput(index, "subject", e.target.value)} />
                        <span className="label-text-alt mt-1 block opacity-50">
                          {hasTemplate ? t("settings.automation_editor.subject_override_help") : t("settings.automation_editor.subject_required_without_template")}
                        </span>
                      </label>

                      {!hasTemplate && (
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.email_body")}</span>
                          <CodeTextarea
                            value={step.inputs?.body_text || ""}
                            onChange={(e) => updateStepInput(index, "body_text", e.target.value)}
                            minHeight="160px"
                          />
                          <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.email_body_help")}</span>
                        </label>
                      )}
                    </div>
                  </div>

                  <div className={sectionCardClass}>
                    <div className="font-medium text-sm">{t("settings.automation_editor.attachments_title")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.attachments_help")}</div>
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
                          <span className="label-text">{t("settings.automation_editor.include_attachments")}</span>
                        </label>
                        <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.include_attachments_help")}</span>
                      </label>

                      {includeAttachments && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="form-control">
                            <span className="label-text">{t("settings.automation_editor.attachment_purpose")}</span>
                            <input
                              className="input input-bordered"
                              value={step.inputs?.attachment_purpose || ""}
                              onChange={(e) => updateStepInput(index, "attachment_purpose", e.target.value)}
                              placeholder="invoice_pdf"
                            />
                            <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.attachment_purpose_help")}</span>
                          </label>
                          <label className="form-control">
                            <span className="label-text">{t("settings.automation_editor.attachment_entity")}</span>
                            <AppSelect
                              className="select select-bordered"
                              value={step.inputs?.attachment_entity_id || ""}
                              onChange={(e) => updateStepInput(index, "attachment_entity_id", e.target.value)}
                            >
                              <option value="">{t("settings.automation_editor.use_email_entity")}</option>
                              {entityOptions.map((ent) => (
                                <option key={ent.id} value={ent.id}>
                                  {ent.label || ent.id}
                                </option>
                              ))}
                            </AppSelect>
                            <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.attachment_entity_help")}</span>
                          </label>
                          <label className="form-control">
                            <span className="label-text">{t("settings.automation_editor.attachment_record")}</span>
                            <input
                              className="input input-bordered"
                              list="automation-record-hints"
                              value={step.inputs?.attachment_record_id || ""}
                              onChange={(e) => updateStepInput(index, "attachment_record_id", e.target.value)}
                              placeholder="{{trigger.record_id}}"
                            />
                            <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.attachment_record_help")}</span>
                          </label>
                          <label className="form-control">
                            <span className="label-text">{t("settings.automation_editor.attachment_field")}</span>
                            <AppSelect
                              className="select select-bordered"
                              value={step.inputs?.attachment_field_id || ""}
                              onChange={(e) => updateStepInput(index, "attachment_field_id", e.target.value)}
                            >
                              <option value="">{t("settings.automation_editor.no_record_attachment_field")}</option>
                              {attachmentFields.map((field) => (
                                <option key={field.id} value={field.id}>
                                  {field.label || field.id}
                                </option>
                              ))}
                            </AppSelect>
                            <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.attachment_field_help")}</span>
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
            <div className="font-medium text-sm">{t("settings.automation_editor.document_setup_title")}</div>
            <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.document_setup_help")}</div>
            <div className={`mt-3 ${standardGridClass}`}>
              <label className="form-control">
                <span className="label-text">{t("settings.automation_editor.template")}</span>
                <AppSelect
                  className="select select-bordered"
                  value={step.inputs?.template_id || ""}
                  onChange={(e) => updateStepInput(index, "template_id", e.target.value)}
                >
                  <option value="">{t("settings.automation_editor.select_template")}</option>
                  {docTemplateOptions.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name || tpl.id}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <label className="form-control">
                <span className="label-text">{t("settings.automation_editor.purpose")}</span>
                <input className="input input-bordered" value={step.inputs?.purpose || ""} onChange={(e) => updateStepInput(index, "purpose", e.target.value)} />
                <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.document_purpose_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text">{t("common.entity")}</span>
                <AppSelect
                  className="select select-bordered"
                  value={step.inputs?.entity_id || ""}
                  onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                >
                  <option value="">{t("settings.automation_editor.select_entity")}</option>
                  <option value="{{trigger.entity_id}}">{t("settings.automation_editor.use_trigger_entity")}</option>
                  {entityOptions.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.label || ent.id}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <label className="form-control">
                <span className="label-text">{t("common.record")}</span>
                <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.record_or_trigger_help")}</span>
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
                  <div className="font-medium text-sm">{t("settings.automation_editor.request_setup_title")}</div>
                  <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.request_setup_help")}</div>
                  <div className={`${standardGridClass} mt-3`}>
                    <label className="form-control">
                      <span className="label-text">{t("common.connection")}</span>
                      <AppSelect
                        className="select select-bordered"
                        value={step.inputs?.connection_id || ""}
                        onChange={(e) => updateStepInput(index, "connection_id", e.target.value)}
                      >
                        <option value="">{t("settings.automation_editor.select_connection")}</option>
                        {integrationConnectionOptions.map((conn) => (
                          <option key={conn.id} value={conn.id}>
                            {conn.name || conn.id}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.method")}</span>
                      <AppSelect
                        className="select select-bordered"
                        value={step.inputs?.method || "GET"}
                        onChange={(e) => updateStepInput(index, "method", e.target.value)}
                      >
                        {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.path")}</span>
                      <input
                        className="input input-bordered"
                        value={step.inputs?.path || ""}
                        onChange={(e) => updateStepInput(index, "path", e.target.value)}
                        placeholder="/contacts"
                      />
                      <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.path_help")}</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.full_url_override")}</span>
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
                      <div className="font-medium text-sm">{t("settings.automation_editor.headers")}</div>
                      <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.request_headers_help")}</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
                      onClick={() => writeObjectEntries(index, "headers", [...headerRows, { fieldId: "", value: "" }])}
                    >
                      {t("settings.automation_editor.add_header")}
                    </button>
                  </div>
                  {headerRows.length === 0 ? (
                    <div className="text-xs opacity-60">{t("settings.automation_editor.no_headers_yet")}</div>
                  ) : (
                    <div className="space-y-3">
                      {headerRows.map((row, rowIndex) => {
                        const nextRows = headerRows.slice();
                        return (
                          <div key={`request-header-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t("settings.automation_editor.header_number", { count: rowIndex + 1 })}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeObjectEntries(index, "headers", headerRows.filter((_, idx) => idx !== rowIndex))}
                              >
                                {t("common.remove")}
                              </button>
                            </div>
                            <div className={standardGridClass}>
                              <label className="form-control">
                                <span className="label-text">{t("settings.automation_editor.header_name")}</span>
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
                                <span className="label-text">{t("settings.automation_editor.header_value")}</span>
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
                      <div className="font-medium text-sm">{t("settings.automation_editor.query_parameters")}</div>
                      <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.query_parameters_help")}</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
                      onClick={() => writeObjectEntries(index, "query", [...queryRows, { fieldId: "", value: "" }])}
                    >
                      {t("settings.automation_editor.add_parameter")}
                    </button>
                  </div>
                  {queryRows.length === 0 ? (
                    <div className="text-xs opacity-60">{t("settings.automation_editor.no_query_parameters_yet")}</div>
                  ) : (
                    <div className="space-y-3">
                      {queryRows.map((row, rowIndex) => {
                        const nextRows = queryRows.slice();
                        return (
                          <div key={`request-query-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t("settings.automation_editor.parameter_number", { count: rowIndex + 1 })}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeObjectEntries(index, "query", queryRows.filter((_, idx) => idx !== rowIndex))}
                              >
                                {t("common.remove")}
                              </button>
                            </div>
                            <div className={standardGridClass}>
                              <label className="form-control">
                                <span className="label-text">{t("settings.automation_editor.parameter_name")}</span>
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
                                <span className="label-text">{t("settings.automation_editor.parameter_value")}</span>
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
                  <div className="font-medium text-sm">{t("settings.automation_editor.request_body_title")}</div>
                  <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.request_body_help")}</div>
                  <div className={`${standardGridClass} mt-3`}>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.json_body")}</span>
                        <CodeTextarea
                          value={typeof step.inputs?.json === "string" ? step.inputs.json : JSON.stringify(step.inputs?.json || {}, null, 2)}
                          onChange={(e) => updateStepInput(index, "json", e.target.value)}
                          minHeight="140px"
                        />
                        <span className="label label-text-alt opacity-50">{t("settings.automation_editor.json_body_help")}</span>
                      </label>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.raw_body")}</span>
                        <CodeTextarea
                          value={step.inputs?.body || ""}
                          onChange={(e) => updateStepInput(index, "body", e.target.value)}
                          minHeight="120px"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.headers_json")}</span>
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
                        <span className="label-text">{t("settings.automation_editor.query_json")}</span>
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
                  <div className="font-medium text-sm">{t("settings.automation_editor.sync_setup_title")}</div>
                  <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.sync_setup_help")}</div>
                  <div className={`${standardGridClass} mt-3`}>
                    <label className="form-control">
                      <span className="label-text">{t("common.connection")}</span>
                      <AppSelect
                        className="select select-bordered"
                        value={step.inputs?.connection_id || ""}
                        onChange={(e) => updateStepInput(index, "connection_id", e.target.value)}
                      >
                        <option value="">{t("settings.automation_editor.select_connection")}</option>
                        {integrationConnectionOptions.map((conn) => (
                          <option key={conn.id} value={conn.id}>
                            {conn.name || conn.id}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.checkpoint_scope")}</span>
                      <input
                        className="input input-bordered"
                        value={step.inputs?.scope_key || ""}
                        onChange={(e) => updateStepInput(index, "scope_key", e.target.value)}
                        placeholder="contacts"
                      />
                      <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.checkpoint_scope_help")}</span>
                    </label>
                    <label className="form-control">
                      <label className="label cursor-pointer justify-start gap-3">
                        <input
                          type="checkbox"
                          className="toggle toggle-sm"
                          checked={Boolean(step.inputs?.emit_events)}
                          onChange={(e) => updateStepInput(index, "emit_events", e.target.checked ? true : undefined)}
                        />
                        <span className="label-text">{t("settings.automation_editor.emit_item_events")}</span>
                      </label>
                      <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.emit_item_events_help")}</span>
                    </label>
                    <label className="form-control">
                      <label className="label cursor-pointer justify-start gap-3">
                        <input
                          type="checkbox"
                          className="toggle toggle-sm"
                          checked={Boolean(step.inputs?.async)}
                          onChange={(e) => updateStepInput(index, "async", e.target.checked ? true : undefined)}
                        />
                        <span className="label-text">{t("settings.automation_editor.queue_in_background")}</span>
                      </label>
                      <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.queue_in_background_help")}</span>
                    </label>
                  </div>
                </div>
                <div className={sectionCardClass}>
                  <div className="font-medium text-sm">{t("settings.automation_editor.sync_request_options")}</div>
                  <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.sync_request_options_help")}</div>
                  <div className={`${standardGridClass} mt-3`}>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.method")}</span>
                        <AppSelect
                          className="select select-bordered"
                          value={step.inputs?.method || "GET"}
                          onChange={(e) => updateStepInput(index, "method", e.target.value)}
                        >
                          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                            <option key={method} value={method}>
                              {method}
                            </option>
                          ))}
                        </AppSelect>
                      </label>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.path")}</span>
                        <input
                          className="input input-bordered"
                          value={step.inputs?.path || ""}
                          onChange={(e) => updateStepInput(index, "path", e.target.value)}
                          placeholder="/contacts"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.items_path")}</span>
                        <input
                          className="input input-bordered"
                          value={step.inputs?.items_path || ""}
                          onChange={(e) => updateStepInput(index, "items_path", e.target.value)}
                          placeholder="items"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.cursor_query_parameter")}</span>
                        <input
                          className="input input-bordered"
                          value={step.inputs?.cursor_param || ""}
                          onChange={(e) => updateStepInput(index, "cursor_param", e.target.value)}
                          placeholder="updated_since"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.next_cursor_path")}</span>
                        <input
                          className="input input-bordered"
                          value={step.inputs?.cursor_value_path || ""}
                          onChange={(e) => updateStepInput(index, "cursor_value_path", e.target.value)}
                          placeholder="meta.next_cursor"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.last_item_cursor_path")}</span>
                        <input
                          className="input input-bordered"
                          value={step.inputs?.last_item_cursor_path || ""}
                          onChange={(e) => updateStepInput(index, "last_item_cursor_path", e.target.value)}
                          placeholder="updated_at"
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.max_items")}</span>
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
                            <div className="font-medium text-sm">{t("settings.automation_editor.headers")}</div>
                            <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.sync_headers_help")}</div>
                          </div>
                          <button
                            type="button"
                            className={builderAddButtonClass}
                            onClick={() => writeObjectEntries(index, "headers", [...headerRows, { fieldId: "", value: "" }])}
                          >
                            {t("settings.automation_editor.add_header")}
                          </button>
                        </div>
                        {headerRows.length === 0 ? (
                          <div className="text-xs opacity-60">{t("settings.automation_editor.no_override_headers_yet")}</div>
                        ) : (
                          <div className="space-y-3">
                            {headerRows.map((row, rowIndex) => {
                              const nextRows = headerRows.slice();
                              return (
                                <div key={`sync-header-${rowIndex}`} className={builderRowCardClass}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t("settings.automation_editor.header_number", { count: rowIndex + 1 })}</div>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs text-error"
                                      onClick={() => writeObjectEntries(index, "headers", headerRows.filter((_, idx) => idx !== rowIndex))}
                                    >
                                      {t("common.remove")}
                                    </button>
                                  </div>
                                  <div className={standardGridClass}>
                                    <label className="form-control">
                                      <span className="label-text">{t("settings.automation_editor.header_name")}</span>
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
                                      <span className="label-text">{t("settings.automation_editor.header_value")}</span>
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
                            <div className="font-medium text-sm">{t("settings.automation_editor.query_parameters")}</div>
                            <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.sync_query_parameters_help")}</div>
                          </div>
                          <button
                            type="button"
                            className={builderAddButtonClass}
                            onClick={() => writeObjectEntries(index, "query", [...queryRows, { fieldId: "", value: "" }])}
                          >
                            {t("settings.automation_editor.add_parameter")}
                          </button>
                        </div>
                        {queryRows.length === 0 ? (
                          <div className="text-xs opacity-60">{t("settings.automation_editor.no_override_query_parameters_yet")}</div>
                        ) : (
                          <div className="space-y-3">
                            {queryRows.map((row, rowIndex) => {
                              const nextRows = queryRows.slice();
                              return (
                                <div key={`sync-query-${rowIndex}`} className={builderRowCardClass}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t("settings.automation_editor.parameter_number", { count: rowIndex + 1 })}</div>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs text-error"
                                      onClick={() => writeObjectEntries(index, "query", queryRows.filter((_, idx) => idx !== rowIndex))}
                                    >
                                      {t("common.remove")}
                                    </button>
                                  </div>
                                  <div className={standardGridClass}>
                                    <label className="form-control">
                                      <span className="label-text">{t("settings.automation_editor.parameter_name")}</span>
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
                                      <span className="label-text">{t("settings.automation_editor.parameter_value")}</span>
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
                        <span className="label-text">{t("settings.automation_editor.headers_json")}</span>
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
                        <span className="label-text">{t("settings.automation_editor.query_json")}</span>
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
            <div className="font-medium text-sm">{t("settings.automation_editor.action_target")}</div>
            <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.action_target_help")}</div>
            <div className={`mt-3 ${standardGridClass}`}>
              <label className="form-control">
                <span className="label-text">{t("common.entity")}</span>
                <AppSelect
                  className="select select-bordered"
                  value={step.inputs?.entity_id || ""}
                  onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                >
                  <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                  {entityOptions.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.label || ent.id}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <label className="form-control">
                <span className="label-text">{t("common.record")}</span>
                <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.record_or_trigger_help")}</span>
              </label>
              <label className="form-control md:col-span-2">
                <span className="label-text">{t("settings.automation_editor.selected_records_comma")}</span>
                <input className="input input-bordered" value={(step.inputs?.selected_ids || []).join(", ")} onChange={(e) => updateStepInput(index, "selected_ids", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.selected_records_comma_help")}</span>
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
                  <div className="font-medium text-sm">{t("settings.automation_editor.record_setup_title")}</div>
                  <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.record_setup_help")}</div>
                  <div className={`${standardGridClass} mt-3`}>
                    <label className="form-control">
                      <span className="label-text">{t("common.entity")}</span>
                      <AppSelect className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">{t("settings.automation_editor.select_entity")}</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.store_output_as")}</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="new_record" />
                    </label>
                  </div>
                </div>
                <div className={builderSectionCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">{t("settings.automation_editor.field_values")}</div>
                      <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.field_values_help")}</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
                      onClick={() => writeObjectEntries(index, "values", [...rows, { fieldId: "", value: "" }])}
                    >
                      {t("settings.automation_editor.add_field")}
                    </button>
                  </div>
                  {rows.length === 0 ? (
                    <div className="text-xs opacity-60">{t("settings.automation_editor.no_field_values_yet")}</div>
                  ) : (
                    <div className="space-y-3">
                      {rows.map((row, rowIndex) => {
                        const nextRows = rows.slice();
                        const fieldDef = findEntityField(selectedEntityFields, row.fieldId);
                        return (
                          <div key={`create-value-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t("settings.automation_editor.field_number", { count: rowIndex + 1 })}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeObjectEntries(index, "values", rows.filter((_, idx) => idx !== rowIndex))}
                              >
                                {t("common.remove")}
                              </button>
                            </div>
                            <div className={standardGridClass}>
                              <label className="form-control">
                                <span className="label-text">{t("common.field")}</span>
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
                                <span className="label-text">{t("settings.value")}</span>
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
                                    ? t("settings.automation_editor.field_type", { type: fieldDef.type || "string" })
                                    : t("settings.automation_editor.pick_field_for_type_aware_input")}
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
                    <div className="font-medium text-sm">{t("settings.automation_editor.raw_values_json")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.raw_values_json_help")}</div>
                    <div className="mt-3">
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.values_json")}</span>
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
                  <div className="font-medium text-sm">{t("settings.automation_editor.record_target")}</div>
                  <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.record_target_help")}</div>
                  <div className={`${standardGridClass} mt-3`}>
                    <label className="form-control">
                      <span className="label-text">{t("common.entity")}</span>
                      <AppSelect className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("common.record")}</span>
                      <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} placeholder="{{trigger.record_id}}" />
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.store_output_as")}</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="updated_record" />
                    </label>
                  </div>
                </div>
                <div className={builderSectionCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">{t("settings.automation_editor.field_changes")}</div>
                      <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.field_changes_help")}</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
                      onClick={() => writeObjectEntries(index, "patch", [...rows, { fieldId: "", value: "" }])}
                    >
                      {t("settings.automation_editor.add_change")}
                    </button>
                  </div>
                  {rows.length === 0 ? (
                    <div className="text-xs opacity-60">{t("settings.automation_editor.no_changes_yet")}</div>
                  ) : (
                    <div className="space-y-3">
                      {rows.map((row, rowIndex) => {
                        const nextRows = rows.slice();
                        const fieldDef = findEntityField(selectedEntityFields, row.fieldId);
                        return (
                          <div key={`update-patch-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t("settings.automation_editor.change_number", { count: rowIndex + 1 })}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeObjectEntries(index, "patch", rows.filter((_, idx) => idx !== rowIndex))}
                              >
                                {t("common.remove")}
                              </button>
                            </div>
                            <div className={standardGridClass}>
                              <label className="form-control">
                                <span className="label-text">{t("common.field")}</span>
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
                                <span className="label-text">{t("settings.automation_editor.new_value")}</span>
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
                                    ? t("settings.automation_editor.field_type", { type: fieldDef.type || "string" })
                                    : t("settings.automation_editor.pick_field_for_type_aware_input")}
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
                    <div className="font-medium text-sm">{t("settings.automation_editor.raw_patch_json")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.raw_patch_json_help")}</div>
                    <div className="mt-3">
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.patch_json")}</span>
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
                  <div className="font-medium text-sm">{t("settings.automation_editor.query_setup_title")}</div>
                  <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.query_setup_help")}</div>
                  <div className={`${standardGridClass} mt-3`}>
                    <label className="form-control">
                      <span className="label-text">{t("common.entity")}</span>
                      <AppSelect className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.search_text")}</span>
                      <input className="input input-bordered" value={step.inputs?.q || ""} onChange={(e) => updateStepInput(index, "q", e.target.value)} />
                      <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.search_text_help")}</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.limit")}</span>
                      <input className="input input-bordered" type="number" min={1} max={200} value={step.inputs?.limit || 25} onChange={(e) => updateStepInput(index, "limit", Number(e.target.value || 25))} />
                      <span className="label-text-alt mt-1 block opacity-50">{t("settings.automation_editor.limit_help")}</span>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.store_output_as")}</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="query_results" />
                    </label>
                  </div>
                </div>
                <div className={builderSectionCardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">{t("settings.automation_editor.quick_filters")}</div>
                      <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.quick_filters_help")}</div>
                    </div>
                    <button
                      type="button"
                      className={builderAddButtonClass}
                      onClick={() => writeFilterRows(index, "filter_expr", [...filterRows, { path: "", op: "eq", value: "" }])}
                    >
                      {t("settings.automation_editor.add_rule")}
                    </button>
                  </div>
                  {filterRows.length === 0 ? (
                    <div className="text-xs opacity-60">{t("settings.automation_editor.no_quick_filters_yet")}</div>
                  ) : (
                    <div className="space-y-3">
                      {filterRows.map((row, rowIndex) => {
                        const nextRows = filterRows.slice();
                        const fieldDef = findEntityField(selectedEntityFields, row.path);
                        return (
                          <div key={`query-filter-${rowIndex}`} className={builderRowCardClass}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t("settings.automation_editor.rule_number", { count: rowIndex + 1 })}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                onClick={() => writeFilterRows(index, "filter_expr", filterRows.filter((_, idx) => idx !== rowIndex))}
                              >
                                {t("common.remove")}
                              </button>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)]">
                              <label className="form-control">
                                <span className="label-text">{t("settings.automation_editor.field_path")}</span>
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
                                <span className="label-text">{t("settings.automation_editor.operator")}</span>
                                <AppSelect
                                  className="select select-bordered"
                                  value={row.op || "eq"}
                                  onChange={(e) => {
                                    nextRows[rowIndex] = { ...row, op: e.target.value };
                                    writeFilterRows(index, "filter_expr", nextRows);
                                  }}
                                >
                                  <option value="eq">{t("settings.automation_editor.operator_eq")}</option>
                                  <option value="neq">{t("settings.automation_editor.operator_neq")}</option>
                                  <option value="gt">{t("settings.automation_editor.operator_gt")}</option>
                                  <option value="gte">{t("settings.automation_editor.operator_gte")}</option>
                                  <option value="lt">{t("settings.automation_editor.operator_lt")}</option>
                                  <option value="lte">{t("settings.automation_editor.operator_lte")}</option>
                                  <option value="contains">{t("settings.automation_editor.operator_contains")}</option>
                                  <option value="in">{t("settings.automation_editor.operator_in")}</option>
                                  <option value="not_in">{t("settings.automation_editor.operator_not_in")}</option>
                                  <option value="exists">{t("settings.automation_editor.operator_exists")}</option>
                                  <option value="not_exists">{t("settings.automation_editor.operator_not_exists")}</option>
                                </AppSelect>
                              </label>
                              <label className="form-control">
                                <span className="label-text">{t("settings.value")}</span>
                                {row.op === "exists" || row.op === "not_exists" ? (
                                  <input className="input input-bordered" disabled value={t("settings.automation_editor.no_value_needed")} />
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
                                    ? t("settings.automation_editor.field_type", { type: fieldDef.type || "string" })
                                    : t("settings.automation_editor.use_record_field_for_type_input")}
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
                    <div className="font-medium text-sm">{t("settings.automation_editor.search_and_raw_filter_options")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.search_and_raw_filter_options_help")}</div>
                    <div className={`${standardGridClass} mt-3`}>
                      <label className="form-control">
                        <span className="label-text">{t("settings.automation_editor.search_fields")}</span>
                        <input className="input input-bordered" value={step.inputs?.search_fields || ""} onChange={(e) => updateStepInput(index, "search_fields", e.target.value)} placeholder="field.one, field.two" />
                        <span className="label label-text-alt opacity-50">{t("settings.automation_editor.search_fields_help")}</span>
                      </label>
                      <div />
                      <label className="form-control md:col-span-2">
                        <span className="label-text">{t("settings.automation_editor.filter_condition_json")}</span>
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
            <div className="font-medium text-sm">{t("settings.automation_editor.entry_setup")}</div>
            <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.entry_setup_help")}</div>
            <div className={`mt-3 ${standardGridClass}`}>
              <label className="form-control">
                <span className="label-text">{t("common.entity")}</span>
                <AppSelect className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                  <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                  {entityOptions.map((ent) => (
                    <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                  ))}
                </AppSelect>
              </label>
              <label className="form-control">
                <span className="label-text">{t("common.record")}</span>
                <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} placeholder="{{trigger.record_id}}" />
              </label>
              <label className="form-control">
                <span className="label-text">{t("settings.automation_editor.entry_type")}</span>
                <AppSelect className="select select-bordered" value={step.inputs?.entry_type || "note"} onChange={(e) => updateStepInput(index, "entry_type", e.target.value)}>
                  <option value="note">{t("settings.automation_editor.entry_type_note")}</option>
                  <option value="comment">{t("settings.automation_editor.entry_type_comment")}</option>
                  <option value="system">{t("settings.automation_editor.entry_type_system")}</option>
                </AppSelect>
              </label>
              <label className="form-control">
                <span className="label-text">{t("settings.automation_editor.store_output_as")}</span>
                <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder="activity_note" />
              </label>
              <label className="form-control md:col-span-2">
                <span className="label-text">{t("common.body")}</span>
                <CodeTextarea value={step.inputs?.body || ""} onChange={(e) => updateStepInput(index, "body", e.target.value)} minHeight="140px" />
              </label>
            </div>
          </div>
        )}

        {step.kind === "delay" && (
          <div className={sectionCardClass}>
            <div className="font-medium text-sm">{t("settings.automation_editor.delay_settings")}</div>
            <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.delay_settings_help")}</div>
            <div className={`mt-3 ${wideGridClass}`}>
            <label className="form-control md:col-span-4">
              <span className="label-text">{t("settings.automation_editor.delay_mode")}</span>
              <AppSelect
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
                <option value="relative">{t("settings.automation_editor.wait_relative_time")}</option>
                <option value="until_time">{t("settings.automation_editor.wait_until_datetime")}</option>
              </AppSelect>
            </label>
            {!step.target_time ? (
              <>
                <label className="form-control md:col-span-4">
                  <span className="label-text">{t("settings.automation_editor.amount")}</span>
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
                  <span className="label-text">{t("settings.automation_editor.unit")}</span>
                  <AppSelect
                    className="select select-bordered"
                    value={step.delay_unit || "seconds"}
                    onChange={(e) => {
                      const unit = e.target.value;
                      const amount = Number(step.delay_value || step.seconds || 60);
                      updateStep(index, { delay_unit: unit, delay_value: amount, seconds: amount * delayUnitToSeconds(unit) });
                    }}
                  >
                    <option value="seconds">{t("settings.automation_editor.unit_seconds")}</option>
                    <option value="minutes">{t("settings.automation_editor.unit_minutes")}</option>
                    <option value="hours">{t("settings.automation_editor.unit_hours")}</option>
                    <option value="days">{t("settings.automation_editor.unit_days")}</option>
                  </AppSelect>
                </label>
              </>
            ) : (
              <label className="form-control md:col-span-8">
                <span className="label-text">{t("settings.automation_editor.resume_at")}</span>
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
          const commonOptions = triggerMode === "webhook"
            ? [
                { value: "trigger.event", label: t("settings.automation_editor.trigger_event"), type: "string", options: [] },
                { value: "trigger.connection_id", label: t("settings.automation_editor.webhook_connection"), type: "string", options: [] },
                { value: "trigger.event_key", label: t("settings.automation_editor.webhook_event_key"), type: "string", options: [] },
                { value: "trigger.provider_event_id", label: t("settings.automation_editor.provider_event_id"), type: "string", options: [] },
                { value: "trigger.signature_valid", label: t("settings.automation_editor.signature_valid"), type: "boolean", options: [] },
                { value: "trigger.payload", label: t("settings.automation_editor.webhook_payload_object"), type: "text", options: [] },
                { value: "trigger.payload.customer.email", label: t("settings.automation_editor.payload_example_customer_email"), type: "string", options: [] },
                { value: "trigger.headers", label: t("settings.automation_editor.webhook_headers_object"), type: "text", options: [] },
                { value: "trigger.headers.x-request-id", label: t("settings.automation_editor.header_example_request_id"), type: "string", options: [] },
              ]
            : [
                { value: "trigger.event", label: t("settings.automation_editor.trigger_event"), type: "string", options: [] },
                { value: "trigger.entity_id", label: t("settings.automation_editor.trigger_entity"), type: "string", options: [] },
                { value: "trigger.record_id", label: t("settings.automation_editor.trigger_record"), type: "string", options: [] },
                { value: "trigger.user_id", label: t("settings.automation_editor.trigger_user"), type: "user", options: [] },
              ];
          const availableFieldPaths = buildConditionFieldOptions(selectedEntityFields, commonOptions);
          const fieldPathOptions = availableFieldPaths.filter((item) => !commonOptions.some((opt) => opt.value === item.value));
          const selectedFieldDef = availableFieldPaths.find((item) => item.value === leftVar) || null;
          const isExistsOp = op === "exists" || op === "not_exists";
          const isInListOp = op === "in" || op === "not_in";
          const isNumericOp = ["gt", "gte", "lt", "lte"].includes(op);
          const fieldType = String(selectedFieldDef?.type || "string").toLowerCase();
          const stopOnFalse = Boolean(step.stop_on_false);

          function updateConditionValue(raw) {
            const nextValue = coerceConditionLiteralValue(raw, {
              fieldDef: selectedFieldDef,
              op,
              isNumericOp,
            });
            updateStep(index, { expr: { ...expr, right: { literal: nextValue } } });
          }

          return (
            <div className={sectionCardClass}>
              <div className="font-medium text-sm">{t("settings.automation_editor.condition_rule")}</div>
              <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.condition_rule_help")}</div>
              <div className={`mt-3 ${wideGridClass}`}>
              <label className="form-control md:col-span-4">
                <span className="label-text">{t("settings.automation_editor.entity_context")}</span>
                <AppSelect
                  className="select select-bordered"
                  value={selectedEntityId}
                  onChange={(e) => {
                    updateStepInput(index, "entity_id", e.target.value);
                    updateStep(index, { expr: { ...expr, left: { var: "trigger.record_id" } } });
                  }}
                >
                  <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                  {entityOptions.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.label || ent.id}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <label className="form-control md:col-span-4">
                <span className="label-text">{t("settings.automation_editor.check")}</span>
                <AppSelect
                  className="select select-bordered"
                  value={leftVar}
                  onChange={(e) => updateStep(index, { expr: { ...expr, left: { var: e.target.value } } })}
                >
                  <option value="">{t("settings.automation_editor.select_field")}</option>
                  <optgroup label={t("settings.automation_editor.trigger")}>
                    {commonOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                  {fieldPathOptions.length > 0 && (
                    <optgroup label={t("settings.automation_editor.record_fields")}>
                      {fieldPathOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </AppSelect>
              </label>
              <label className="form-control md:col-span-4">
                <span className="label-text">{t("settings.automation_editor.compare_using")}</span>
                <AppSelect
                  className="select select-bordered"
                  value={op}
                  onChange={(e) => updateStep(index, { expr: { ...expr, op: e.target.value } })}
                >
                  <option value="eq">{t("settings.automation_editor.operator_eq")}</option>
                  <option value="neq">{t("settings.automation_editor.operator_neq")}</option>
                  <option value="gt">{t("settings.automation_editor.operator_gt")}</option>
                  <option value="gte">{t("settings.automation_editor.operator_gte")}</option>
                  <option value="lt">{t("settings.automation_editor.operator_lt")}</option>
                  <option value="lte">{t("settings.automation_editor.operator_lte")}</option>
                  <option value="contains">{t("settings.automation_editor.operator_contains")}</option>
                  <option value="in">{t("settings.automation_editor.operator_is_in_list")}</option>
                  <option value="not_in">{t("settings.automation_editor.operator_is_not_in_list")}</option>
                  <option value="exists">{t("settings.automation_editor.operator_exists")}</option>
                  <option value="not_exists">{t("settings.automation_editor.operator_not_exists")}</option>
                </AppSelect>
              </label>
              <label className="form-control md:col-span-12">
                <span className="label-text">{t("settings.automation_editor.against")}</span>
                {isExistsOp ? (
                  <input className="input input-bordered" value={t("settings.automation_editor.no_value_needed_for_operator")} disabled />
                ) : (
                  renderTypedValueEditor({
                    fieldDef: selectedFieldDef,
                    value: Array.isArray(rightVal) ? rightVal.join(", ") : String(rightVal ?? ""),
                    onChange: updateConditionValue,
                    placeholder: isInListOp ? "value1, value2, value3" : "",
                  })
                )}
                <span className="label label-text-alt opacity-50">
                  {isInListOp ? t("settings.automation_editor.use_comma_separated_values") : t("settings.automation_editor.condition_runs_against_trigger_data")}
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
            <span className="label-text">{t("common.name")}</span>
            <input className="input input-bordered" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="form-control md:col-span-2">
            <span className="label-text">{t("common.description")}</span>
            <textarea className="textarea textarea-bordered" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>

        <div className="rounded-box border border-base-300 bg-base-200/40 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide opacity-50">{t("settings.automation_editor.trigger_summary")}</div>
          <div className="mt-1 font-medium">{triggerSummaryText}</div>
          <div className="mt-1 text-xs opacity-60">
            {triggerMode === "schedule"
              ? t("settings.automation_editor.trigger_summary_schedule_help")
              : t("settings.automation_editor.trigger_summary_event_help")}
          </div>
        </div>

        <div className="rounded-box border border-base-300 bg-base-200/40">
          <details>
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{t("settings.automation_editor.trigger_setup")}</div>
                <div className="text-xs opacity-60">{t("settings.automation_editor.trigger_setup_help")}</div>
              </div>
              <span className="text-xs opacity-60">{t("settings.automation_editor.show")}</span>
            </summary>
            <div className="px-4 pb-4 space-y-4">
              {triggerMode === "schedule" ? (
                <div className="space-y-3">
                  <div>
                    <div className="font-medium text-sm">{t("settings.automation_editor.schedule")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.schedule_interval_help")}</div>
                  </div>
                  <label className="form-control max-w-xs">
                    <span className="label-text">{t("settings.automation_editor.run_every_n_minutes")}</span>
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
                    <div className="font-medium text-sm">{t("settings.automation_editor.webhook_setup")}</div>
                    <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.webhook_setup_help")}</div>
                  </div>
                  <label className="form-control">
                    <span className="label-text">{t("common.connection")}</span>
                    <AppSelect
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
                    </AppSelect>
                    <span className="label label-text-alt opacity-50">{t("settings.automation_editor.webhook_connection_help")}</span>
                  </label>
                  <label className="form-control">
                    <span className="label-text">{t("settings.automation_editor.event_key")}</span>
                    <input
                      className="input input-bordered"
                      value={webhookTriggerEventKey}
                      onChange={(e) => upsertTriggerFilter("event_key", e.target.value)}
                      placeholder={t("settings.automation_editor.event_key_example")}
                    />
                    <span className="label label-text-alt opacity-50">{t("settings.automation_editor.event_key_help")}</span>
                  </label>
                  <details className="rounded-box border border-base-300 bg-base-200/40">
                    <summary className="cursor-pointer list-none px-3 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{t("settings.automation_editor.webhook_data_available")}</div>
                        <div className="text-xs opacity-60">{t("settings.automation_editor.webhook_data_available_help")}</div>
                      </div>
                      <span className="text-xs opacity-60">{t("settings.automation_editor.show")}</span>
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
                      {t("settings.automation_editor.test_webhook_trigger")}
                    </button>
                    <div className="self-center text-xs opacity-60">{t("settings.automation_editor.queue_sample_inbound_webhook")}</div>
                  </div>
                </div>
              ) : (
                <div className="form-control">
                  <span className="label-text">{t("settings.automation_editor.trigger_event")}</span>
                  <AppSelect
                    className="select select-bordered"
                    value={(trigger?.event_types || [])[0] || ""}
                    onChange={(e) => updateTriggerEvent(e.target.value)}
                  >
                    <option value="">{t("settings.automation_editor.select_event")}</option>
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
                  </AppSelect>
                </div>
              )}

              {(triggerMode === "event" || triggerMode === "webhook") && (
              <div className="space-y-3">
                <div className="rounded-box border border-base-300 bg-base-200/40">
                  <details className="group">
                    <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{t("settings.automation_editor.trigger_rules")}</div>
                        <div className="text-xs opacity-60">{t("settings.automation_editor.trigger_rules_help")}</div>
                      </div>
                      <span className="text-xs opacity-60 group-[&[open]]:hidden">{t("settings.automation_editor.show")}</span>
                      <span className="text-xs opacity-60 hidden group-[&[open]]:inline">{t("settings.automation_editor.hide")}</span>
                    </summary>
                    <div className="px-4 pb-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="label-text">{t("settings.automation_editor.only_run_when")}</div>
                  <div className="text-xs opacity-60 mt-1">
                    {triggerMode === "webhook"
                      ? t("settings.automation_editor.webhook_rules_help")
                      : t("settings.automation_editor.event_rules_help")}
                  </div>
                </div>
                <button type="button" className={automationAddButtonClass} onClick={addTriggerFilter}>{t("settings.automation_editor.add_rule")}</button>
              </div>
              {((trigger?.filters || [])).length === 0 ? (
                <div className="text-xs opacity-60">
                  {triggerMode === "webhook"
                    ? t("settings.automation_editor.webhook_runs_when_match")
                    : t("settings.automation_editor.event_runs_every_time")}
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
                          <span className="label-text">{t("common.field")}</span>
                          <input
                            className="input input-bordered"
                            list="automation-trigger-fields"
                            value={filt?.path || ""}
                            onChange={(e) => updateTriggerFilter(idx, { path: e.target.value })}
                            placeholder={triggerMode === "webhook" ? t("settings.automation_editor.webhook_field_path_placeholder") : t("settings.automation_editor.record_field_path_placeholder")}
                          />
                          <span className="label label-text-alt opacity-50">
                            {selectedFieldDef
                              ? t("settings.automation_editor.field_type", { type: selectedFieldDef.type || "string" })
                              : t("settings.automation_editor.pick_suggested_field_or_custom_path")}
                          </span>
                        </label>
                        <label className="form-control md:col-span-3">
                          <span className="label-text">{t("settings.automation_editor.operator")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={op}
                            onChange={(e) => updateTriggerFilter(idx, { op: e.target.value })}
                          >
                            <option value="eq">{t("settings.automation_editor.operator_eq")}</option>
                            <option value="neq">{t("settings.automation_editor.operator_neq")}</option>
                            <option value="gt">{t("settings.automation_editor.operator_gt")}</option>
                            <option value="gte">{t("settings.automation_editor.operator_gte")}</option>
                            <option value="lt">{t("settings.automation_editor.operator_lt")}</option>
                            <option value="lte">{t("settings.automation_editor.operator_lte")}</option>
                            <option value="contains">{t("settings.automation_editor.operator_contains")}</option>
                            <option value="in">{t("settings.automation_editor.operator_in")}</option>
                            <option value="not_in">{t("settings.automation_editor.operator_not_in")}</option>
                            <option value="exists">{t("settings.automation_editor.operator_exists")}</option>
                            <option value="not_exists">{t("settings.automation_editor.operator_not_exists")}</option>
                            <option value="changed">{t("settings.automation_editor.operator_changed")}</option>
                            <option value="changed_from">{t("settings.automation_editor.operator_changed_from")}</option>
                            <option value="changed_to">{t("settings.automation_editor.operator_changed_to")}</option>
                          </AppSelect>
                        </label>
                        <label className="form-control md:col-span-3">
                          <span className="label-text">{t("settings.value")}</span>
                          {noValue ? (
                            <input className="input input-bordered" disabled value={t("settings.automation_editor.no_value_needed")} />
                          ) : supportsTypedValue ? (
                            renderTypedValueEditor({
                              fieldDef: selectedFieldDef,
                              value: Array.isArray(filt?.value) ? filt.value.join(", ") : (filt?.value ?? ""),
                              onChange: (nextValue) => updateTriggerFilter(idx, { value: nextValue }),
                              placeholder: triggerMode === "webhook" ? t("settings.automation_editor.webhook_value_placeholder") : t("settings.automation_editor.active_placeholder"),
                            })
                          ) : (
                            <input
                              className="input input-bordered"
                              value={Array.isArray(filt?.value) ? filt.value.join(", ") : (filt?.value ?? "")}
                              placeholder={triggerMode === "webhook" ? t("settings.automation_editor.list_values_generic_placeholder") : t("settings.automation_editor.active_pending_placeholder")}
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
                          {t("common.remove")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <details className="group">
                <summary className="cursor-pointer list-none py-1 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{t("settings.automation_editor.advanced_logic")}</div>
                    <div className="text-xs opacity-60">{t("settings.automation_editor.advanced_logic_help")}</div>
                  </div>
                  <span className="text-xs opacity-60 group-[&[open]]:hidden">{t("settings.automation_editor.show")}</span>
                  <span className="text-xs opacity-60 hidden group-[&[open]]:inline">{t("settings.automation_editor.hide")}</span>
                </summary>
                <div className="pt-3">
                  <label className="form-control">
                    <span className="label-text">{t("settings.automation_editor.advanced_trigger_condition_json")}</span>
                    <CodeTextarea
                      value={triggerExprText}
                      onChange={(e) => setTriggerExprText(e.target.value)}
                      minHeight="120px"
                      placeholder={`{\n  "op": "and",\n  "children": []\n}`}
                    />
                    <span className="label label-text-alt opacity-50">{t("settings.automation_editor.advanced_trigger_condition_json_help")}</span>
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
          <div className="text-[11px] uppercase tracking-[0.18em] text-primary/70">{t("settings.automation_editor.flow_title")}</div>
          <div className="mt-1 text-lg font-semibold">{t("settings.automation_editor.flow_heading")}</div>
          <div className="mt-1 text-xs opacity-70">{t("settings.automation_editor.flow_description")}</div>
        </div>
        <div className="space-y-3 min-w-0 p-4 md:p-5">
          <button
            type="button"
            className="w-full rounded-box border border-base-300 bg-base-200/40 p-4 text-left transition hover:border-primary/40 hover:bg-base-200/60"
            onClick={() => setTriggerDrawerOpen(true)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.automation_editor.trigger")}</div>
                <div className="font-medium">{triggerSummaryText}</div>
                <div className="text-xs opacity-60 mt-1">
                  {trigger?.kind === "schedule"
                    ? t("settings.automation_editor.runs_on_scheduler")
                    : triggerMode === "webhook"
                    ? [
                        webhookTriggerConnectionId ? t("settings.automation_editor.connection_selected") : t("settings.automation_editor.any_connection"),
                        webhookTriggerEventKey ? t("settings.automation_editor.event_key_value", { key: webhookTriggerEventKey }) : t("settings.automation_editor.any_webhook_event"),
                      ].join(" • ")
                    : (trigger?.filters || []).length > 0
                    ? t("settings.automation_editor.trigger_rules_count", { count: trigger.filters.length })
                    : t("settings.automation_editor.runs_for_every_matching_event")}
                </div>
              </div>
              <span className="btn btn-sm btn-outline">{t("settings.automation_editor.edit_trigger")}</span>
            </div>
          </button>

          {steps.length === 0 ? (
            <div className="rounded-box border border-dashed border-base-300 bg-base-100 p-6 text-sm opacity-60">
              {t("settings.automation_editor.no_steps_start_flow")}
            </div>
          ) : (
            renderStepCards(steps)
          )}
        </div>
      </div>

      <ResponsiveDrawer
        open={Boolean(stepModalOpen && selectedStep)}
        onClose={() => setStepModalOpen(false)}
        title={selectedStep ? stepSummaryText(selectedStep) : t("settings.automation_editor.step")}
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
          <span className="label-text">{t("settings.automation_editor.steps")}</span>
          <button className="btn btn-sm" onClick={addStep}>{t("settings.automation_editor.add_step")}</button>
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
                    <AppSelect
                      className="select select-bordered"
                      value={step.kind || "action"}
                      onChange={(e) => updateStep(index, { kind: e.target.value })}
                    >
                      <option value="action">Action</option>
                      <option value="foreach">Repeat action</option>
                      <option value="condition">Condition</option>
                      <option value="delay">Delay</option>
                    </AppSelect>
                  </label>

                  {isActionLike && (
                    <label className="form-control md:col-span-8">
                      <span className="label-text">Action</span>
                      <AppSelect
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
                      </AppSelect>
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
                              <AppSelect
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
                                <option value="">{t("settings.automation_editor.select_workspace_user")}</option>
                                {memberOptions.map((member) => (
                                  <option key={member.user_id} value={member.user_id}>
                                    {member.name || member.email || member.user_email || member.user_id}
                                  </option>
                                ))}
                              </AppSelect>
                              <span className="label label-text-alt opacity-50">{t("settings.automation_editor.add_workspace_users_help")}</span>
                            </label>
                          );
                        })()}
                        <div className="md:col-span-2">
                          <span className="label-text">{t("settings.automation_editor.selected_recipients")}</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(Array.isArray(step.inputs?.recipient_user_ids)
                              ? step.inputs.recipient_user_ids
                              : step.inputs?.recipient_user_id
                                ? [step.inputs.recipient_user_id]
                                : []
                            ).map((userId) => {
                              const member = memberById.get(userId);
                              const label = member?.name || member?.email || member?.user_email || t("settings.automation_editor.unknown_user");
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
                            ).length) && <span className="text-xs opacity-60">{t("settings.automation_editor.no_recipients_selected")}</span>}
                          </div>
                        </div>
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.severity")}</span>
                          <AppSelect className="select select-bordered" value={step.inputs?.severity || "info"} onChange={(e) => updateStepInput(index, "severity", e.target.value)}>
                            <option value="info">{t("settings.automation_editor.info")}</option>
                            <option value="success">{t("settings.automation_editor.success")}</option>
                            <option value="warning">{t("settings.automation_editor.warning")}</option>
                            <option value="danger">{t("settings.automation_editor.danger")}</option>
                          </AppSelect>
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text">{t("settings.automation_editor.title")}</span>
                          <input className="input input-bordered" value={step.inputs?.title || ""} onChange={(e) => updateStepInput(index, "title", e.target.value)} />
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text">{t("settings.automation_editor.body")}</span>
                          <CodeTextarea
                            value={step.inputs?.body || ""}
                            onChange={(e) => updateStepInput(index, "body", e.target.value)}
                            minHeight="140px"
                          />
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text">{t("settings.automation_editor.link")}</span>
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
                          <AppSelect
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
                          </AppSelect>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">Template (optional)</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.template_id || ""}
                            onChange={(e) => updateStepInput(index, "template_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.no_template")}</option>
                            {emailTemplateOptions.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name || tpl.id}
                              </option>
                            ))}
                          </AppSelect>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">{t("settings.automation_editor.entity_optional")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.entity_id || ""}
                            onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </AppSelect>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">{t("settings.automation_editor.record_optional")}</span>
                          <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                          <span className="label label-text-alt opacity-50">{t("settings.automation_editor.record_for_merge_fields_help")}</span>
                        </label>
                        <label className="form-control md:col-span-4">
                          <span className="label-text">{t("settings.automation_editor.attachment_purpose_optional")}</span>
                          <input
                            className="input input-bordered"
                            value={step.inputs?.attachment_purpose || ""}
                            onChange={(e) => updateStepInput(index, "attachment_purpose", e.target.value)}
                            placeholder="invoice_pdf"
                          />
                          <span className="label label-text-alt opacity-50">{t("settings.automation_editor.attachment_purpose_help")}</span>
                        </label>
                        <label className="form-control md:col-span-4">
                          <span className="label-text">{t("settings.automation_editor.attachment_entity_optional")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.attachment_entity_id || ""}
                            onChange={(e) => updateStepInput(index, "attachment_entity_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.use_email_entity")}</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </AppSelect>
                        </label>
                        <label className="form-control md:col-span-4">
                          <span className="label-text">{t("settings.automation_editor.attachment_record_optional")}</span>
                          <input
                            className="input input-bordered"
                            list="automation-record-hints"
                            value={step.inputs?.attachment_record_id || ""}
                            onChange={(e) => updateStepInput(index, "attachment_record_id", e.target.value)}
                            placeholder="{{trigger.record_id}}"
                          />
                        </label>
                        <label className="form-control md:col-span-12">
                          <span className="label-text">{t("settings.automation_editor.attachment_field_optional")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.attachment_field_id || ""}
                            onChange={(e) => updateStepInput(index, "attachment_field_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.no_record_attachment_field")}</option>
                            {attachmentFields.map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.label || field.id}
                              </option>
                            ))}
                          </AppSelect>
                          <span className="label label-text-alt opacity-50">{t("settings.automation_editor.attachment_field_help")}</span>
                        </label>
                        <label className="form-control md:col-span-12">
                          <span className="label-text">{t("settings.automation_editor.direct_email_addresses")}</span>
                          <input className="input input-bordered" value={(step.inputs?.to || []).join(", ")} onChange={(e) => updateStepInput(index, "to", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                          <span className="label label-text-alt opacity-50">{t("settings.automation_editor.direct_email_addresses_help")}</span>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">{t("settings.automation_editor.add_internal_recipient")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value=""
                            onChange={(e) => {
                              const email = e.target.value;
                              if (!email) return;
                              const next = Array.from(new Set([...(selectedInternalEmails || []), email]));
                              updateStepInput(index, "to_internal_emails", next);
                            }}
                          >
                            <option value="">{t("settings.automation_editor.select_workspace_member")}</option>
                            {memberOptions.map((member) => {
                              const memberEmail = member.email || member.user_email || "";
                              return (
                              <option key={member.user_id} value={memberEmail} disabled={!memberEmail}>
                                {member.name || memberEmail || member.user_id}
                              </option>
                              );
                            })}
                          </AppSelect>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">{t("settings.automation_editor.add_record_email_field")}</span>
                          <AppSelect
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
                            <option value="">{t("settings.automation_editor.select_email_field")}</option>
                            {emailFields.map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.label || field.id}
                              </option>
                            ))}
                          </AppSelect>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">{t("settings.automation_editor.add_lookup_recipient_field")}</span>
                          <AppSelect
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
                            <option value="">{t("settings.automation_editor.select_lookup_field")}</option>
                            {lookupFields.map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.label || field.id}
                              </option>
                            ))}
                          </AppSelect>
                        </label>
                        <label className="form-control md:col-span-6">
                          <span className="label-text">{t("settings.automation_editor.target_email_field")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.to_lookup_email_field || ""}
                            onChange={(e) => updateStepInput(index, "to_lookup_email_field", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.auto_detect_email")}</option>
                            {targetEmailFields.map((field) => (
                              <option key={field.id} value={field.id}>
                                {field.label || field.id}
                              </option>
                            ))}
                          </AppSelect>
                        </label>
                        <div className="md:col-span-12">
                          <span className="label-text">{t("settings.automation_editor.selected_recipient_sources")}</span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedInternalEmails.map((email) => {
                              const match = memberOptions.find((m) => (m.email || m.user_email) === email);
                              const label = match?.name ? `${match.name} (${email})` : email;
                              return (
                                <span key={`internal:${email}`} className="badge badge-outline badge-dismissible">
                                  {t("settings.automation_editor.internal_recipient_badge", { label })}
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
                                  {t("settings.automation_editor.record_field_badge", { label: field?.label || fieldId })}
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
                                  {t("settings.automation_editor.lookup_badge", { label: field?.label || fieldId })}
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
                              <span className="text-xs opacity-60">{t("settings.automation_editor.no_dynamic_recipient_sources_selected")}</span>
                            )}
                          </div>
                        </div>
                          <label className="form-control md:col-span-12">
                            <span className="label-text">{t("settings.automation_editor.recipient_expression")}</span>
                            <input
                              className="input input-bordered"
                              value={step.inputs?.to_expr || ""}
                              onChange={(e) => updateStepInput(index, "to_expr", e.target.value)}
                              placeholder="{{ record['workorder.contact_email'] }}, ops@octodrop.com"
                            />
                            <span className="label label-text-alt opacity-50">{t("settings.automation_editor.rendered_with_jinja_context")}</span>
                          </label>
                        <label className="form-control md:col-span-12">
                          <span className="label-text">{t("settings.automation_editor.subject_optional")}</span>
                          <input className="input input-bordered" value={step.inputs?.subject || ""} onChange={(e) => updateStepInput(index, "subject", e.target.value)} />
                          <span className="label label-text-alt opacity-50">{t("settings.automation_editor.subject_override_help")}</span>
                        </label>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {isActionLike && step.action_id === "system.generate_document" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.template")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.template_id || ""}
                            onChange={(e) => updateStepInput(index, "template_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.select_template")}</option>
                            {docTemplateOptions.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name || tpl.id}
                              </option>
                            ))}
                          </AppSelect>
                        </label>
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.purpose")}</span>
                          <input className="input input-bordered" value={step.inputs?.purpose || ""} onChange={(e) => updateStepInput(index, "purpose", e.target.value)} />
                        </label>
                        <label className="form-control">
                          <span className="label-text">{t("common.entity")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.entity_id || ""}
                            onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.select_entity")}</option>
                            <option value="{{trigger.entity_id}}">{t("settings.automation_editor.use_trigger_entity")}</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </AppSelect>
                        </label>
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.record_id")}</span>
                          <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                          <span className="label label-text-alt opacity-50">{t("settings.automation_editor.record_or_trigger_help")}</span>
                        </label>
                  </div>
                )}

                    {isActionLike && step.action_id && !step.action_id.startsWith("system.") && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="form-control">
                          <span className="label-text">{t("common.entity")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.inputs?.entity_id || ""}
                            onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}
                          >
                            <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                            {entityOptions.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label || ent.id}
                              </option>
                            ))}
                          </AppSelect>
                        </label>
                        <label className="form-control">
                          <span className="label-text">{t("settings.automation_editor.record_id")}</span>
                          <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                          <span className="label label-text-alt opacity-50">{t("settings.automation_editor.record_or_trigger_help")}</span>
                        </label>
                        <label className="form-control md:col-span-2">
                          <span className="label-text">{t("settings.automation_editor.selected_records_comma")}</span>
                          <input className="input input-bordered" value={(step.inputs?.selected_ids || []).join(", ")} onChange={(e) => updateStepInput(index, "selected_ids", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                          <span className="label label-text-alt opacity-50">{t("settings.automation_editor.selected_records_comma_help")}</span>
                        </label>
                  </div>
                )}

                {isActionLike && step.action_id === "system.create_record" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control">
                      <span className="label-text">{t("common.entity")}</span>
                      <AppSelect className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">{t("settings.automation_editor.select_entity")}</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.store_output_as")}</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder={t("settings.automation_editor.new_record_placeholder")} />
                    </label>
                    <label className="form-control md:col-span-2">
                      <span className="label-text">{t("settings.automation_editor.values_json")}</span>
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
                      <span className="label-text">{t("common.entity")}</span>
                      <AppSelect className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.record_id")}</span>
                      <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} placeholder="{{trigger.record_id}}" />
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.store_output_as")}</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder={t("settings.automation_editor.updated_record_placeholder")} />
                    </label>
                    <label className="form-control md:col-span-2">
                      <span className="label-text">{t("settings.automation_editor.patch_json")}</span>
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
                      <span className="label-text">{t("common.entity")}</span>
                      <AppSelect className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.search_text")}</span>
                      <input className="input input-bordered" value={step.inputs?.q || ""} onChange={(e) => updateStepInput(index, "q", e.target.value)} />
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.search_fields")}</span>
                      <input className="input input-bordered" value={step.inputs?.search_fields || ""} onChange={(e) => updateStepInput(index, "search_fields", e.target.value)} placeholder={t("settings.automation_editor.search_fields_placeholder")} />
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.limit")}</span>
                      <input className="input input-bordered" type="number" min={1} max={200} value={step.inputs?.limit || 25} onChange={(e) => updateStepInput(index, "limit", Number(e.target.value || 25))} />
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.store_output_as")}</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder={t("settings.automation_editor.query_results_placeholder")} />
                    </label>
                    <label className="form-control md:col-span-2">
                      <span className="label-text">{t("settings.automation_editor.filter_condition_json")}</span>
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
                      <span className="label-text">{t("common.entity")}</span>
                      <AppSelect className="select select-bordered" value={step.inputs?.entity_id || ""} onChange={(e) => updateStepInput(index, "entity_id", e.target.value)}>
                        <option value="">{t("settings.automation_editor.use_trigger_entity")}</option>
                        {entityOptions.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.label || ent.id}</option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.record_id")}</span>
                      <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} placeholder="{{trigger.record_id}}" />
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.entry_type")}</span>
                      <input className="input input-bordered" value={step.inputs?.entry_type || "note"} onChange={(e) => updateStepInput(index, "entry_type", e.target.value)} />
                    </label>
                    <label className="form-control">
                      <span className="label-text">{t("settings.automation_editor.store_output_as")}</span>
                      <input className="input input-bordered" value={step.store_as || ""} onChange={(e) => updateStep(index, { store_as: e.target.value })} placeholder={t("settings.automation_editor.activity_note_placeholder")} />
                    </label>
                    <label className="form-control md:col-span-2">
                      <span className="label-text">{t("settings.automation_editor.body")}</span>
                      <CodeTextarea value={step.inputs?.body || ""} onChange={(e) => updateStepInput(index, "body", e.target.value)} minHeight="140px" />
                    </label>
                  </div>
                )}

                {step.kind === "delay" && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <label className="form-control md:col-span-4">
                      <span className="label-text">{t("settings.automation_editor.delay_mode")}</span>
                      <AppSelect
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
                        <option value="relative">{t("settings.automation_editor.wait_relative_time")}</option>
                        <option value="until_time">{t("settings.automation_editor.wait_until_datetime")}</option>
                      </AppSelect>
                    </label>
                    {!step.target_time ? (
                      <>
                        <label className="form-control md:col-span-4">
                          <span className="label-text">{t("settings.automation_editor.amount")}</span>
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
                          <span className="label-text">{t("settings.automation_editor.unit")}</span>
                          <AppSelect
                            className="select select-bordered"
                            value={step.delay_unit || "seconds"}
                            onChange={(e) => {
                              const unit = e.target.value;
                              const amount = Number(step.delay_value || step.seconds || 60);
                              updateStep(index, { delay_unit: unit, delay_value: amount, seconds: amount * delayUnitToSeconds(unit) });
                            }}
                          >
                            <option value="seconds">{t("settings.automation_editor.unit_seconds")}</option>
                            <option value="minutes">{t("settings.automation_editor.unit_minutes")}</option>
                            <option value="hours">{t("settings.automation_editor.unit_hours")}</option>
                            <option value="days">{t("settings.automation_editor.unit_days")}</option>
                          </AppSelect>
                        </label>
                      </>
                    ) : (
                      <label className="form-control md:col-span-8">
                        <span className="label-text">{t("settings.automation_editor.resume_at")}</span>
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
                  const commonOptions = [
                    { value: "trigger.event", label: t("settings.automation_editor.trigger_event"), type: "string", options: [] },
                    { value: "trigger.entity_id", label: t("settings.automation_editor.trigger_entity"), type: "string", options: [] },
                    { value: "trigger.record_id", label: t("settings.automation_editor.trigger_record"), type: "string", options: [] },
                    { value: "trigger.user_id", label: t("settings.automation_editor.trigger_user"), type: "user", options: [] },
                  ];
                  const availableFieldPaths = buildConditionFieldOptions(selectedEntityFields, commonOptions);
                  const selectedFieldDef = availableFieldPaths.find((item) => item.value === leftVar) || null;
                  const isExistsOp = op === "exists" || op === "not_exists";
                  const isInListOp = op === "in" || op === "not_in";
                  const isNumericOp = ["gt", "gte", "lt", "lte"].includes(op);
                  const fieldType = String(selectedFieldDef?.type || "string").toLowerCase();
                  const stopOnFalse = Boolean(step.stop_on_false);

                  function updateConditionValue(raw) {
                    const nextValue = coerceConditionLiteralValue(raw, {
                      fieldDef: selectedFieldDef,
                      op,
                      isNumericOp,
                    });
                    updateStep(index, { expr: { ...expr, right: { literal: nextValue } } });
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                      <label className="form-control md:col-span-4">
                        <span className="label-text">{t("settings.automation_editor.entity_context")}</span>
                        <AppSelect
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
                        </AppSelect>
                      </label>
                      <label className="form-control md:col-span-4">
                        <span className="label-text">{t("settings.automation_editor.field_path")}</span>
                        <input
                          className="input input-bordered"
                          list={`automation-condition-fields-${normalizedPath.join("-") || "root"}`}
                          value={leftVar}
                          onChange={(e) => updateStep(index, { expr: { ...expr, left: { var: e.target.value } } })}
                          placeholder={triggerMode === "webhook" ? t("settings.automation_editor.webhook_field_path_placeholder") : t("settings.automation_editor.record_field_path_placeholder")}
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
                            ? t("settings.automation_editor.field_type", { type: selectedFieldDef.type || "string" })
                            : t("settings.automation_editor.pick_suggested_field_or_custom_path")}
                        </span>
                      </label>
                      <label className="form-control md:col-span-4">
                        <span className="label-text">{t("settings.automation_editor.operator")}</span>
                        <AppSelect
                          className="select select-bordered"
                          value={op}
                          onChange={(e) => updateStep(index, { expr: { ...expr, op: e.target.value } })}
                        >
                          <option value="eq">{t("settings.automation_editor.operator_eq")}</option>
                          <option value="neq">{t("settings.automation_editor.operator_neq")}</option>
                          <option value="gt">{t("settings.automation_editor.operator_gt")}</option>
                          <option value="gte">{t("settings.automation_editor.operator_gte")}</option>
                          <option value="lt">{t("settings.automation_editor.operator_lt")}</option>
                          <option value="lte">{t("settings.automation_editor.operator_lte")}</option>
                          <option value="contains">{t("settings.automation_editor.operator_contains")}</option>
                          <option value="in">{t("settings.automation_editor.operator_is_in_list")}</option>
                          <option value="not_in">{t("settings.automation_editor.operator_is_not_in_list")}</option>
                          <option value="exists">{t("settings.automation_editor.operator_exists")}</option>
                          <option value="not_exists">{t("settings.automation_editor.operator_not_exists")}</option>
                        </AppSelect>
                      </label>
                      <label className="form-control md:col-span-12">
                        <span className="label-text">{t("settings.value")}</span>
                        {isExistsOp ? (
                          <input className="input input-bordered" value={t("settings.automation_editor.no_value_needed_for_operator")} disabled />
                        ) : !isInListOp ? (
                          renderTypedValueEditor({
                            fieldDef: selectedFieldDef,
                            value: Array.isArray(rightVal) ? rightVal.join(", ") : String(rightVal ?? ""),
                            onChange: updateConditionValue,
                            placeholder: triggerMode === "webhook" ? t("settings.automation_editor.webhook_value_placeholder") : "",
                          })
                        ) : (
                          <input
                            className="input input-bordered"
                            type={isNumericOp || fieldType === "number" ? "number" : "text"}
                            value={Array.isArray(rightVal) ? rightVal.join(", ") : String(rightVal ?? "")}
                            onChange={(e) => updateConditionValue(e.target.value)}
                            placeholder={isInListOp ? t("settings.automation_editor.list_values_placeholder") : ""}
                          />
                        )}
                        <span className="label label-text-alt opacity-50">
                          {isInListOp ? t("settings.automation_editor.use_comma_separated_values") : t("settings.automation_editor.condition_runs_against_trigger_data")}
                        </span>
                      </label>
                      <label className="form-control md:col-span-12">
                        <span className="label-text">{t("settings.automation_editor.if_false")}</span>
                        <label className="label cursor-pointer justify-start gap-3">
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={stopOnFalse}
                            onChange={(e) => updateStep(index, { stop_on_false: e.target.checked })}
                          />
                          <span className="label-text">{t("settings.automation_editor.stop_automation_if_condition_false")}</span>
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
        <option value="{{trigger.entity_id}}">{t("settings.automation_editor.use_trigger_entity")}</option>
        {entityOptions.map((ent) => (
          <option key={ent.id} value={ent.id}>
            {ent.label || ent.id}
          </option>
        ))}
      </datalist>
      <datalist id="automation-record-hints">
        <option value="{{trigger.record_id}}">{t("settings.automation_editor.use_trigger_record_id")}</option>
        <option value="{{last.id}}">{t("settings.automation_editor.use_last_step_id_output")}</option>
        <option value="{{vars.created_record.id}}">{t("settings.automation_editor.use_stored_record_id")}</option>
        {triggerMode === "webhook" && (
          <>
            <option value="{{trigger.payload.id}}">{t("settings.automation_editor.use_webhook_payload_id")}</option>
            <option value="{{trigger.payload.record_id}}">{t("settings.automation_editor.use_webhook_payload_record_id")}</option>
          </>
        )}
      </datalist>
      <datalist id="automation-loop-hints">
        <option value="{{trigger.record_ids}}">{t("settings.automation_editor.use_trigger_record_ids")}</option>
        <option value="{{steps.query_records.records}}">{t("settings.automation_editor.use_records_from_query_step")}</option>
        <option value="{{vars.query_results.records}}">{t("settings.automation_editor.use_records_from_stored_variable")}</option>
        {triggerMode === "webhook" && (
          <>
            <option value="{{trigger.payload.items}}">{t("settings.automation_editor.use_items_from_webhook_payload")}</option>
            <option value="{{trigger.payload.records}}">{t("settings.automation_editor.use_records_from_webhook_payload")}</option>
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
        <option value="{{trigger.entity_id}}">{t("settings.automation_editor.trigger_entity_id")}</option>
        <option value="{{trigger.record_id}}">{t("settings.automation_editor.trigger_record_id")}</option>
        <option value="{{trigger.user_id}}">{t("settings.automation_editor.trigger_user_id")}</option>
        <option value="{{trigger.timestamp}}">{t("settings.automation_editor.trigger_timestamp")}</option>
        <option value="{{last.id}}">{t("settings.automation_editor.last_step_id")}</option>
        <option value="{{last.records}}">{t("settings.automation_editor.last_step_records")}</option>
        <option value="{{vars.created_record.id}}">{t("settings.automation_editor.created_record_id")}</option>
        <option value="{{vars.query_results.records}}">{t("settings.automation_editor.stored_query_records")}</option>
        <option value="{{item.id}}">{t("settings.automation_editor.loop_item_id")}</option>
        <option value="{{item.record_id}}">{t("settings.automation_editor.loop_item_record_id")}</option>
        {triggerMode === "webhook" && (
          <>
            <option value="{{trigger.connection_id}}">{t("settings.automation_editor.webhook_connection_id")}</option>
            <option value="{{trigger.event_key}}">{t("settings.automation_editor.webhook_event_key")}</option>
            <option value="{{trigger.provider_event_id}}">{t("settings.automation_editor.webhook_provider_event_id")}</option>
            <option value="{{trigger.payload.id}}">{t("settings.automation_editor.webhook_payload_id")}</option>
            <option value="{{trigger.payload.record_id}}">{t("settings.automation_editor.webhook_payload_record_id")}</option>
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
          <div className="font-medium text-sm">{t("settings.automation_editor.trigger_setup")}</div>
          <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.trigger_setup_help")}</div>
        </div>
        <label className="form-control">
          <span className="label-text">{t("settings.automation_editor.trigger_type")}</span>
          <AppSelect className="select select-bordered" value={triggerMode} onChange={(e) => setTriggerMode(e.target.value)}>
            <option value="event">{t("settings.automation_editor.when_event_happens")}</option>
            <option value="webhook">{t("settings.automation_editor.when_webhook_received")}</option>
            <option value="schedule">{t("settings.automation_editor.run_on_schedule")}</option>
          </AppSelect>
        </label>

        {triggerMode === "schedule" ? (
          <label className="form-control max-w-xs">
            <span className="label-text">{t("settings.automation_editor.run_every_n_minutes")}</span>
            <input
              className="input input-bordered"
              inputMode="numeric"
              value={trigger?.every_minutes ?? ""}
              onChange={(e) => setTrigger((prev) => ({ ...(prev || {}), kind: "schedule", every_minutes: e.target.value ? Number(e.target.value) : "" }))}
              placeholder={t("settings.automation_editor.schedule_minutes_placeholder")}
            />
            <span className="label label-text-alt opacity-50">{t("settings.automation_editor.schedule_interval_help")}</span>
          </label>
        ) : triggerMode === "webhook" ? (
          <div className="space-y-3">
            <div className={triggerDetailCardClass}>
              <div>
                <div className="font-medium text-sm">{t("settings.automation_editor.webhook_setup")}</div>
                <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.webhook_setup_help")}</div>
              </div>
              <label className="form-control">
                <span className="label-text">{t("common.connection")}</span>
                <AppSelect className="select select-bordered" value={webhookTriggerConnectionId} onChange={(e) => upsertTriggerFilter("connection_id", e.target.value)}>
                  <option value="">{t("settings.automation_editor.any_connection")}</option>
                  {webhookConnectionOptions.map((conn) => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name || conn.id}
                    </option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">{t("settings.automation_editor.webhook_connection_help")}</span>
              </label>
              <label className="form-control">
                <span className="label-text">{t("settings.automation_editor.event_key")}</span>
                <input
                  className="input input-bordered"
                  value={webhookTriggerEventKey}
                  onChange={(e) => upsertTriggerFilter("event_key", e.target.value)}
                  placeholder={t("settings.automation_editor.event_key_example")}
                />
                <span className="label label-text-alt opacity-50">{t("settings.automation_editor.event_key_help")}</span>
              </label>
            </div>
            <div className={triggerDetailCardClass}>
              <div className="font-medium text-sm">{t("settings.automation_editor.webhook_data_available")}</div>
              <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.webhook_data_available_help")}</div>
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
                <div className="text-xs opacity-60">{t("settings.automation_editor.queue_sample_inbound_webhook")}</div>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setWebhookTestOpen(true)}>
                  {t("settings.automation_editor.test_webhook_trigger")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <label className="form-control">
            <span className="label-text">{t("settings.automation_editor.trigger_event")}</span>
            <AppSelect className="select select-bordered" value={(trigger?.event_types || [])[0] || ""} onChange={(e) => updateTriggerEvent(e.target.value)}>
              <option value="">{t("settings.automation_editor.select_event")}</option>
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
            </AppSelect>
          </label>
        )}
      </div>

      {(triggerMode === "event" || triggerMode === "webhook") && (
        <>
          <div className={triggerSectionCardClass}>
            <div>
              <div className="font-medium text-sm">{t("settings.automation_editor.trigger_rules")}</div>
              <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.trigger_rules_help")}</div>
            </div>
            <div className="space-y-3">
              {((trigger?.filters || [])).length === 0 ? (
                <div className="rounded-box border border-dashed border-base-300 bg-base-100 p-5 text-center">
                  <div className="text-sm font-medium">{t("settings.automation_editor.no_rules_yet")}</div>
                  <div className="mt-1 text-xs opacity-60">
                    {triggerMode === "webhook"
                      ? t("settings.automation_editor.webhook_runs_when_match")
                      : t("settings.automation_editor.event_runs_every_time")}
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
                          <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t("settings.automation_editor.rule_number", { count: idx + 1 })}</div>
                          <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => removeTriggerFilter(idx)}>
                            {t("common.remove")}
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                          <label className="form-control md:col-span-5">
                            <span className="label-text">{t("common.field")}</span>
                            <input
                              className="input input-bordered"
                              list="automation-trigger-fields"
                              value={filt?.path || ""}
                              onChange={(e) => updateTriggerFilter(idx, { path: e.target.value })}
                              placeholder={triggerMode === "webhook" ? t("settings.automation_editor.trigger_payload_field_placeholder") : t("settings.automation_editor.trigger_status_field_placeholder")}
                            />
                            <span className="label label-text-alt opacity-50">
                              {selectedFieldDef ? t("settings.automation_editor.field_type", { type: selectedFieldDef.type || "string" }) : t("settings.automation_editor.pick_suggested_field_or_custom_path")}
                            </span>
                          </label>
                          <label className="form-control md:col-span-3">
                            <span className="label-text">{t("settings.automation_editor.operator")}</span>
                            <AppSelect className="select select-bordered" value={op} onChange={(e) => updateTriggerFilter(idx, { op: e.target.value })}>
                              <option value="eq">{t("settings.automation_editor.operator_eq")}</option>
                              <option value="neq">{t("settings.automation_editor.operator_neq")}</option>
                              <option value="gt">{t("settings.automation_editor.operator_gt")}</option>
                              <option value="gte">{t("settings.automation_editor.operator_gte")}</option>
                              <option value="lt">{t("settings.automation_editor.operator_lt")}</option>
                              <option value="lte">{t("settings.automation_editor.operator_lte")}</option>
                              <option value="contains">{t("settings.automation_editor.operator_contains")}</option>
                              <option value="in">{t("settings.automation_editor.operator_in")}</option>
                              <option value="not_in">{t("settings.automation_editor.operator_not_in")}</option>
                              <option value="exists">{t("settings.automation_editor.operator_exists")}</option>
                              <option value="not_exists">{t("settings.automation_editor.operator_not_exists")}</option>
                              <option value="changed">{t("settings.automation_editor.operator_changed")}</option>
                              <option value="changed_from">{t("settings.automation_editor.operator_changed_from")}</option>
                              <option value="changed_to">{t("settings.automation_editor.operator_changed_to")}</option>
                            </AppSelect>
                          </label>
                          <label className="form-control md:col-span-4">
                            <span className="label-text">{t("settings.value")}</span>
                            {noValue ? (
                              <input className="input input-bordered" disabled value={t("settings.automation_editor.no_value_needed")} />
                            ) : supportsTypedValue ? (
                              renderTypedValueEditor({
                                fieldDef: selectedFieldDef,
                                value: Array.isArray(filt?.value) ? filt.value.join(", ") : (filt?.value ?? ""),
                                onChange: (nextValue) => updateTriggerFilter(idx, { value: nextValue }),
                                placeholder: triggerMode === "webhook" ? t("settings.automation_editor.webhook_value_placeholder") : t("settings.automation_editor.active_placeholder"),
                              })
                            ) : (
                              <input
                                className="input input-bordered"
                                value={Array.isArray(filt?.value) ? filt.value.join(", ") : (filt?.value ?? "")}
                                placeholder={triggerMode === "webhook" ? t("settings.automation_editor.list_values_generic_placeholder") : t("settings.automation_editor.active_pending_placeholder")}
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
                  {((trigger?.filters || [])).length === 0 ? t("settings.automation_editor.add_first_rule") : t("settings.automation_editor.add_rule")}
                </button>
              </div>
            </div>
          </div>

          <div className={triggerSectionCardClass}>
            <div>
              <div className="font-medium text-sm">{t("settings.automation_editor.advanced_logic")}</div>
              <div className="text-xs opacity-60 mt-1">{t("settings.automation_editor.advanced_logic_help")}</div>
            </div>
            <label className="form-control">
              <span className="label-text">{t("settings.automation_editor.advanced_trigger_condition_json")}</span>
              <CodeTextarea
                value={triggerExprText}
                onChange={(e) => setTriggerExprText(e.target.value)}
                minHeight="120px"
                placeholder={`{\n  "op": "and",\n  "children": []\n}`}
              />
              <span className="label label-text-alt opacity-50">{t("settings.automation_editor.advanced_trigger_condition_json_help")}</span>
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
            <span className="label-text">{t("common.name")}</span>
            <input className="input input-bordered bg-base-100" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="form-control md:col-span-8">
            <span className="label-text">{t("common.description")}</span>
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
            <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.automation_editor.trigger")}</div>
            <div className="font-medium">{triggerSummaryText}</div>
            <div className="text-xs opacity-60 mt-1">
              {trigger?.kind === "schedule"
                ? t("settings.automation_editor.runs_on_scheduler")
                : triggerMode === "webhook"
                ? [
                    webhookTriggerConnectionId ? t("settings.automation_editor.connection_selected") : t("settings.automation_editor.any_connection"),
                    webhookTriggerEventKey ? t("settings.automation_editor.event_key_value", { key: webhookTriggerEventKey }) : t("settings.automation_editor.any_webhook_event"),
                  ].join(" • ")
                : (trigger?.filters || []).length > 0
                ? t("settings.automation_editor.trigger_rules_count", { count: trigger.filters.length })
                : t("settings.automation_editor.runs_for_every_matching_event")}
            </div>
          </div>
        </button>

        {steps.length === 0 ? (
          <div className="rounded-box border border-dashed border-base-300 bg-base-100 p-6 text-sm opacity-60">
            {t("settings.automation_editor.no_steps_start_flow")}
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
        "run.id": { id: "run.id", label: t("settings.automation_editor.run_id"), type: "text" },
        "run.status": { id: "run.status", label: t("common.status"), type: "enum", options: ["queued", "running", "completed", "failed", "cancelled"] },
        "run.started_at": { id: "run.started_at", label: t("settings.automation_editor.started"), type: "datetime" },
        "run.ended_at": { id: "run.ended_at", label: t("settings.automation_editor.ended"), type: "datetime" },
        "run.last_error": { id: "run.last_error", label: t("settings.automation_editor.last_error"), type: "text" },
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
        { id: "all", label: t("common.all"), domain: null },
        { id: "queued", label: t("common.queued"), domain: { op: "eq", field: "run.status", value: "queued" } },
        { id: "running", label: t("settings.automation_editor.running"), domain: { op: "eq", field: "run.status", value: "running" } },
        { id: "completed", label: t("settings.automation_editor.completed"), domain: { op: "eq", field: "run.status", value: "completed" } },
        { id: "failed", label: t("common.failed"), domain: { op: "eq", field: "run.status", value: "failed" } },
      ];
      const activeRunFilter = runFilters.find((flt) => flt.id === runsStatusFilter) || null;
      const runFilterableFields = [
        { id: "run.id", label: t("settings.automation_editor.run_id") },
        { id: "run.status", label: t("common.status") },
        { id: "run.last_error", label: t("settings.automation_editor.last_error") },
      ];

      return (
        <div className="h-full min-h-0 flex flex-col gap-4">
          {runsError && <div className="alert alert-error text-sm">{runsError}</div>}
          <section className={`${automationTabSectionClass} h-full min-h-0 flex flex-col gap-4`}>
            {runsLoading ? (
              <div className="text-sm opacity-60">{t("settings.automation_editor.loading_runs")}</div>
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
      pushToast("success", t("settings.automation_editor.automation_json_applied"));
    } catch (err) {
      setJsonEditorError(err?.message || t("settings.automation_editor.automation_json_invalid"));
    }
  }

  const jsonTab = (
    <div className="h-full min-h-0 flex flex-col">
      <section className={`${automationTabSectionClass} h-full min-h-0 flex flex-col space-y-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{t("settings.automation_editor.automation_json_title")}</div>
            <div className="mt-1 text-xs opacity-60">{t("settings.automation_editor.automation_json_help")}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={resetJsonEditor} disabled={!jsonEditorDirty}>
              {t("settings.automation_editor.reset")}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={applyJsonEditor}>
              {t("settings.automation_editor.apply_to_flow")}
            </button>
          </div>
        </div>
        {jsonEditorDirty ? <div className="text-xs opacity-60">{t("settings.automation_editor.json_has_unapplied_changes")}</div> : null}
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
      setWebhookTestError(err?.message || t("settings.automation_editor.failed_to_queue_webhook_test"));
    }
    setWebhookTestSaving(false);
  }

  const defaultAutomationTabId = "flow";

  const automationProfile = useMemo(() => ({
    kind: "automation",
    defaultTabId: defaultAutomationTabId,
    desktopScrollableTabs: ["flow", "runs"],
    rightTabs: [
      { id: "flow", label: t("settings.automation_editor.flow"), render: () => flowTab },
      { id: "json", label: t("settings.automation_editor.json"), render: () => jsonTab },
      { id: "runs", label: t("settings.automation_editor.runs"), render: () => runsTab },
    ],
    actions: [
      { id: "save", label: t("common.save"), kind: "secondary", onClick: save, disabled: saving },
      { id: "publish", label: t("settings.automation_editor.publish"), kind: "primary", onClick: publish, disabled: item?.status === "published" },
    ],
  }), [defaultAutomationTabId, flowTab, runsTab, jsonTab, save, publish, saving, item?.status, t]);

  return (
    <div className={isMobile ? "min-h-full bg-base-100 flex flex-col" : "h-full min-h-0 flex flex-col overflow-hidden"}>
      <TemplateStudioShell
        title={item?.name || t("settings.automation_editor.automation")}
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
        title={t("settings.automation_editor.trigger")}
        description={t("settings.automation_editor.trigger_drawer_description")}
        mobileHeightClass="h-[92dvh] max-h-[92dvh]"
        zIndexClass="z-[240]"
      >
        {triggerEditorContent}
      </ResponsiveDrawer>
      <ResponsiveDrawer
        open={Boolean(stepModalOpen && selectedStep)}
        onClose={() => setStepModalOpen(false)}
        title={selectedStep ? stepSummaryText(selectedStep) : t("settings.automation_editor.step")}
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
                <h3 className="text-lg font-semibold">{t("settings.automation_editor.test_webhook_trigger")}</h3>
                <p className="text-sm opacity-70">{t("settings.automation_editor.test_webhook_trigger_help")}</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWebhookTestOpen(false)}>
                {t("common.close")}
              </button>
            </div>
            <div className="space-y-4">
              {webhookTestError ? <div className="alert alert-error text-sm">{webhookTestError}</div> : null}
              <label className="form-control">
                <span className="label-text">{t("common.connection")}</span>
                <AppSelect className="select select-bordered" value={webhookTestConnectionId} onChange={(e) => setWebhookTestConnectionId(e.target.value)}>
                  <option value="">{t("settings.automation_editor.any_connection")}</option>
                  {webhookConnectionOptions.map((conn) => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name || conn.id}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <label className="form-control">
                <span className="label-text">{t("settings.automation_editor.event_key")}</span>
                <input
                  className="input input-bordered"
                  value={webhookTestEventKey}
                  onChange={(e) => setWebhookTestEventKey(e.target.value)}
                placeholder={t("settings.automation_editor.event_key_example")}
                />
              </label>
              <label className="form-control">
                <span className="label-text">{t("settings.automation_editor.provider_event_id")}</span>
                <input
                  className="input input-bordered"
                  value={webhookTestProviderEventId}
                  onChange={(e) => setWebhookTestProviderEventId(e.target.value)}
                  placeholder={t("settings.automation_editor.provider_event_id_example")}
                />
              </label>
              <label className="form-control">
                <span className="label-text">{t("settings.automation_editor.headers_json")}</span>
                <CodeTextarea value={webhookTestHeadersText} onChange={(e) => setWebhookTestHeadersText(e.target.value)} minHeight="140px" />
              </label>
              <label className="form-control">
                <span className="label-text">{t("settings.automation_editor.payload_json")}</span>
                <CodeTextarea value={webhookTestPayloadText} onChange={(e) => setWebhookTestPayloadText(e.target.value)} minHeight="220px" />
                <span className="label label-text-alt opacity-50">{t("settings.automation_editor.payload_json_help")}</span>
              </label>
              <div className="rounded-box border border-base-300 bg-base-200/40 p-3 text-xs leading-5 text-base-content/70">
                <div className="font-medium text-sm text-base-content">{t("settings.automation_editor.what_this_test_creates")}</div>
                <div className="mt-2 font-mono">{t("settings.automation_editor.webhook_test_connection_mapping")}</div>
                <div className="font-mono">{t("settings.automation_editor.webhook_test_event_key_mapping")}</div>
                <div className="font-mono">{t("settings.automation_editor.webhook_test_provider_event_id_mapping")}</div>
                <div className="font-mono">{t("settings.automation_editor.webhook_test_headers_mapping")}</div>
                <div className="font-mono">{t("settings.automation_editor.webhook_test_payload_mapping")}</div>
                <div className="font-mono">{t("settings.automation_editor.webhook_test_event_mapping")}</div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setWebhookTestOpen(false)} disabled={webhookTestSaving}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="btn btn-primary" onClick={runWebhookTest} disabled={webhookTestSaving}>
                  {webhookTestSaving ? t("settings.automation_editor.queueing") : t("settings.automation_editor.run_test")}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setWebhookTestOpen(false)} />
        </div>
      )}
      <ProviderSecretModal
        open={openAiModalOpen}
        providerKey="openai"
        canManageSettings={canManageSettings}
        onClose={() => setOpenAiModalOpen(false)}
        onSaved={async () => {
          setOpenAiModalOpen(false);
          await reloadProviderStatus();
        }}
      />
    </div>
  );
}
