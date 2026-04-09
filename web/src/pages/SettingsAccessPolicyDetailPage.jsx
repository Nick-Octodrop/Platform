import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import { useToast } from "../components/Toast.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";

const RESOURCE_TYPES = [
  { value: "module", label: "Module" },
  { value: "entity", label: "Entity" },
  { value: "field", label: "Field" },
  { value: "action", label: "Action" },
];

const ACCESS_LEVELS = {
  module: [
    { value: "hidden", label: "Hidden" },
    { value: "visible", label: "Visible" },
  ],
  entity: [
    { value: "none", label: "No access" },
    { value: "read", label: "Read only" },
    { value: "write", label: "Read + write" },
  ],
  field: [
    { value: "hidden", label: "Hidden" },
    { value: "read", label: "Read only" },
    { value: "write", label: "Writable" },
  ],
  action: [
    { value: "hidden", label: "Hidden" },
    { value: "run", label: "Allowed" },
  ],
};

function Section({ title, description, children, tone = "bg-base-100" }) {
  return (
    <div className={`rounded-box border border-base-300 p-4 ${tone}`}>
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="text-sm opacity-70 mt-1">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function SettingsAccessPolicyDetailPage() {
  const { profileId } = useParams();
  const { pushToast } = useToast();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTabId, setActiveTabId] = useState("details");
  const [ruleDraft, setRuleDraft] = useState({ resource_type: "module", resource_id: "", access_level: "hidden", priority: 100, condition_json_text: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/access/profiles");
      setProfiles(res?.profiles || []);
    } catch (err) {
      setProfiles([]);
      setError(err?.message || "Failed to load access profiles");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [profileId]);

  const profile = useMemo(() => profiles.find((item) => item.id === profileId) || null, [profiles, profileId]);
  const levelOptions = ACCESS_LEVELS[ruleDraft.resource_type] || ACCESS_LEVELS.module;

  async function saveProfile() {
    if (!profile?.id || saving) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/access/profiles/${profile.id}`, {
        method: "PATCH",
        body: {
          name: profile.name || "",
          description: profile.description || "",
          profile_key: profile.profile_key || "",
        },
      });
      pushToast("success", "Access profile updated.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to update access profile");
    } finally {
      setSaving(false);
    }
  }

  async function addRule() {
    if (!profile?.id || !ruleDraft.resource_id.trim()) return;
    setSaving(true);
    setError("");
    try {
      let conditionJson = undefined;
      if (ruleDraft.resource_type === "entity" && ruleDraft.condition_json_text.trim()) {
        try {
          conditionJson = JSON.parse(ruleDraft.condition_json_text);
        } catch {
          throw new Error("Condition JSON must be valid JSON.");
        }
      }
      await apiFetch(`/access/profiles/${profile.id}/rules`, {
        method: "POST",
        body: {
          resource_type: ruleDraft.resource_type,
          resource_id: ruleDraft.resource_id,
          access_level: ruleDraft.access_level,
          priority: ruleDraft.priority,
          condition_json: conditionJson,
        },
      });
      setRuleDraft({ resource_type: "module", resource_id: "", access_level: "hidden", priority: 100, condition_json_text: "" });
      pushToast("success", "Rule added.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to add rule");
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(ruleId) {
    if (!profile?.id || !ruleId || saving) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/access/profiles/${profile.id}/rules/${ruleId}`, { method: "DELETE" });
      pushToast("success", "Rule deleted.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete rule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TabbedPaneShell
      tabs={[
        { id: "details", label: "Details" },
        { id: "rules", label: "Rules" },
      ]}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      contentContainer={true}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {loading ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">Loading…</div>
      ) : !profile ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">Access profile not found.</div>
      ) : activeTabId === "details" ? (
        <div className="space-y-4">
          <Section title="Profile Details" description="Names are user-facing. Keys are stable references you can reuse later.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <label className="form-control md:col-span-4">
                <span className="label-text text-sm">Name</span>
                <input className="input input-bordered input-sm" value={profile.name || ""} disabled={saving} onChange={(e) => setProfiles((prev) => prev.map((item) => (item.id === profile.id ? { ...item, name: e.target.value } : item)))} />
              </label>
              <label className="form-control md:col-span-3">
                <span className="label-text text-sm">Key</span>
                <input className="input input-bordered input-sm" value={profile.profile_key || ""} disabled={saving} onChange={(e) => setProfiles((prev) => prev.map((item) => (item.id === profile.id ? { ...item, profile_key: e.target.value } : item)))} />
              </label>
              <label className="form-control md:col-span-5">
                <span className="label-text text-sm">Description</span>
                <input className="input input-bordered input-sm" value={profile.description || ""} disabled={saving} onChange={(e) => setProfiles((prev) => prev.map((item) => (item.id === profile.id ? { ...item, description: e.target.value } : item)))} />
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-box bg-base-200/40 p-3">
                <div className="text-xs uppercase tracking-wide opacity-60">Rules</div>
                <div className="mt-1 text-lg font-semibold">{Number(profile.rule_count || 0)}</div>
              </div>
              <div className="rounded-box bg-base-200/40 p-3">
                <div className="text-xs uppercase tracking-wide opacity-60">Assigned Users</div>
                <div className="mt-1 text-lg font-semibold">{Number(profile.assignment_count || 0)}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-sm btn-primary" type="button" disabled={saving || !profile.name?.trim()} onClick={saveProfile}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </Section>
        </div>
      ) : (
        <div className="space-y-4">
          <Section title="Add Rule" description="Use exact ids such as a module id, entity id, field id, or module_id:action_id.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <label className="form-control md:col-span-3">
                <span className="label-text text-sm">Resource type</span>
                <AppSelect
                  className="select select-bordered select-sm"
                  value={ruleDraft.resource_type}
                  disabled={saving}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    const nextLevels = ACCESS_LEVELS[nextType] || ACCESS_LEVELS.module;
                    setRuleDraft((prev) => ({ ...prev, resource_type: nextType, access_level: nextLevels[0].value }));
                  }}
                >
                  {RESOURCE_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">Choose what kind of thing this rule controls.</span>
              </label>
              <label className="form-control md:col-span-4">
                <span className="label-text text-sm">Resource id</span>
                <input className="input input-bordered input-sm" value={ruleDraft.resource_id} disabled={saving} placeholder="quotes, entity.nl_quote, nl_quote.grand_total, app:action.save" onChange={(e) => setRuleDraft((prev) => ({ ...prev, resource_id: e.target.value }))} />
                <span className="label label-text-alt opacity-50">
                  Required. Use the exact id for the module, entity, field, or action you want this rule to apply to.
                </span>
              </label>
              <label className="form-control md:col-span-3">
                <span className="label-text text-sm">Access</span>
                <AppSelect className="select select-bordered select-sm" value={ruleDraft.access_level} disabled={saving} onChange={(e) => setRuleDraft((prev) => ({ ...prev, access_level: e.target.value }))}>
                  {levelOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">Choose the access level this rule should enforce.</span>
              </label>
              <label className="form-control md:col-span-2">
                <span className="label-text text-sm">Priority</span>
                <input className="input input-bordered input-sm" type="number" value={ruleDraft.priority} disabled={saving} onChange={(e) => setRuleDraft((prev) => ({ ...prev, priority: Number(e.target.value || 100) }))} />
                <span className="label label-text-alt opacity-50">Lower numbers run first. Default is 100.</span>
              </label>
              <label className="form-control md:col-span-12">
                <span className="label-text text-sm">Scope condition JSON</span>
                <textarea
                  className="textarea textarea-bordered textarea-sm min-h-24 font-mono text-xs"
                  value={ruleDraft.condition_json_text}
                  disabled={saving}
                  placeholder='Optional. Example: {"op":"eq","field":"contact.type","value":"Customer"}'
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, condition_json_text: e.target.value }))}
                />
                <span className="label label-text-alt opacity-50">
                  Optional. Leave blank to apply this rule everywhere the resource matches.
                </span>
              </label>
            </div>
            <div className="mt-4">
              <button className="btn btn-sm btn-primary" type="button" disabled={saving || !ruleDraft.resource_id.trim()} onClick={addRule}>
                Add Rule
              </button>
            </div>
          </Section>

          <Section title="Rules" description="Rules are evaluated as a restrictive overlay on top of the base workspace role.">
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Resource</th>
                    <th>Access</th>
                    <th>Scope</th>
                    <th>Priority</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(profile.rules || []).length ? (
                    profile.rules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{rule.resource_type}</td>
                        <td className="font-mono text-xs">{rule.resource_id}</td>
                        <td>{rule.access_level}</td>
                        <td className="max-w-xs truncate font-mono text-[11px] opacity-70">
                          {rule.condition_json ? JSON.stringify(rule.condition_json) : <span className="opacity-40">All matching records</span>}
                        </td>
                        <td>{rule.priority}</td>
                        <td className="text-right">
                          <button className="btn btn-ghost btn-xs text-error" type="button" disabled={saving} onClick={() => removeRule(rule.id)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="text-sm opacity-60">No rules on this profile yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}
    </TabbedPaneShell>
  );
}
