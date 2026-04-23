import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_URL, apiFetch, getActiveWorkspaceId, getUiPrefs, setActiveWorkspaceId, setUiPrefs } from "../api";
import { useAccessContext } from "../access.js";
import { useToast } from "../components/Toast.jsx";
import PaginationControls from "../components/PaginationControls.jsx";
import { applyBrandColors, DEFAULT_BRAND_COLORS, setBrandColors } from "../theme/theme.js";
import { getSafeSession } from "../supabase.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import AppSelect from "../components/AppSelect.jsx";

const TAB_IDS = ["workspaces", "branding", "regional"];
const TEXT_COLOR_FALLBACK = "#111827";
const BRANDING_ASSET_TYPE_OPTIONS = [
  { value: "logo", label: "Logo" },
  { value: "icon", label: "Icon" },
  { value: "header_graphic", label: "Header Graphic" },
  { value: "footer_graphic", label: "Footer Graphic" },
  { value: "background_graphic", label: "Background Graphic" },
  { value: "watermark", label: "Watermark" },
  { value: "banner", label: "Banner" },
  { value: "letterhead_graphic", label: "Letterhead Graphic" },
  { value: "pwa_icon", label: "PWA Icon" },
  { value: "favicon", label: "Favicon" },
  { value: "nav_logo", label: "Nav Logo" },
  { value: "other", label: "Other" },
];
const APP_BRANDING_COLOR_FIELDS = [
  { key: "primary_color", label: "Primary Color", fallback: DEFAULT_BRAND_COLORS.primary },
  { key: "secondary_color", label: "Secondary Color", fallback: DEFAULT_BRAND_COLORS.secondary },
  { key: "accent_color", label: "Accent Color", fallback: DEFAULT_BRAND_COLORS.accent },
  { key: "text_color", label: "Text Color", fallback: TEXT_COLOR_FALLBACK },
];
const TEMPLATE_BRANDING_COLOR_FIELDS = [
  { key: "template_primary_color", label: "Primary Color", fallbackKey: "primary_color", fallback: DEFAULT_BRAND_COLORS.primary },
  { key: "template_secondary_color", label: "Secondary Color", fallbackKey: "secondary_color", fallback: DEFAULT_BRAND_COLORS.secondary },
  { key: "template_accent_color", label: "Accent Color", fallbackKey: "accent_color", fallback: DEFAULT_BRAND_COLORS.accent },
  { key: "template_text_color", label: "Text Color", fallbackKey: "text_color", fallback: TEXT_COLOR_FALLBACK },
];
const APP_BRANDING_ASSET_FIELDS = [
  { key: "app_logo_asset_id", label: "App Logo", type: "logo" },
  { key: "app_icon_asset_id", label: "App Icon", type: "icon" },
  { key: "favicon_asset_id", label: "Favicon", type: "favicon" },
  { key: "pwa_icon_asset_id", label: "PWA Icon", type: "pwa_icon" },
  { key: "nav_logo_asset_id", label: "Nav Logo", type: "nav_logo" },
  { key: "homepage_brand_asset_id", label: "Homepage Brand Asset", type: "other" },
];
const TEMPLATE_BRANDING_TEXT_FIELDS = [
  { key: "brand_name", label: "Brand Name" },
  { key: "legal_name", label: "Legal Name" },
  { key: "website", label: "Website", type: "url" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email", type: "email" },
  { key: "address_line_1", label: "Address Line 1" },
  { key: "address_line_2", label: "Address Line 2" },
  { key: "city", label: "City" },
  { key: "state_region", label: "State / Region" },
  { key: "postcode", label: "Postcode" },
  { key: "country", label: "Country" },
  { key: "tax_number", label: "Tax Number" },
  { key: "vat_number", label: "VAT Number" },
  { key: "company_registration_number", label: "Company Registration Number" },
  { key: "default_terms_url", label: "Default Terms URL", type: "url" },
  { key: "default_bank_name", label: "Default Bank Name" },
  { key: "default_bank_account_name", label: "Bank Account Name" },
  { key: "default_bank_account_number", label: "Bank Account Number" },
  { key: "default_bank_iban", label: "Bank IBAN" },
  { key: "default_bank_bic", label: "Bank BIC" },
];
const TEMPLATE_BRANDING_TEXTAREA_FIELDS = [
  { key: "default_footer_text", label: "Default Footer Text" },
  { key: "default_disclaimer_text", label: "Default Disclaimer Text" },
];
const TEMPLATE_BRANDING_ASSET_FIELDS = [
  { key: "primary_logo_asset_id", label: "Primary Logo", type: "logo" },
  { key: "secondary_logo_asset_id", label: "Secondary Logo", type: "logo" },
  { key: "header_graphic_asset_id", label: "Header Graphic", type: "header_graphic" },
  { key: "footer_graphic_asset_id", label: "Footer Graphic", type: "footer_graphic" },
  { key: "default_background_graphic_asset_id", label: "Background Graphic", type: "background_graphic" },
  { key: "default_email_banner_asset_id", label: "Email Banner", type: "banner" },
  { key: "default_watermark_asset_id", label: "Watermark", type: "watermark" },
];
const APP_BRANDING_PRIMARY_ASSET_FIELDS = APP_BRANDING_ASSET_FIELDS.filter((field) =>
  ["app_logo_asset_id", "app_icon_asset_id", "nav_logo_asset_id"].includes(field.key),
);
const APP_BRANDING_OPTIONAL_ASSET_FIELDS = APP_BRANDING_ASSET_FIELDS.filter(
  (field) => !APP_BRANDING_PRIMARY_ASSET_FIELDS.some((entry) => entry.key === field.key),
);
const TEMPLATE_BRANDING_PRIMARY_TEXT_FIELDS = TEMPLATE_BRANDING_TEXT_FIELDS.filter((field) =>
  ["brand_name", "website", "phone", "email"].includes(field.key),
);
const TEMPLATE_BRANDING_OPTIONAL_TEXT_FIELDS = TEMPLATE_BRANDING_TEXT_FIELDS.filter(
  (field) => !TEMPLATE_BRANDING_PRIMARY_TEXT_FIELDS.some((entry) => entry.key === field.key),
);
const TEMPLATE_BRANDING_PRIMARY_ASSET_FIELDS = TEMPLATE_BRANDING_ASSET_FIELDS.filter((field) =>
  ["primary_logo_asset_id", "secondary_logo_asset_id"].includes(field.key),
);
const TEMPLATE_BRANDING_OPTIONAL_ASSET_FIELDS = TEMPLATE_BRANDING_ASSET_FIELDS.filter(
  (field) => !TEMPLATE_BRANDING_PRIMARY_ASSET_FIELDS.some((entry) => entry.key === field.key),
);
const APP_BRANDING_DEFAULTS = {
  workspace_name: "",
  app_logo_asset_id: "",
  app_icon_asset_id: "",
  favicon_asset_id: "",
  pwa_icon_asset_id: "",
  nav_logo_asset_id: "",
  homepage_brand_asset_id: "",
  primary_color: DEFAULT_BRAND_COLORS.primary,
  secondary_color: DEFAULT_BRAND_COLORS.secondary,
  accent_color: DEFAULT_BRAND_COLORS.accent,
  text_color: TEXT_COLOR_FALLBACK,
  app_logo_url: "",
};
const TEMPLATE_BRANDING_DEFAULTS = {
  brand_name: "",
  legal_name: "",
  website: "",
  phone: "",
  email: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  state_region: "",
  postcode: "",
  country: "",
  tax_number: "",
  vat_number: "",
  company_registration_number: "",
  default_footer_text: "",
  default_disclaimer_text: "",
  default_terms_url: "",
  default_bank_name: "",
  default_bank_account_name: "",
  default_bank_account_number: "",
  default_bank_iban: "",
  default_bank_bic: "",
  template_primary_color: DEFAULT_BRAND_COLORS.primary,
  template_secondary_color: DEFAULT_BRAND_COLORS.secondary,
  template_accent_color: DEFAULT_BRAND_COLORS.accent,
  template_text_color: TEXT_COLOR_FALLBACK,
  primary_logo_asset_id: "",
  secondary_logo_asset_id: "",
  header_graphic_asset_id: "",
  footer_graphic_asset_id: "",
  default_background_graphic_asset_id: "",
  default_email_banner_asset_id: "",
  default_watermark_asset_id: "",
  primary_logo_url: "",
};
const BRANDING_ASSET_UPLOAD_DEFAULTS = {
  name: "",
  reference_key: "",
  type: "logo",
  alt_text: "",
  notes: "",
  sort_order: 0,
  is_active: true,
};

function normalizeTabId(value) {
  const raw = String(value || "").trim().toLowerCase();
  return TAB_IDS.includes(raw) ? raw : "workspaces";
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

function textValue(value) {
  return value == null ? "" : String(value);
}

function sortBrandingAssets(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftInactive = left?.is_active === false ? 1 : 0;
    const rightInactive = right?.is_active === false ? 1 : 0;
    if (leftInactive !== rightInactive) return leftInactive - rightInactive;
    const leftOrder = Number(left?.sort_order || 0);
    const rightOrder = Number(right?.sort_order || 0);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftName = String(left?.name || left?.reference_key || "");
    const rightName = String(right?.name || right?.reference_key || "");
    return leftName.localeCompare(rightName);
  });
}

