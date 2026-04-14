// Settings preferences (appearance, developer mode, account, profile).
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { clearCaches, getUiPrefs, setUiPrefs } from "../api";
import { useModuleStore } from "../state/moduleStore.jsx";
import { useToast } from "../components/Toast.jsx";
import { getInitialTheme, setTheme } from "../theme/theme.js";
import { getDevMode, setDevMode } from "../dev/devMode.js";
import { useI18n } from "../i18n/LocalizationProvider.jsx";

export default function SettingsPreferencesPage({ user, onSignOut }) {
  const { t, workspaceKey } = useI18n();
  const [theme, setThemeState] = useState(getInitialTheme());
  const [devMode, setDevModeState] = useState(getDevMode());
  const { actions } = useModuleStore();
  const { pushToast } = useToast();
  const email = user?.email || "";
  const name = user?.user_metadata?.name || user?.user_metadata?.full_name || "";

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await getUiPrefs();
        if (!mounted) return;
        const userPrefs = res?.user || {};
        const nextTheme = userPrefs?.theme || getInitialTheme();
        if (nextTheme) {
          setThemeState(nextTheme);
          setTheme(nextTheme);
        }
      } catch {
        // fall back to local values
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workspaceKey]);

  useEffect(() => {
    setTheme(theme);
    const timeout = setTimeout(() => {
      setUiPrefs({ user: { theme } }).catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [theme]);

  useEffect(() => {
    setDevMode(devMode);
  }, [devMode]);

  async function handleSignOut() {
    await onSignOut?.();
  }

  async function handleClearCaches() {
    clearCaches();
    await actions.refresh({ force: true });
    pushToast("success", t("settings.preferences.caches_cleared"));
  }

  const themes = [
    "light",
    "dark",
    "cupcake",
    "bumblebee",
    "emerald",
    "corporate",
    "synthwave",
    "retro",
    "cyberpunk",
    "valentine",
    "halloween",
    "garden",
    "forest",
    "aqua",
    "lofi",
    "pastel",
    "fantasy",
    "wireframe",
    "black",
    "luxury",
    "dracula",
    "cmyk",
    "autumn",
    "business",
    "acid",
    "lemonade",
    "night",
    "coffee",
    "winter",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("settings.preferences.title", {}, { defaultValue: "Preferences" })}</h1>
        <div className="text-sm opacity-70">{t("settings.preferences.description", {}, { defaultValue: "Theme, developer tools, and account details." })}</div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">{t("settings.preferences.appearance_title", {}, { defaultValue: "Appearance" })}</h2>
          <div className="form-control max-w-xs">
            <label className="label">
              <span className="label-text">{t("settings.preferences.theme_label", {}, { defaultValue: "Theme" })}</span>
            </label>
            <div className="dropdown dropdown-bottom w-full">
              <label tabIndex={0} className="input input-bordered w-full flex items-center justify-between cursor-pointer">
                <span className="truncate">{theme}</span>
                <span className="opacity-60 pointer-events-none">▾</span>
              </label>
              <ul tabIndex={0} className="dropdown-content menu menu-compact menu-vertical p-2 shadow bg-base-100 rounded-box w-full max-h-60 overflow-auto z-30">
                {themes.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      className={`justify-start ${item === theme ? "active" : ""}`}
                      onClick={(event) => {
                        setThemeState(item);
                        const dropdown = event.currentTarget.closest(".dropdown");
                        const trigger = dropdown?.querySelector('[tabindex="0"]');
                        trigger?.blur();
                        if (document.activeElement instanceof HTMLElement) {
                          document.activeElement.blur();
                        }
                      }}
                    >
                      <span className="truncate">{item}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="text-sm opacity-70 mt-2">{t("settings.preferences.theme_help", {}, { defaultValue: "Includes DaisyUI themes (for example, business)." })}</div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">{t("settings.preferences.developer_mode_title", {}, { defaultValue: "Developer Mode" })}</h2>
          <label className="label cursor-pointer gap-3">
            <span className="label-text">{t("settings.preferences.enable_developer_mode", {}, { defaultValue: "Enable developer mode" })}</span>
            <input
              type="checkbox"
              className="toggle"
              checked={devMode}
              onChange={(e) => setDevModeState(e.target.checked)}
            />
          </label>
          <div className="text-sm opacity-70 mt-2">{t("settings.preferences.developer_mode_help", {}, { defaultValue: "Shows entity, module, and view IDs, hashes, and debug links." })}</div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">{t("settings.account_title")}</h2>
          <div className="text-sm opacity-70">{t("settings.email")}</div>
          <div className="font-medium">{email || t("settings.preferences.unknown", {}, { defaultValue: "Unknown" })}</div>
          <div className="mt-4 flex gap-2">
            <button className="btn btn-outline btn-sm" onClick={handleSignOut}>{t("settings.sign_out")}</button>
            <button className="btn btn-sm" onClick={handleClearCaches}>{t("settings.clear_local_caches")}</button>
            <Link className="btn btn-outline btn-sm" to="/settings/password">{t("settings.change_password")}</Link>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">{t("settings.profile_title")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm opacity-70">{t("common.name")}</div>
              <div className="font-medium">{name || "—"}</div>
            </div>
            <div>
              <div className="text-sm opacity-70">{t("settings.email")}</div>
              <div className="font-medium">{email || "—"}</div>
            </div>
          </div>
          <div className="text-sm opacity-70 mt-2">{t("settings.preferences.edit_profile_soon", {}, { defaultValue: "Edit profile (soon)" })}</div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">{t("settings.preferences.system_title", {}, { defaultValue: "System" })}</h2>
          <div className="text-sm opacity-70">{t("settings.preferences.api_base_url", {}, { defaultValue: "API Base URL" })}</div>
          <div className="font-medium">{import.meta.env.VITE_API_URL || "http://localhost:8000"}</div>
          <div className="text-sm opacity-70 mt-2">{t("settings.preferences.app_version", { version: "v0" }, { defaultValue: "App version: {{version}}" })}</div>
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              <Link className="btn btn-outline btn-sm" to="/settings/diagnostics">{t("settings.diagnostics.title")}</Link>
              <Link className="btn btn-outline btn-sm" to="/audit">{t("navigation.audit")}</Link>
              <Link className="btn btn-outline btn-sm" to="/settings/email-templates">{t("settings.email_templates.title")}</Link>
              <Link className="btn btn-outline btn-sm" to="/settings/email-outbox">{t("settings.email_outbox.title")}</Link>
              <Link className="btn btn-outline btn-sm" to="/settings/documents/templates">{t("settings.documents")}</Link>
              <Link className="btn btn-outline btn-sm" to="/ops">{t("navigation.ops")}</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
