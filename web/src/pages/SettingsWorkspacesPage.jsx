import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_URL, apiFetch, getActiveWorkspaceId, getUiPrefs, setActiveWorkspaceId, setUiPrefs } from "../api";
import { useToast } from "../components/Toast.jsx";
import PaginationControls from "../components/PaginationControls.jsx";
import { applyBrandColors, DEFAULT_BRAND_COLORS, setBrandColors } from "../theme/theme.js";
import { supabase } from "../supabase.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";

const TAB_IDS = ["workspaces", "branding"];

function normalizeTabId(value) {
  const raw = String(value || "").trim().toLowerCase();
  return TAB_IDS.includes(raw) ? raw : "workspaces";
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

export default function SettingsWorkspacesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = normalizeTabId(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState(initialTab);

  const [context, setContext] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesPage, setWorkspacesPage] = useState(0);
  const [workspacePrefs, setWorkspacePrefs] = useState({ logo_url: "", colors: { ...DEFAULT_BRAND_COLORS } });
  const [workspaceName, setWorkspaceName] = useState("");
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeWorkspaceId, setActive] = useState(getActiveWorkspaceId());
  const [deleteBusyId, setDeleteBusyId] = useState("");
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
          primary: prefsRes?.workspace?.colors?.primary || DEFAULT_BRAND_COLORS.primary,
          secondary: prefsRes?.workspace?.colors?.secondary || DEFAULT_BRAND_COLORS.secondary,
          accent: prefsRes?.workspace?.colors?.accent || DEFAULT_BRAND_COLORS.accent,
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

  useEffect(() => {
    setActiveTab(normalizeTabId(searchParams.get("tab")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("tab")]);

  const actor = context?.actor || {};
  const displayWorkspaces = useMemo(() => {
    return (workspaces || []).map((w) => ({
      workspace_id: w.workspace_id || w.id,
      workspace_name: w.workspace_name || w.name || w.workspace_id || w.id,
      role: w.role || (actor.platform_role === "superadmin" ? "admin" : "member"),
      member_count: w.member_count,
      is_sandbox: Boolean(w.is_sandbox),
      sandbox_status: w.sandbox_status || "",
      sandbox_owner_user_id: w.sandbox_owner_user_id || "",
    }));
  }, [workspaces, actor.platform_role]);

  const workspacesPageSize = 25;
  const workspacesTotalPages = useMemo(
    () => Math.max(1, Math.ceil(displayWorkspaces.length / workspacesPageSize)),
    [displayWorkspaces.length],
  );

  useEffect(() => {
    setWorkspacesPage((prev) => Math.min(Math.max(0, prev), workspacesTotalPages - 1));
  }, [workspacesTotalPages]);

  const pagedWorkspaces = useMemo(() => {
    const start = workspacesPage * workspacesPageSize;
    return displayWorkspaces.slice(start, start + workspacesPageSize);
  }, [displayWorkspaces, workspacesPage]);
  const activeWorkspace = useMemo(
    () => displayWorkspaces.find((w) => w.workspace_id === activeWorkspaceId) || null,
    [displayWorkspaces, activeWorkspaceId],
  );

  useEffect(() => {
    if (activeWorkspace?.workspace_id) {
      setWorkspaceName(activeWorkspace.workspace_name || "");
    }
  }, [activeWorkspace?.workspace_id]);

  function switchWorkspace(workspaceId) {
    setActiveWorkspaceId(workspaceId);
    setActive(workspaceId);
    window.location.reload();
  }

  async function deleteWorkspace(workspaceId, workspaceName) {
    if (!workspaceId || deleteBusyId) return;
    if (!window.confirm(`Delete workspace "${workspaceName || workspaceId}"? This cannot be undone.`)) return;
    setDeleteBusyId(workspaceId);
    try {
      await apiFetch(`/access/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
      });
      setWorkspaces((prev) => prev.filter((item) => (item.workspace_id || item.id) !== workspaceId));
      pushToast("success", "Workspace deleted");
    } catch (err) {
      pushToast("error", err?.message || "Failed to delete workspace");
    } finally {
      setDeleteBusyId("");
    }
  }

  const canEditWorkspaceSettings = actor.platform_role === "superadmin" || actor.workspace_role === "admin";

  function goTab(nextId) {
    const next = normalizeTabId(nextId);
    setActiveTab(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", next);
    setSearchParams(nextParams, { replace: true });
  }

  async function persistWorkspacePrefs(next) {
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
      setWorkspacePrefs((prev) => ({ ...prev, logo_url: data.logo_url }));
      setLogoPreviewError(false);
      pushToast("success", "Logo uploaded");
    } catch (err) {
      pushToast("error", err?.message || "Logo upload failed");
    } finally {
      setLogoUploading(false);
    }
  }

  async function saveBranding() {
    if (!workspaceName.trim()) return;
    setBrandingSaving(true);
    try {
      const trimmedName = workspaceName.trim();
      const res = await apiFetch("/access/workspace", {
        method: "PATCH",
        body: { name: trimmedName },
      });
      await persistWorkspacePrefs(workspacePrefs);
      const nextWorkspaces = res?.workspaces || [];
      if (nextWorkspaces.length) {
        setWorkspaces(nextWorkspaces);
      } else {
        await load();
      }
      setWorkspaceName(trimmedName);
      pushToast("success", "Workspace name updated");
    } catch (err) {
      pushToast("error", err?.message || "Failed to update workspace name");
    } finally {
      setBrandingSaving(false);
    }
  }

  return (
    <TabbedPaneShell
      tabs={[
        { id: "workspaces", label: "Workspaces" },
        { id: "branding", label: "Branding" },
      ]}
      activeTabId={activeTab}
      onTabChange={goTab}
      contentContainer={true}
    >
      <div className="space-y-4">
        {error && <div className="alert alert-error text-sm">{error}</div>}

        {activeTab === "workspaces" && (
          <Section title="Workspaces" description="Switch your active workspace.">
            {loading ? (
              <div className="text-sm opacity-60">Loading workspaces…</div>
            ) : displayWorkspaces.length === 0 ? (
              <div className="text-sm opacity-60">No workspaces available.</div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-end">
                  <PaginationControls
                    page={workspacesPage}
                    pageSize={workspacesPageSize}
                    totalItems={displayWorkspaces.length}
                    onPageChange={setWorkspacesPage}
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Type</th>
                      <th>Members</th>
                      <th className="w-48">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedWorkspaces.map((workspace) => (
                      <tr key={workspace.workspace_id}>
                        <td className="whitespace-nowrap">{workspace.workspace_name}</td>
                        <td className="whitespace-nowrap">{workspace.role || "—"}</td>
                        <td className="whitespace-nowrap">
                          {workspace.is_sandbox ? (
                            <span className="badge badge-outline">Sandbox</span>
                          ) : (
                            <span className="badge badge-ghost">Workspace</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap">{workspace.member_count ?? "—"}</td>
                        <td className="whitespace-nowrap">
                          <button
                            className={`btn btn-xs ${activeWorkspaceId === workspace.workspace_id ? "btn-primary" : "btn-outline"}`}
                            onClick={() => switchWorkspace(workspace.workspace_id)}
                            type="button"
                          >
                            {activeWorkspaceId === workspace.workspace_id ? "Active" : "Switch"}
                          </button>
                          {actor.platform_role === "superadmin" ? (
                            <button
                              className="btn btn-xs btn-error ml-2"
                              type="button"
                              disabled={deleteBusyId === workspace.workspace_id || activeWorkspaceId === workspace.workspace_id}
                              onClick={() => deleteWorkspace(workspace.workspace_id, workspace.workspace_name)}
                            >
                              {deleteBusyId === workspace.workspace_id ? "Deleting..." : "Delete"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
              </div>
            )}
          </Section>
        )}

        {activeTab === "branding" && (
          <Section title="Branding" description="Applies to the active workspace only.">
            {!canEditWorkspaceSettings ? (
              <div className="alert alert-warning text-sm">Only workspace admins can edit these settings.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-4 md:col-start-1">
                    <label className="form-control">
                      <span className="label-text text-sm">Workspace name</span>
                      <input
                        type="text"
                        className="input input-bordered input-sm w-full"
                        value={workspaceName}
                        placeholder="Workspace name"
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        disabled={brandingSaving}
                      />
                    </label>

                    <label className="form-control">
                      <span className="label-text text-sm">Logo URL</span>
                      <input
                        type="url"
                        className="input input-bordered input-sm"
                        placeholder="https://cdn.example.com/logo.png"
                        value={workspacePrefs.logo_url || ""}
                        onChange={(e) => {
                          setLogoPreviewError(false);
                          setWorkspacePrefs((prev) => ({ ...prev, logo_url: e.target.value }));
                        }}
                        disabled={brandingSaving}
                      />
                    </label>

                    <div className="space-y-3">
                      <div>
                        <div className="text-sm opacity-70">Logo preview</div>
                        <div className="mt-2 w-40 h-16 rounded-box border border-base-300 bg-base-200 flex items-center justify-center overflow-hidden">
                          {workspacePrefs.logo_url && !logoPreviewError ? (
                            <img
                              src={workspacePrefs.logo_url}
                              alt="Workspace logo"
                              className="max-w-full max-h-full object-contain"
                              onError={() => setLogoPreviewError(true)}
                            />
                          ) : (
                            <div className="text-xs opacity-60 px-3 text-center">
                              {workspacePrefs.logo_url ? "Unable to load logo" : "No logo"}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => logoFileRef.current?.click()}
                          disabled={logoUploading || brandingSaving}
                        >
                          {logoUploading ? "Uploading..." : "Upload logo"}
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
                            onClick={() => {
                              setLogoPreviewError(false);
                              setWorkspacePrefs((prev) => ({ ...prev, logo_url: "" }));
                            }}
                            disabled={brandingSaving}
                          >
                            Clear logo
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <label className="form-control">
                        <span className="label-text text-sm">Primary</span>
                        <input
                          type="color"
                          className="input input-bordered h-10"
                          value={workspacePrefs.colors?.primary || DEFAULT_BRAND_COLORS.primary}
                          onChange={(e) => {
                            const colors = { ...(workspacePrefs.colors || {}), primary: e.target.value };
                            setWorkspacePrefs((prev) => ({ ...prev, colors }));
                          }}
                          disabled={brandingSaving}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="hidden md:block" />
                </div>

                <div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={brandingSaving || logoUploading || !workspaceName.trim()}
                    onClick={saveBranding}
                  >
                    {brandingSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            )}
          </Section>
        )}
      </div>
    </TabbedPaneShell>
  );
}
