import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation, useMatch, useParams } from "react-router-dom";
import { ChevronLeft, Menu, X } from "lucide-react";
import UserMenu from "../components/UserMenu.jsx";
import NotificationBell from "../components/NotificationBell.jsx";
import { apiFetch, getManifest, listStudio2Modules } from "../api.js";
import { appendOctoAiFrameParams, buildTargetRoute } from "../apps/appShellUtils.js";
import useMediaQuery from "../hooks/useMediaQuery.js";
import { readStudioPreviewManifest } from "../pages/studio/studioPreviewStore.js";

function isUuidLike(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
}

function findFirstViewTarget(blocks) {
  const items = Array.isArray(blocks) ? blocks : [];
  for (const block of items) {
    if (!block || typeof block !== "object") continue;
    if (block.kind === "view" && typeof block.target === "string" && block.target.startsWith("view:")) {
      return block.target;
    }
    const nested = findFirstViewTarget(block.content);
    if (nested) return nested;
    if (Array.isArray(block.items)) {
      for (const item of block.items) {
        const fromItem = findFirstViewTarget(item?.content);
        if (fromItem) return fromItem;
      }
    }
    if (Array.isArray(block.tabs)) {
      for (const tab of block.tabs) {
        const fromTab = findFirstViewTarget(tab?.content);
        if (fromTab) return fromTab;
      }
    }
  }
  return null;
}

function findFirstRecordBlock(blocks) {
  const items = Array.isArray(blocks) ? blocks : [];
  for (const block of items) {
    if (!block || typeof block !== "object") continue;
    if (block.kind === "record") return block;
    const nested = findFirstRecordBlock(block.content);
    if (nested) return nested;
    if (Array.isArray(block.items)) {
      for (const item of block.items) {
        const fromItem = findFirstRecordBlock(item?.content);
        if (fromItem) return fromItem;
      }
    }
    if (Array.isArray(block.tabs)) {
      for (const tab of block.tabs) {
        const fromTab = findFirstRecordBlock(tab?.content);
        if (fromTab) return fromTab;
      }
    }
  }
  return null;
}

function rankEntityLabelField(fieldId) {
  const id = String(fieldId || "").toLowerCase();
  if (!id) return -1;
  if (id.endsWith(".name")) return 100;
  if (id.endsWith(".title")) return 95;
  if (id.endsWith(".invoice_number") || id.endsWith(".order_number") || id.endsWith(".quote_number") || id.endsWith(".po_number")) return 92;
  if (id.endsWith(".number") || id.endsWith("_number")) return 90;
  if (id.endsWith(".code")) return 85;
  if (id.endsWith(".reference")) return 80;
  if (id.endsWith(".subject")) return 75;
  if (id.endsWith(".summary")) return 70;
  return -1;
}

function buildRecordLabel(record, { preferredFields = [], entity = null, fallback = "Record", recordId = "" } = {}) {
  const safeRecord = record && typeof record === "object" ? record : {};
  const entityFields = Array.isArray(entity?.fields) ? entity.fields : [];
  const rankedEntityFields = entityFields
    .map((field) => ({ id: field?.id, rank: rankEntityLabelField(field?.id) }))
    .filter((field) => field.id && field.rank >= 0)
    .sort((a, b) => b.rank - a.rank)
    .map((field) => field.id);

  const candidates = [
    ...preferredFields,
    ...rankedEntityFields,
    "display_name",
    "full_name",
    "name",
    "title",
    "number",
    "code",
    "reference",
    "subject",
    "summary",
  ];
  const seen = new Set();
  for (const key of candidates) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const raw = safeRecord?.[key];
    const text = String(raw || "").trim();
    if (!text) continue;
    if (text === String(safeRecord?.id || "").trim()) continue;
    if (text === String(recordId || "").trim()) continue;
    if (isUuidLike(text)) continue;
    return text;
  }
  return String(fallback || "Record").trim() || "Record";
}

