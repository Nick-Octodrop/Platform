import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  API_URL,
  apiFetch,
  getActiveWorkspaceId,
  getUiPrefs,
  googlePlaceDetails,
  googlePlacesAutocomplete,
  setActiveWorkspaceId,
  setUiPrefs,
} from "../api";
import { useAccessContext } from "../access.js";
import { useToast } from "../components/Toast.jsx";
import PaginationControls from "../components/PaginationControls.jsx";
import { applyBrandColors, DEFAULT_BRAND_COLORS, setBrandColors } from "../theme/theme.js";
import { getSafeSession } from "../supabase.js";
import TabbedPaneShell from "../ui/TabbedPaneShell.jsx";
import { useI18n } from "../i18n/LocalizationProvider.jsx";
import AppSelect from "../components/AppSelect.jsx";
import ResponsiveDrawer from "../ui/ResponsiveDrawer.jsx";
import useWorkspaceProviderStatus from "../hooks/useWorkspaceProviderStatus.js";
import ProviderSecretModal from "../components/ProviderSecretModal.jsx";

const TAB_IDS = ["workspaces", "business", "branding", "regional"];
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
const BUSINESS_TAB_HIDDEN_FIELD_KEYS = new Set([
  "default_bank_name",
  "default_bank_account_name",
  "default_bank_account_number",
  "default_bank_iban",
  "default_bank_bic",
]);
const BUSINESS_TAB_TEXT_FIELDS = TEMPLATE_BRANDING_TEXT_FIELDS.filter(
  (field) => !BUSINESS_TAB_HIDDEN_FIELD_KEYS.has(field.key),
);
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
const UNIQUE_BRANDING_SLOT_BY_TYPE = {
  icon: { scope: "app", field: "app_icon_asset_id", label: "App Icon" },
  favicon: { scope: "app", field: "favicon_asset_id", label: "Favicon" },
  pwa_icon: { scope: "app", field: "pwa_icon_asset_id", label: "PWA Icon" },
  nav_logo: { scope: "app", field: "nav_logo_asset_id", label: "Nav Logo" },
  header_graphic: { scope: "template", field: "header_graphic_asset_id", label: "Header Graphic" },
  footer_graphic: { scope: "template", field: "footer_graphic_asset_id", label: "Footer Graphic" },
  background_graphic: { scope: "template", field: "default_background_graphic_asset_id", label: "Background Graphic" },
  banner: { scope: "template", field: "default_email_banner_asset_id", label: "Email Banner" },
  watermark: { scope: "template", field: "default_watermark_asset_id", label: "Watermark" },
};
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
  nav_logo_url: "",
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
  id: "",
  name: "",
  reference_key: "",
  type: "logo",
  file_url: "",
  alt_text: "",
  notes: "",
  sort_order: 0,
  is_active: true,
};
const BUSINESS_FIELD_HELP = {
  workspace_name: "Used as the workspace name in the app and as the default brand name in generated content.",
  brand_name: "Shown to customers on documents, PDFs, and emails.",
  legal_name: "Use the registered legal entity name if it differs from the trading name.",
  website: "Used in customer-facing templates and AI-generated communications.",
  address_line_1: "Start typing to search with Google Maps if your workspace has Google Maps connected.",
  tax_number: "Shown in places where templates or documents include tax details.",
  company_registration_number: "Useful for invoices, proposals, and other official documents.",
  default_footer_text: "Added to the footer area of generated documents and emails when templates use it.",
  default_disclaimer_text: "Use for legal, compliance, or operational disclaimers.",
  default_terms_url: "Link to your standard terms so templates and AI can reference the right source.",
  default_bank_account_number: "Used in payment instructions when templates include bank details.",
};
const BRAND_COLOR_FIELD_HELP = {
  primary_color: "Main brand color used in the app, documents, and AI-generated customer-facing output.",
  secondary_color: "Supporting brand color for less prominent surfaces and accents.",
  accent_color: "Highlight color for buttons, badges, and emphasis.",
  text_color: "Default brand text color to keep output readable.",
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

function upsertBrandingAsset(items, asset) {
  const next = (Array.isArray(items) ? items : []).filter((entry) => entry?.id !== asset?.id);
  next.push(asset);
  return sortBrandingAssets(next);
}

function uniqueBrandingSlotForAssetType(assetType) {
  const type = textValue(assetType);
  return UNIQUE_BRANDING_SLOT_BY_TYPE[type] || null;
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
    nav_logo_url: textValue(appBranding?.nav_logo_url || workspace?.nav_logo_url),
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

function Section({ title, description, headerActions = null, children }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          {description ? <div className="mt-1 text-sm opacity-70">{description}</div> : null}
        </div>
        {headerActions ? <div className="shrink-0">{headerActions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function AssetThumbnail({ asset, fallbackUrl = "", emptyLabel = "No asset selected." }) {
  const previewUrl = asset?.file_url || fallbackUrl || "";
  const isImage =
    previewUrl &&
    (String(asset?.mime_type || "").startsWith("image/") ||
      /\.(png|jpe?g|gif|svg|webp)$/i.test(previewUrl));

  return (
    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-box border border-base-300 bg-base-100 p-2">
      {previewUrl && isImage ? (
        <img
          src={previewUrl}
          alt={asset?.alt_text || asset?.name || "Branding asset"}
          className="max-h-full max-w-full object-contain"
        />
      ) : previewUrl ? (
        <a href={previewUrl} target="_blank" rel="noreferrer" className="text-center text-[11px] leading-tight text-primary">
          Open
        </a>
      ) : (
        <div className="text-center text-[11px] opacity-60">{emptyLabel}</div>
      )}
    </div>
  );
}

function BusinessAddressField({ value, disabled, canManageSettings, onChange, onApplyAddress }) {
  const { providers, reload: reloadProviderStatus } = useWorkspaceProviderStatus(["google_maps"]);
  const containerRef = useRef(null);
  const sessionTokenRef = useRef(`gmaps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [search, setSearch] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [lookupError, setLookupError] = useState("");
  const [mapsDrawerOpen, setMapsDrawerOpen] = useState(false);
  const mapsConnected = Boolean(providers?.google_maps?.connected);

  useEffect(() => {
    setSearch(value || "");
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    if (!open || disabled || !mapsConnected) {
      setSuggestions([]);
      setLookupError("");
      setLoading(false);
      return undefined;
    }
    const query = String(search || "").trim();
    if (query.length < 3) {
      setSuggestions([]);
      setLookupError("");
      setLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLookupError("");
      try {
        const res = await googlePlacesAutocomplete(query, sessionTokenRef.current);
        if (!cancelled) setSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
      } catch (err) {
        if (!cancelled) {
          setSuggestions([]);
          setLookupError(err?.message || "Address lookup failed.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [disabled, mapsConnected, open, search]);

  async function handleSelectSuggestion(suggestion) {
    setLoading(true);
    try {
      const res = await googlePlaceDetails(suggestion.place_id, sessionTokenRef.current);
      const address = res?.address || {};
      onApplyAddress?.(address);
      setSearch(address?.line_1 || suggestion?.main_text || suggestion?.description || "");
      setOpen(false);
      sessionTokenRef.current = `gmaps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    } catch (err) {
      setLookupError(err?.message || "Address details lookup failed.");
      onChange?.(suggestion?.description || search);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div ref={containerRef} className="relative">
        <input
          type="text"
          className="input input-bordered input-sm"
          value={search}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const next = event.target.value;
            setSearch(next);
            onChange?.(next);
            if (!open) setOpen(true);
          }}
        />
        {open && !disabled ? (
          <div className="absolute z-30 mt-1 w-full rounded-box border border-base-300 bg-base-100 shadow">
            {mapsConnected ? (
              <ul className="menu menu-compact menu-vertical w-full max-h-72 overflow-y-auto">
                {loading ? <li className="menu-title"><span>Searching addresses...</span></li> : null}
                {!loading && lookupError ? <li className="menu-title text-error"><span>{lookupError}</span></li> : null}
                {!loading && !lookupError && String(search || "").trim().length < 3 ? (
                  <li className="menu-title"><span>Type at least 3 characters</span></li>
                ) : null}
                {!loading && !lookupError && String(search || "").trim().length >= 3 && suggestions.length === 0 ? (
                  <li className="menu-title"><span>No address matches</span></li>
                ) : null}
                {suggestions.map((item) => (
                  <li key={item.place_id}>
                    <button type="button" className="text-left" onClick={() => handleSelectSuggestion(item)}>
                      <div className="flex flex-col items-start">
                        <span>{item.main_text || item.description}</span>
                        {item.secondary_text ? <span className="text-xs opacity-60">{item.secondary_text}</span> : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3">
                {canManageSettings ? (
                  <button type="button" className="btn btn-sm btn-outline w-full justify-start" onClick={() => setMapsDrawerOpen(true)}>
                    Connect Google Maps
                  </button>
                ) : null}
                <div className="pt-2 text-xs opacity-60">
                  {canManageSettings
                    ? "Connect Google Maps to enable address autocomplete."
                    : "Ask a workspace admin to connect Google Maps for address autocomplete."}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <ProviderSecretModal
        open={mapsDrawerOpen}
        providerKey="google_maps"
        canManageSettings={canManageSettings}
        onClose={() => setMapsDrawerOpen(false)}
        onSaved={async () => {
          setMapsDrawerOpen(false);
          await reloadProviderStatus();
          setOpen(true);
        }}
      />
    </>
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
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [assetUploading, setAssetUploading] = useState(false);
  const [assetDeletingId, setAssetDeletingId] = useState("");
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
            { id: "business", label: "Business" },
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
        nav_logo_url: prefsRes?.workspace?.nav_logo_url || "",
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

  async function saveWorkspaceSettings() {
    if (!canEditWorkspaceSettings || !appBranding.workspace_name.trim()) return;
    setSettingsSaving(true);
    try {
      const workspacePayload = {
        default_locale: defaultLocale,
        default_timezone: defaultTimezone,
        default_currency: defaultCurrency,
      };
      const appBrandingPayload = pickValues(appBranding, [
        "workspace_name",
        "app_logo_asset_id",
        "app_icon_asset_id",
        "favicon_asset_id",
        "pwa_icon_asset_id",
        "nav_logo_asset_id",
        "homepage_brand_asset_id",
        "primary_color",
      ]);
      appBrandingPayload.secondary_color = "";
      appBrandingPayload.accent_color = "";
      appBrandingPayload.text_color = "";
      const templateBrandingPayload = pickValues(templateBranding, [
        ...TEMPLATE_BRANDING_TEXT_FIELDS.map((field) => field.key),
        ...TEMPLATE_BRANDING_TEXTAREA_FIELDS.map((field) => field.key),
        ...TEMPLATE_BRANDING_ASSET_FIELDS.map((field) => field.key),
      ]);
      templateBrandingPayload.template_primary_color = appBranding.primary_color;
      templateBrandingPayload.template_secondary_color = "";
      templateBrandingPayload.template_accent_color = "";
      templateBrandingPayload.template_text_color = "";
      const response = await setUiPrefs({
        workspace: workspacePayload,
        app_branding: appBrandingPayload,
        template_branding: templateBrandingPayload,
      });
      const nextAppBranding = normalizeAppBranding(response?.app_branding, response?.workspace);
      const nextTemplateBranding = normalizeTemplateBranding(response?.template_branding, nextAppBranding);
      setAppBranding(nextAppBranding);
      setTemplateBranding(nextTemplateBranding);
      setBrandingAssets(sortBrandingAssets(response?.branding_assets || brandingAssets));
      setWorkspacePrefs((prev) => ({
        ...prev,
        logo_url: response?.workspace?.logo_url || prev.logo_url,
        nav_logo_url: response?.workspace?.nav_logo_url || prev.nav_logo_url,
        colors: response?.workspace?.colors || prev.colors,
      }));
      if (response?.workspace?.colors) {
        setBrandColors(response.workspace.colors);
        applyBrandColors(response.workspace.colors);
      }
      setDefaultLocale(String(response?.workspace?.default_locale || defaultLocale));
      setDefaultTimezone(String(response?.workspace?.default_timezone || defaultTimezone));
      setDefaultCurrency(String(response?.workspace?.default_currency || defaultCurrency));
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          (workspace.workspace_id || workspace.id) === activeWorkspaceId
            ? { ...workspace, workspace_name: nextAppBranding.workspace_name }
            : workspace,
        ),
      );
      await reloadI18n(response);
      pushToast("success", "Workspace settings updated.");
    } catch (err) {
      pushToast("error", err?.message || "Failed to update workspace settings.");
    } finally {
      setSettingsSaving(false);
    }
  }

  function resetAssetUpload(nextType = BRANDING_ASSET_UPLOAD_DEFAULTS.type, asset = null) {
    if (asset) {
      setAssetUpload({
        ...BRANDING_ASSET_UPLOAD_DEFAULTS,
        id: asset.id || "",
        name: textValue(asset.name),
        reference_key: textValue(asset.reference_key),
        type: textValue(asset.type || nextType || BRANDING_ASSET_UPLOAD_DEFAULTS.type),
        file_url: textValue(asset.file_url),
        alt_text: textValue(asset.alt_text),
        notes: textValue(asset.notes),
        sort_order: Number(asset.sort_order || 0),
        is_active: asset.is_active !== false,
      });
    } else {
      setAssetUpload({ ...BRANDING_ASSET_UPLOAD_DEFAULTS, type: nextType });
    }
    setAssetUploadFile(null);
    if (assetFileRef.current) assetFileRef.current.value = "";
  }

  function openAssetDrawer(nextType = BRANDING_ASSET_UPLOAD_DEFAULTS.type, asset = null) {
    resetAssetUpload(nextType, asset);
    setAssetDrawerOpen(true);
  }

  function closeAssetDrawer() {
    if (assetUploading || assetDeletingId) return;
    setAssetDrawerOpen(false);
    resetAssetUpload(BRANDING_ASSET_UPLOAD_DEFAULTS.type);
  }

  async function persistAutoAssignedAsset(savedAsset, previousAsset = null) {
    const nextAssignment = uniqueBrandingSlotForAssetType(savedAsset?.type);
    const previousAssignment = uniqueBrandingSlotForAssetType(previousAsset?.type);
    const appBrandingPatch = {};
    const templateBrandingPatch = {};

    if (
      previousAssignment &&
      previousAsset?.id &&
      (!nextAssignment || nextAssignment.field !== previousAssignment.field || savedAsset?.id !== previousAsset.id)
    ) {
      if (
        previousAssignment.scope === "app" &&
        textValue(appBranding?.[previousAssignment.field]) === textValue(previousAsset.id)
      ) {
        appBrandingPatch[previousAssignment.field] = "";
      }
      if (
        previousAssignment.scope === "template" &&
        textValue(templateBranding?.[previousAssignment.field]) === textValue(previousAsset.id)
      ) {
        templateBrandingPatch[previousAssignment.field] = "";
      }
    }

    if (nextAssignment && savedAsset?.id) {
      if (nextAssignment.scope === "app") appBrandingPatch[nextAssignment.field] = savedAsset.id;
      if (nextAssignment.scope === "template") templateBrandingPatch[nextAssignment.field] = savedAsset.id;
    }

    if (!Object.keys(appBrandingPatch).length && !Object.keys(templateBrandingPatch).length) return null;

    const payload = {};
    if (Object.keys(appBrandingPatch).length) payload.app_branding = appBrandingPatch;
    if (Object.keys(templateBrandingPatch).length) payload.template_branding = templateBrandingPatch;
    const response = await setUiPrefs(payload);

    if (Object.keys(appBrandingPatch).length) {
      setAppBranding((prev) => ({
        ...prev,
        ...appBrandingPatch,
        ...(response?.app_branding && typeof response.app_branding === "object" ? response.app_branding : {}),
      }));
    }
    if (Object.keys(templateBrandingPatch).length) {
      setTemplateBranding((prev) => ({
        ...prev,
        ...templateBrandingPatch,
        ...(response?.template_branding && typeof response.template_branding === "object" ? response.template_branding : {}),
      }));
    }
    setWorkspacePrefs((prev) => ({
      ...prev,
      logo_url: response?.workspace?.logo_url || prev.logo_url,
      nav_logo_url: response?.workspace?.nav_logo_url || response?.app_branding?.nav_logo_url || prev.nav_logo_url,
      colors: response?.workspace?.colors || prev.colors,
      nav_logo_asset_id:
        response?.workspace?.nav_logo_asset_id ||
        response?.app_branding?.nav_logo_asset_id ||
        appBrandingPatch.nav_logo_asset_id ||
        prev.nav_logo_asset_id,
    }));
    if (response?.workspace?.colors) {
      setBrandColors(response.workspace.colors);
      applyBrandColors(response.workspace.colors);
    }
    await reloadI18n(response);
    return nextAssignment?.label || previousAssignment?.label || null;
  }

  async function submitAssetDrawer() {
    if (assetDeletingId) return;
    if (!assetUpload.name.trim() || !assetUpload.reference_key.trim()) return;
    if (!assetUpload.id && !assetUploadFile) return;
    setAssetUploading(true);
    try {
      const previousAsset = assetUpload.id ? assetMap.get(assetUpload.id) || null : null;
      let savedAsset = null;
      if (assetUpload.id) {
        const response = await apiFetch(`/prefs/branding/assets/${encodeURIComponent(assetUpload.id)}`, {
          method: "PATCH",
          body: {
            name: assetUpload.name.trim(),
            reference_key: assetUpload.reference_key.trim(),
            type: assetUpload.type,
            alt_text: textValue(assetUpload.alt_text),
            notes: textValue(assetUpload.notes),
            is_active: assetUpload.is_active !== false,
            sort_order: Number(assetUpload.sort_order || 0),
          },
        });
        if (!response?.asset) throw new Error("Failed to save branding asset.");
        savedAsset = response.asset;
        setBrandingAssets((prev) => upsertBrandingAsset(prev, savedAsset));
      } else {
        const session = await getSafeSession();
        const token = session?.access_token;
        const activeWorkspaceId = getActiveWorkspaceId();
        const form = new FormData();
        form.append("file", assetUploadFile);
        form.append("name", assetUpload.name.trim());
        form.append("reference_key", assetUpload.reference_key.trim());
        form.append("type", assetUpload.type);
        form.append("alt_text", assetUpload.alt_text);
        form.append("notes", assetUpload.notes);
        form.append("sort_order", String(Number(assetUpload.sort_order || 0)));
        form.append("is_active", assetUpload.is_active ? "true" : "false");
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (activeWorkspaceId) headers["X-Workspace-Id"] = activeWorkspaceId;
        const response = await fetch(`${API_URL}/prefs/branding/assets/upload`, {
          method: "POST",
          headers,
          body: form,
        });
        const data = await response.json();
        if (!response.ok || !data?.asset) {
          throw new Error(data?.errors?.[0]?.message || "Failed to upload branding asset.");
        }
        savedAsset = data.asset;
        setBrandingAssets((prev) => upsertBrandingAsset(prev, savedAsset));
      }
      const autoAssignedLabel = savedAsset ? await persistAutoAssignedAsset(savedAsset, previousAsset) : null;
      if (autoAssignedLabel) {
        pushToast("success", `Branding asset saved and applied as the active ${autoAssignedLabel}.`);
      } else {
        pushToast("success", assetUpload.id ? "Branding asset updated." : "Branding asset uploaded.");
      }
      setAssetDrawerOpen(false);
      resetAssetUpload(BRANDING_ASSET_UPLOAD_DEFAULTS.type);
    } catch (err) {
      pushToast("error", err?.message || "Failed to save branding asset.");
    } finally {
      setAssetUploading(false);
    }
  }

  async function deleteBrandingAsset(asset) {
    const assetId = textValue(asset?.id);
    if (!assetId || assetDeletingId || assetUploading || settingsSaving) return;
    const assetName = asset?.name || asset?.reference_key || "this asset";
    if (!window.confirm(`Delete ${assetName}? This removes it from branding slots and deletes the stored file.`)) return;
    setAssetDeletingId(assetId);
    try {
      const response = await apiFetch(`/prefs/branding/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      const nextAssets = sortBrandingAssets(response?.branding_assets || []);
      const nextAppBranding = normalizeAppBranding(response?.app_branding, response?.workspace);
      const nextTemplateBranding = normalizeTemplateBranding(response?.template_branding, nextAppBranding);
      setBrandingAssets(nextAssets);
      setAppBranding(nextAppBranding);
      setTemplateBranding(nextTemplateBranding);
      setWorkspacePrefs((prev) => ({
        ...prev,
        logo_url: response?.workspace?.logo_url || "",
        nav_logo_url: response?.app_branding?.nav_logo_url || response?.workspace?.nav_logo_url || "",
        colors: response?.workspace?.colors || prev.colors,
      }));
      if (response?.workspace?.colors) {
        setBrandColors(response.workspace.colors);
        applyBrandColors(response.workspace.colors);
      }
      if (assetUpload.id === assetId) {
        setAssetDrawerOpen(false);
        resetAssetUpload(BRANDING_ASSET_UPLOAD_DEFAULTS.type);
      }
      await reloadI18n(response);
      pushToast("success", "Branding asset deleted.");
    } catch (err) {
      pushToast("error", err?.message || "Failed to delete branding asset.");
    } finally {
      setAssetDeletingId("");
    }
  }

  const showSettingsActions = canEditWorkspaceSettings && activeTab !== "workspaces";
  const headerActions = showSettingsActions ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={saveWorkspaceSettings}
        disabled={settingsSaving || assetUploading || Boolean(assetDeletingId) || !appBranding.workspace_name.trim()}
      >
        {settingsSaving ? t("common.saving") : t("common.save")}
      </button>
    </div>
  ) : null;
  const mobilePrimaryActions = showSettingsActions
    ? [
        {
          label: settingsSaving ? t("common.saving") : t("common.save"),
          className: "btn btn-primary btn-sm",
          onClick: saveWorkspaceSettings,
          disabled: settingsSaving || assetUploading || Boolean(assetDeletingId) || !appBranding.workspace_name.trim(),
        },
      ]
    : [];

  return (
    <TabbedPaneShell
      tabs={workspaceTabs}
      activeTabId={activeTab}
      onTabChange={goTab}
      rightActions={headerActions}
      mobilePrimaryActions={mobilePrimaryActions}
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

        {activeTab === "business" && (
          <div className="space-y-4">
            {!canEditWorkspaceSettings ? (
              <div className="alert alert-warning text-sm">{t("settings.workspace_admin_only")}</div>
            ) : (
              <>
                <Section
                  title="Business Details"
                  description="Customer-facing details used in templates, PDFs, emails, and generated content."
                >
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {[ 
                      { key: "workspace_name", label: "Workspace Name", source: "app" },
                      ...BUSINESS_TAB_TEXT_FIELDS,
                    ].map((field) => (
                      <label className="form-control" key={field.key}>
                        <span className="label-text text-sm">{field.label}</span>
                        {field.key === "address_line_1" ? (
                          <BusinessAddressField
                            value={templateBranding.address_line_1 || ""}
                            disabled={settingsSaving}
                            canManageSettings={canEditWorkspaceSettings}
                            onChange={(next) => setTemplateBranding((prev) => ({ ...prev, address_line_1: next }))}
                            onApplyAddress={(address) =>
                              setTemplateBranding((prev) => ({
                                ...prev,
                                address_line_1: address?.line_1 || "",
                                address_line_2: address?.line_2 || "",
                                city: address?.city || "",
                                state_region: address?.region || "",
                                postcode: address?.postcode || "",
                                country: address?.country || "",
                              }))
                            }
                          />
                        ) : (
                          <input
                            type={field.type || "text"}
                            className="input input-bordered input-sm"
                            value={field.source === "app" ? appBranding.workspace_name : templateBranding[field.key] || ""}
                            onChange={(event) =>
                              field.source === "app"
                                ? setAppBranding((prev) => ({ ...prev, workspace_name: event.target.value }))
                                : setTemplateBranding((prev) => ({ ...prev, [field.key]: event.target.value }))
                            }
                            disabled={settingsSaving}
                          />
                        )}
                        {BUSINESS_FIELD_HELP[field.key] ? <span className="label-text-alt mt-1 opacity-70">{BUSINESS_FIELD_HELP[field.key]}</span> : null}
                      </label>
                    ))}
                    {TEMPLATE_BRANDING_TEXTAREA_FIELDS.map((field) => (
                      <label className="form-control lg:col-span-2" key={field.key}>
                        <span className="label-text text-sm">{field.label}</span>
                        <textarea
                          className="textarea textarea-bordered textarea-sm min-h-28"
                          value={templateBranding[field.key] || ""}
                          onChange={(event) =>
                            setTemplateBranding((prev) => ({ ...prev, [field.key]: event.target.value }))
                          }
                          disabled={settingsSaving}
                        />
                        {BUSINESS_FIELD_HELP[field.key] ? <span className="label-text-alt mt-1 opacity-70">{BUSINESS_FIELD_HELP[field.key]}</span> : null}
                      </label>
                    ))}
                  </div>
                </Section>

              </>
            )}
          </div>
        )}

        {activeTab === "branding" && (
          <div className="space-y-4">
            {!canEditWorkspaceSettings ? (
              <div className="alert alert-warning text-sm">{t("settings.workspace_admin_only")}</div>
            ) : (
              <>
                <Section
                  title="Business Color"
                  description="One primary brand color used across the app, customer-facing templates, and AI-generated content."
                >
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {APP_BRANDING_COLOR_FIELDS.map((field) => (
                      <label className="form-control" key={field.key}>
                        <span className="label-text text-sm">{field.label}</span>
                        <input
                          type="color"
                          className="h-11 w-full cursor-pointer rounded-box border border-base-300 bg-base-100 p-1"
                          value={appBranding[field.key] || field.fallback}
                          onChange={(event) =>
                            setAppBranding((prev) => ({
                              ...prev,
                              [field.key]: normalizeHexColor(event.target.value, field.fallback),
                            }))
                          }
                          disabled={settingsSaving}
                        />
                        {BRAND_COLOR_FIELD_HELP[field.key] ? <span className="label-text-alt mt-1 opacity-70">{BRAND_COLOR_FIELD_HELP[field.key]}</span> : null}
                      </label>
                    ))}
                  </div>
                </Section>

                <Section
                  title="Assets"
                  description="Manage the uploaded asset library used across workspace branding."
                  headerActions={
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => openAssetDrawer()}
                      disabled={assetUploading || settingsSaving || Boolean(assetDeletingId)}
                    >
                      Upload Asset
                    </button>
                  }
                >
                  <div className="space-y-6">
                    <div className="space-y-3">
                      {assetOptions.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="table table-sm">
                            <thead>
                              <tr>
                                <th>Preview</th>
                                <th>Name</th>
                                <th>Reference Key</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th className="w-36">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {assetOptions.map((asset) => (
                                <tr key={asset.id}>
                                  <td className="w-20">
                                    <AssetThumbnail asset={asset} emptyLabel="No preview" />
                                  </td>
                                  <td className="whitespace-nowrap">{asset.name || "Untitled asset"}</td>
                                  <td className="whitespace-nowrap">{asset.reference_key || "—"}</td>
                                  <td className="whitespace-nowrap">{asset.type || "other"}</td>
                                  <td className="whitespace-nowrap">{asset.is_active === false ? "Inactive" : "Active"}</td>
                                  <td className="whitespace-nowrap">
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs"
                                      onClick={() => openAssetDrawer(asset.type || BRANDING_ASSET_UPLOAD_DEFAULTS.type, asset)}
                                      disabled={assetUploading || Boolean(assetDeletingId)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs text-error"
                                      onClick={() => deleteBrandingAsset(asset)}
                                      disabled={assetUploading || settingsSaving || Boolean(assetDeletingId)}
                                    >
                                      {assetDeletingId === asset.id ? "Deleting..." : "Delete"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Section>

                <ResponsiveDrawer
                  open={assetDrawerOpen}
                  onClose={closeAssetDrawer}
                  title={assetUpload.id ? "Edit Asset" : "Upload Asset"}
                  description={
                    assetUpload.id
                      ? "Update the asset metadata used across workspace branding."
                      : "Upload a reusable asset. Unique asset types are applied automatically when saved."
                  }
                  mobileHeightClass="h-[88dvh] max-h-[88dvh]"
                  zIndexClass="z-[220]"
                >
                  <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="form-control">
                          <span className="label-text text-sm">Type</span>
                          <AppSelect
                            className="select select-bordered select-sm"
                            value={assetUpload.type}
                            onChange={(event) => setAssetUpload((prev) => ({ ...prev, type: event.target.value }))}
                            disabled={assetUploading || Boolean(assetDeletingId)}
                            aria-label="Asset type"
                          >
                            {BRANDING_ASSET_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </AppSelect>
                          <span className="label-text-alt mt-1 opacity-70">
                            Unique asset types such as nav logo, favicon, PWA icon, header graphic, footer graphic, banner, and watermark are applied automatically when saved.
                          </span>
                        </label>
                        {!assetUpload.id ? (
                          <label className="form-control">
                            <span className="label-text text-sm">File</span>
                            <input
                              ref={assetFileRef}
                              type="file"
                              className="file-input file-input-bordered file-input-sm w-full"
                              onChange={(event) => setAssetUploadFile(event.target.files?.[0] || null)}
                              disabled={assetUploading || Boolean(assetDeletingId)}
                            />
                            <span className="label-text-alt mt-1 opacity-70">Upload the original file once, then reuse it anywhere in workspace branding.</span>
                          </label>
                        ) : assetUpload.file_url ? (
                          <label className="form-control">
                            <span className="label-text text-sm">Asset URL</span>
                            <input
                              type="text"
                              className="input input-bordered input-sm"
                              value={assetUpload.file_url}
                              readOnly
                            />
                            <span className="label-text-alt mt-1 opacity-70">
                              Saved automatically from storage.
                              {" "}
                              <a href={assetUpload.file_url} target="_blank" rel="noreferrer" className="link link-primary">
                                Open asset
                              </a>
                            </span>
                          </label>
                        ) : <div />}
                        <label className="form-control">
                          <span className="label-text text-sm">Name</span>
                          <input
                            type="text"
                            className="input input-bordered input-sm"
                            value={assetUpload.name}
                            onChange={(event) => setAssetUpload((prev) => ({ ...prev, name: event.target.value }))}
                            disabled={assetUploading || Boolean(assetDeletingId)}
                          />
                          <span className="label-text-alt mt-1 opacity-70">Clear internal label for admins choosing assets later.</span>
                        </label>
                        <label className="form-control">
                          <span className="label-text text-sm">Reference Key</span>
                          <input
                            type="text"
                            className="input input-bordered input-sm"
                            value={assetUpload.reference_key}
                            onChange={(event) => setAssetUpload((prev) => ({ ...prev, reference_key: event.target.value }))}
                            disabled={assetUploading || Boolean(assetDeletingId)}
                          />
                          <span className="label-text-alt mt-1 opacity-70">Stable identifier templates and AI can reference consistently.</span>
                        </label>
                        <label className="form-control">
                          <span className="label-text text-sm">Alt Text</span>
                          <input
                            type="text"
                            className="input input-bordered input-sm"
                            value={assetUpload.alt_text}
                            onChange={(event) => setAssetUpload((prev) => ({ ...prev, alt_text: event.target.value }))}
                            disabled={assetUploading || Boolean(assetDeletingId)}
                          />
                          <span className="label-text-alt mt-1 opacity-70">Useful for accessibility and descriptive output.</span>
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
                            disabled={assetUploading || Boolean(assetDeletingId)}
                          />
                          <span className="label-text-alt mt-1 opacity-70">Lower numbers appear earlier in filtered asset lists.</span>
                        </label>
                      </div>
                      <label className="form-control">
                        <span className="label-text text-sm">Notes</span>
                        <textarea
                          className="textarea textarea-bordered textarea-sm min-h-24"
                          value={assetUpload.notes}
                          onChange={(event) => setAssetUpload((prev) => ({ ...prev, notes: event.target.value }))}
                          disabled={assetUploading || Boolean(assetDeletingId)}
                        />
                        <span className="label-text-alt mt-1 opacity-70">Use notes to explain where this asset should be used.</span>
                      </label>
                      <label className="label cursor-pointer justify-start gap-3">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={assetUpload.is_active}
                          onChange={(event) => setAssetUpload((prev) => ({ ...prev, is_active: event.target.checked }))}
                          disabled={assetUploading || Boolean(assetDeletingId)}
                        />
                        <span className="label-text">Asset is active</span>
                      </label>

                      <div className="flex items-center justify-end gap-3">
                        {assetUpload.id ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-error"
                            onClick={() => deleteBrandingAsset(assetMap.get(assetUpload.id) || assetUpload)}
                            disabled={assetUploading || settingsSaving || Boolean(assetDeletingId)}
                          >
                            {assetDeletingId === assetUpload.id ? "Deleting..." : "Delete Asset"}
                          </button>
                        ) : null}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={closeAssetDrawer} disabled={assetUploading || Boolean(assetDeletingId)}>
                          {t("common.cancel")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={assetUploading || Boolean(assetDeletingId) || (!assetUpload.id && !assetUploadFile) || !assetUpload.name.trim() || !assetUpload.reference_key.trim()}
                          onClick={submitAssetDrawer}
                        >
                          {assetUploading ? t("common.saving") : assetUpload.id ? "Save Asset" : "Upload Asset"}
                        </button>
                      </div>
                  </div>
                </ResponsiveDrawer>
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
                      disabled={settingsSaving}
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
                      disabled={settingsSaving}
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
                      disabled={settingsSaving}
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
              </div>
            )}
          </Section>
        )}
      </div>
    </TabbedPaneShell>
  );
}