function assetOptionLabel(asset) {
  const parts = [asset?.name || asset?.reference_key || "Untitled asset"];
  if (asset?.reference_key) parts.push(`(${asset.reference_key})`);
  if (asset?.type) parts.push(`[${asset.type}]`);
  if (asset?.is_active === false) parts.push("inactive");
  return parts.join(" ");
}

function countConfiguredValues(source, keys) {
  return keys.reduce((count, key) => {
    const value = source?.[key];
    if (typeof value === "string") return count + (value.trim() ? 1 : 0);
    if (typeof value === "number") return count + (Number.isFinite(value) ? 1 : 0);
    if (typeof value === "boolean") return count + 1;
    return count;
  }, 0);
}

function upsertBrandingAsset(items, asset) {
  const next = (Array.isArray(items) ? items : []).filter((entry) => entry?.id !== asset?.id);
  next.push(asset);
  return sortBrandingAssets(next);
}

function normalizeAppBranding(appBranding, workspace) {
  return {
    ...APP_BRANDING_DEFAULTS,
    workspace_name: textValue(appBranding?.workspace_name || workspace?.workspace_name),
    app_logo_asset_id: textValue(appBranding?.app_logo_asset_id || workspace?.app_logo_asset_id),
    app_icon_asset_id: textValue(appBranding?.app_icon_asset_id || workspace?.app_icon_asset_id),
    favicon_asset_id: textValue(appBranding?.favicon_asset_id || workspace?.favicon_asset_id),
    pwa_icon_asset_id: textValue(appBranding?.pwa_icon_asset_id || workspace?.pwa_icon_asset_id),
    nav_logo_asset_id: textValue(appBranding?.nav_logo_asset_id || workspace?.nav_logo_asset_id),
    homepage_brand_asset_id: textValue(appBranding?.homepage_brand_asset_id || workspace?.homepage_brand_asset_id),
    primary_color: normalizeHexColor(appBranding?.primary_color || workspace?.colors?.primary, DEFAULT_BRAND_COLORS.primary),
    secondary_color: normalizeHexColor(
      appBranding?.secondary_color || workspace?.colors?.secondary,
      DEFAULT_BRAND_COLORS.secondary,
    ),
    accent_color: normalizeHexColor(appBranding?.accent_color || workspace?.colors?.accent, DEFAULT_BRAND_COLORS.accent),
    text_color: normalizeHexColor(appBranding?.text_color, TEXT_COLOR_FALLBACK),
    app_logo_url: textValue(appBranding?.app_logo_url || appBranding?.logo_url || workspace?.logo_url),
  };
}

