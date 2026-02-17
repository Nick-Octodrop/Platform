import React, { useEffect, useMemo, useState } from "react";
import { apiFetch, getActiveWorkspaceId, setActiveWorkspaceId } from "../api";

export default function SettingsWorkspacesPage() {
  const [context, setContext] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeWorkspaceId, setActive] = useState(getActiveWorkspaceId());

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/access/context");
      setContext(res || null);
      setWorkspaces(res?.workspaces || []);
      if (!activeWorkspaceId && res?.actor?.workspace_id) {
        setActive(res.actor.workspace_id);
      }
    } catch (err) {
      setError(err?.message || "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const actor = context?.actor || {};
  const displayWorkspaces = useMemo(() => {
    return (workspaces || []).map((w) => ({
      workspace_id: w.workspace_id || w.id,
      workspace_name: w.workspace_name || w.name || w.workspace_id || w.id,
      role: w.role || (actor.platform_role === "superadmin" ? "admin" : "member"),
      member_count: w.member_count,
    }));
  }, [workspaces, actor.platform_role]);

  function switchWorkspace(workspaceId) {
    setActiveWorkspaceId(workspaceId);
    setActive(workspaceId);
    window.location.reload();
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <p className="text-sm opacity-70">
          {actor.platform_role === "superadmin"
            ? "Superadmin view: access and switch any workspace."
            : "Switch between your workspace memberships."}
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body">
          {loading ? (
            <div className="text-sm opacity-60">Loading workspaces…</div>
          ) : displayWorkspaces.length === 0 ? (
            <div className="text-sm opacity-60">No workspaces available.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Members</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayWorkspaces.map((workspace) => (
                    <tr key={workspace.workspace_id}>
                      <td>{workspace.workspace_name}</td>
                      <td>{workspace.role || "—"}</td>
                      <td>{workspace.member_count ?? "—"}</td>
                      <td>
                        <button
                          className={`btn btn-xs ${activeWorkspaceId === workspace.workspace_id ? "btn-primary" : "btn-outline"}`}
                          onClick={() => switchWorkspace(workspace.workspace_id)}
                        >
                          {activeWorkspaceId === workspace.workspace_id ? "Active" : "Switch"}
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
    </div>
  );
}
