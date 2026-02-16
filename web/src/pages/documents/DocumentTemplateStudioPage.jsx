import React, { useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../../api.js";
import TemplateStudioShell from "../templates/TemplateStudioShell.jsx";
import { documentTemplateProfile } from "../templates/templateProfiles.jsx";

export default function DocumentTemplateStudioPage({ user }) {
  const { id } = useParams();
  const profile = useMemo(() => documentTemplateProfile, []);

  const loadRecord = useCallback(async (recordId) => {
    const res = await apiFetch(`/documents/templates/${recordId}`);
    return res?.template;
  }, []);

  const saveRecord = useCallback(async (recordId, patch) => {
    const res = await apiFetch(`/documents/templates/${recordId}`, {
      method: "POST",
      body: patch,
    });
    return res?.template;
  }, []);

  const validateRecord = useCallback(async (recordId, payload) => {
    return apiFetch(`/docs/templates/${recordId}/validate`, { method: "POST", body: payload || {} });
  }, []);

  const previewRecord = useCallback(async (recordId, payload) => {
    return apiFetch(`/docs/templates/${recordId}/preview`, { method: "POST", body: payload });
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
        enableAutosave={false}
      />
    </div>
  );
}
