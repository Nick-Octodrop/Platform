import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_URL, apiFetch, getActiveWorkspaceId, getUiPrefs, setActiveWorkspaceId, setUiPrefs } from "../api";
import { useAccessContext } from "../access.js";
import { useToast } from "../components/Toast.jsx";
import PaginationControls from "../components/PaginationControls.jsx";
import { applyBrandColors, DEFAULT_BRAND_COLORS, setBrandColors } from "../theme/theme.js";
import { supabase } from "../supabase.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import AppSelect from "../components/AppSelect.jsx";

const TAB_IDS = ["workspaces", "branding", "regional"];

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
  const { t, reload: reloadI18n, availableLocales, availableTimezones, availableCurrencies, workspaceKey } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = normalizeTabId(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState(initialTab);

  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesPage, setWorkspacesPage] = useState(0);
  const [workspacePrefs, setWorkspacePrefs] = useState({ logo_url: "", colors: { ...DEFAULT_BRAND_COLORS } });
  const [workspaceName, setWorkspaceName] = useState("");
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [regionalSaving, setRegionalSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeWorkspaceId, setActive] = useState(getActiveWorkspaceId());
  const [deleteBusyId, setDeleteBusyId] = useState("");
  const [defaultLocale, setDefaultLocale] = useState("en-NZ");
  const [defaultTimezone, setDefaultTimezone] = useState("UTC");
  const [defaultCurrency, setDefaultCurrency] = useState("NZD");
  const logoFileRef = useRef(null);
  const { pushToast } = useToast();
  const { context, loading: accessLoading } = useAccessContext();

  async function load() {
    setLoading(true);
    setError("");
    try {
      const prefsRes = await getUiPrefs();
      setWorkspaces(context?.workspaces || []);
      setWorkspacePrefs({
        logo_url: prefsRes?.workspace?.logo_url || "",
        colors: {
          primary: prefsRes?.workspace?.colors?.primary || DEFAULT_BRAND_COLORS.primary,
          secondary: prefsRes?.workspace?.colors?.secondary || DEFAULT_BRAND_COLORS.secondary,
          accent: prefsRes?.workspace?.colors?.accent || DEFAULT_BRAND_COLORS.accent,
        },
      });
      setDefaultLocale(String(prefsRes?.workspace?.default_locale || "en-NZ"));
      setDefaultTimezone(String(prefsRes?.workspace?.default_timezone || "UTC"));
      setDefaultCurrency(String(prefsRes?.workspace?.default_currency || "NZD"));
      if (!activeWorkspaceId && context?.actor?.workspace_id) {
        setActive(context.actor.workspace_id);
      }
    } catch (err) {
      setError(err?.message || "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (accessLoading || !context) return;
    load();
  }, [accessLoading, context, workspaceKey]);

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
    if (!window.confirm(t("common.delete_workspace_body", { name: workspaceName || workspaceId }))) return;
    setDeleteBusyId(workspaceId);
    try {
      await apiFetch(`/access/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
      });
      setWorkspaces((prev) => prev.filter((item) => (item.workspace_id || item.id) !== workspaceId));
      pushToast("success", t("common.deleted_workspace"));
    } catch (err) {
      pushToast("error", err?.message || t("common.delete_failed"));
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
      await reloadI18n();
    } catch (err) {
      pushToast("error", t("settings.workspace_save_failed"));
      throw err;
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
        throw new Error(data?.errors?.[0]?.message || t("settings.logo_upload_failed"));
      }
      setWorkspacePrefs((prev) => ({ ...prev, logo_url: data.logo_url }));
      setLogoPreviewError(false);
      pushToast("success", t("settings.logo_uploaded"));
    } catch (err) {
      pushToast("error", err?.message || t("settings.logo_upload_failed"));
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
      pushToast("success", t("settings.workspace_name_updated"));
    } catch (err) {
      pushToast("error", err?.message || t("settings.workspace_name_update_failed"));
    } finally {
      setBrandingSaving(false);
    }
  }

  async function saveRegionalDefaults() {
    if (!canEditWorkspaceSettings) return;
    setRegionalSaving(true);
    try {
      await persistWorkspacePrefs({
        default_locale: defaultLocale,
        default_timezone: defaultTimezone,
        default_currency: defaultCurrency,
      });
      pushToast("success", t("settings.workspace_regional_saved"));
    } catch {
      // toast already emitted in persistWorkspacePrefs
    } finally {
      setRegionalSaving(false);
    }
  }

  return (
    <TabbedPaneShell
      tabs={[
        { id: "workspaces", label: t("settings.workspaces_tab") },
        { id: "branding", label: t("settings.branding_tab") },
        { id: "regional", label: t("settings.regional_tab") },
      ]}
      activeTabId={activeTab}
      onTabChange={goTab}
      contentContainer={true}
    >
      <div className="space-y-4">
        {error && <div className="alert alert-error text-sm">{error}</div>}

        {activeTab === "workspaces" && (
          <Section title={t("settings.workspaces_title")} description={t("settings.workspaces_description")}>
            {loading ? (
              <div className="text-sm opacity-60">{t("common.loading")}</div>
            ) : displayWorkspaces.length === 0 ? (
              <div className="text-sm opacity-60">{t("empty.no_workspaces")}</div>
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
                      <th>{t("settings.workspace_name")}</th>
                      <th>{t("settings.role")}</th>
                      <th>{t("settings.type")}</th>
                      <th>{t("settings.members")}</th>
                      <th className="w-48">{t("settings.actions")}</th>
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
                            <span className="badge badge-ghost">{t("settings.workspace_badge")}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap">{workspace.member_count ?? "—"}</td>
                        <td className="whitespace-nowrap">
                          <button
                            className={`btn btn-xs ${activeWorkspaceId === workspace.workspace_id ? "btn-primary" : "btn-outline"}`}
                            onClick={() => switchWorkspace(workspace.workspace_id)}
                            type="button"
                          >
                            {activeWorkspaceId === workspace.workspace_id ? t("common.active") : t("common.switch")}
                          </button>
                          {actor.platform_role === "superadmin" ? (
                            <button
                              className="btn btn-xs btn-error ml-2"
                              type="button"
                              disabled={deleteBusyId === workspace.workspace_id || activeWorkspaceId === workspace.workspace_id}
                              onClick={() => deleteWorkspace(workspace.workspace_id, workspace.workspace_name)}
                            >
                              {deleteBusyId === workspace.workspace_id ? t("common.deleting") : t("common.delete")}
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
          <Section title={t("settings.branding_title")} description={t("settings.branding_description")}>
            {!canEditWorkspaceSettings ? (
              <div className="alert alert-warning text-sm">{t("settings.workspace_admin_only")}</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-4 md:col-start-1">
                    <label className="form-control">
                      <span className="label-text text-sm">{t("settings.workspace_name")}</span>
                      <input
                        type="text"
                        className="input input-bordered input-sm w-full"
                        value={workspaceName}
                        placeholder={t("settings.workspace_name")}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        disabled={brandingSaving}
                      />
                    </label>

                    <label className="form-control">
                      <span className="label-text text-sm">{t("settings.logo_url")}</span>
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
                        <div className="text-sm opacity-70">{t("settings.logo_preview")}</div>
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
                              {workspacePrefs.logo_url ? t("settings.logo_unavailable") : t("settings.no_logo")}
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
                          {logoUploading ? t("common.uploading") : t("settings.upload_logo")}
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
                            {t("settings.clear_logo")}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <label className="form-control">
                        <span className="label-text text-sm">{t("settings.primary_colour")}</span>
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
                    {brandingSaving ? t("common.saving") : t("common.save")}
                  </button>
                </div>
              </div>
            )}
          </Section>
        )}

        {activeTab === "regional" && (
          <Section title={t("settings.regional_title")} description={t("settings.regional_description")}>
            {!canEditWorkspaceSettings ? (
              <div className="alert alert-warning text-sm">{t("settings.workspace_admin_only")}</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="form-control">
                    <span className="label-text text-sm">{t("settings.default_language_label")}</span>
                    <AppSelect
                      className="select select-bordered select-sm"
                      value={defaultLocale}
                      onChange={(e) => setDefaultLocale(e.target.value)}
                      aria-label={t("settings.default_language_label")}
                      disabled={regionalSaving}
                    >
                      {availableLocales.map((locale) => (
                        <option key={locale.code} value={locale.code}>{locale.label}</option>
                      ))}
                    </AppSelect>
                  </label>
                  <label className="form-control">
                    <span className="label-text text-sm">{t("settings.default_timezone_label")}</span>
                    <AppSelect
                      className="select select-bordered select-sm"
                      value={defaultTimezone}
                      onChange={(e) => setDefaultTimezone(e.target.value)}
                      aria-label={t("settings.default_timezone_label")}
                      disabled={regionalSaving}
                    >
                      {availableTimezones.map((timezone) => (
                        <option key={timezone} value={timezone}>{timezone}</option>
                      ))}
                    </AppSelect>
                  </label>
                  <label className="form-control">
                    <span className="label-text text-sm">{t("settings.default_currency_label")}</span>
                    <AppSelect
                      className="select select-bordered select-sm"
                      value={defaultCurrency}
                      onChange={(e) => setDefaultCurrency(e.target.value)}
                      aria-label={t("settings.default_currency_label")}
                      disabled={regionalSaving}
                    >
                      {availableCurrencies.map((currency) => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </AppSelect>
                  </label>
                </div>
                <div className="text-sm opacity-70">{t("settings.currency_not_from_locale")}</div>
                <div>
                  <button type="button" className="btn btn-primary btn-sm" disabled={regionalSaving} onClick={saveRegionalDefaults}>
                    {regionalSaving ? t("common.saving") : t("common.save")}
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
