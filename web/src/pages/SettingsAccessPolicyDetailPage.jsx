import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api.js";
import AppSelect from "../components/AppSelect.jsx";
import { useToast } from "../components/Toast.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";

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
  const { t } = useI18n();
  const { profileId } = useParams();
  const { pushToast } = useToast();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTabId, setActiveTabId] = useState("details");
  const [ruleDraft, setRuleDraft] = useState({ resource_type: "module", resource_id: "", access_level: "hidden", priority: 100, condition_json_text: "" });

  const resourceTypes = useMemo(
    () => [
      { value: "module", label: t("settings.access_policies.detail.resource_types.module") },
      { value: "entity", label: t("settings.access_policies.detail.resource_types.entity") },
      { value: "field", label: t("settings.access_policies.detail.resource_types.field") },
      { value: "action", label: t("settings.access_policies.detail.resource_types.action") },
    ],
    [t],
  );

  const accessLevels = useMemo(
    () => ({
      module: [
        { value: "hidden", label: t("settings.access_policies.detail.access_levels.module.hidden") },
        { value: "visible", label: t("settings.access_policies.detail.access_levels.module.visible") },
      ],
      entity: [
        { value: "none", label: t("settings.access_policies.detail.access_levels.entity.none") },
        { value: "read", label: t("settings.access_policies.detail.access_levels.entity.read") },
        { value: "write", label: t("settings.access_policies.detail.access_levels.entity.write") },
      ],
      field: [
        { value: "hidden", label: t("settings.access_policies.detail.access_levels.field.hidden") },
        { value: "read", label: t("settings.access_policies.detail.access_levels.field.read") },
        { value: "write", label: t("settings.access_policies.detail.access_levels.field.write") },
      ],
      action: [
        { value: "hidden", label: t("settings.access_policies.detail.access_levels.action.hidden") },
        { value: "run", label: t("settings.access_policies.detail.access_levels.action.run") },
      ],
    }),
    [t],
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/access/profiles");
      setProfiles(res?.profiles || []);
    } catch (err) {
      setProfiles([]);
      setError(err?.message || t("settings.access_policies.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [profileId]);

  const profile = useMemo(() => profiles.find((item) => item.id === profileId) || null, [profiles, profileId]);
  const levelOptions = accessLevels[ruleDraft.resource_type] || accessLevels.module;

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
      pushToast("success", t("settings.access_policies.detail.updated"));
      await load();
    } catch (err) {
      setError(err?.message || t("settings.access_policies.detail.update_failed"));
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
          throw new Error(t("settings.access_policies.detail.condition_json_invalid"));
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
      pushToast("success", t("settings.access_policies.detail.rule_added"));
      await load();
    } catch (err) {
      setError(err?.message || t("settings.access_policies.detail.add_rule_failed"));
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
      pushToast("success", t("settings.access_policies.detail.rule_deleted"));
      await load();
    } catch (err) {
      setError(err?.message || t("settings.access_policies.detail.delete_rule_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TabbedPaneShell
      tabs={[
        { id: "details", label: t("settings.access_policies.detail.tabs.details") },
        { id: "rules", label: t("settings.access_policies.detail.tabs.rules") },
      ]}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      contentContainer={true}
    >
      {error ? <div className="alert alert-error text-sm mb-4">{error}</div> : null}

      {loading ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-70">{t("common.loading")}</div>
      ) : !profile ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-4 text-sm opacity-60">{t("settings.access_policies.detail.not_found")}</div>
      ) : activeTabId === "details" ? (
        <div className="space-y-4">
          <Section title={t("settings.access_policies.detail.profile_title")} description={t("settings.access_policies.detail.profile_description")}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <label className="form-control md:col-span-4">
                <span className="label-text text-sm">{t("settings.access_policies.name")}</span>
                <input className="input input-bordered input-sm" value={profile.name || ""} disabled={saving} onChange={(e) => setProfiles((prev) => prev.map((item) => (item.id === profile.id ? { ...item, name: e.target.value } : item)))} />
              </label>
              <label className="form-control md:col-span-3">
                <span className="label-text text-sm">{t("settings.access_policies.key")}</span>
                <input className="input input-bordered input-sm" value={profile.profile_key || ""} disabled={saving} onChange={(e) => setProfiles((prev) => prev.map((item) => (item.id === profile.id ? { ...item, profile_key: e.target.value } : item)))} />
              </label>
              <label className="form-control md:col-span-5">
                <span className="label-text text-sm">{t("settings.access_policies.description")}</span>
                <input className="input input-bordered input-sm" value={profile.description || ""} disabled={saving} onChange={(e) => setProfiles((prev) => prev.map((item) => (item.id === profile.id ? { ...item, description: e.target.value } : item)))} />
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-box bg-base-200/40 p-3">
                <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.access_policies.rules")}</div>
                <div className="mt-1 text-lg font-semibold">{Number(profile.rule_count || 0)}</div>
              </div>
              <div className="rounded-box bg-base-200/40 p-3">
                <div className="text-xs uppercase tracking-wide opacity-60">{t("settings.access_policies.detail.assigned_users")}</div>
                <div className="mt-1 text-lg font-semibold">{Number(profile.assignment_count || 0)}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-sm btn-primary" type="button" disabled={saving || !profile.name?.trim()} onClick={saveProfile}>
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </Section>
        </div>
      ) : (
        <div className="space-y-4">
          <Section title={t("settings.access_policies.detail.add_rule_title")} description={t("settings.access_policies.detail.add_rule_description")}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <label className="form-control md:col-span-3">
                <span className="label-text text-sm">{t("settings.access_policies.detail.resource_type")}</span>
                <AppSelect
                  className="select select-bordered select-sm"
                  value={ruleDraft.resource_type}
                  disabled={saving}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    const nextLevels = accessLevels[nextType] || accessLevels.module;
                    setRuleDraft((prev) => ({ ...prev, resource_type: nextType, access_level: nextLevels[0].value }));
                  }}
                >
                  {resourceTypes.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">{t("settings.access_policies.detail.resource_type_help")}</span>
              </label>
              <label className="form-control md:col-span-4">
                <span className="label-text text-sm">{t("settings.access_policies.detail.resource_id")}</span>
                <input className="input input-bordered input-sm" value={ruleDraft.resource_id} disabled={saving} placeholder={t("settings.access_policies.detail.resource_id_placeholder")} onChange={(e) => setRuleDraft((prev) => ({ ...prev, resource_id: e.target.value }))} />
                <span className="label label-text-alt opacity-50">
                  {t("settings.access_policies.detail.resource_id_help")}
                </span>
              </label>
              <label className="form-control md:col-span-3">
                <span className="label-text text-sm">{t("settings.access_policies.detail.access")}</span>
                <AppSelect className="select select-bordered select-sm" value={ruleDraft.access_level} disabled={saving} onChange={(e) => setRuleDraft((prev) => ({ ...prev, access_level: e.target.value }))}>
                  {levelOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </AppSelect>
                <span className="label label-text-alt opacity-50">{t("settings.access_policies.detail.access_help")}</span>
              </label>
              <label className="form-control md:col-span-2">
                <span className="label-text text-sm">{t("settings.access_policies.detail.priority")}</span>
                <input className="input input-bordered input-sm" type="number" value={ruleDraft.priority} disabled={saving} onChange={(e) => setRuleDraft((prev) => ({ ...prev, priority: Number(e.target.value || 100) }))} />
                <span className="label label-text-alt opacity-50">{t("settings.access_policies.detail.priority_help")}</span>
              </label>
              <label className="form-control md:col-span-12">
                <span className="label-text text-sm">{t("settings.access_policies.detail.condition_json")}</span>
                <textarea
                  className="textarea textarea-bordered textarea-sm min-h-24 font-mono text-xs"
                  value={ruleDraft.condition_json_text}
                  disabled={saving}
                  placeholder={t("settings.access_policies.detail.condition_json_placeholder")}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, condition_json_text: e.target.value }))}
                />
                <span className="label label-text-alt opacity-50">
                  {t("settings.access_policies.detail.condition_json_help")}
                </span>
              </label>
            </div>
            <div className="mt-4">
              <button className="btn btn-sm btn-primary" type="button" disabled={saving || !ruleDraft.resource_id.trim()} onClick={addRule}>
                {t("settings.access_policies.detail.add_rule_action")}
              </button>
            </div>
          </Section>

          <Section title={t("settings.access_policies.rules")} description={t("settings.access_policies.detail.rules_description")}>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>{t("settings.type")}</th>
                    <th>{t("settings.access_policies.detail.resource")}</th>
                    <th>{t("settings.access_policies.detail.access")}</th>
                    <th>{t("settings.access_policies.detail.scope")}</th>
                    <th>{t("settings.access_policies.detail.priority")}</th>
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
                          {rule.condition_json ? JSON.stringify(rule.condition_json) : <span className="opacity-40">{t("settings.access_policies.detail.all_matching_records")}</span>}
                        </td>
                        <td>{rule.priority}</td>
                        <td className="text-right">
                          <button className="btn btn-ghost btn-xs text-error" type="button" disabled={saving} onClick={() => removeRule(rule.id)}>
                            {t("common.delete")}
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="text-sm opacity-60">{t("settings.access_policies.detail.no_rules")}</td>
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
