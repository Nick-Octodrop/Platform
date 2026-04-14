import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { clearCaches, getUiPrefs, setUiPrefs } from "../api";
import { useModuleStore } from "../state/moduleStore.jsx";
import { useToast } from "../components/Toast.jsx";
import { getInitialTheme, setTheme } from "../theme/theme.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { supabase } from "../supabase";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import AppSelect from "../components/AppSelect.jsx";

const TAB_IDS = ["appearance", "profile"];

function normalizeTabId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "account") return "profile";
  return TAB_IDS.includes(raw) ? raw : "appearance";
}

function normalizeTheme(value) {
  return String(value || "").trim().toLowerCase() === "dark" ? "dark" : "light";
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

export default function SettingsSettingsPage({ user, onSignOut }) {
  const { t, reload: reloadI18n, availableLocales, availableTimezones, userPrefs, workspacePrefs, workspaceKey } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = normalizeTabId(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState(initialTab);

  const [theme, setThemeState] = useState(() => normalizeTheme(getInitialTheme()));
  const { actions } = useModuleStore();
  const { pushToast } = useToast();

  const email = user?.email || "";
  const metadata = user?.user_metadata || {};
  const legacyName = metadata?.name || metadata?.full_name || "";
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [userLocale, setUserLocale] = useState("");
  const [userTimezone, setUserTimezone] = useState("");
  const [regionalSaving, setRegionalSaving] = useState(false);

  useEffect(() => {
    // Initialize profile fields from auth metadata.
    const first = String(metadata?.first_name || "").trim();
    const last = String(metadata?.last_name || "").trim();
    const phone = String(metadata?.phone || "").trim();
    if (first || last || phone) {
      setProfileFirstName(first);
      setProfileLastName(last);
      setProfilePhone(phone);
      return;
    }
    // Fallback: split a legacy name/full_name value.
    const raw = String(legacyName || "").trim();
    if (!raw) return;
    const parts = raw.split(/\s+/g);
    setProfileFirstName(parts[0] || "");
    setProfileLastName(parts.slice(1).join(" "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    setActiveTab(normalizeTabId(searchParams.get("tab")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("tab")]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await getUiPrefs();
        if (!mounted) return;
        const userPrefs = res?.user || {};
        const nextTheme = normalizeTheme(userPrefs?.theme || getInitialTheme());
        const prefFirst = String(userPrefs?.first_name || "").trim();
        const prefLast = String(userPrefs?.last_name || "").trim();
        const prefPhone = String(userPrefs?.phone || "").trim();
        if (nextTheme) {
          setThemeState(nextTheme);
          setTheme(nextTheme);
          // If the stored theme is not supported anymore, normalize it and persist.
          if (userPrefs?.theme && normalizeTheme(userPrefs.theme) !== userPrefs.theme) {
            setUiPrefs({ user: { theme: nextTheme } }).catch(() => {});
          }
        }
        if (prefFirst || prefLast || prefPhone) {
          setProfileFirstName(prefFirst);
          setProfileLastName(prefLast);
          setProfilePhone(prefPhone);
        }
        setUserLocale(String(res?.user?.locale || "").trim());
        setUserTimezone(String(res?.user?.timezone || "").trim());
      } catch {
        // fall back to local values
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workspaceKey]);

  useEffect(() => {
    const normalized = normalizeTheme(theme);
    if (normalized !== theme) {
      setThemeState(normalized);
      return;
    }
    setTheme(normalized);
    const timeout = setTimeout(() => {
      setUiPrefs({ user: { theme: normalized } }).catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [theme]);

  function goTab(nextId) {
    const next = normalizeTabId(nextId);
    setActiveTab(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", next);
    setSearchParams(nextParams, { replace: true });
  }

  async function handleSignOut() {
    await onSignOut?.();
  }

  async function handleClearCaches() {
    clearCaches();
    await actions.refresh({ force: true });
    pushToast("success", t("settings.preferences.caches_cleared"));
  }

  async function handleSaveProfile(event) {
    event?.preventDefault?.();
    if (profileSaving) return;
    setProfileSaving(true);
    try {
      const first = String(profileFirstName || "").trim();
      const last = String(profileLastName || "").trim();
      const phone = String(profilePhone || "").trim();
      const fullName = [first, last].filter(Boolean).join(" ").trim();

      const { error } = await supabase.auth.updateUser({
        data: {
          first_name: first,
          last_name: last,
          phone,
          // Keep backward-compatible fields around for older UI surfaces.
          name: fullName,
          full_name: fullName,
        },
      });
      if (error) throw error;
      await setUiPrefs({
        user: {
          first_name: first,
          last_name: last,
          phone,
        },
      });
      pushToast("success", t("settings.profile_updated"));
    } catch (err) {
      pushToast("error", err?.message || t("settings.profile_update_failed"));
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleSaveRegional(event) {
    event?.preventDefault?.();
    if (regionalSaving) return;
    setRegionalSaving(true);
    try {
      await setUiPrefs({
        user: {
          locale: userLocale || null,
          timezone: userTimezone || null,
        },
      });
      await reloadI18n();
      pushToast("success", t("settings.profile_language_saved"));
    } catch (err) {
      pushToast("error", err?.message || t("settings.profile_language_save_failed"));
    } finally {
      setRegionalSaving(false);
    }
  }

  const tabs = useMemo(
    () => [
      { id: "profile", label: t("settings.profile_tab") },
      { id: "appearance", label: t("settings.appearance_tab") },
    ],
    [t]
  );

  return (
    <TabbedPaneShell
      tabs={tabs}
      activeTabId={activeTab}
      onTabChange={goTab}
      contentContainer={true}
    >
      {activeTab === "appearance" && (
        <div className="space-y-4">
          <Section title={t("settings.theme_title")} description={t("settings.theme_description")}>
            <label className="label cursor-pointer gap-3 justify-start">
              <span className="label-text text-sm">
                {theme === "dark" ? t("settings.theme_dark") : t("settings.theme_light")}
              </span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={theme === "dark"}
                onChange={(e) => setThemeState(e.target.checked ? "dark" : "light")}
              />
            </label>
          </Section>

          <Section title={t("settings.language_title")} description={t("settings.language_description")}>
            <form className="space-y-4" onSubmit={handleSaveRegional}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm opacity-70">{t("settings.language_label")}</div>
                  <AppSelect
                    className="select select-bordered select-sm w-full mt-1"
                    value={userLocale}
                    onChange={(event) => setUserLocale(event.target.value)}
                    disabled={regionalSaving}
                    aria-label={t("settings.language_label")}
                  >
                    <option value="">{t("settings.use_workspace_language")}</option>
                    {availableLocales.map((locale) => (
                      <option key={locale.code} value={locale.code}>
                        {locale.label}
                      </option>
                    ))}
                  </AppSelect>
                </div>
                <div>
                  <div className="text-sm opacity-70">{t("settings.timezone_label")}</div>
                  <AppSelect
                    className="select select-bordered select-sm w-full mt-1"
                    value={userTimezone}
                    onChange={(event) => setUserTimezone(event.target.value)}
                    disabled={regionalSaving}
                    aria-label={t("settings.timezone_label")}
                  >
                    <option value="">{t("settings.use_workspace_timezone")}</option>
                    {availableTimezones.map((timezone) => (
                      <option key={timezone} value={timezone}>
                        {timezone}
                      </option>
                    ))}
                  </AppSelect>
                </div>
              </div>
              <div className="text-sm opacity-70">
                {t("settings.personal_override_hint", {
                  locale: workspacePrefs?.default_locale || "en-NZ",
                  timezone: workspacePrefs?.default_timezone || "UTC",
                })}
              </div>
              <div className="text-sm opacity-70">
                {t("settings.current_workspace_defaults", {
                  locale: workspacePrefs?.default_locale || "en-NZ",
                  timezone: workspacePrefs?.default_timezone || "UTC",
                })}
              </div>
              <div className="text-sm opacity-70">
                {t("settings.current_user_overrides", {
                  locale: userPrefs?.locale || t("settings.none"),
                  timezone: userPrefs?.timezone || t("settings.none"),
                })}
              </div>
              <div>
                <button className="btn btn-primary btn-sm" type="submit" disabled={regionalSaving}>
                  {regionalSaving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </Section>
        </div>
      )}

      {activeTab === "profile" && (
        <div className="space-y-4">
          <Section title={t("settings.profile_title")} description={t("settings.profile_description")}>
            <form className="space-y-4" onSubmit={handleSaveProfile}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm opacity-70">{t("settings.first_name")}</div>
                  <input
                    className="input input-bordered input-sm w-full mt-1"
                    value={profileFirstName}
                    onChange={(e) => setProfileFirstName(e.target.value)}
                    placeholder={t("settings.first_name")}
                    disabled={profileSaving}
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <div className="text-sm opacity-70">{t("settings.last_name")}</div>
                  <input
                    className="input input-bordered input-sm w-full mt-1"
                    value={profileLastName}
                    onChange={(e) => setProfileLastName(e.target.value)}
                    placeholder={t("settings.last_name")}
                    disabled={profileSaving}
                    autoComplete="family-name"
                  />
                </div>
                <div>
                  <div className="text-sm opacity-70">{t("settings.phone")}</div>
                  <input
                    className="input input-bordered input-sm w-full mt-1"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    placeholder={t("settings.phone")}
                    disabled={profileSaving}
                    autoComplete="tel"
                  />
                </div>
                <div>
                  <div className="text-sm opacity-70">{t("settings.email")}</div>
                  <input
                    className="input input-bordered input-sm w-full mt-1"
                    value={email || ""}
                    disabled
                    readOnly
                    placeholder={t("settings.email")}
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" type="submit" disabled={profileSaving}>
                  {profileSaving ? t("common.saving") : t("settings.save_changes")}
                </button>
              </div>
            </form>
          </Section>

          <Section title={t("settings.account_title")} description={t("settings.account_description")}>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-outline btn-sm" onClick={handleSignOut} type="button">
                {t("settings.sign_out")}
              </button>
              <Link className="btn btn-outline btn-sm" to="/settings/password">
                {t("settings.change_password")}
              </Link>
              <button className="btn btn-sm" onClick={handleClearCaches} type="button">
                {t("settings.clear_local_caches")}
              </button>
            </div>
          </Section>
        </div>
      )}
    </TabbedPaneShell>
  );
}
