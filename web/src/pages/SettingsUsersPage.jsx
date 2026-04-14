import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { useAccessContext } from "../access.js";
import { useToast } from "../components/Toast.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import PaginationControls from "../components/PaginationControls.jsx";
import AppSelect from "../components/AppSelect.jsx";

function SettingsSection({ title, description, children }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="text-sm opacity-70 mt-1">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function SettingsUsersPage() {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const [members, setMembers] = useState([]);
  const [accessProfiles, setAccessProfiles] = useState([]);
  const [page, setPage] = useState(0);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pendingRemove, setPendingRemove] = useState(null);
  const [deleteAuthUser, setDeleteAuthUser] = useState(false);
  const [pendingEmailEdit, setPendingEmailEdit] = useState(null);
  const [nextEmail, setNextEmail] = useState("");
  const [pendingProfileEdit, setPendingProfileEdit] = useState(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState([]);
  const [platformInviteEmail, setPlatformInviteEmail] = useState("");
  const [platformInviteRole, setPlatformInviteRole] = useState("standard");
  const { context, loading: accessLoading } = useAccessContext();

  const roleOptions = useMemo(
    () => [
      { value: "admin", label: t("settings.users.roles.admin") },
      { value: "member", label: t("settings.users.roles.member") },
      { value: "readonly", label: t("settings.users.roles.readonly") },
      { value: "portal", label: t("settings.users.roles.portal") },
    ],
    [t],
  );

  const platformRoleOptions = useMemo(
    () => [
      { value: "standard", label: t("settings.users.platform_roles.standard") },
      { value: "superadmin", label: t("settings.users.platform_roles.superadmin") },
    ],
    [t],
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const actorCtx = context?.actor || {};
      const nextCanManage = actorCtx?.workspace_role === "admin" || actorCtx?.platform_role === "superadmin";
      const requests = [apiFetch("/access/members")];
      if (nextCanManage) requests.push(apiFetch("/access/profiles"));
      const [membersRes, profilesRes] = await Promise.all(requests);
      setMembers(membersRes?.members || []);
      setAccessProfiles(profilesRes?.profiles || []);
    } catch (err) {
      setError(err?.message || t("settings.users.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (accessLoading || !context) return;
    load();
  }, [accessLoading, context]);

  const actor = context?.actor || {};
  const canManage = actor?.workspace_role === "admin" || actor?.platform_role === "superadmin";
  const canDeleteAuth = actor?.platform_role === "superadmin";
  const adminCount = useMemo(() => members.filter((m) => (m?.role || "") === "admin").length, [members]);
  const pageSize = 25;
  const totalPages = useMemo(() => Math.max(1, Math.ceil(members.length / pageSize)), [members.length]);

  useEffect(() => {
    setPage((prev) => Math.min(Math.max(0, prev), totalPages - 1));
  }, [totalPages]);

  const pagedMembers = useMemo(() => {
    const start = page * pageSize;
    return members.slice(start, start + pageSize);
  }, [members, page]);

  const roleLabel = useMemo(() => {
    const map = new Map(roleOptions.map((r) => [r.value, r.label]));
    return (role) => map.get(role) || role || t("settings.users.roles.member");
  }, [roleOptions, t]);

  function openProfileModal(member) {
    setPendingProfileEdit(member);
    setSelectedProfileIds(Array.isArray(member?.access_profile_ids) ? member.access_profile_ids : []);
  }

  function closeProfileModal() {
    setPendingProfileEdit(null);
    setSelectedProfileIds([]);
  }

  async function updateProfiles(member) {
    if (!member?.user_id) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/access/members/${member.user_id}/profiles`, {
        method: "PATCH",
        body: { profile_ids: selectedProfileIds },
      });
      await load();
      pushToast("success", t("settings.users.access_profiles_updated"));
      closeProfileModal();
    } catch (err) {
      setError(err?.message || t("settings.users.access_profiles_update_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function inviteMember() {
    if (!inviteEmail.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/access/members/invite", {
        method: "POST",
        body: {
          email: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
          redirect_to: `${window.location.origin}/auth/set-password`,
        },
      });
      setMembers(res?.members || []);
      pushToast("success", t("settings.users.invitation_sent", { email: inviteEmail.trim() }));
      setInviteEmail("");
    } catch (err) {
      setError(err?.message || t("settings.users.invite_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function updateRole(userId, role) {
    const current = members.find((m) => m.user_id === userId);
    if (current && current.role === "admin" && role !== "admin" && adminCount <= 1) {
      setError(t("settings.users.admin_required"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/access/members/${userId}`, {
        method: "PATCH",
        body: { role },
      });
      setMembers(res?.members || []);
      pushToast("success", t("settings.users.role_updated"));
    } catch (err) {
      setError(err?.message || t("settings.users.role_update_failed"));
    } finally {
      setSaving(false);
    }
  }

  function openRemoveModal(member) {
    if ((member?.role || "") === "admin" && adminCount <= 1) {
      setError(t("settings.users.admin_required"));
      return;
    }
    setPendingRemove(member);
    setDeleteAuthUser(!!canDeleteAuth);
  }

  function closeRemoveModal() {
    setPendingRemove(null);
    setDeleteAuthUser(false);
  }

  async function removeMember(member) {
    if (!member?.user_id) return;
    setSaving(true);
    setError("");
    try {
      const query = deleteAuthUser ? "?delete_auth_user=1" : "";
      const res = await apiFetch(`/access/members/${member.user_id}${query}`, { method: "DELETE" });
      setMembers(res?.members || []);
      pushToast("success", deleteAuthUser ? t("settings.users.user_removed_with_auth") : t("settings.users.user_removed"));
      closeRemoveModal();
    } catch (err) {
      setError(err?.message || t("settings.users.remove_failed"));
    } finally {
      setSaving(false);
    }
  }

  function openEmailModal(member) {
    setPendingEmailEdit(member);
    setNextEmail(member?.email || "");
  }

  function closeEmailModal() {
    setPendingEmailEdit(null);
    setNextEmail("");
  }

  async function updateMemberEmail(member) {
    if (!member?.user_id || !nextEmail.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/access/members/${member.user_id}/email`, {
        method: "PATCH",
        body: { email: nextEmail.trim().toLowerCase() },
      });
      setMembers(res?.members || []);
      pushToast("success", t("settings.users.email_updated"));
      closeEmailModal();
    } catch (err) {
      setError(err?.message || t("settings.users.email_update_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function invitePlatformUser() {
    if (!platformInviteEmail.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/access/platform-invite", {
        method: "POST",
        body: {
          email: platformInviteEmail.trim().toLowerCase(),
          platform_role: platformInviteRole,
        },
      });
      pushToast(
        "success",
        t("settings.users.platform_invite_sent", {
          email: platformInviteEmail.trim(),
          flow: res?.email_flow || "invite",
        }),
      );
      setPlatformInviteEmail("");
      setPlatformInviteRole("standard");
    } catch (err) {
      setError(err?.message || t("settings.users.platform_invite_failed"));
    } finally {
      setSaving(false);
    }
  }

  const tabs = useMemo(
    () => [],
    [],
  );

  return (
    <TabbedPaneShell
      tabs={tabs}
      contentContainer={true}
    >
      <div className="space-y-4">
        {error && <div className="alert alert-error text-sm">{error}</div>}

        <div className="space-y-4">
          <SettingsSection title={t("settings.users.invite_title")} description={t("settings.users.invite_description")}>
            {canManage ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <label className="form-control md:col-span-6">
                  <span className="label-text text-sm">{t("settings.email")}</span>
                  <input
                    className="input input-bordered input-sm"
                    type="email"
                    placeholder="user@company.com"
                    value={inviteEmail}
                    disabled={saving}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </label>
                <label className="form-control md:col-span-3">
                  <span className="label-text text-sm">{t("settings.role")}</span>
                  <AppSelect
                    className="select select-bordered select-sm"
                    value={inviteRole}
                    disabled={saving}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    {roleOptions.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <div className="md:col-span-3 flex items-end">
                  <button
                    className="btn btn-primary btn-sm w-full"
                    disabled={saving || !inviteEmail.trim()}
                    onClick={inviteMember}
                    type="button"
                  >
                    {t("settings.users.invite_action")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm opacity-70">{t("settings.users.admin_required_manage")}</div>
            )}
          </SettingsSection>

          {actor.platform_role === "superadmin" ? (
            <SettingsSection
              title={t("settings.users.platform_invite_title")}
              description={t("settings.users.platform_invite_description")}
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <label className="form-control md:col-span-6">
                  <span className="label-text text-sm">{t("settings.email")}</span>
                  <input
                    className="input input-bordered input-sm"
                    type="email"
                    placeholder="user@company.com"
                    value={platformInviteEmail}
                    disabled={saving}
                    onChange={(e) => setPlatformInviteEmail(e.target.value)}
                  />
                </label>
                <label className="form-control md:col-span-3">
                  <span className="label-text text-sm">{t("settings.users.platform_role")}</span>
                  <AppSelect
                    className="select select-bordered select-sm"
                    value={platformInviteRole}
                    disabled={saving}
                    onChange={(e) => setPlatformInviteRole(e.target.value)}
                  >
                    {platformRoleOptions.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <div className="md:col-span-3 flex items-end">
                  <button
                    className="btn btn-primary btn-sm w-full"
                    disabled={saving || !platformInviteEmail.trim()}
                    onClick={invitePlatformUser}
                    type="button"
                  >
                    {t("settings.users.invite_platform_action")}
                  </button>
                </div>
              </div>
            </SettingsSection>
          ) : null}

          <SettingsSection title={t("settings.users.workspace_users_title")} description={t("settings.users.workspace_users_description")}>
            {loading ? (
              <div className="text-sm opacity-60">{t("settings.users.loading_users")}</div>
            ) : members.length === 0 ? (
              <div className="text-sm opacity-60">{t("settings.users.no_users")}</div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-end">
                  <PaginationControls
                    page={page}
                    pageSize={pageSize}
                    totalItems={members.length}
                    onPageChange={setPage}
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="table table-sm table-fixed w-full">
                  <thead>
                    <tr>
                      <th className="w-48">{t("settings.users.user")}</th>
                      <th className="w-64">{t("settings.email")}</th>
                      <th className="w-44">{t("settings.role")}</th>
                      <th className="w-72">{t("settings.users.access_profiles")}</th>
                      <th className="w-56">{t("settings.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                  {pagedMembers.map((member) => (
                    <tr key={member.user_id}>
                      <td>
                        <div className="truncate" title={member.name || member.user_id}>
                          {member.name || member.user_id}
                        </div>
                      </td>
                      <td>
                        <div className="truncate" title={member.email || "—"}>
                          {member.email || "—"}
                        </div>
                      </td>
                      <td>
                        {canManage ? (
                          <AppSelect
                            className="select select-bordered select-sm w-full max-w-[11rem]"
                            value={member.role || "member"}
                            disabled={saving || ((member.role || "") === "admin" && adminCount <= 1)}
                            title={((member.role || "") === "admin" && adminCount <= 1)
                              ? t("settings.users.admin_required_title")
                              : ""}
                            onChange={(e) => updateRole(member.user_id, e.target.value)}
                          >
                            {roleOptions.map((role) => (
                              <option key={role.value} value={role.value}>
                                {role.label}
                                </option>
                              ))}
                            </AppSelect>
                          ) : (
                          <span>{roleLabel(member.role)}</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1 max-w-full">
                          {(member.access_profiles || []).length ? (
                            member.access_profiles.map((profile) => (
                              <span key={profile.id} className="badge badge-outline badge-sm max-w-full">
                                {profile.name || profile.id}
                              </span>
                            ))
                          ) : (
                            <span className="opacity-60">—</span>
                          )}
                        </div>
                      </td>
                        <td>
                          {canManage ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                className="btn btn-ghost btn-xs"
                                disabled={saving}
                                onClick={() => openProfileModal(member)}
                                type="button"
                              >
                                {t("settings.users.access")}
                              </button>
                              <button
                                className="btn btn-ghost btn-xs"
                                disabled={saving}
                                onClick={() => openEmailModal(member)}
                                type="button"
                              >
                                {t("settings.users.change_email")}
                              </button>
                              <button
                                className="btn btn-ghost btn-xs text-error"
                                disabled={saving || ((member.role || "") === "admin" && adminCount <= 1)}
                                title={((member.role || "") === "admin" && adminCount <= 1)
                                  ? t("settings.users.admin_required_title")
                                  : ""}
                                onClick={() => openRemoveModal(member)}
                                type="button"
                              >
                                {t("settings.users.remove")}
                              </button>
                            </div>
                          ) : (
                            <span className="opacity-60">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
              </div>
            )}
          </SettingsSection>
        </div>
      </div>

      {pendingRemove ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">{t("settings.users.remove_user_title")}</h3>
            <p className="text-sm opacity-70 mt-2">
              {t("settings.users.remove_user_body", {
                user: pendingRemove.email || pendingRemove.name || pendingRemove.user_id,
              })}
            </p>
            <label className="label cursor-pointer justify-start gap-3 mt-3">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={deleteAuthUser}
                disabled={saving || !canDeleteAuth}
                onChange={(e) => setDeleteAuthUser(e.target.checked)}
              />
              <span className="label-text">
                {t("settings.users.delete_auth_user")}
              </span>
            </label>
            {!canDeleteAuth ? (
              <p className="text-xs opacity-70 mt-1">{t("settings.users.superadmin_required")}</p>
            ) : null}
            <div className="modal-action">
              <button className="btn btn-sm" onClick={closeRemoveModal} disabled={saving} type="button">{t("common.cancel")}</button>
              <button className="btn btn-error btn-sm" onClick={() => removeMember(pendingRemove)} disabled={saving} type="button">
                {saving ? t("settings.users.removing") : t("settings.users.remove_user_action")}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={closeRemoveModal} />
        </div>
      ) : null}

      {pendingEmailEdit ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">{t("settings.users.change_email_title")}</h3>
            <p className="text-sm opacity-70 mt-2">{t("settings.users.change_email_description")}</p>
            <label className="form-control mt-3">
              <span className="label-text">{t("settings.users.new_email")}</span>
              <input
                className="input input-bordered input-sm"
                type="email"
                value={nextEmail}
                disabled={saving}
                onChange={(e) => setNextEmail(e.target.value)}
              />
            </label>
            <div className="modal-action">
              <button className="btn btn-sm" onClick={closeEmailModal} disabled={saving} type="button">{t("common.cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => updateMemberEmail(pendingEmailEdit)}
                disabled={saving || !nextEmail.trim()}
                type="button"
              >
                {saving ? t("settings.users.updating") : t("settings.users.update_email")}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={closeEmailModal} />
        </div>
      ) : null}

      {pendingProfileEdit ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">{t("settings.users.access_profiles")}</h3>
            <p className="text-sm opacity-70 mt-2">
              {t("settings.users.assign_access_profiles", {
                user: pendingProfileEdit.email || pendingProfileEdit.name || pendingProfileEdit.user_id,
              })}
            </p>
            <div className="mt-4 space-y-3 max-h-80 overflow-y-auto">
              {accessProfiles.length ? (
                accessProfiles.map((profile) => {
                  const checked = selectedProfileIds.includes(profile.id);
                  return (
                    <label key={profile.id} className="flex items-start gap-3 rounded-box border border-base-300 bg-base-100 p-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm mt-0.5"
                        checked={checked}
                        disabled={saving}
                        onChange={(e) => {
                          setSelectedProfileIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(profile.id);
                            else next.delete(profile.id);
                            return Array.from(next);
                          });
                        }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{profile.name || profile.id}</div>
                        {profile.description ? <div className="text-xs opacity-70 mt-1">{profile.description}</div> : null}
                      </div>
                    </label>
                  );
                })
              ) : (
                <div className="text-sm opacity-70">{t("settings.users.no_access_profiles")}</div>
              )}
            </div>
            <div className="modal-action">
              <button className="btn btn-sm" onClick={closeProfileModal} disabled={saving} type="button">{t("common.cancel")}</button>
              <button className="btn btn-primary btn-sm" onClick={() => updateProfiles(pendingProfileEdit)} disabled={saving} type="button">
                {saving ? t("common.saving") : t("settings.users.save_access")}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={closeProfileModal} />
        </div>
      ) : null}
    </TabbedPaneShell>
  );
}
