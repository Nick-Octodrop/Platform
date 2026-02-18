import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import PaginationControls from "../components/PaginationControls.jsx";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "User" },
  { value: "readonly", label: "Read only" },
  { value: "portal", label: "Portal" },
];
const PLATFORM_ROLE_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "superadmin", label: "Superadmin" },
];

export default function SettingsUsersPage() {
  const [context, setContext] = useState(null);
  const [members, setMembers] = useState([]);
  const [page, setPage] = useState(0);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingRemove, setPendingRemove] = useState(null);
  const [deleteAuthUser, setDeleteAuthUser] = useState(false);
  const [pendingEmailEdit, setPendingEmailEdit] = useState(null);
  const [nextEmail, setNextEmail] = useState("");
  const [platformInviteEmail, setPlatformInviteEmail] = useState("");
  const [platformInviteRole, setPlatformInviteRole] = useState("standard");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [ctxRes, membersRes] = await Promise.all([apiFetch("/access/context"), apiFetch("/access/members")]);
      setContext(ctxRes || null);
      setMembers(membersRes?.members || []);
    } catch (err) {
      setError(err?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
    const map = new Map(ROLE_OPTIONS.map((r) => [r.value, r.label]));
    return (role) => map.get(role) || role || "member";
  }, []);

  async function inviteMember() {
    if (!inviteEmail.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
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
      setNotice(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
    } catch (err) {
      setError(err?.message || "Failed to invite user");
    } finally {
      setSaving(false);
    }
  }

  async function updateRole(userId, role) {
    const current = members.find((m) => m.user_id === userId);
    if (current && current.role === "admin" && role !== "admin" && adminCount <= 1) {
      setError("At least one admin user is required in every workspace.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/access/members/${userId}`, {
        method: "PATCH",
        body: { role },
      });
      setMembers(res?.members || []);
    } catch (err) {
      setError(err?.message || "Failed to update role");
    } finally {
      setSaving(false);
    }
  }

  function openRemoveModal(member) {
    if ((member?.role || "") === "admin" && adminCount <= 1) {
      setError("At least one admin user is required in every workspace.");
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
    setNotice("");
    try {
      const query = deleteAuthUser ? "?delete_auth_user=1" : "";
      const res = await apiFetch(`/access/members/${member.user_id}${query}`, { method: "DELETE" });
      setMembers(res?.members || []);
      setNotice(deleteAuthUser ? "User removed and auth account deleted." : "User removed from workspace.");
      closeRemoveModal();
    } catch (err) {
      setError(err?.message || "Failed to remove user");
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
    setNotice("");
    try {
      const res = await apiFetch(`/access/members/${member.user_id}/email`, {
        method: "PATCH",
        body: { email: nextEmail.trim().toLowerCase() },
      });
      setMembers(res?.members || []);
      setNotice("User email updated.");
      closeEmailModal();
    } catch (err) {
      setError(err?.message || "Failed to update user email");
    } finally {
      setSaving(false);
    }
  }

  async function invitePlatformUser() {
    if (!platformInviteEmail.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch("/access/platform-invite", {
        method: "POST",
        body: {
          email: platformInviteEmail.trim().toLowerCase(),
          platform_role: platformInviteRole,
        },
      });
      setNotice(
        `Platform invite sent to ${platformInviteEmail.trim()} (${res?.email_flow || "invite"} flow). No workspace assigned until first login.`,
      );
      setPlatformInviteEmail("");
      setPlatformInviteRole("standard");
    } catch (err) {
      setError(err?.message || "Failed to send platform invite");
    } finally {
      setSaving(false);
    }
  }

  function Section({ title, description, children }) {
    return (
      <div className="rounded-box border border-base-300 bg-base-100 p-4">
        <div className="text-sm font-semibold">{title}</div>
        {description ? <div className="text-sm opacity-70 mt-1">{description}</div> : null}
        <div className="mt-4">{children}</div>
      </div>
    );
  }

  const tabs = useMemo(
    () => [],
    [],
  );

  return (
    <TabbedPaneShell
      title="Users & Roles"
      subtitle="Invite workspace users and manage access roles."
      tabs={tabs}
      rightActions={(
        <button className="btn btn-sm btn-ghost" type="button" disabled={loading || saving} onClick={load}>
          Refresh
        </button>
      )}
    >
      <div className="space-y-4">
        {error && <div className="alert alert-error text-sm">{error}</div>}
        {notice && <div className="alert alert-success text-sm">{notice}</div>}

        <div className="space-y-4">
          <Section title="Invite user" description="Add someone to this workspace.">
            {canManage ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <label className="form-control md:col-span-6">
                  <span className="label-text text-sm">Email</span>
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
                  <span className="label-text text-sm">Role</span>
                  <select
                    className="select select-bordered select-sm"
                    value={inviteRole}
                    disabled={saving}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="md:col-span-3 flex items-end">
                  <button
                    className="btn btn-primary btn-sm w-full"
                    disabled={saving || !inviteEmail.trim()}
                    onClick={inviteMember}
                    type="button"
                  >
                    Invite user
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm opacity-70">Admin role is required to invite and manage users.</div>
            )}
          </Section>

          {actor.platform_role === "superadmin" ? (
            <Section
              title="Platform invite"
              description="Invite a user without assigning them to the current workspace (workspace created on first login)."
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <label className="form-control md:col-span-6">
                  <span className="label-text text-sm">Email</span>
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
                  <span className="label-text text-sm">Platform role</span>
                  <select
                    className="select select-bordered select-sm"
                    value={platformInviteRole}
                    disabled={saving}
                    onChange={(e) => setPlatformInviteRole(e.target.value)}
                  >
                    {PLATFORM_ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="md:col-span-3 flex items-end">
                  <button
                    className="btn btn-primary btn-sm w-full"
                    disabled={saving || !platformInviteEmail.trim()}
                    onClick={invitePlatformUser}
                    type="button"
                  >
                    Invite platform user
                  </button>
                </div>
              </div>
            </Section>
          ) : null}

          <Section title="Workspace users" description="Everyone who can access this workspace.">
            {loading ? (
              <div className="text-sm opacity-60">Loading users…</div>
            ) : members.length === 0 ? (
              <div className="text-sm opacity-60">No users in this workspace yet.</div>
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
                  <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Email</th>
                      <th className="w-44">Role</th>
                      <th className="w-44">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                  {pagedMembers.map((member) => (
                    <tr key={member.user_id}>
                      <td className="whitespace-nowrap">{member.name || member.user_id}</td>
                      <td className="whitespace-nowrap">{member.email || "—"}</td>
                      <td>
                        {canManage ? (
                          <select
                            className="select select-bordered select-sm w-full max-w-[11rem]"
                            value={member.role || "member"}
                            disabled={saving || ((member.role || "") === "admin" && adminCount <= 1)}
                            title={((member.role || "") === "admin" && adminCount <= 1)
                              ? "At least one admin is required in every workspace."
                              : ""}
                            onChange={(e) => updateRole(member.user_id, e.target.value)}
                          >
                            {ROLE_OPTIONS.map((role) => (
                              <option key={role.value} value={role.value}>
                                {role.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span>{roleLabel(member.role)}</span>
                          )}
                        </td>
                        <td>
                          {canManage ? (
                            <div className="flex items-center gap-2">
                              <button
                                className="btn btn-ghost btn-xs"
                                disabled={saving}
                                onClick={() => openEmailModal(member)}
                                type="button"
                              >
                                Change email
                              </button>
                              <button
                                className="btn btn-ghost btn-xs text-error"
                                disabled={saving || ((member.role || "") === "admin" && adminCount <= 1)}
                                title={((member.role || "") === "admin" && adminCount <= 1)
                                  ? "At least one admin is required in every workspace."
                                  : ""}
                                onClick={() => openRemoveModal(member)}
                                type="button"
                              >
                                Remove
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
          </Section>
        </div>
      </div>

      {pendingRemove ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Remove user</h3>
            <p className="text-sm opacity-70 mt-2">
              Remove <span className="font-medium">{pendingRemove.email || pendingRemove.name || pendingRemove.user_id}</span> from this workspace.
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
                Also delete this user from Supabase Auth (global account delete)
              </span>
            </label>
            {!canDeleteAuth ? (
              <p className="text-xs opacity-70 mt-1">Superadmin required for global auth deletion.</p>
            ) : null}
            <div className="modal-action">
              <button className="btn btn-sm" onClick={closeRemoveModal} disabled={saving} type="button">Cancel</button>
              <button className="btn btn-error btn-sm" onClick={() => removeMember(pendingRemove)} disabled={saving} type="button">
                {saving ? "Removing..." : "Remove user"}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={closeRemoveModal} />
        </div>
      ) : null}

      {pendingEmailEdit ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Change user email</h3>
            <p className="text-sm opacity-70 mt-2">Update login email for this user.</p>
            <label className="form-control mt-3">
              <span className="label-text">New email</span>
              <input
                className="input input-bordered input-sm"
                type="email"
                value={nextEmail}
                disabled={saving}
                onChange={(e) => setNextEmail(e.target.value)}
              />
            </label>
            <div className="modal-action">
              <button className="btn btn-sm" onClick={closeEmailModal} disabled={saving} type="button">Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => updateMemberEmail(pendingEmailEdit)}
                disabled={saving || !nextEmail.trim()}
                type="button"
              >
                {saving ? "Updating..." : "Update email"}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={closeEmailModal} />
        </div>
      ) : null}
    </TabbedPaneShell>
  );
}
