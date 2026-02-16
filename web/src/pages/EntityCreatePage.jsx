import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { apiFetch, getManifest } from "../api";
import FormViewRenderer from "../ui/FormViewRenderer.jsx";
import { useModuleStore } from "../state/moduleStore.jsx";
import { useToast } from "../components/Toast.jsx";
import { loadEntityIndex } from "../data/entityIndex.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";

export default function EntityCreatePage({ entityId }) {
  const params = useParams();
  const location = useLocation();
  const routeEntity = params.entity;
  const isDataRoute = location.pathname.startsWith("/data/");
  const navigate = useNavigate();
  const { modules } = useModuleStore();
  const { pushToast } = useToast();
  const [manifest, setManifest] = useState(null);
  const [viewForm, setViewForm] = useState(null);
  const [fieldIndex, setFieldIndex] = useState({});
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [error, setError] = useState(null);
  const [indexEntry, setIndexEntry] = useState(null);

  useEffect(() => {
    async function buildIndex() {
      const idx = await loadEntityIndex(modules);
      const entry = routeEntity ? idx.byId?.[routeEntity] : null;
      setIndexEntry(entry || null);
    }
    buildIndex();
  }, [modules, routeEntity]);

  useEffect(() => {
    async function load() {
      if (!(isDataRoute && indexEntry)) return;
      setLoading(true);
      try {
        const moduleId = indexEntry?.moduleId;
        const formViewId = indexEntry?.formViewId;
        const entityFullId = indexEntry?.entityFullId;
        const manifestRes = await getManifest(moduleId);
        setManifest(manifestRes.manifest);
        const compiled = manifestRes.compiled;
        const view = compiled?.viewById?.get(formViewId);
        setViewForm(view || (manifestRes.manifest?.views || []).find((v) => v.id === formViewId));
        const fieldMap = compiled?.fieldByEntity?.get(entityFullId);
        const index = fieldMap ? Object.fromEntries(fieldMap) : {};
        if (!fieldMap) {
          const entity = (manifestRes.manifest?.entities || []).find((e) => e.id === entityFullId);
          for (const f of entity?.fields || []) index[f.id] = f;
        }
        setFieldIndex(index);
        setError(null);
      } catch (err) {
        setError(err.message || "Failed to load form");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [indexEntry, isDataRoute]);

  async function handleSave() {
    if (!(isDataRoute && indexEntry)) return;
    setShowValidation(true);
    setLoading(true);
    try {
      const endpoint = `/records/${routeEntity}`;
      let payload = draft;
      if (payload && typeof payload === "object") {
        payload = { ...payload };
        for (const [fieldId, field] of Object.entries(fieldIndex || {})) {
          if (field?.type === "tags" && typeof payload[fieldId] === "string") {
            payload[fieldId] = payload[fieldId]
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
          }
        }
      }
      const res = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const newId = res.record_id || res.job_id;
      pushToast("success", "Created");
      if (newId) {
        if (isDataRoute && routeEntity) {
          navigate(`/data/${routeEntity}/${newId}`);
        } else {
          navigate(`/data/${routeEntity}/${newId}`);
        }
      } else {
        if (isDataRoute && routeEntity) {
          navigate(`/data/${routeEntity}`);
        } else {
          navigate(`/data/${routeEntity}`);
        }
      }
    } catch (err) {
      setError(err.message || "Create failed");
      pushToast("error", err.message || "Create failed");
    } finally {
      setLoading(false);
    }
  }

  if (isDataRoute && routeEntity && !indexEntry) {
    return <div className="alert alert-error">Entity unavailable or disabled.</div>;
  }

  const displayName = indexEntry?.displayName || routeEntity;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">New {displayName}</h2>
      </div>
      {error && <div className="alert alert-error mb-4">{error}</div>}
      {loading && <LoadingSpinner className="min-h-[20vh]" />}
      {manifest && viewForm && (
        <FormViewRenderer
          view={viewForm}
          entityId={routeEntity}
          recordId={null}
          fieldIndex={fieldIndex}
          record={draft}
          onChange={(next) => setDraft(next)}
          onSave={handleSave}
          readonly={false}
          showValidation={showValidation}
          applyDefaults={true}
        />
      )}
    </div>
  );
}