function normalizeTemplateBranding(templateBranding, appBranding) {
  return {
    ...TEMPLATE_BRANDING_DEFAULTS,
    ...Object.fromEntries(
      [...TEMPLATE_BRANDING_TEXT_FIELDS, ...TEMPLATE_BRANDING_TEXTAREA_FIELDS].map((field) => [
        field.key,
        textValue(templateBranding?.[field.key]),
      ]),
    ),
    ...Object.fromEntries(
      TEMPLATE_BRANDING_ASSET_FIELDS.map((field) => [field.key, textValue(templateBranding?.[field.key])]),
    ),
    brand_name: textValue(templateBranding?.brand_name || appBranding?.workspace_name),
    template_primary_color: normalizeHexColor(
      templateBranding?.template_primary_color,
      appBranding?.primary_color || DEFAULT_BRAND_COLORS.primary,
    ),
    template_secondary_color: normalizeHexColor(
      templateBranding?.template_secondary_color,
      appBranding?.secondary_color || DEFAULT_BRAND_COLORS.secondary,
    ),
    template_accent_color: normalizeHexColor(
      templateBranding?.template_accent_color,
      appBranding?.accent_color || DEFAULT_BRAND_COLORS.accent,
    ),
    template_text_color: normalizeHexColor(
      templateBranding?.template_text_color,
      appBranding?.text_color || TEXT_COLOR_FALLBACK,
    ),
    primary_logo_url: textValue(templateBranding?.primary_logo_url || templateBranding?.logo_url || appBranding?.app_logo_url),
  };
}

function pickValues(source, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = source?.[key] ?? "";
    return acc;
  }, {});
}

