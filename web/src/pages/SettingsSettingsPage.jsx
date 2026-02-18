import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { clearCaches, getUiPrefs, setUiPrefs } from "../api";
import { useModuleStore } from "../state/moduleStore.jsx";
import { useToast } from "../components/Toast.jsx";
import { getInitialTheme, setTheme } from "../theme/theme.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { supabase } from "../supabase";

const TAB_IDS = ["appearance", "profile"];

function normalizeTabId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "account") return "profile";
  return TAB_IDS.includes(raw) ? raw : "appearance";
}

function normalizeTheme(value) {
  return String(value || "").trim().toLowerCase() === "dark" ? "dark" : "light";
}

export default function SettingsSettingsPage({ user, onSignOut }) {
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
        if (nextTheme) {
          setThemeState(nextTheme);
          setTheme(nextTheme);
          // If the stored theme is not supported anymore, normalize it and persist.
          if (userPrefs?.theme && normalizeTheme(userPrefs.theme) !== userPrefs.theme) {
            setUiPrefs({ user: { theme: nextTheme } }).catch(() => {});
          }
        }
      } catch {
        // fall back to local values
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
    pushToast("success", "Caches cleared");
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
      pushToast("success", "Profile updated");
    } catch (err) {
      pushToast("error", err?.message || "Failed to update profile");
    } finally {
      setProfileSaving(false);
    }
  }

  const tabs = useMemo(
    () => [
      { id: "profile", label: "Profile" },
      { id: "appearance", label: "Appearance" },
    ],
    []
  );

  // Keep a stable page header while switching tabs so it reads as one page.
  const pageTitle = "Profile";
  const pageSubtitle = "Account details, password, and appearance.";

  function Section({ title, description, children }) {
    return (
      <div className="rounded-box border border-base-300 bg-base-100 p-4">
        <div className="text-sm font-semibold">{title}</div>
        {description ? <div className="text-sm opacity-70 mt-1">{description}</div> : null}
        <div className="mt-4">{children}</div>
      </div>
    );
  }

  return (
    <TabbedPaneShell
      title={pageTitle}
      subtitle={pageSubtitle}
      tabs={tabs}
      activeTabId={activeTab}
      onTabChange={goTab}
    >
      {activeTab === "appearance" && (
        <Section title="Theme" description="Light / dark mode.">
          <label className="label cursor-pointer gap-3 justify-start">
            <span className="label-text text-sm">
              {theme === "dark" ? "Dark" : "Light"}
            </span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={theme === "dark"}
              onChange={(e) => setThemeState(e.target.checked ? "dark" : "light")}
            />
          </label>
        </Section>
      )}

      {activeTab === "profile" && (
        <div className="space-y-4">
          <Section title="Profile" description="Basic account and contact details.">
            <form className="space-y-4" onSubmit={handleSaveProfile}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm opacity-70">First name</div>
                  <input
                    className="input input-bordered input-sm w-full mt-1"
                    value={profileFirstName}
                    onChange={(e) => setProfileFirstName(e.target.value)}
                    placeholder="First name"
                    disabled={profileSaving}
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <div className="text-sm opacity-70">Last name</div>
                  <input
                    className="input input-bordered input-sm w-full mt-1"
                    value={profileLastName}
                    onChange={(e) => setProfileLastName(e.target.value)}
                    placeholder="Last name"
                    disabled={profileSaving}
                    autoComplete="family-name"
                  />
                </div>
                <div>
                  <div className="text-sm opacity-70">Phone</div>
                  <input
                    className="input input-bordered input-sm w-full mt-1"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    placeholder="Phone"
                    disabled={profileSaving}
                    autoComplete="tel"
                  />
                </div>
                <div>
                  <div className="text-sm opacity-70">Email</div>
                  <input
                    className="input input-bordered input-sm w-full mt-1"
                    value={email || ""}
                    disabled
                    readOnly
                    placeholder="Email"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                <button className="btn btn-primary btn-sm" type="submit" disabled={profileSaving}>
                  {profileSaving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </Section>

          <Section title="Account" description="Session and local data controls.">
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-outline btn-sm" onClick={handleSignOut} type="button">
                Sign out
              </button>
              <Link className="btn btn-outline btn-sm" to="/settings/password">
                Change password
              </Link>
              <button className="btn btn-sm" onClick={handleClearCaches} type="button">
                Clear local caches
              </button>
            </div>
          </Section>
        </div>
      )}
    </TabbedPaneShell>
  );
}
