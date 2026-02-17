import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "User" },
  { value: "readonly", label: "Read only" },
  { value: "portal", label: "Portal" },
];

export default function SettingsUsersPage() {
  const [context, setContext] = useState(null);
  const [members, setMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingRemove, setPendingRemove] = useState(null);
  const [deleteAuthUser, setDeleteAuthUser] = useState(false);

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

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Users & Roles</h1>
        <p className="text-sm opacity-70">Invite workspace users and manage access roles.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body space-y-3">
          <div className="text-sm">
            <span className="opacity-60">Current role:</span> <span className="font-medium">{roleLabel(actor.workspace_role)}</span>
            {actor.platform_role === "superadmin" && <span className="badge badge-outline ml-2">Superadmin</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <label className="form-control md:col-span-6">
              <span className="label-text">Invite by email</span>
              <input
                className="input input-bordered"
                placeholder="user@company.com"
                value={inviteEmail}
                disabled={!canManage || saving}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </label>
            <label className="form-control md:col-span-3">
              <span className="label-text">Role</span>
              <select className="select select-bordered" value={inviteRole} disabled={!canManage || saving} onChange={(e) => setInviteRole(e.target.value)}>
                {ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </label>
            <div className="md:col-span-3 flex items-end">
              <button className="btn btn-primary w-full" disabled={!canManage || saving} onClick={inviteMember}>
                Invite user
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body">
          {loading ? (
            <div className="text-sm opacity-60">Loading users…</div>
          ) : members.length === 0 ? (
            <div className="text-sm opacity-60">No users in this workspace yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.user_id}>
                      <td>{member.name || member.user_id}</td>
                      <td>{member.email || "—"}</td>
                      <td>
                        <select
                          className="select select-bordered select-sm w-40"
                          value={member.role || "member"}
                          disabled={!canManage || saving}
                          onChange={(e) => updateRole(member.user_id, e.target.value)}
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role.value} value={role.value}>{role.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-xs text-error" disabled={!canManage || saving} onClick={() => openRemoveModal(member)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
              <button className="btn" onClick={closeRemoveModal} disabled={saving}>Cancel</button>
              <button className="btn btn-error" onClick={() => removeMember(pendingRemove)} disabled={saving}>
                {saving ? "Removing..." : "Remove user"}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={closeRemoveModal} />
        </div>
      ) : null}
    </div>
  );
}
