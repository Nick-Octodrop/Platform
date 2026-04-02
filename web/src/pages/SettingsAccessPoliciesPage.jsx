import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
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

function Section({ title, description, children }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function SettingsAccessPoliciesPage() {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createDraft, setCreateDraft] = useState({ name: "", description: "", profile_key: "" });
  const [ruleDraft, setRuleDraft] = useState({ resource_type: "module", resource_id: "", access_level: "hidden", priority: 100, condition_json_text: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/access/profiles");
      const nextProfiles = res?.profiles || [];
      setProfiles(nextProfiles);
      setSelectedProfileId((prev) => (prev && nextProfiles.some((p) => p.id === prev) ? prev : (nextProfiles[0]?.id || "")));
    } catch (err) {
      setError(err?.message || "Failed to load access profiles");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) || null,
    [profiles, selectedProfileId],
  );

  async function createProfile() {
    if (!createDraft.name.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiFetch("/access/profiles", {
        method: "POST",
        body: createDraft,
      });
      setCreateDraft({ name: "", description: "", profile_key: "" });
      setNotice("Access profile created.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to create access profile");
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile() {
    if (!selectedProfile?.id) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/access/profiles/${selectedProfile.id}`, {
        method: "PATCH",
        body: {
          name: selectedProfile.name || "",
          description: selectedProfile.description || "",
          profile_key: selectedProfile.profile_key || "",
        },
      });
      setNotice("Access profile updated.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to update access profile");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProfile() {
    if (!selectedProfile?.id) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/access/profiles/${selectedProfile.id}`, { method: "DELETE" });
      setNotice("Access profile deleted.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete access profile");
    } finally {
      setSaving(false);
    }
  }

  async function addRule() {
    if (!selectedProfile?.id || !ruleDraft.resource_id.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      let conditionJson = undefined;
      if (ruleDraft.resource_type === "entity" && ruleDraft.condition_json_text.trim()) {
        try {
          conditionJson = JSON.parse(ruleDraft.condition_json_text);
        } catch {
          setError("Condition JSON must be valid JSON.");
          setSaving(false);
          return;
        }
      }
      await apiFetch(`/access/profiles/${selectedProfile.id}/rules`, {
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
      setNotice("Rule added.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to add rule");
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(ruleId) {
    if (!selectedProfile?.id || !ruleId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/access/profiles/${selectedProfile.id}/rules/${ruleId}`, { method: "DELETE" });
      setNotice("Rule deleted.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete rule");
    } finally {
      setSaving(false);
    }
  }

  const levelOptions = ACCESS_LEVELS[ruleDraft.resource_type] || ACCESS_LEVELS.module;

  return (
    <TabbedPaneShell
      title="Access Policies"
      subtitle="Profile-based module, entity, field, action, and scoped record visibility rules."
      tabs={[]}
      rightActions={(
        <button className="btn btn-sm btn-ghost" type="button" disabled={loading || saving} onClick={load}>
          Refresh
        </button>
      )}
    >
      <div className="space-y-4">
        {error ? <div className="alert alert-error text-sm">{error}</div> : null}
        {notice ? <div className="alert alert-success text-sm">{notice}</div> : null}

        <Section title="New profile" description="Create reusable access bundles like Sales, Ops, or Finance.">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <label className="form-control md:col-span-4">
              <span className="label-text text-sm">Name</span>
              <input className="input input-bordered input-sm" value={createDraft.name} disabled={saving} onChange={(e) => setCreateDraft((prev) => ({ ...prev, name: e.target.value }))} />
            </label>
            <label className="form-control md:col-span-3">
              <span className="label-text text-sm">Key</span>
              <input className="input input-bordered input-sm" value={createDraft.profile_key} disabled={saving} onChange={(e) => setCreateDraft((prev) => ({ ...prev, profile_key: e.target.value }))} />
            </label>
            <label className="form-control md:col-span-3">
              <span className="label-text text-sm">Description</span>
              <input className="input input-bordered input-sm" value={createDraft.description} disabled={saving} onChange={(e) => setCreateDraft((prev) => ({ ...prev, description: e.target.value }))} />
            </label>
            <div className="md:col-span-2 flex items-end">
              <button className="btn btn-primary btn-sm w-full" type="button" disabled={saving || !createDraft.name.trim()} onClick={createProfile}>
                Create profile
              </button>
            </div>
          </div>
        </Section>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Section title="Profiles" description="Select a profile to edit its rules.">
            {loading ? (
              <div className="text-sm opacity-70">Loading profiles…</div>
            ) : profiles.length ? (
              <div className="space-y-2">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className={`w-full rounded-box border px-3 py-3 text-left ${selectedProfileId === profile.id ? "border-primary bg-base-200" : "border-base-300 bg-base-100"}`}
                    onClick={() => setSelectedProfileId(profile.id)}
                  >
                    <div className="font-medium text-sm">{profile.name || profile.id}</div>
                    <div className="text-xs opacity-70 mt-1">{profile.description || "No description"}</div>
                    <div className="mt-2 flex gap-2 text-xs opacity-60">
                      <span>{profile.rule_count || 0} rules</span>
                      <span>{profile.assignment_count || 0} users</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm opacity-70">No profiles yet.</div>
            )}
          </Section>

          <div className="xl:col-span-8 space-y-4">
            <Section title="Profile details" description="Names are user-facing. Keys are stable references you can reuse in seed data later.">
              {selectedProfile ? (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <label className="form-control md:col-span-4">
                    <span className="label-text text-sm">Name</span>
                    <input
                      className="input input-bordered input-sm"
                      value={selectedProfile.name || ""}
                      disabled={saving}
                      onChange={(e) => setProfiles((prev) => prev.map((profile) => (profile.id === selectedProfile.id ? { ...profile, name: e.target.value } : profile)))}
                    />
                  </label>
                  <label className="form-control md:col-span-3">
                    <span className="label-text text-sm">Key</span>
                    <input
                      className="input input-bordered input-sm"
                      value={selectedProfile.profile_key || ""}
                      disabled={saving}
                      onChange={(e) => setProfiles((prev) => prev.map((profile) => (profile.id === selectedProfile.id ? { ...profile, profile_key: e.target.value } : profile)))}
                    />
                  </label>
                  <label className="form-control md:col-span-5">
                    <span className="label-text text-sm">Description</span>
                    <input
                      className="input input-bordered input-sm"
                      value={selectedProfile.description || ""}
                      disabled={saving}
                      onChange={(e) => setProfiles((prev) => prev.map((profile) => (profile.id === selectedProfile.id ? { ...profile, description: e.target.value } : profile)))}
                    />
                  </label>
                  <div className="md:col-span-12 flex justify-between gap-3">
                    <button className="btn btn-error btn-sm" type="button" disabled={saving} onClick={deleteProfile}>
                      Delete profile
                    </button>
                    <button className="btn btn-primary btn-sm" type="button" disabled={saving || !selectedProfile.name?.trim()} onClick={saveProfile}>
                      Save profile
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm opacity-70">Select a profile to edit it.</div>
              )}
            </Section>

            <Section title="Rules" description="Use exact ids such as a module id, entity id, field id, or module_id:action_id. Entity rules can include a condition JSON filter to scope matching records only.">
              {selectedProfile ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <label className="form-control md:col-span-3">
                      <span className="label-text text-sm">Resource type</span>
                      <select
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
                      </select>
                    </label>
                    <label className="form-control md:col-span-4">
                      <span className="label-text text-sm">Resource id</span>
                      <input
                        className="input input-bordered input-sm"
                        value={ruleDraft.resource_id}
                        disabled={saving}
                        placeholder="quotes, entity.nl_quote, nl_quote.grand_total, luke_quotes:action.accept"
                        onChange={(e) => setRuleDraft((prev) => ({ ...prev, resource_id: e.target.value }))}
                      />
                    </label>
                    <label className="form-control md:col-span-3">
                      <span className="label-text text-sm">Access</span>
                      <select
                        className="select select-bordered select-sm"
                        value={ruleDraft.access_level}
                        disabled={saving}
                        onChange={(e) => setRuleDraft((prev) => ({ ...prev, access_level: e.target.value }))}
                      >
                        {levelOptions.map((item) => (
                          <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-control md:col-span-1">
                      <span className="label-text text-sm">Priority</span>
                      <input
                        className="input input-bordered input-sm"
                        type="number"
                        value={ruleDraft.priority}
                        disabled={saving}
                        onChange={(e) => setRuleDraft((prev) => ({ ...prev, priority: Number(e.target.value || 100) }))}
                      />
                    </label>
                    <div className="md:col-span-1 flex items-end">
                      <button className="btn btn-primary btn-sm w-full" type="button" disabled={saving || !ruleDraft.resource_id.trim()} onClick={addRule}>
                        Add
                      </button>
                    </div>
                    {ruleDraft.resource_type === "entity" ? (
                      <label className="form-control md:col-span-12">
                        <span className="label-text text-sm">Scope condition JSON</span>
                        <textarea
                          className="textarea textarea-bordered textarea-sm min-h-24 font-mono text-xs"
                          value={ruleDraft.condition_json_text}
                          disabled={saving}
                          placeholder='Optional. Example: {"op":"eq","field":"nl_contact.contact_type","value":"Customer"}'
                          onChange={(e) => setRuleDraft((prev) => ({ ...prev, condition_json_text: e.target.value }))}
                        />
                      </label>
                    ) : null}
                  </div>

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
                        {(selectedProfile.rules || []).length ? (
                          selectedProfile.rules.map((rule) => (
                            <tr key={rule.id}>
                              <td>{rule.resource_type}</td>
                              <td className="font-mono text-xs">{rule.resource_id}</td>
                              <td>{rule.access_level}</td>
                              <td className="max-w-xs truncate font-mono text-[11px] opacity-70">
                                {rule.condition_json ? JSON.stringify(rule.condition_json) : <span className="opacity-40">Global</span>}
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
                </div>
              ) : (
                <div className="text-sm opacity-70">Select a profile to manage rules.</div>
              )}
            </Section>
          </div>
        </div>
      </div>
    </TabbedPaneShell>
  );
}
