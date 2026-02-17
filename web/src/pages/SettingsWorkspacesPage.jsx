import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_URL, apiFetch, getActiveWorkspaceId, getUiPrefs, setActiveWorkspaceId, setUiPrefs } from "../api";
import { useToast } from "../components/Toast.jsx";
import { applyBrandColors, setBrandColors } from "../theme/theme.js";
import { supabase } from "../supabase.js";

export default function SettingsWorkspacesPage() {
  const [context, setContext] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacePrefs, setWorkspacePrefs] = useState({ logo_url: "", colors: { primary: "", secondary: "", accent: "" } });
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceNameSaving, setWorkspaceNameSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeWorkspaceId, setActive] = useState(getActiveWorkspaceId());
  const logoFileRef = useRef(null);
  const { pushToast } = useToast();

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [res, prefsRes] = await Promise.all([apiFetch("/access/context"), getUiPrefs()]);
      setContext(res || null);
      setWorkspaces(res?.workspaces || []);
      setWorkspacePrefs({
        logo_url: prefsRes?.workspace?.logo_url || "",
        colors: {
          primary: prefsRes?.workspace?.colors?.primary || "",
          secondary: prefsRes?.workspace?.colors?.secondary || "",
          accent: prefsRes?.workspace?.colors?.accent || "",
        },
      });
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
  const activeWorkspace = useMemo(
    () => displayWorkspaces.find((w) => w.workspace_id === activeWorkspaceId) || null,
    [displayWorkspaces, activeWorkspaceId],
  );

  useEffect(() => {
    setWorkspaceName(activeWorkspace?.workspace_name || "");
  }, [activeWorkspace?.workspace_id, activeWorkspace?.workspace_name]);

  function switchWorkspace(workspaceId) {
    setActiveWorkspaceId(workspaceId);
    setActive(workspaceId);
    window.location.reload();
  }

  const canEditWorkspaceSettings = actor.platform_role === "superadmin" || actor.workspace_role === "admin";

  async function saveWorkspacePrefs(next) {
    setWorkspacePrefs(next);
    try {
      await setUiPrefs({ workspace: next });
      if (next.colors) {
        setBrandColors(next.colors);
        applyBrandColors(next.colors);
      }
    } catch {
      pushToast("error", "Failed to save workspace settings");
    }
  }

  async function handleLogoFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLogoUploading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/prefs/ui/logo/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data?.logo_url) {
        throw new Error(data?.errors?.[0]?.message || "Logo upload failed");
      }
      const next = { ...workspacePrefs, logo_url: data.logo_url };
      await saveWorkspacePrefs(next);
      pushToast("success", "Logo uploaded");
    } catch (err) {
      pushToast("error", err?.message || "Logo upload failed");
    } finally {
      setLogoUploading(false);
    }
  }

  async function saveWorkspaceName() {
    if (!workspaceName.trim()) return;
    setWorkspaceNameSaving(true);
    try {
      const res = await apiFetch("/access/workspace", {
        method: "PATCH",
        body: { name: workspaceName.trim() },
      });
      const nextWorkspaces = res?.workspaces || [];
      if (nextWorkspaces.length) {
        setWorkspaces(nextWorkspaces);
      } else {
        await load();
      }
      pushToast("success", "Workspace name updated");
    } catch (err) {
      pushToast("error", err?.message || "Failed to update workspace name");
    } finally {
      setWorkspaceNameSaving(false);
    }
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

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body">
          <h2 className="card-title">Workspace Settings</h2>
          <p className="text-sm opacity-70">Branding and color settings apply to the active workspace only.</p>
          {!canEditWorkspaceSettings ? (
            <div className="alert alert-warning mt-2">Only workspace admins can edit these settings.</div>
          ) : (
            <div className="space-y-4 mt-2">
              <label className="form-control max-w-3xl">
                <span className="label-text">Workspace name</span>
                <div className="join">
                  <input
                    type="text"
                    className="input input-bordered join-item w-full"
                    value={workspaceName}
                    placeholder="Workspace name"
                    onChange={(e) => setWorkspaceName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary join-item"
                    disabled={workspaceNameSaving || !workspaceName.trim()}
                    onClick={saveWorkspaceName}
                  >
                    {workspaceNameSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </label>
              <label className="form-control max-w-3xl">
                <span className="label-text">Logo URL</span>
                <input
                  type="url"
                  className="input input-bordered"
                  placeholder="https://cdn.example.com/logo.png"
                  value={workspacePrefs.logo_url || ""}
                  onChange={(e) => saveWorkspacePrefs({ ...workspacePrefs, logo_url: e.target.value })}
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => logoFileRef.current?.click()}
                  disabled={logoUploading}
                >
                  {logoUploading ? "Uploading..." : "Upload Logo"}
                </button>
                <input
                  ref={logoFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoFileChange}
                />
                {workspacePrefs.logo_url ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => saveWorkspacePrefs({ ...workspacePrefs, logo_url: "" })}
                  >
                    Clear Logo
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl">
                <label className="form-control">
                  <span className="label-text">Primary</span>
                  <input
                    type="color"
                    className="input input-bordered h-10"
                    value={workspacePrefs.colors?.primary || "#4f46e5"}
                    onChange={(e) => {
                      const colors = { ...workspacePrefs.colors, primary: e.target.value };
                      saveWorkspacePrefs({ ...workspacePrefs, colors });
                    }}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Secondary</span>
                  <input
                    type="color"
                    className="input input-bordered h-10"
                    value={workspacePrefs.colors?.secondary || "#0ea5e9"}
                    onChange={(e) => {
                      const colors = { ...workspacePrefs.colors, secondary: e.target.value };
                      saveWorkspacePrefs({ ...workspacePrefs, colors });
                    }}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Accent</span>
                  <input
                    type="color"
                    className="input input-bordered h-10"
                    value={workspacePrefs.colors?.accent || "#22c55e"}
                    onChange={(e) => {
                      const colors = { ...workspacePrefs.colors, accent: e.target.value };
                      saveWorkspacePrefs({ ...workspacePrefs, colors });
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
