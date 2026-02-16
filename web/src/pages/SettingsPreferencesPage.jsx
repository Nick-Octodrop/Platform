// Settings preferences (appearance, developer mode, account, profile).
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API_URL, clearCaches, getUiPrefs, setUiPrefs } from "../api";
import { useModuleStore } from "../state/moduleStore.jsx";
import { useToast } from "../components/Toast.jsx";
import { applyBrandColors, getBrandColors, getInitialTheme, setBrandColors, setTheme } from "../theme/theme.js";
import { getDevMode, setDevMode } from "../dev/devMode.js";
import { supabase } from "../supabase.js";

export default function SettingsPreferencesPage({ user, onSignOut }) {
  const [theme, setThemeState] = useState(getInitialTheme());
  const [devMode, setDevModeState] = useState(getDevMode());
  const [brandColors, setBrandColorsState] = useState(getBrandColors());
  const [logoUrl, setLogoUrlState] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const logoFileRef = useRef(null);
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
        const workspace = res?.workspace || {};
        const userPrefs = res?.user || {};
        if (workspace?.colors) {
          setBrandColorsState(workspace.colors);
          setBrandColors(workspace.colors);
          applyBrandColors(workspace.colors);
        }
        setLogoUrlState(workspace?.logo_url || "");
        const nextTheme = userPrefs?.theme || workspace?.theme || getInitialTheme();
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
  }, []);

  useEffect(() => {
    setTheme(theme);
    const timeout = setTimeout(() => {
      setUiPrefs({ user: { theme } }).catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [theme]);

  useEffect(() => {
    applyBrandColors(brandColors);
    const timeout = setTimeout(() => {
      setUiPrefs({ workspace: { colors: brandColors } }).catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [brandColors]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setUiPrefs({ workspace: { logo_url: logoUrl.trim() || null } }).catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [logoUrl]);

  useEffect(() => {
    setDevMode(devMode);
  }, [devMode]);

  async function handleSignOut() {
    await onSignOut?.();
  }

  async function handleClearCaches() {
    clearCaches();
    await actions.refresh({ force: true });
    pushToast("success", "Caches cleared");
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
      const nextLogoUrl = data.logo_url;
      setLogoUrlState(nextLogoUrl);
      pushToast("success", "Logo uploaded");
    } catch (err) {
      pushToast("error", err?.message || "Logo upload failed");
    } finally {
      setLogoUploading(false);
    }
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
        <h1 className="text-2xl font-semibold">Preferences</h1>
        <div className="text-sm opacity-70">Theme, developer tools, and account details.</div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">Appearance</h2>
          <div className="form-control max-w-xs">
            <label className="label">
              <span className="label-text">Theme</span>
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
          <div className="text-sm opacity-70 mt-2">Includes DaisyUI themes (e.g., business).</div>
          <div className="mt-6">
            <div className="text-sm font-semibold">Organization branding</div>
            <label className="form-control mt-3 max-w-3xl">
              <span className="label-text">Logo URL (used in email/document templates)</span>
              <input
                type="url"
                className="input input-bordered"
                placeholder="https://cdn.example.com/logo.png"
                value={logoUrl}
                onChange={(e) => setLogoUrlState(e.target.value)}
              />
            </label>
            <div className="mt-2 flex items-center gap-2">
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
              {logoUrl ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogoUrlState("")}>
                  Clear Logo
                </button>
              ) : null}
            </div>
            <div className="text-xs opacity-60 mt-2">
              Use in Jinja as <code>{'{{ company.logo_url }}'}</code> or <code>{'{{ workspace.logo_url }}'}</code>.
            </div>
            <div className="text-sm font-semibold mt-4">Organization colors</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 max-w-3xl">
              <label className="form-control">
                <span className="label-text">Primary</span>
                <input
                  type="color"
                  className="input input-bordered h-10"
                  value={brandColors.primary || "#4f46e5"}
                  onChange={(e) => {
                    const next = { ...brandColors, primary: e.target.value };
                    setBrandColorsState(next);
                    setBrandColors(next);
                  }}
                />
              </label>
              <label className="form-control">
                <span className="label-text">Secondary</span>
                <input
                  type="color"
                  className="input input-bordered h-10"
                  value={brandColors.secondary || "#0ea5e9"}
                  onChange={(e) => {
                    const next = { ...brandColors, secondary: e.target.value };
                    setBrandColorsState(next);
                    setBrandColors(next);
                  }}
                />
              </label>
              <label className="form-control">
                <span className="label-text">Accent</span>
                <input
                  type="color"
                  className="input input-bordered h-10"
                  value={brandColors.accent || "#22c55e"}
                  onChange={(e) => {
                    const next = { ...brandColors, accent: e.target.value };
                    setBrandColorsState(next);
                    setBrandColors(next);
                  }}
                />
              </label>
            </div>
            <div className="text-xs opacity-60 mt-2">
              Overrides DaisyUI theme colors for primary/secondary/accent.
            </div>
            <button
              className="btn btn-sm btn-ghost mt-3"
              onClick={() => {
                const next = { primary: "", secondary: "", accent: "" };
                setBrandColorsState(next);
                setBrandColors(next);
              }}
            >
              Reset colors
            </button>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">Developer Mode</h2>
          <label className="label cursor-pointer gap-3">
            <span className="label-text">Enable developer mode</span>
            <input
              type="checkbox"
              className="toggle"
              checked={devMode}
              onChange={(e) => setDevModeState(e.target.checked)}
            />
          </label>
          <div className="text-sm opacity-70 mt-2">Shows entity/module/view IDs, hashes, and debug links.</div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">Account</h2>
          <div className="text-sm opacity-70">Email</div>
          <div className="font-medium">{email || "Unknown"}</div>
          <div className="mt-4 flex gap-2">
            <button className="btn btn-outline btn-sm" onClick={handleSignOut}>Sign out</button>
            <button className="btn btn-sm" onClick={handleClearCaches}>Clear local caches</button>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">Profile</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm opacity-70">Name</div>
              <div className="font-medium">{name || "—"}</div>
            </div>
            <div>
              <div className="text-sm opacity-70">Email</div>
              <div className="font-medium">{email || "—"}</div>
            </div>
          </div>
          <div className="text-sm opacity-70 mt-2">Edit profile (soon)</div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">System</h2>
          <div className="text-sm opacity-70">API Base URL</div>
          <div className="font-medium">{import.meta.env.VITE_API_URL || "http://localhost:8000"}</div>
          <div className="text-sm opacity-70 mt-2">App version: v0</div>
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              <Link className="btn btn-outline btn-sm" to="/settings/diagnostics">Diagnostics</Link>
              <Link className="btn btn-outline btn-sm" to="/audit">Audit</Link>
              <Link className="btn btn-outline btn-sm" to="/data">Data explorer</Link>
              <Link className="btn btn-outline btn-sm" to="/settings/email-templates">Email templates</Link>
              <Link className="btn btn-outline btn-sm" to="/settings/email-outbox">Email outbox</Link>
              <Link className="btn btn-outline btn-sm" to="/settings/documents/templates">Documents</Link>
              <Link className="btn btn-outline btn-sm" to="/ops">Ops</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