function Section({ title, description, children }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function DisclosureSection({ title, summary, defaultOpen = false, children }) {
  return (
    <details className="rounded-box border border-base-300 bg-base-100" open={defaultOpen}>
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">{title}</div>
          {summary ? <div className="text-xs opacity-60">{summary}</div> : null}
        </div>
      </summary>
      <div className="border-t border-base-300 p-4">{children}</div>
    </details>
  );
}

function AssetPreview({ asset, fallbackUrl = "", emptyLabel = "No asset selected." }) {
  const previewUrl = asset?.file_url || fallbackUrl || "";
  const isImage =
    previewUrl &&
    (String(asset?.mime_type || "").startsWith("image/") ||
      /\.(png|jpe?g|gif|svg|webp)$/i.test(previewUrl));
  return (
    <div className="rounded-box border border-base-300 bg-base-200 p-3">
      <div className="text-xs uppercase tracking-wide opacity-60">Preview</div>
      <div className="mt-2 flex min-h-24 items-center justify-center overflow-hidden rounded-box border border-base-300 bg-base-100 p-2">
        {previewUrl && isImage ? (
          <img src={previewUrl} alt={asset?.alt_text || asset?.name || "Branding asset"} className="max-h-24 max-w-full object-contain" />
        ) : previewUrl ? (
          <a href={previewUrl} target="_blank" rel="noreferrer" className="link text-sm break-all">
            {asset?.name || "Open asset"}
          </a>
        ) : (
          <div className="text-xs opacity-60 text-center">{emptyLabel}</div>
        )}
      </div>
      {asset ? (
        <div className="mt-2 text-xs opacity-70">
          <div>{asset.name || "Untitled asset"}</div>
          <div>{asset.reference_key || "No reference key"}</div>
        </div>
      ) : null}
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
  const [appBranding, setAppBranding] = useState(APP_BRANDING_DEFAULTS);
  const [templateBranding, setTemplateBranding] = useState(TEMPLATE_BRANDING_DEFAULTS);
  const [brandingAssets, setBrandingAssets] = useState([]);
  const [assetUpload, setAssetUpload] = useState(BRANDING_ASSET_UPLOAD_DEFAULTS);
  const [assetUploadFile, setAssetUploadFile] = useState(null);
  const [appBrandingSaving, setAppBrandingSaving] = useState(false);
  const [templateBrandingSaving, setTemplateBrandingSaving] = useState(false);
  const [regionalSaving, setRegionalSaving] = useState(false);
  const [assetUploading, setAssetUploading] = useState(false);
  const [assetSavingId, setAssetSavingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeWorkspaceId, setActive] = useState(getActiveWorkspaceId());
  const [deleteBusyId, setDeleteBusyId] = useState("");
  const [defaultLocale, setDefaultLocale] = useState("en-NZ");
  const [defaultTimezone, setDefaultTimezone] = useState("UTC");
  const [defaultCurrency, setDefaultCurrency] = useState("NZD");
  const assetFileRef = useRef(null);
  const { pushToast } = useToast();
  const { context, loading: accessLoading } = useAccessContext();

  const actor = context?.actor || {};
  const canEditWorkspaceSettings = actor.platform_role === "superadmin" || actor.workspace_role === "admin";
  const workspaceTabs = useMemo(
    () => [
      { id: "workspaces", label: t("settings.workspaces_tab") },
      ...(canEditWorkspaceSettings
        ? [
            { id: "branding", label: t("settings.branding_tab") },
            { id: "regional", label: t("settings.regional_tab") },
          ]
        : []),
    ],
    [canEditWorkspaceSettings, t],
  );
  const displayWorkspaces = useMemo(() => {
    return (workspaces || []).map((workspace) => ({
      workspace_id: workspace.workspace_id || workspace.id,
      workspace_name: workspace.workspace_name || workspace.name || workspace.workspace_id || workspace.id,
      role: workspace.role || (actor.platform_role === "superadmin" ? "admin" : "member"),
      member_count: workspace.member_count,
      is_sandbox: Boolean(workspace.is_sandbox),
      sandbox_status: workspace.sandbox_status || "",
      sandbox_owner_user_id: workspace.sandbox_owner_user_id || "",
    }));
  }, [workspaces, actor.platform_role]);
  const workspacesPageSize = 25;
  const workspacesTotalPages = useMemo(
    () => Math.max(1, Math.ceil(displayWorkspaces.length / workspacesPageSize)),
    [displayWorkspaces.length],
  );
  const pagedWorkspaces = useMemo(() => {
    const start = workspacesPage * workspacesPageSize;
    return displayWorkspaces.slice(start, start + workspacesPageSize);
  }, [displayWorkspaces, workspacesPage]);
  const assetMap = useMemo(() => new Map(brandingAssets.map((asset) => [asset.id, asset])), [brandingAssets]);
  const assetOptions = useMemo(() => sortBrandingAssets(brandingAssets), [brandingAssets]);

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
      const nextAppBranding = normalizeAppBranding(prefsRes?.app_branding, prefsRes?.workspace);
      setAppBranding(nextAppBranding);
      setTemplateBranding(normalizeTemplateBranding(prefsRes?.template_branding, nextAppBranding));
      setBrandingAssets(sortBrandingAssets(prefsRes?.branding_assets || []));
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

  useEffect(() => {
    setWorkspacesPage((prev) => Math.min(Math.max(0, prev), workspacesTotalPages - 1));
  }, [workspacesTotalPages]);

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
      await apiFetch(`/access/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
      setWorkspaces((prev) => prev.filter((item) => (item.workspace_id || item.id) !== workspaceId));
      pushToast("success", t("common.deleted_workspace"));
    } catch (err) {
      pushToast("error", err?.message || t("common.delete_failed"));
    } finally {
      setDeleteBusyId("");
    }
  }

  function goTab(nextId) {
    const allowedTabIds = new Set(workspaceTabs.map((tab) => tab.id));
    const next = allowedTabIds.has(normalizeTabId(nextId)) ? normalizeTabId(nextId) : "workspaces";
    setActiveTab(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", next);
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    const allowedTabIds = new Set(workspaceTabs.map((tab) => tab.id));
    if (!allowedTabIds.has(activeTab)) {
      goTab("workspaces");
    }
  }, [activeTab, workspaceTabs]);

  async function persistWorkspacePrefs(next) {
    try {
      const response = await setUiPrefs({ workspace: next });
      if (next.colors) {
        setBrandColors(next.colors);
        applyBrandColors(next.colors);
      }
      await reloadI18n(response);
      return response;
    } catch (err) {
      pushToast("error", t("settings.workspace_save_failed"));
      throw err;
    }
  }

  async function saveAppBranding() {
    if (!appBranding.workspace_name.trim()) return;
    setAppBrandingSaving(true);
    try {
      const payload = pickValues(appBranding, [
        "workspace_name",
        "app_logo_asset_id",
        "app_icon_asset_id",
        "favicon_asset_id",
        "pwa_icon_asset_id",
        "nav_logo_asset_id",
        "homepage_brand_asset_id",
        "primary_color",
        "secondary_color",
        "accent_color",
        "text_color",
      ]);
      const response = await setUiPrefs({ app_branding: payload });
      const nextAppBranding = normalizeAppBranding(response?.app_branding, response?.workspace);
      setAppBranding(nextAppBranding);
      setTemplateBranding(normalizeTemplateBranding(response?.template_branding, nextAppBranding));
      setBrandingAssets(sortBrandingAssets(response?.branding_assets || brandingAssets));
      setWorkspacePrefs((prev) => ({
        ...prev,
        logo_url: response?.workspace?.logo_url || prev.logo_url,
        colors: response?.workspace?.colors || prev.colors,
      }));
      if (response?.workspace?.colors) {
        setBrandColors(response.workspace.colors);
        applyBrandColors(response.workspace.colors);
      }
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          (workspace.workspace_id || workspace.id) === activeWorkspaceId
            ? { ...workspace, workspace_name: nextAppBranding.workspace_name }
            : workspace,
        ),
      );
      await reloadI18n(response);
      pushToast("success", "App branding updated.");
    } catch (err) {
      pushToast("error", err?.message || "Failed to update app branding.");
    } finally {
      setAppBrandingSaving(false);
    }
  }

  async function saveTemplateBranding() {
    setTemplateBrandingSaving(true);
    try {
      const payload = pickValues(templateBranding, [
        ...TEMPLATE_BRANDING_TEXT_FIELDS.map((field) => field.key),
        ...TEMPLATE_BRANDING_TEXTAREA_FIELDS.map((field) => field.key),
        ...TEMPLATE_BRANDING_ASSET_FIELDS.map((field) => field.key),
        ...TEMPLATE_BRANDING_COLOR_FIELDS.map((field) => field.key),
      ]);
      const response = await setUiPrefs({ template_branding: payload });
      const nextAppBranding = normalizeAppBranding(response?.app_branding, response?.workspace);
      setAppBranding(nextAppBranding);
      setTemplateBranding(normalizeTemplateBranding(response?.template_branding, nextAppBranding));
      setBrandingAssets(sortBrandingAssets(response?.branding_assets || brandingAssets));
      await reloadI18n(response);
      pushToast("success", "Template branding updated.");
    } catch (err) {
      pushToast("error", err?.message || "Failed to update template branding.");
    } finally {
      setTemplateBrandingSaving(false);
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

  async function uploadBrandingAsset() {
    if (!assetUploadFile || !assetUpload.name.trim() || !assetUpload.reference_key.trim()) return;
    setAssetUploading(true);
    try {
      const session = await getSafeSession();
      const token = session?.access_token;
      const form = new FormData();
      form.append("file", assetUploadFile);
      form.append("name", assetUpload.name.trim());
      form.append("reference_key", assetUpload.reference_key.trim());
      form.append("type", assetUpload.type);
      form.append("alt_text", assetUpload.alt_text);
      form.append("notes", assetUpload.notes);
      form.append("sort_order", String(Number(assetUpload.sort_order || 0)));
      form.append("is_active", assetUpload.is_active ? "true" : "false");
      const response = await fetch(`${API_URL}/prefs/branding/assets/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await response.json();
      if (!response.ok || !data?.asset) {
        throw new Error(data?.errors?.[0]?.message || "Failed to upload branding asset.");
      }
      setBrandingAssets((prev) => upsertBrandingAsset(prev, data.asset));
      setAssetUpload(BRANDING_ASSET_UPLOAD_DEFAULTS);
      setAssetUploadFile(null);
      if (assetFileRef.current) assetFileRef.current.value = "";
      pushToast("success", "Branding asset uploaded.");
    } catch (err) {
      pushToast("error", err?.message || "Failed to upload branding asset.");
    } finally {
      setAssetUploading(false);
    }
  }

  async function saveBrandingAsset(asset) {
    if (!asset?.id || !asset?.name?.trim() || !asset?.reference_key?.trim()) return;
    setAssetSavingId(asset.id);
    try {
      const response = await apiFetch(`/prefs/branding/assets/${encodeURIComponent(asset.id)}`, {
        method: "PATCH",
        body: {
          name: asset.name.trim(),
          reference_key: asset.reference_key.trim(),
          type: asset.type,
          alt_text: textValue(asset.alt_text),
          notes: textValue(asset.notes),
          is_active: asset.is_active !== false,
          sort_order: Number(asset.sort_order || 0),
        },
      });
      if (!response?.asset) {
        throw new Error("Failed to save branding asset.");
      }
      setBrandingAssets((prev) => upsertBrandingAsset(prev, response.asset));
      pushToast("success", "Branding asset saved.");
    } catch (err) {
      pushToast("error", err?.message || "Failed to save branding asset.");
    } finally {
      setAssetSavingId("");
    }
  }

  function renderAssetSelect(state, setState, field, { disabled = false, fallbackUrl = "" } = {}) {
    const selectedAsset = assetMap.get(state[field.key]) || null;
    const filteredOptions = assetOptions.filter(
      (asset) => asset?.id === state[field.key] || !field.type || asset?.type === field.type,
    );
    return (
      <div className="space-y-2">
        <label className="form-control">
          <span className="label-text text-sm">{field.label}</span>
          <AppSelect
            className="select select-bordered select-sm"
            value={state[field.key] || ""}
            onChange={(event) => setState((prev) => ({ ...prev, [field.key]: event.target.value }))}
            disabled={disabled}
            aria-label={field.label}
            placeholder="No asset selected"
          >
            <option value="">No asset selected</option>
            {filteredOptions.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {assetOptionLabel(asset)}
              </option>
            ))}
          </AppSelect>
        </label>
        <AssetPreview asset={selectedAsset} fallbackUrl={fallbackUrl} emptyLabel="Select an asset or upload one below." />
      </div>
    );
  }

  return (
    <TabbedPaneShell tabs={workspaceTabs} activeTabId={activeTab} onTabChange={goTab} contentContainer={true}>
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
          <div className="space-y-4">
            {!canEditWorkspaceSettings ? (
              <div className="alert alert-warning text-sm">{t("settings.workspace_admin_only")}</div>
            ) : (
              <>
                <Section
                  title="App Branding"
                  description="Workspace name, app theme colors, and app-facing brand assets."
                >
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <label className="form-control">
                        <span className="label-text text-sm">Workspace Name</span>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full"
                          value={appBranding.workspace_name}
                          onChange={(event) => setAppBranding((prev) => ({ ...prev, workspace_name: event.target.value }))}
                          disabled={appBrandingSaving}
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {APP_BRANDING_COLOR_FIELDS.map((field) => (
                        <label className="form-control" key={field.key}>
                          <span className="label-text text-sm">{field.label}</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              className="input input-bordered h-10 w-16 p-1"
                              value={appBranding[field.key] || field.fallback}
                              onChange={(event) =>
                                setAppBranding((prev) => ({ ...prev, [field.key]: event.target.value }))
                              }
                              disabled={appBrandingSaving}
                            />
                            <input
                              type="text"
                              className="input input-bordered input-sm flex-1"
                              value={appBranding[field.key] || field.fallback}
                              onChange={(event) =>
                                setAppBranding((prev) => ({
                                  ...prev,
                                  [field.key]: normalizeHexColor(event.target.value, field.fallback),
                                }))
                              }
                              disabled={appBrandingSaving}
                            />
                          </div>
                        </label>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      {APP_BRANDING_PRIMARY_ASSET_FIELDS.map((field) => (
                        <div key={field.key}>
                          {renderAssetSelect(appBranding, setAppBranding, field, {
                            disabled: appBrandingSaving,
                            fallbackUrl: field.key === "app_logo_asset_id" ? appBranding.app_logo_url : "",
                          })}
                        </div>
                      ))}
                    </div>

                    <DisclosureSection
                      title="Additional App Assets"
                      summary="Optional"
                    >
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                        {APP_BRANDING_OPTIONAL_ASSET_FIELDS.map((field) => (
                          <div key={field.key}>
                            {renderAssetSelect(appBranding, setAppBranding, field, {
                              disabled: appBrandingSaving,
                            })}
                          </div>
                        ))}
                      </div>
                    </DisclosureSection>

                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm opacity-70">
                        These values drive the active workspace theme and app branding.
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={appBrandingSaving || !appBranding.workspace_name.trim()}
                        onClick={saveAppBranding}
                      >
                        {appBrandingSaving ? t("common.saving") : t("common.save")}
                      </button>
                    </div>
                  </div>
                </Section>

                <Section
                  title="Template Branding"
                  description="Customer-facing branding for emails, templates, PDFs, and generated content."
                >
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {TEMPLATE_BRANDING_PRIMARY_TEXT_FIELDS.map((field) => (
                        <label className="form-control" key={field.key}>
                          <span className="label-text text-sm">{field.label}</span>
                          <input
                            type={field.type || "text"}
                            className="input input-bordered input-sm"
                            value={templateBranding[field.key] || ""}
                            onChange={(event) =>
                              setTemplateBranding((prev) => ({ ...prev, [field.key]: event.target.value }))
                            }
                            disabled={templateBrandingSaving}
                          />
                        </label>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {TEMPLATE_BRANDING_COLOR_FIELDS.map((field) => (
                        <label className="form-control" key={field.key}>
                          <span className="label-text text-sm">{field.label}</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              className="input input-bordered h-10 w-16 p-1"
                              value={templateBranding[field.key] || appBranding[field.fallbackKey] || field.fallback}
                              onChange={(event) =>
                                setTemplateBranding((prev) => ({ ...prev, [field.key]: event.target.value }))
                              }
                              disabled={templateBrandingSaving}
                            />
                            <input
                              type="text"
                              className="input input-bordered input-sm flex-1"
                              value={templateBranding[field.key] || appBranding[field.fallbackKey] || field.fallback}
                              onChange={(event) =>
                                setTemplateBranding((prev) => ({
                                  ...prev,
                                  [field.key]: normalizeHexColor(
                                    event.target.value,
                                    appBranding[field.fallbackKey] || field.fallback,
                                  ),
                                }))
                              }
                              disabled={templateBrandingSaving}
                            />
                          </div>
                        </label>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {TEMPLATE_BRANDING_PRIMARY_ASSET_FIELDS.map((field) => (
                        <div key={field.key}>
                          {renderAssetSelect(templateBranding, setTemplateBranding, field, {
                            disabled: templateBrandingSaving,
                            fallbackUrl: field.key === "primary_logo_asset_id" ? templateBranding.primary_logo_url : "",
                          })}
                        </div>
                      ))}
                    </div>

                    <DisclosureSection
                      title="Legal, Address, and Banking Details"
                      summary="Optional"
                    >
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {TEMPLATE_BRANDING_OPTIONAL_TEXT_FIELDS.map((field) => (
                          <label className="form-control" key={field.key}>
                            <span className="label-text text-sm">{field.label}</span>
                            <input
                              type={field.type || "text"}
                              className="input input-bordered input-sm"
                              value={templateBranding[field.key] || ""}
                              onChange={(event) =>
                                setTemplateBranding((prev) => ({ ...prev, [field.key]: event.target.value }))
                              }
                              disabled={templateBrandingSaving}
                            />
                          </label>
                        ))}
                      </div>
                    </DisclosureSection>

                    <DisclosureSection
                      title="Footer, Disclaimer, and Template Copy"
                      summary="Optional"
                    >
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {TEMPLATE_BRANDING_TEXTAREA_FIELDS.map((field) => (
                          <label className="form-control" key={field.key}>
                            <span className="label-text text-sm">{field.label}</span>
                            <textarea
                              className="textarea textarea-bordered textarea-sm min-h-28"
                              value={templateBranding[field.key] || ""}
                              onChange={(event) =>
                                setTemplateBranding((prev) => ({ ...prev, [field.key]: event.target.value }))
                              }
                              disabled={templateBrandingSaving}
                            />
                          </label>
                        ))}
                      </div>
                    </DisclosureSection>

                    <DisclosureSection
                      title="Graphics and Template Extras"
                      summary="Optional"
                    >
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                        {TEMPLATE_BRANDING_OPTIONAL_ASSET_FIELDS.map((field) => (
                          <div key={field.key}>
                            {renderAssetSelect(templateBranding, setTemplateBranding, field, {
                              disabled: templateBrandingSaving,
                            })}
                          </div>
                        ))}
                      </div>
                    </DisclosureSection>

                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm opacity-70">
                        Template branding falls back to app branding where sensible.
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={templateBrandingSaving}
                        onClick={saveTemplateBranding}
                      >
                        {templateBrandingSaving ? t("common.saving") : t("common.save")}
                      </button>
                    </div>
                  </div>
                </Section>

                <Section
                  title="Branding Assets"
                  description="Reusable assets shared across app branding and templates."
                >
                  <div className="space-y-6">
                    <DisclosureSection title="Upload Asset" summary="Add a reusable logo, icon, or graphic" defaultOpen={true}>
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
                          <label className="form-control">
                            <span className="label-text text-sm">Name</span>
                            <input
                              type="text"
                              className="input input-bordered input-sm"
                              value={assetUpload.name}
                              onChange={(event) => setAssetUpload((prev) => ({ ...prev, name: event.target.value }))}
                              disabled={assetUploading}
                            />
                          </label>
                          <label className="form-control">
                            <span className="label-text text-sm">Reference Key</span>
                            <input
                              type="text"
                              className="input input-bordered input-sm"
                              value={assetUpload.reference_key}
                              onChange={(event) =>
                                setAssetUpload((prev) => ({ ...prev, reference_key: event.target.value }))
                              }
                              disabled={assetUploading}
                            />
                          </label>
                          <label className="form-control">
                            <span className="label-text text-sm">Type</span>
                            <AppSelect
                              className="select select-bordered select-sm"
                              value={assetUpload.type}
                              onChange={(event) => setAssetUpload((prev) => ({ ...prev, type: event.target.value }))}
                              disabled={assetUploading}
                              aria-label="Asset type"
                            >
                              {BRANDING_ASSET_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </AppSelect>
                          </label>
                          <label className="form-control">
                            <span className="label-text text-sm">File</span>
                            <input
                              ref={assetFileRef}
                              type="file"
                              className="file-input file-input-bordered file-input-sm w-full"
                              onChange={(event) => setAssetUploadFile(event.target.files?.[0] || null)}
                              disabled={assetUploading}
                            />
                          </label>
                        </div>
                        <DisclosureSection title="Optional Asset Metadata" summary="Optional">
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <label className="form-control">
                              <span className="label-text text-sm">Alt Text</span>
                              <input
                                type="text"
                                className="input input-bordered input-sm"
                                value={assetUpload.alt_text}
                                onChange={(event) =>
                                  setAssetUpload((prev) => ({ ...prev, alt_text: event.target.value }))
                                }
                                disabled={assetUploading}
                              />
                            </label>
                            <label className="form-control">
                              <span className="label-text text-sm">Sort Order</span>
                              <input
                                type="number"
                                className="input input-bordered input-sm"
                                value={assetUpload.sort_order}
                                onChange={(event) =>
                                  setAssetUpload((prev) => ({ ...prev, sort_order: Number(event.target.value || 0) }))
                                }
                                disabled={assetUploading}
                              />
                            </label>
                          </div>
                          <label className="form-control mt-4">
                            <span className="label-text text-sm">Notes / Intended Usage</span>
                            <textarea
                              className="textarea textarea-bordered textarea-sm min-h-24"
                              value={assetUpload.notes}
                              onChange={(event) => setAssetUpload((prev) => ({ ...prev, notes: event.target.value }))}
                              disabled={assetUploading}
                            />
                          </label>
                          <label className="label mt-3 cursor-pointer justify-start gap-3">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              checked={assetUpload.is_active}
                              onChange={(event) =>
                                setAssetUpload((prev) => ({ ...prev, is_active: event.target.checked }))
                              }
                              disabled={assetUploading}
                            />
                            <span className="label-text">Asset is active</span>
                          </label>
                        </DisclosureSection>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm opacity-70">
                            Use stable reference keys so templates and generated content can reuse assets reliably.
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={assetUploading || !assetUploadFile || !assetUpload.name.trim() || !assetUpload.reference_key.trim()}
                            onClick={uploadBrandingAsset}
                          >
                            {assetUploading ? t("common.uploading") : "Upload Asset"}
                          </button>
                        </div>
                      </div>
                    </DisclosureSection>

                    {assetOptions.length === 0 ? (
                      <div className="text-sm opacity-60">No branding assets uploaded yet.</div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        {assetOptions.map((asset) => (
                          <div key={asset.id} className="rounded-box border border-base-300 bg-base-100 p-4">
                            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4">
                              <AssetPreview asset={asset} emptyLabel="No preview available." />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate text-sm font-semibold">{asset.name || "Untitled asset"}</div>
                                  <span className="badge badge-outline badge-sm">{asset.type || "other"}</span>
                                  <span className={`badge badge-sm ${asset.is_active === false ? "badge-ghost" : "badge-success badge-outline"}`}>
                                    {asset.is_active === false ? "Inactive" : "Active"}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs opacity-70">{asset.reference_key || "No reference key"}</div>
                                {asset.notes ? <div className="mt-2 text-sm opacity-80">{asset.notes}</div> : null}
                              </div>
                            </div>
                            <DisclosureSection
                              title="Edit Asset Details"
                              summary={`${countConfiguredValues(asset, ["alt_text", "notes"])} metadata fields`}
                            >
                              <div className="space-y-3">
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                  <label className="form-control">
                                    <span className="label-text text-sm">Name</span>
                                    <input
                                      type="text"
                                      className="input input-bordered input-sm"
                                      value={asset.name || ""}
                                      onChange={(event) =>
                                        setBrandingAssets((prev) =>
                                          prev.map((entry) =>
                                            entry.id === asset.id ? { ...entry, name: event.target.value } : entry,
                                          ),
                                        )
                                      }
                                      disabled={assetSavingId === asset.id}
                                    />
                                  </label>
                                  <label className="form-control">
                                    <span className="label-text text-sm">Reference Key</span>
                                    <input
                                      type="text"
                                      className="input input-bordered input-sm"
                                      value={asset.reference_key || ""}
                                      onChange={(event) =>
                                        setBrandingAssets((prev) =>
                                          prev.map((entry) =>
                                            entry.id === asset.id ? { ...entry, reference_key: event.target.value } : entry,
                                          ),
                                        )
                                      }
                                      disabled={assetSavingId === asset.id}
                                    />
                                  </label>
                                  <label className="form-control">
                                    <span className="label-text text-sm">Type</span>
                                    <AppSelect
                                      className="select select-bordered select-sm"
                                      value={asset.type || "other"}
                                      onChange={(event) =>
                                        setBrandingAssets((prev) =>
                                          prev.map((entry) =>
                                            entry.id === asset.id ? { ...entry, type: event.target.value } : entry,
                                          ),
                                        )
                                      }
                                      disabled={assetSavingId === asset.id}
                                      aria-label={`Asset type for ${asset.name || asset.reference_key || asset.id}`}
                                    >
                                      {BRANDING_ASSET_TYPE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </AppSelect>
                                  </label>
                                  <label className="form-control">
                                    <span className="label-text text-sm">Sort Order</span>
                                    <input
                                      type="number"
                                      className="input input-bordered input-sm"
                                      value={asset.sort_order ?? 0}
                                      onChange={(event) =>
                                        setBrandingAssets((prev) =>
                                          prev.map((entry) =>
                                            entry.id === asset.id
                                              ? { ...entry, sort_order: Number(event.target.value || 0) }
                                              : entry,
                                          ),
                                        )
                                      }
                                      disabled={assetSavingId === asset.id}
                                    />
                                  </label>
                                </div>
                                <label className="form-control">
                                  <span className="label-text text-sm">Alt Text</span>
                                  <input
                                    type="text"
                                    className="input input-bordered input-sm"
                                    value={asset.alt_text || ""}
                                    onChange={(event) =>
                                      setBrandingAssets((prev) =>
                                        prev.map((entry) =>
                                          entry.id === asset.id ? { ...entry, alt_text: event.target.value } : entry,
                                        ),
                                      )
                                    }
                                    disabled={assetSavingId === asset.id}
                                  />
                                </label>
                                <label className="form-control">
                                  <span className="label-text text-sm">Notes / Intended Usage</span>
                                  <textarea
                                    className="textarea textarea-bordered textarea-sm min-h-24"
                                    value={asset.notes || ""}
                                    onChange={(event) =>
                                      setBrandingAssets((prev) =>
                                        prev.map((entry) =>
                                          entry.id === asset.id ? { ...entry, notes: event.target.value } : entry,
                                        ),
                                      )
                                    }
                                    disabled={assetSavingId === asset.id}
                                  />
                                </label>
                                <div className="flex items-center justify-between gap-3">
                                  <label className="label cursor-pointer justify-start gap-3">
                                    <input
                                      type="checkbox"
                                      className="checkbox checkbox-sm"
                                      checked={asset.is_active !== false}
                                      onChange={(event) =>
                                        setBrandingAssets((prev) =>
                                          prev.map((entry) =>
                                            entry.id === asset.id ? { ...entry, is_active: event.target.checked } : entry,
                                          ),
                                        )
                                      }
                                      disabled={assetSavingId === asset.id}
                                    />
                                    <span className="label-text">Active</span>
                                  </label>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    disabled={assetSavingId === asset.id || !asset.name?.trim() || !asset.reference_key?.trim()}
                                    onClick={() => saveBrandingAsset(asset)}
                                  >
                                    {assetSavingId === asset.id ? t("common.saving") : t("common.save")}
                                  </button>
                                </div>
                              </div>
                            </DisclosureSection>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Section>
              </>
            )}
          </div>
        )}

        {activeTab === "regional" && (
          <Section title={t("settings.regional_title")} description={t("settings.regional_description")}>
            {!canEditWorkspaceSettings ? (
              <div className="alert alert-warning text-sm">{t("settings.workspace_admin_only")}</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <label className="form-control">
                    <span className="label-text text-sm">{t("settings.default_language_label")}</span>
                    <AppSelect
                      className="select select-bordered select-sm"
                      value={defaultLocale}
                      onChange={(event) => setDefaultLocale(event.target.value)}
                      aria-label={t("settings.default_language_label")}
                      disabled={regionalSaving}
                    >
                      {availableLocales.map((locale) => (
                        <option key={locale.code} value={locale.code}>
                          {locale.label}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                  <label className="form-control">
                    <span className="label-text text-sm">{t("settings.default_timezone_label")}</span>
                    <AppSelect
                      className="select select-bordered select-sm"
                      value={defaultTimezone}
                      onChange={(event) => setDefaultTimezone(event.target.value)}
                      aria-label={t("settings.default_timezone_label")}
                      disabled={regionalSaving}
                    >
                      {availableTimezones.map((timezone) => (
                        <option key={timezone} value={timezone}>
                          {timezone}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                  <label className="form-control">
                    <span className="label-text text-sm">{t("settings.default_currency_label")}</span>
                    <AppSelect
                      className="select select-bordered select-sm"
                      value={defaultCurrency}
                      onChange={(event) => setDefaultCurrency(event.target.value)}
                      aria-label={t("settings.default_currency_label")}
                      disabled={regionalSaving}
                    >
                      {availableCurrencies.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
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