export default function TopNav({ user, onSignOut, frameMode = false }) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const location = useLocation();
  const { moduleId } = useParams();
  const isAppRoute = !!useMatch("/apps/:moduleId/*");
  const studioPreviewMatch = useMatch("/studio/preview/:moduleId");
  const isStudioPreviewRoute = !!studioPreviewMatch;
  const pageMatch = useMatch("/apps/:moduleId/page/:pageId");
  const viewMatch = useMatch("/apps/:moduleId/view/:viewId");
  const studioMatch = useMatch("/studio/:moduleId");
  const isStudioList = location.pathname === "/studio";
  const isStudioEditor = !!studioMatch;
  const isStudioRoute = !isStudioPreviewRoute && (isStudioList || isStudioEditor);
  const isHome = location.pathname === "/home";
  const isAppsStore = location.pathname === "/apps";
  const isSettingsRoot = location.pathname === "/settings";
  const isSettingsSettings = location.pathname.startsWith("/settings/settings");
  const isSettingsPreferences = location.pathname.startsWith("/settings/preferences");
  const isSettingsPassword = location.pathname.startsWith("/settings/password");
  const isSettingsUsers = location.pathname.startsWith("/settings/users");
  const isSettingsAccessPolicies = location.pathname.startsWith("/settings/access-policies");
  const isSettingsApiCredentials = location.pathname.startsWith("/settings/api-credentials");
  const isSettingsWorkspaces = location.pathname.startsWith("/settings/workspaces");
  const isSettingsSecrets = location.pathname.startsWith("/settings/secrets");
  const isSettingsWebhookSubscriptions = location.pathname.startsWith("/settings/webhook-subscriptions");
  const isDiagnostics = location.pathname.startsWith("/settings/diagnostics");
  const isAudit = location.pathname.startsWith("/audit");
  const isSettingsSecurity = location.pathname.startsWith("/settings/security");
  const isSecurity = location.pathname.startsWith("/security") || isSettingsSecurity;
  const isIntegrations = location.pathname.startsWith("/integrations");
  const isOps = location.pathname.startsWith("/ops");
  const isEmailHome = location.pathname === "/settings/email";
  const isEmailConnections = location.pathname.startsWith("/settings/email/connections");
  const isEmailTemplates = location.pathname.startsWith("/settings/email-templates");
  const isEmailOutbox = location.pathname.startsWith("/settings/email-outbox");
  const isEmailTemplateStudio = location.pathname.startsWith("/email/templates/");
  const isDocsHome = location.pathname === "/settings/documents";
  const isDocsTemplates = location.pathname.startsWith("/settings/documents/templates");
  const isDocTemplateStudio = location.pathname.startsWith("/documents/templates/");
  const isSettingsDocumentNumbering = location.pathname.startsWith("/settings/document-numbering");
  const settingsLeafLabel = isSettingsSettings || isSettingsPreferences
    ? "Profile"
    : isSettingsPassword
      ? "Password"
    : isSettingsUsers
      ? "Users"
    : isSettingsAccessPolicies
        ? "Access Policies"
      : isSettingsApiCredentials
        ? "API Credentials"
      : isSettingsWorkspaces
        ? "Workspaces"
        : isSettingsSecrets
          ? "Secrets"
          : isSettingsWebhookSubscriptions
            ? "Webhook Subscriptions"
          : isDiagnostics
            ? "Diagnostics"
            : isAudit
              ? "Audit"
              : isSecurity
                ? "Security"
              : isEmailHome
                  ? "Email"
                  : isEmailConnections
                    ? "Email Connections"
                      : isEmailTemplates
                        ? "Email Templates"
                        : isEmailOutbox
                          ? "Email Outbox"
                          : isEmailTemplateStudio
                            ? "Email Template"
                            : isDocsHome
                            ? "Documents"
                            : isDocsTemplates
                              ? "Document Templates"
                                : isDocTemplateStudio
                                  ? "Document Template"
                                  : isSettingsDocumentNumbering
                                    ? "Document Numbering"
                                  : "";
  const isSettingsRoute = isSettingsRoot
    || isSettingsSettings
    || isSettingsPreferences
    || isSettingsPassword
    || isSettingsUsers
    || isSettingsAccessPolicies
    || isSettingsApiCredentials
    || isSettingsWorkspaces
    || isSettingsSecrets
    || isSettingsWebhookSubscriptions
    || isDiagnostics
    || isAudit
    || isSecurity
    || isEmailHome
    || isEmailConnections
    || isEmailTemplates
    || isEmailOutbox
    || isEmailTemplateStudio
    || isDocsHome
    || isDocsTemplates
    || isDocTemplateStudio
    || isSettingsDocumentNumbering;
  const isNotifications = location.pathname.startsWith("/notifications");
  const isAutomations = location.pathname.startsWith("/automations");
  const isOctoAi = location.pathname.startsWith("/octo-ai");
  const isAutomationRuns = location.pathname.startsWith("/automation-runs");
  const automationMatch = useMatch("/automations/:automationId");
  const automationRunMatch = useMatch("/automation-runs/:runId");
  const accessPolicyMatch = useMatch("/settings/access-policies/:profileId");
  const apiCredentialMatch = useMatch("/settings/api-credentials/:credentialId");
  const emailConnectionMatch = useMatch("/settings/email/connections/:connectionId");
  const integrationConnectionMatch = useMatch("/integrations/connections/:connectionId");
  const webhookSubscriptionMatch = useMatch("/settings/webhook-subscriptions/:subscriptionId");
  const emailTemplateMatch = useMatch("/email/templates/:templateId");
  const emailOutboxMatch = useMatch("/settings/email-outbox/:outboxId");
  const docTemplateMatch = useMatch("/documents/templates/:templateId");
  const documentNumberingMatch = useMatch("/settings/document-numbering/:sequenceId");
  const automationIdParam = automationMatch?.params?.automationId || "";
  const automationRunIdParam = automationRunMatch?.params?.runId || "";
  const accessPolicyIdParam = accessPolicyMatch?.params?.profileId || "";
  const apiCredentialIdParam = apiCredentialMatch?.params?.credentialId || "";
  const emailConnectionIdParam = emailConnectionMatch?.params?.connectionId || "";
  const integrationConnectionIdParam = integrationConnectionMatch?.params?.connectionId || "";
  const webhookSubscriptionIdParam = webhookSubscriptionMatch?.params?.subscriptionId || "";
  const emailTemplateIdParam = emailTemplateMatch?.params?.templateId || "";
  const emailOutboxIdParam = emailOutboxMatch?.params?.outboxId || "";
  const docTemplateIdParam = docTemplateMatch?.params?.templateId || "";
  const documentNumberingIdParam = documentNumberingMatch?.params?.sequenceId || "";
  const [manifest, setManifest] = useState(() => {
    if (isStudioPreviewRoute && moduleId) {
      return readStudioPreviewManifest(moduleId);
    }
    return null;
  });
  const [studioModules, setStudioModules] = useState([]);
  const [studioLoading, setStudioLoading] = useState(false);
  const [recordCrumbLabel, setRecordCrumbLabel] = useState("");
  const [automationCrumbLabel, setAutomationCrumbLabel] = useState("");
  const [automationRunCrumbLabel, setAutomationRunCrumbLabel] = useState("");
  const [automationCrumbId, setAutomationCrumbId] = useState("");
  const [accessPolicyCrumbLabel, setAccessPolicyCrumbLabel] = useState("");
  const [apiCredentialCrumbLabel, setApiCredentialCrumbLabel] = useState("");
  const [emailConnectionCrumbLabel, setEmailConnectionCrumbLabel] = useState("");
  const [integrationConnectionCrumbLabel, setIntegrationConnectionCrumbLabel] = useState("");
  const [webhookSubscriptionCrumbLabel, setWebhookSubscriptionCrumbLabel] = useState("");
  const [emailTemplateCrumbLabel, setEmailTemplateCrumbLabel] = useState("");
  const [emailOutboxCrumbLabel, setEmailOutboxCrumbLabel] = useState("");
  const [docTemplateCrumbLabel, setDocTemplateCrumbLabel] = useState("");
  const [documentNumberingCrumbLabel, setDocumentNumberingCrumbLabel] = useState("");
  const [mobileAppMenuOpen, setMobileAppMenuOpen] = useState(false);
  const [mobileHomeMenuOpen, setMobileHomeMenuOpen] = useState(false);
  const accountEmail = user?.email || "Account";
  const accountLabel = user?.email ? user.email.split("@")[0] : "Account";

  useLayoutEffect(() => {
    if (isStudioPreviewRoute && moduleId) {
      setManifest(readStudioPreviewManifest(moduleId));
      return;
    }
    setManifest(null);
  }, [moduleId, isAppRoute, isStudioPreviewRoute]);

  useLayoutEffect(() => {
    setRecordCrumbLabel("");
  }, [location.pathname, location.search]);

  useEffect(() => {
    let mounted = true;
    async function loadManifest() {
      if ((!isAppRoute && !isStudioPreviewRoute) || !moduleId) {
        setManifest(null);
        return;
      }
      if (isStudioPreviewRoute) {
        const previewManifest = readStudioPreviewManifest(moduleId);
        if (previewManifest) {
          setManifest(previewManifest);
          return;
        }
      }
      try {
        const res = await getManifest(moduleId);
        if (!mounted) return;
        setManifest(res?.manifest || null);
      } catch {
        if (mounted) setManifest(null);
      }
    }
    loadManifest();
    function handlePreviewMessage(event) {
      if (!isStudioPreviewRoute) return;
      const payload = event?.data;
      if (!payload || payload.type !== "octo:studio-preview-manifest") return;
      if (payload.moduleId !== moduleId) return;
      if (!mounted) return;
      setManifest(payload.manifest && typeof payload.manifest === "object" ? payload.manifest : null);
    }
    if (isStudioPreviewRoute) {
      window.addEventListener("message", handlePreviewMessage);
    }
    return () => {
      mounted = false;
      if (isStudioPreviewRoute) {
        window.removeEventListener("message", handlePreviewMessage);
      }
    };
  }, [isAppRoute, isStudioPreviewRoute, moduleId]);

  useEffect(() => {
    if (!isStudioRoute) return;
    let mounted = true;
    async function loadStudioModules() {
      setStudioLoading(true);
      try {
        const res = await listStudio2Modules();
        if (!mounted) return;
        const payload = res.data || {};
        if (Array.isArray(payload.modules)) {
          setStudioModules(
            payload.modules.map((m) => ({
              module_id: m.module_id,
              name: m.name || m.module_id,
            }))
          );
        } else {
          const installed = payload.installed || [];
          const drafts = payload.drafts || [];
          const draftOnly = drafts.filter((d) => !installed.find((i) => i.module_id === d.module_id));
          const merged = [
            ...installed.map((m) => ({
              module_id: m.module_id,
              name: m.name || m.module_id,
            })),
            ...draftOnly.map((d) => ({
              module_id: d.module_id,
              name: d.name || d.module_id,
            })),
          ];
          setStudioModules(merged);
        }
      } catch {
        if (mounted) setStudioModules([]);
      } finally {
        if (mounted) setStudioLoading(false);
      }
    }
    loadStudioModules();
    return () => {
      mounted = false;
    };
  }, [isStudioRoute]);

  const appName = manifest?.module?.name || moduleId;
  const navGroups = Array.isArray(manifest?.app?.nav) ? manifest.app.nav : [];
  const appHomeTarget = manifest?.app?.home || null;
  const appHomeRoute = appHomeTarget ? buildTargetRoute(moduleId, appHomeTarget) : null;
  const currentPageId = pageMatch?.params?.pageId || "";
  const currentViewId = viewMatch?.params?.viewId || "";
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const currentPageDef = useMemo(() => {
    if (!currentPageId || !Array.isArray(manifest?.pages)) return null;
    return manifest.pages.find((p) => p?.id === currentPageId) || null;
  }, [manifest, currentPageId]);
  const recordBlock = useMemo(
    () => findFirstRecordBlock(currentPageDef?.content),
    [currentPageDef]
  );
  const recordParamKey = recordBlock?.record_id_query || "record";
  const recordIdParam = currentPageId && recordParamKey ? searchParams.get(recordParamKey) : null;
  const isRecordPage = !!(currentPageId && recordParamKey && recordIdParam);
  const recordEntityId = recordBlock?.entity_id || null;
  const recordEntityDef = useMemo(() => {
    if (!recordEntityId || !Array.isArray(manifest?.entities)) return null;
    return manifest.entities.find((entity) => entity?.id === recordEntityId) || null;
  }, [manifest, recordEntityId]);

  const recordTitleField = useMemo(() => {
    return recordEntityDef?.display_field || null;
  }, [recordEntityDef]);

  const recordViewTitleField = useMemo(() => {
    const target = findFirstViewTarget(recordBlock?.content);
    if (!target || !target.startsWith("view:") || !Array.isArray(manifest?.views)) return null;
    const viewId = target.slice(5);
    const view = manifest.views.find((entry) => entry?.id === viewId);
    return view?.header?.title_field || null;
  }, [manifest, recordBlock]);

  useEffect(() => {
    let mounted = true;
    async function loadRecordCrumb() {
      if (!isAppRoute || !isRecordPage || !recordEntityId || !recordIdParam) {
        setRecordCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch(`/records/${encodeURIComponent(recordEntityId)}/${encodeURIComponent(recordIdParam)}`);
        if (!mounted) return;
        const record = res?.record || {};
        const text = buildRecordLabel(record, {
          preferredFields: [recordViewTitleField, recordTitleField],
          entity: recordEntityDef,
          fallback: currentPageDef?.title || "Record",
          recordId: recordIdParam,
        });
        setRecordCrumbLabel(text);
      } catch {
        if (mounted) setRecordCrumbLabel(currentPageDef?.title || "Record");
      }
    }
    loadRecordCrumb();
    return () => {
      mounted = false;
    };
  }, [isAppRoute, isRecordPage, recordEntityId, recordIdParam, recordTitleField, recordViewTitleField, recordEntityDef, currentPageDef?.title]);

  useEffect(() => {
    let mounted = true;
    async function loadAutomationCrumbs() {
      if (automationIdParam) {
        try {
          const res = await apiFetch(`/automations/${automationIdParam}`);
          if (!mounted) return;
          const automation = res?.automation || {};
          const label = String(automation?.name || automationIdParam || "").trim();
          setAutomationCrumbLabel(label || "Automation");
          setAutomationCrumbId(String(automation?.id || automationIdParam || "").trim());
        } catch {
          if (mounted) {
            setAutomationCrumbLabel("Automation");
            setAutomationCrumbId(automationIdParam);
          }
        }
        setAutomationRunCrumbLabel("");
        return;
      }

      if (automationRunIdParam) {
        try {
          const res = await apiFetch(`/automation-runs/${automationRunIdParam}`);
          if (!mounted) return;
          const run = res?.run || {};
          const runLabel = String(run?.id || automationRunIdParam || "").trim();
          setAutomationRunCrumbLabel(runLabel ? `Run ${runLabel.slice(0, 8)}` : "Run");
          const parentAutomationId = String(run?.automation_id || "").trim();
          if (parentAutomationId) {
            setAutomationCrumbId(parentAutomationId);
            try {
              const automationRes = await apiFetch(`/automations/${parentAutomationId}`);
              if (!mounted) return;
              const automation = automationRes?.automation || {};
              const label = String(automation?.name || parentAutomationId || "").trim();
              setAutomationCrumbLabel(label || "Automation");
            } catch {
              if (mounted) setAutomationCrumbLabel("Automation");
            }
          } else {
            setAutomationCrumbLabel("Automation");
            setAutomationCrumbId("");
          }
        } catch {
          if (mounted) {
            setAutomationCrumbLabel("Automation");
            setAutomationRunCrumbLabel("Run");
            setAutomationCrumbId("");
          }
        }
        return;
      }

      setAutomationCrumbLabel("");
      setAutomationRunCrumbLabel("");
      setAutomationCrumbId("");
    }

    loadAutomationCrumbs();
    return () => {
      mounted = false;
    };
  }, [automationIdParam, automationRunIdParam]);

  useEffect(() => {
    let mounted = true;
    async function loadAccessPolicyCrumb() {
      if (!accessPolicyIdParam) {
        setAccessPolicyCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch("/access/profiles");
        if (!mounted) return;
        const profiles = Array.isArray(res?.profiles) ? res.profiles : [];
        const profile = profiles.find((item) => String(item?.id || "") === accessPolicyIdParam);
        setAccessPolicyCrumbLabel(String(profile?.name || accessPolicyIdParam || "").trim() || "Access Profile");
      } catch {
        if (mounted) setAccessPolicyCrumbLabel("Access Profile");
      }
    }
    loadAccessPolicyCrumb();
    return () => {
      mounted = false;
    };
  }, [accessPolicyIdParam]);

  useEffect(() => {
    let mounted = true;
    async function loadApiCredentialCrumb() {
      if (!apiCredentialIdParam) {
        setApiCredentialCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch("/settings/api-credentials");
        if (!mounted) return;
        const items = Array.isArray(res?.api_credentials) ? res.api_credentials : [];
        const item = items.find((entry) => String(entry?.id || "") === apiCredentialIdParam);
        setApiCredentialCrumbLabel(String(item?.name || apiCredentialIdParam || "").trim() || "API Credential");
      } catch {
        if (mounted) setApiCredentialCrumbLabel("API Credential");
      }
    }
    loadApiCredentialCrumb();
    return () => {
      mounted = false;
    };
  }, [apiCredentialIdParam]);

  useEffect(() => {
    let mounted = true;
    async function loadEmailConnectionCrumb() {
      if (!emailConnectionIdParam) {
        setEmailConnectionCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch(`/email/connections/${encodeURIComponent(emailConnectionIdParam)}`);
        if (!mounted) return;
        const connection = res?.connection || {};
        setEmailConnectionCrumbLabel(String(connection?.name || emailConnectionIdParam || "").trim() || "Connection");
      } catch {
        if (mounted) setEmailConnectionCrumbLabel("Connection");
      }
    }
    loadEmailConnectionCrumb();
    return () => {
      mounted = false;
    };
  }, [emailConnectionIdParam]);

  useEffect(() => {
    let mounted = true;
    async function loadIntegrationConnectionCrumb() {
      if (!integrationConnectionIdParam) {
        setIntegrationConnectionCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch(`/integrations/connections/${encodeURIComponent(integrationConnectionIdParam)}`);
        if (!mounted) return;
        const connection = res?.connection || {};
        setIntegrationConnectionCrumbLabel(String(connection?.name || integrationConnectionIdParam || "").trim() || "Connection");
      } catch {
        if (mounted) setIntegrationConnectionCrumbLabel("Connection");
      }
    }
    loadIntegrationConnectionCrumb();
    return () => {
      mounted = false;
    };
  }, [integrationConnectionIdParam]);

  useEffect(() => {
    let mounted = true;
    async function loadWebhookSubscriptionCrumb() {
      if (!webhookSubscriptionIdParam) {
        setWebhookSubscriptionCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch("/settings/webhook-subscriptions");
        if (!mounted) return;
        const items = Array.isArray(res?.subscriptions) ? res.subscriptions : [];
        const item = items.find((entry) => String(entry?.id || "") === webhookSubscriptionIdParam);
        setWebhookSubscriptionCrumbLabel(String(item?.name || webhookSubscriptionIdParam || "").trim() || "Webhook Subscription");
      } catch {
        if (mounted) setWebhookSubscriptionCrumbLabel("Webhook Subscription");
      }
    }
    loadWebhookSubscriptionCrumb();
    return () => {
      mounted = false;
    };
  }, [webhookSubscriptionIdParam]);

  useEffect(() => {
    let mounted = true;
    async function loadEmailTemplateCrumb() {
      if (!emailTemplateIdParam) {
        setEmailTemplateCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch(`/email/templates/${encodeURIComponent(emailTemplateIdParam)}`);
        if (!mounted) return;
        const template = res?.template || {};
        setEmailTemplateCrumbLabel(String(template?.name || emailTemplateIdParam || "").trim() || "Email Template");
      } catch {
        if (mounted) setEmailTemplateCrumbLabel("Email Template");
      }
    }
    loadEmailTemplateCrumb();
    return () => {
      mounted = false;
    };
  }, [emailTemplateIdParam]);

  useEffect(() => {
    let mounted = true;
    async function loadEmailOutboxCrumb() {
      if (!emailOutboxIdParam) {
        setEmailOutboxCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch(`/email/outbox/${encodeURIComponent(emailOutboxIdParam)}`);
        if (!mounted) return;
        const outbox = res?.outbox || {};
        setEmailOutboxCrumbLabel(String(outbox?.subject || emailOutboxIdParam || "").trim() || "Email");
      } catch {
        if (mounted) setEmailOutboxCrumbLabel("Email");
      }
    }
    loadEmailOutboxCrumb();
    return () => {
      mounted = false;
    };
  }, [emailOutboxIdParam]);

  useEffect(() => {
    let mounted = true;
    async function loadDocTemplateCrumb() {
      if (!docTemplateIdParam) {
        setDocTemplateCrumbLabel("");
        return;
      }
      try {
        const res = await apiFetch(`/documents/templates/${encodeURIComponent(docTemplateIdParam)}`);
        if (!mounted) return;
        const template = res?.template || {};
        setDocTemplateCrumbLabel(String(template?.name || docTemplateIdParam || "").trim() || "Document Template");
      } catch {
        if (mounted) setDocTemplateCrumbLabel("Document Template");
      }
    }
    loadDocTemplateCrumb();
    return () => {
      mounted = false;
    };
  }, [docTemplateIdParam]);

  useEffect(() => {
    let mounted = true;
    async function loadDocumentNumberingCrumb() {
      if (!documentNumberingIdParam || documentNumberingIdParam === "new") {
        setDocumentNumberingCrumbLabel(documentNumberingIdParam === "new" ? "New Sequence" : "");
        return;
      }
      try {
        const res = await apiFetch("/settings/document-numbering");
        if (!mounted) return;
        const sequences = Array.isArray(res?.sequences) ? res.sequences : [];
        const sequence = sequences.find((item) => String(item?.id || "") === documentNumberingIdParam);
        setDocumentNumberingCrumbLabel(String(sequence?.name || documentNumberingIdParam || "").trim() || "Sequence");
      } catch {
        if (mounted) setDocumentNumberingCrumbLabel("Sequence");
      }
    }
    loadDocumentNumberingCrumb();
    return () => {
      mounted = false;
    };
  }, [documentNumberingIdParam]);

  const currentPath = location.pathname;
  const previewTarget = isStudioPreviewRoute ? searchParams.get("preview_target") || appHomeTarget || "" : "";
  const buildPreviewRoute = (target) => {
    if (!moduleId) return "#";
    const params = new URLSearchParams(location.search || "");
    params.set("octo_ai_frame", "1");
    if (target) params.set("preview_target", target);
    else params.delete("preview_target");
    const suffix = params.toString();
    return `/studio/preview/${moduleId}${suffix ? `?${suffix}` : ""}`;
  };
  const navItems = useMemo(() => {
    if (!moduleId) return [];
    const items = [];
    for (const group of navGroups) {
      if (!group || !Array.isArray(group.items)) continue;
      const groupLabel = group.group || "Navigation";
      const groupItems = group.items.filter((i) => i && i.label && i.to);
      items.push({
        groupLabel,
        items: groupItems,
        mode: group.mode,
        inline: group.inline,
        asLink: group.as_link,
      });
    }
    return items;
  }, [navGroups, moduleId]);

  const studioModuleId = studioMatch?.params?.moduleId || "";
  const studioModuleName = studioModules.find((m) => m.module_id === studioModuleId)?.name
    || (studioLoading ? "Loading…" : studioModuleId);
  const breadcrumbClass = "breadcrumbs text-xs sm:text-sm pl-1 sm:pl-2 overflow-x-auto no-scrollbar max-w-full";
  const currentRoute = `${location.pathname}${location.search}${location.hash}`;
  const CrumbLink = ({ to, children }) => (
    to ? <Link to={to}>{children}</Link> : <span>{children}</span>
  );
  const mobileAppBreadcrumb = useMemo(() => {
    if (!isAppRoute) return "";
    const appLabel = String(appName || moduleId || "App").trim();
    const leafLabel = String(
      isRecordPage
        ? (recordCrumbLabel || currentPageDef?.title || "Record")
        : (currentPageDef?.title || appLabel || "App")
    ).trim();
    if (!leafLabel || leafLabel === appLabel) return appLabel;
    return `${appLabel} / ${leafLabel}`;
  }, [appName, currentPageDef?.title, isAppRoute, isRecordPage, moduleId, recordCrumbLabel]);
  const mobileTitle = useMemo(() => {
    if (isAppRoute) {
      return mobileAppBreadcrumb || appName || moduleId || "App";
    }
    if (isStudioRoute) return isStudioEditor ? studioModuleName : "Studio";
    if (isSettingsRoute) return settingsLeafLabel || "Settings";
    if (isAppsStore) return "Apps";
    if (isNotifications) return "Notifications";
    if (isAutomations) return "Automations";
    if (isAutomationRuns) return automationRunCrumbLabel || "Run";
    if (isOctoAi) return "Octo AI";
    if (isIntegrations) return integrationConnectionIdParam ? (integrationConnectionCrumbLabel || "Connection") : "Integrations";
    if (isOps) return "Ops";
    return "Octodrop";
  }, [
    appName,
    currentPageDef?.title,
    isAppRoute,
    isAppsStore,
    isAutomationRuns,
    isAutomations,
    automationRunCrumbLabel,
    isIntegrations,
    integrationConnectionCrumbLabel,
    integrationConnectionIdParam,
    isNotifications,
    isOctoAi,
    isOps,
    isRecordPage,
    isSettingsRoute,
    isStudioEditor,
    isStudioRoute,
    mobileAppBreadcrumb,
    moduleId,
    recordCrumbLabel,
    settingsLeafLabel,
    studioModuleName,
  ]);
  const mobileSubtitle = useMemo(() => {
    if (isAppRoute) return "";
    return "";
  }, [isAppRoute]);
  const mobileBackTarget = useMemo(() => {
    if (isAppRoute) {
      return appendOctoAiFrameParams("/home");
    }
    if (isStudioRoute) {
      return appendOctoAiFrameParams(isStudioEditor ? "/studio" : "/home");
    }
    if (isSettingsRoute || isNotifications || isAutomations || isOctoAi || isIntegrations || isOps || isAppsStore) {
      return appendOctoAiFrameParams("/home");
    }
    return null;
  }, [
    isAppRoute,
    isAppsStore,
    isAutomations,
    isIntegrations,
    isNotifications,
    isOctoAi,
    isOps,
    isSettingsRoute,
    isStudioEditor,
    isStudioRoute,
  ]);

  useEffect(() => {
    setMobileAppMenuOpen(false);
    setMobileHomeMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mobileAppMenuOpen && !mobileHomeMenuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileAppMenuOpen, mobileHomeMenuOpen]);

  const hideLeftChrome = frameMode && (isAppRoute || isStudioPreviewRoute);
  const hideRightChrome = frameMode;
  const leftChromeContent = isStudioRoute ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{mobileTitle}</div>
          {mobileSubtitle ? <div className="text-[11px] opacity-60 truncate">{mobileSubtitle}</div> : null}
        </div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li><CrumbLink to={appendOctoAiFrameParams("/studio")}>Studio</CrumbLink></li>
          {isStudioEditor && !isMobile && <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{studioModuleName}</CrumbLink></li>}
        </ul>
      </div>
    )
  ) : isAppRoute ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {navItems.length > 0 ? (
          <button
            className="btn btn-ghost btn-sm btn-square shrink-0"
            type="button"
            aria-label="App navigation"
            onClick={() => setMobileAppMenuOpen((open) => !open)}
          >
            <Menu className="w-4 h-4" />
          </button>
        ) : null}
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square shrink-0" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{mobileTitle}</div>
          {mobileSubtitle ? <div className="text-[11px] opacity-60 truncate">{mobileSubtitle}</div> : null}
        </div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li>
            <CrumbLink to={appHomeRoute || appendOctoAiFrameParams(currentRoute)}>{appName || moduleId}</CrumbLink>
          </li>
          {isRecordPage && !isMobile && <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{recordCrumbLabel || currentPageDef?.title || "Record"}</CrumbLink></li>}
        </ul>
      </div>
    )
  ) : isAppsStore ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="text-sm font-semibold truncate">{mobileTitle}</div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li><CrumbLink to={appendOctoAiFrameParams("/apps")}>Apps</CrumbLink></li>
        </ul>
      </div>
    )
  ) : isSettingsRoute ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="text-sm font-semibold truncate">{mobileTitle}</div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li><CrumbLink to={appendOctoAiFrameParams("/settings")}>Settings</CrumbLink></li>
          {settingsLeafLabel && (
            <li>
              <CrumbLink
                to={
                  isSettingsAccessPolicies && accessPolicyIdParam
                    ? appendOctoAiFrameParams("/settings/access-policies")
                    : location.pathname.startsWith("/settings/api-credentials") && apiCredentialIdParam
                      ? appendOctoAiFrameParams("/settings/api-credentials")
                    : isEmailConnections && emailConnectionIdParam
                      ? appendOctoAiFrameParams("/settings/email/connections")
                    : location.pathname.startsWith("/settings/webhook-subscriptions") && webhookSubscriptionIdParam
                      ? appendOctoAiFrameParams("/settings/webhook-subscriptions")
                    : isEmailTemplateStudio && emailTemplateIdParam
                      ? appendOctoAiFrameParams("/settings/email-templates")
                    : isEmailOutbox && emailOutboxIdParam
                      ? appendOctoAiFrameParams("/settings/email-outbox")
                    : isDocTemplateStudio && docTemplateIdParam
                      ? appendOctoAiFrameParams("/settings/documents/templates")
                    : appendOctoAiFrameParams(currentRoute)
                }
              >
                {settingsLeafLabel}
              </CrumbLink>
            </li>
          )}
          {isSettingsAccessPolicies && accessPolicyIdParam ? <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{accessPolicyCrumbLabel || "Access Profile"}</CrumbLink></li> : null}
          {location.pathname.startsWith("/settings/api-credentials") && apiCredentialIdParam ? <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{apiCredentialCrumbLabel || "API Credential"}</CrumbLink></li> : null}
          {isEmailConnections && emailConnectionIdParam ? <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{emailConnectionCrumbLabel || "Connection"}</CrumbLink></li> : null}
          {location.pathname.startsWith("/settings/webhook-subscriptions") && webhookSubscriptionIdParam ? <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{webhookSubscriptionCrumbLabel || "Webhook Subscription"}</CrumbLink></li> : null}
          {isEmailTemplateStudio && emailTemplateIdParam ? <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{emailTemplateCrumbLabel || "Email Template"}</CrumbLink></li> : null}
          {isEmailOutbox && emailOutboxIdParam ? <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{emailOutboxCrumbLabel || "Email"}</CrumbLink></li> : null}
          {isDocTemplateStudio && docTemplateIdParam ? <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{docTemplateCrumbLabel || "Document Template"}</CrumbLink></li> : null}
          {isSettingsDocumentNumbering && documentNumberingIdParam ? <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{documentNumberingCrumbLabel || "Sequence"}</CrumbLink></li> : null}
        </ul>
      </div>
    )
  ) : isNotifications ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="text-sm font-semibold truncate">{mobileTitle}</div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li><CrumbLink to={appendOctoAiFrameParams("/notifications")}>Notifications</CrumbLink></li>
        </ul>
      </div>
    )
  ) : isAutomations ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="text-sm font-semibold truncate">{mobileTitle}</div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li><CrumbLink to={appendOctoAiFrameParams("/automations")}>Automations</CrumbLink></li>
          {automationIdParam ? <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{automationCrumbLabel || "Automation"}</CrumbLink></li> : null}
        </ul>
      </div>
    )
  ) : isOctoAi ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="text-sm font-semibold truncate">{mobileTitle}</div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li><CrumbLink to={appendOctoAiFrameParams("/octo-ai")}>Octo AI</CrumbLink></li>
        </ul>
      </div>
    )
  ) : isIntegrations ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="text-sm font-semibold truncate">{mobileTitle}</div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li><CrumbLink to={appendOctoAiFrameParams("/integrations")}>Integrations</CrumbLink></li>
          {integrationConnectionIdParam ? (
            <li>
              <CrumbLink to={appendOctoAiFrameParams(currentRoute)}>
                {integrationConnectionCrumbLabel || "Connection"}
              </CrumbLink>
            </li>
          ) : null}
        </ul>
      </div>
    )
  ) : isAutomationRuns ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="text-sm font-semibold truncate">{mobileTitle}</div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li><CrumbLink to={appendOctoAiFrameParams("/automations")}>Automations</CrumbLink></li>
          <li>
            <CrumbLink to={automationCrumbId ? appendOctoAiFrameParams(`/automations/${automationCrumbId}`) : appendOctoAiFrameParams(currentRoute)}>
              {automationCrumbLabel || "Automation"}
            </CrumbLink>
          </li>
          <li><CrumbLink to={appendOctoAiFrameParams(currentRoute)}>{automationRunCrumbLabel || "Run"}</CrumbLink></li>
        </ul>
      </div>
    )
  ) : isOps ? (
    isMobile ? (
      <div className="min-w-0 flex items-center gap-2">
        {mobileBackTarget ? (
          <Link to={mobileBackTarget} className="btn btn-ghost btn-sm btn-square" aria-label="Back">
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : null}
        <div className="text-sm font-semibold truncate">{mobileTitle}</div>
      </div>
    ) : (
      <div className={breadcrumbClass}>
        <ul>
          <li><CrumbLink to={appendOctoAiFrameParams("/home")}>Home</CrumbLink></li>
          <li><CrumbLink to={appendOctoAiFrameParams("/ops")}>Ops</CrumbLink></li>
        </ul>
      </div>
    )
  ) : isHome && isMobile ? (
    <div className="min-w-0 flex items-center gap-2">
      <button
        className="btn btn-ghost btn-sm btn-square shrink-0"
        type="button"
        aria-label="Open menu"
        onClick={() => setMobileHomeMenuOpen(true)}
      >
        <Menu className="w-4 h-4" />
      </button>
      <div className="text-sm font-semibold truncate">{mobileTitle}</div>
    </div>
  ) : (
    !isHome && (
      <Link to={appendOctoAiFrameParams("/home")} className="btn btn-ghost btn-sm">← Home</Link>
    )
  );

  return (
    <div className="bg-base-100 shadow overflow-visible relative z-40">
      <div className="navbar px-2 sm:px-4">
        <div className="flex-1 min-w-0 gap-2">
          {hideLeftChrome ? <div className="h-8" aria-hidden="true" /> : leftChromeContent}
        </div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:flex items-center justify-center z-[1] max-w-[50vw] pointer-events-none">
        {isStudioRoute && (
          <div className="text-sm font-medium text-primary pointer-events-auto truncate">
            {isStudioEditor ? studioModuleName : "Studio"}
          </div>
        )}
        {(isAppRoute || isStudioPreviewRoute) && navItems.length > 0 && (
          <div className="flex items-center gap-4 pointer-events-auto">
            {navItems.map((group) => {
              const items = group.items || [];
              const mode = String(group.mode || "").toLowerCase();
              const renderInline = group.inline === true || mode === "inline";
              const explicitLink = group.asLink === true || mode === "link";
              if (renderInline) {
                return (
                  <div className="flex items-center gap-6" key={`${group.groupLabel}-inline`}>
                    {items.map((item) => {
                      const target = isStudioPreviewRoute ? buildPreviewRoute(item.to) : buildTargetRoute(moduleId, item.to);
                      const active = isStudioPreviewRoute
                        ? previewTarget === item.to
                        : (target && currentPath.startsWith(target));
                      return (
                        <Link
                          key={`${group.groupLabel}-${item.label}`}
                          to={target || "#"}
                          className={`text-sm font-medium whitespace-nowrap px-1 ${active ? "text-primary" : "opacity-80"}`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                );
              }
              const single = items.length === 1 || (explicitLink && items.length > 0);
              if (single) {
                const target = isStudioPreviewRoute ? buildPreviewRoute(items[0].to) : buildTargetRoute(moduleId, items[0].to);
                const active = isStudioPreviewRoute
                  ? previewTarget === items[0].to
                  : (target && currentPath.startsWith(target));
                return (
                  <Link
                    key={`${group.groupLabel}-single`}
                    to={target || "#"}
                    className={`text-sm font-medium ${active ? "text-primary" : "opacity-80"}`}
                  >
                    {group.groupLabel || items[0]?.label}
                  </Link>
                );
              }
              return (
                <div className="dropdown dropdown-hover" key={group.groupLabel}>
                  <label tabIndex={0} className="text-sm font-medium cursor-pointer">
                    {group.groupLabel}
                  </label>
                  <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-56 z-50">
                    {items.map((item) => {
                      const target = isStudioPreviewRoute ? buildPreviewRoute(item.to) : buildTargetRoute(moduleId, item.to);
                      const active = isStudioPreviewRoute
                        ? previewTarget === item.to
                        : (target && currentPath.startsWith(target));
                      return (
                        <li key={item.label}>
                          <Link to={target || "#"} className={active ? "text-primary" : ""}>
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!hideRightChrome && (
        <div className="flex-none flex items-center gap-1 sm:gap-2 ml-2">
          <NotificationBell />
          {!isMobile ? <UserMenu user={user} onSignOut={onSignOut} /> : null}
        </div>
      )}
    </div>
      {isMobile && (isAppRoute || isStudioPreviewRoute) && mobileAppMenuOpen && navItems.length > 0 && (
        <div className="fixed inset-0 z-[120]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/30"
            aria-label="Close navigation"
            onClick={() => setMobileAppMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[82vw] max-w-sm bg-base-100 shadow-2xl border-r border-base-300 flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-base-200">
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  to={appendOctoAiFrameParams("/home")}
                  className="btn btn-sm btn-primary shrink-0"
                  onClick={() => setMobileAppMenuOpen(false)}
                >
                  All Apps
                </Link>
                <div className="min-w-0 text-sm font-semibold truncate">{appName || moduleId}</div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square shrink-0"
                aria-label="Close navigation"
                onClick={() => setMobileAppMenuOpen(false)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
              {navItems.map((group) => (
                <div key={`mobile-group-${group.groupLabel}`} className="space-y-2">
                  <div className="text-sm font-semibold">{group.groupLabel}</div>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const target = isStudioPreviewRoute ? buildPreviewRoute(item.to) : buildTargetRoute(moduleId, item.to);
                      const active = isStudioPreviewRoute
                        ? previewTarget === item.to
                        : (target && currentPath.startsWith(target));
                      return (
                        <Link
                          key={`mobile-${group.groupLabel}-${item.label}`}
                          to={target || "#"}
                          onClick={() => setMobileAppMenuOpen(false)}
                          className={`block rounded-lg px-3 py-2 text-sm ${active ? "bg-base-200 text-primary font-medium" : "text-base-content/80"}`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-base-200 px-4 py-4 space-y-3">
              <div className="px-1">
                <div className="text-sm font-semibold truncate">{accountLabel}</div>
                <div className="text-xs opacity-60 truncate">{accountEmail}</div>
              </div>
              <div className="space-y-1">
                <Link
                  to={appendOctoAiFrameParams("/settings")}
                  onClick={() => setMobileAppMenuOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-base-content/80"
                >
                  Settings
                </Link>
                <button
                  type="button"
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-base-content/80"
                  onClick={() => {
                    setMobileAppMenuOpen(false);
                    onSignOut?.();
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
      {isMobile && isHome && mobileHomeMenuOpen && (
        <div className="fixed inset-0 z-[120]">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/30"
            aria-label="Close menu"
            onClick={() => setMobileHomeMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[82vw] max-w-sm bg-base-100 shadow-2xl border-r border-base-300 flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-base-200">
              <div className="text-sm font-semibold">Menu</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square shrink-0"
                aria-label="Close menu"
                onClick={() => setMobileHomeMenuOpen(false)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
              <div />
            </div>
            <div className="border-t border-base-200 px-4 py-4 space-y-3">
              <div className="px-1">
                <div className="text-sm font-semibold truncate">{accountLabel}</div>
                <div className="text-xs opacity-60 truncate">{accountEmail}</div>
              </div>
              <div className="space-y-1">
                <Link
                  to={appendOctoAiFrameParams("/settings")}
                  onClick={() => setMobileHomeMenuOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-base-content/80"
                >
                  Settings
                </Link>
                <button
                  type="button"
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-base-content/80"
                  onClick={() => {
                    setMobileHomeMenuOpen(false);
                    onSignOut?.();
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
