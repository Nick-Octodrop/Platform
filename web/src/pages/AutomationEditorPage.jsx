import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import TemplateStudioShell from "./templates/TemplateStudioShell.jsx";
import CodeTextarea from "../components/CodeTextarea.jsx";
import ValidationPanel from "../components/ValidationPanel.jsx";
import AgentChatInput from "../ui/AgentChatInput.jsx";

export default function AutomationEditorPage({ user }) {
  const { automationId } = useParams();
  const navigate = useNavigate();

  const [item, setItem] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState({ kind: "event", event_types: [], filters: [] });
  const [steps, setSteps] = useState([]);
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
      setTrigger(automation?.trigger || { kind: "event", event_types: [], filters: [] });
      setSteps(automation?.steps || []);
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
      const res = await apiFetch(`/automations/${automationId}`, {
        method: "PUT",
        body: { name, description, trigger, steps },
      });
      setItem(res?.automation || null);
    } catch (err) {
      setError(err?.message || "Failed to save automation");
    }
    setSaving(false);
  }, [automationId, name, description, trigger, steps]);

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
    } catch (err) {
      setError(err?.message || "Failed to export");
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

  function updateStep(index, patch) {
    setSteps((prev) => prev.map((step, idx) => (idx === index ? { ...step, ...patch } : step)));
  }

  function updateStepInput(index, key, value) {
    setSteps((prev) =>
      prev.map((step, idx) => {
        if (idx !== index) return step;
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
    setSteps((prev) => [
      ...prev,
      { id: `step_${prev.length + 1}`, kind: "action", action_id: "system.notify", inputs: { title: "Automation", body: "" } },
    ]);
  }

  function removeStep(index) {
    setSteps((prev) => prev.filter((_, idx) => idx !== index));
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

  const entityOptions = useMemo(() => {
    if (!Array.isArray(meta.entities)) return [];
    return meta.entities.slice().sort((a, b) => (a.label || a.id || "").localeCompare(b.label || b.id || ""));
  }, [meta.entities]);

  const memberOptions = useMemo(() => {
    if (!Array.isArray(meta.members)) return [];
    return meta.members.slice().sort((a, b) => (a.user_id || "").localeCompare(b.user_id || ""));
  }, [meta.members]);

  const connectionOptions = useMemo(() => {
    if (!Array.isArray(meta.connections)) return [];
    return meta.connections.slice().sort((a, b) => (a.name || a.id || "").localeCompare(b.name || b.id || ""));
  }, [meta.connections]);

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

  const validationErrors = useMemo(() => {
    const errs = [];
    if (!name.trim()) errs.push("Name is required.");
    if (!trigger?.event_types || trigger.event_types.length === 0) errs.push("Trigger event is required.");
    if (!steps || steps.length === 0) errs.push("At least one step is required.");
    return errs;
  }, [name, trigger, steps]);

  const bubbleBase = "chat-bubble text-sm leading-5 max-w-[85%]";
  const agentIntro = "Describe the automation change you want and I will draft an update.";
  const userLabel = user?.email || "User";

  const renderLeftPane = useCallback(() => (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto space-y-4">
        {chatMessages.length === 0 && (
          <div className="chat chat-start">
            <div className="chat-header text-[10px] uppercase tracking-wide opacity-60">assistant</div>
            <div className={`${bubbleBase} bg-base-200 text-base-content`}>
              {agentIntro}
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
    </div>
  ), [chatMessages, chatLoading, chatInput, userLabel]);

  const renderValidationPanel = useCallback(() => (
    <ValidationPanel
      title="Validation"
      errors={validationErrors}
      warnings={[]}
      idleMessage="Validation runs automatically while you edit."
      showSuccess={true}
      showFix
      fixDisabled
    />
  ), [validationErrors]);

  const builderTab = (
    <div className="space-y-4">
      {error && <div className="alert alert-error">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="form-control">
          <span className="label-text">Name</span>
          <input className="input input-bordered" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="form-control">
          <span className="label-text">Trigger</span>
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

        <label className="form-control md:col-span-2">
          <span className="label-text">Description</span>
          <textarea className="textarea textarea-bordered" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="label-text">Steps</span>
          <button className="btn btn-sm" onClick={addStep}>Add step</button>
        </div>
        {steps.map((step, index) => {
          const actionValue = step.module_id ? `${step.module_id}::${step.action_id}` : step.action_id || "";
          return (
            <div key={step.id || index} className="card bg-base-200">
              <div className="card-body space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Step {index + 1}</div>
                  <button className="btn btn-ghost btn-xs" onClick={() => removeStep(index)}>Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="form-control">
                    <span className="label-text">Kind</span>
                    <select
                      className="select select-bordered"
                      value={step.kind || "action"}
                      onChange={(e) => updateStep(index, { kind: e.target.value })}
                    >
                      <option value="action">Action</option>
                      <option value="condition">Condition</option>
                      <option value="delay">Delay</option>
                    </select>
                  </label>

                  {step.kind === "action" && (
                    <label className="form-control">
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

                {step.action_id === "system.notify" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="form-control">
                          <span className="label-text">Recipient</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.recipient_user_id || ""}
                            onChange={(e) => updateStepInput(index, "recipient_user_id", e.target.value)}
                          >
                            <option value="">Select user…</option>
                            {memberOptions.map((member) => (
                              <option key={member.user_id} value={member.user_id}>
                                {member.name || member.email || member.user_id}
                              </option>
                            ))}
                          </select>
                        </label>
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

                {step.action_id === "system.send_email" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="form-control">
                          <span className="label-text">Connection (optional)</span>
                          <select
                            className="select select-bordered"
                            value={step.inputs?.connection_id || ""}
                            onChange={(e) => updateStepInput(index, "connection_id", e.target.value)}
                          >
                            <option value="">Use default</option>
                            {connectionOptions.map((conn) => (
                              <option key={conn.id} value={conn.id}>
                                {conn.name || conn.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control">
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
                        <label className="form-control">
                          <span className="label-text">To (comma separated)</span>
                          <input className="input input-bordered" value={(step.inputs?.to || []).join(", ")} onChange={(e) => updateStepInput(index, "to", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                        </label>
                        <label className="form-control">
                          <span className="label-text">Subject (optional)</span>
                          <input className="input input-bordered" value={step.inputs?.subject || ""} onChange={(e) => updateStepInput(index, "subject", e.target.value)} />
                          <span className="label label-text-alt opacity-50">Leave blank to use the template subject.</span>
                        </label>
                        <label className="form-control">
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
                        <label className="form-control">
                          <span className="label-text">Record (optional)</span>
                          <input className="input input-bordered" list="automation-record-hints" value={step.inputs?.record_id || ""} onChange={(e) => updateStepInput(index, "record_id", e.target.value)} />
                          <span className="label label-text-alt opacity-50">Optional record for merge fields (paste ID or use trigger).</span>
                        </label>
                      </div>
                    )}

                    {step.action_id === "system.generate_document" && (
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

                    {step.action_id && !step.action_id.startsWith("system.") && (
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

                {step.kind === "delay" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="form-control md:col-span-2">
                      <span className="label-text">Delay (seconds)</span>
                      <input className="input input-bordered" type="number" value={step.seconds || 0} onChange={(e) => updateStep(index, { seconds: Number(e.target.value) })} />
                    </label>
                  </div>
                )}

                {step.kind === "condition" && (() => {
                  const expr = step.expr || { op: "eq", left: { var: "trigger.status" }, right: { literal: "" } };
                  const leftVar = expr?.left?.var || "";
                  const op = expr?.op || "eq";
                  const rightVal = expr?.right?.literal ?? "";
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="form-control">
                        <span className="label-text">Field (trigger path)</span>
                        <input
                          className="input input-bordered"
                          value={leftVar}
                          onChange={(e) => updateStep(index, { expr: { ...expr, left: { var: e.target.value } } })}
                        />
                      </label>
                      <label className="form-control">
                        <span className="label-text">Operator</span>
                        <select
                          className="select select-bordered"
                          value={op}
                          onChange={(e) => updateStep(index, { expr: { ...expr, op: e.target.value } })}
                        >
                          <option value="eq">equals</option>
                          <option value="neq">not equals</option>
                          <option value="exists">exists</option>
                          <option value="not_exists">not exists</option>
                        </select>
                      </label>
                      <label className="form-control md:col-span-2">
                        <span className="label-text">Value</span>
                        <input
                          className="input input-bordered"
                          value={rightVal}
                          onChange={(e) => updateStep(index, { expr: { ...expr, right: { literal: e.target.value } } })}
                          disabled={op === "exists" || op === "not_exists"}
                        />
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
            {member.role ? `${member.user_id} (${member.role})` : member.user_id}
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
                <span className="opacity-60">{run.started_at || run.created_at || ""}</span>
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
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <TemplateStudioShell
        title={item?.name || "Automation"}
        recordId={automationId}
        profile={automationProfile}
        loadRecord={loadRecord}
        enableAutosave={false}
        renderLeftPane={renderLeftPane}
        renderValidationPanel={renderValidationPanel}
      />
    </div>
  );
}
