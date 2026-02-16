import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../../api.js";
import TemplateStudioShell from "../templates/TemplateStudioShell.jsx";
import { emailTemplateProfile } from "../templates/templateProfiles.jsx";

export default function EmailTemplateStudioPage({ user }) {
  const { id } = useParams();
  const [connections, setConnections] = useState([]);

  const profile = useMemo(() => emailTemplateProfile, []);

  const loadRecord = useCallback(async (recordId) => {
    const res = await apiFetch(`/email/templates/${recordId}`);
    return res?.template;
  }, []);

  const saveRecord = useCallback(async (recordId, patch) => {
    const res = await apiFetch(`/email/templates/${recordId}`, {
      method: "POST",
      body: patch,
    });
    return res?.template;
  }, []);

  const validateRecord = useCallback(async (recordId, payload) => {
    return apiFetch(`/email/templates/${recordId}/validate`, { method: "POST", body: payload || {} });
  }, []);

  const previewRecord = useCallback(async (recordId, payload) => {
    return apiFetch(`/email/templates/${recordId}/preview`, { method: "POST", body: payload });
  }, []);

  const sendTest = useCallback(async (toEmail, sample) => {
    return apiFetch(`/email/templates/${id}/send_test`, {
      method: "POST",
      body: { to_email: toEmail, sample },
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
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <TemplateStudioShell
        title={profile.title}
        recordId={id}
        user={user}
        profile={profile}
        loadRecord={loadRecord}
        saveRecord={saveRecord}
        validate={validateRecord}
        preview={previewRecord}
        extraContext={{ sendTest, connections }}
      />
    </div>
  );
}
