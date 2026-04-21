import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../../api.js";
import TemplateStudioShell from "../templates/TemplateStudioShell.jsx";
import { getEmailTemplateProfile } from "../templates/templateProfiles.jsx";
import useMediaQuery from "../../hooks/useMediaQuery.js";
import { useI18n } from "../../i18n/LocalizationProvider.jsx";

export default function EmailTemplateStudioPage({ user }) {
  const { id } = useParams();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { t } = useI18n();
  const [connections, setConnections] = useState([]);
  const [pageTitle, setPageTitle] = useState("");

  const profile = useMemo(() => getEmailTemplateProfile(t), [t]);

  const loadRecord = useCallback(async (recordId) => {
    const res = await apiFetch(`/email/templates/${recordId}`);
    const template = res?.template || null;
    setPageTitle(template?.name || "");
    return template;
  }, []);

  const saveRecord = useCallback(async (recordId, patch) => {
    const res = await apiFetch(`/email/templates/${recordId}`, {
      method: "POST",
      body: patch,
    });
    const template = res?.template || null;
    setPageTitle(template?.name || "");
    return template;
  }, []);

  const validateRecord = useCallback(async (recordId, payload) => {
    return apiFetch(`/email/templates/${recordId}/validate`, { method: "POST", body: payload || {} });
  }, []);

  const previewRecord = useCallback(async (recordId, payload) => {
    return apiFetch(`/email/templates/${recordId}/preview`, { method: "POST", body: payload });
  }, []);

  const sendTest = useCallback(async (toEmail, sample, draft) => {
    return apiFetch(`/email/templates/${id}/send_test`, {
      method: "POST",
      body: { to_email: toEmail, sample, draft },
    });
  }, [id]);

  useEffect(() => {
    let mounted = true;
    async function loadConnections() {
      try {
        const res = await apiFetch("/automations/meta");
        if (!mounted) return;
        setConnections(res?.connections || []);
      } catch {
        if (mounted) setConnections([]);
      }
    }
    loadConnections();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className={isMobile ? "min-h-full bg-base-100 flex flex-col" : "h-full min-h-0 flex flex-col overflow-hidden"}>
      <TemplateStudioShell
        title={pageTitle || t("settings.email_template")}
        recordId={id}
        user={user}
        profile={profile}
        loadRecord={loadRecord}
        saveRecord={saveRecord}
        validate={validateRecord}
        preview={previewRecord}
        enableAutosave={false}
        desktopContentClass="w-full h-full min-h-0 flex flex-col"
        extraContext={{ sendTest, connections }}
      />
    </div>
  );
}
