import React, { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../../api.js";
import TemplateStudioShell from "../templates/TemplateStudioShell.jsx";
import { getDocumentTemplateProfile } from "../templates/templateProfiles.jsx";
import useMediaQuery from "../../hooks/useMediaQuery.js";
import { useI18n } from "../../i18n/LocalizationProvider.jsx";

const PREVIEW_CACHE_TTL_MS = 60 * 1000;
const PREVIEW_CACHE_LIMIT = 8;
const previewCache = new Map();

function getPreviewCache(key) {
  const cached = previewCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > PREVIEW_CACHE_TTL_MS) {
    previewCache.delete(key);
    return null;
  }
  previewCache.delete(key);
  previewCache.set(key, cached);
  return cached.value;
}

function setPreviewCache(key, value) {
  if (!key || !value) return;
  previewCache.set(key, { ts: Date.now(), value });
  while (previewCache.size > PREVIEW_CACHE_LIMIT) {
    const oldestKey = previewCache.keys().next().value;
    if (!oldestKey) break;
    previewCache.delete(oldestKey);
  }
}

export default function DocumentTemplateStudioPage({ user }) {
  const { id } = useParams();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { t } = useI18n();
  const [pageTitle, setPageTitle] = useState("");
  const profile = useMemo(() => getDocumentTemplateProfile(t), [t]);

  const loadRecord = useCallback(async (recordId) => {
    const res = await apiFetch(`/documents/templates/${recordId}`);
    const template = res?.template || null;
    setPageTitle(template?.name || "");
    return template;
  }, []);

  const saveRecord = useCallback(async (recordId, patch) => {
    const res = await apiFetch(`/documents/templates/${recordId}`, {
      method: "POST",
      body: patch,
    });
    const template = res?.template || null;
    setPageTitle(template?.name || "");
    return template;
  }, []);

  const validateRecord = useCallback(async (recordId, payload) => {
    return apiFetch(`/docs/templates/${recordId}/validate`, { method: "POST", body: payload || {} });
  }, []);

  const previewRecord = useCallback(async (recordId, payload) => {
    const cacheKey = `${recordId}:${JSON.stringify(payload || {})}`;
    const cached = getPreviewCache(cacheKey);
    if (cached) return cached;
    const res = await apiFetch(`/docs/templates/${recordId}/preview`, {
      method: "POST",
      body: payload,
    });
    setPreviewCache(cacheKey, res);
    return res;
  }, []);

  return (
    <div className={isMobile ? "min-h-full bg-base-100 flex flex-col" : "h-full min-h-0 flex flex-col overflow-hidden"}>
      <TemplateStudioShell
        title={pageTitle || t("settings.document_template")}
        recordId={id}
        user={user}
        profile={profile}
        loadRecord={loadRecord}
        saveRecord={saveRecord}
        validate={validateRecord}
        preview={previewRecord}
        enableAutosave={false}
        desktopContentClass="w-full h-full min-h-0 flex flex-col"
      />
    </div>
  );
}
