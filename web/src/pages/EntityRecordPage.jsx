import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, getManifest } from "../api";
import FormViewRenderer from "../ui/FormViewRenderer.jsx";
import { useToast } from "../components/Toast.jsx";
import { loadEntityIndex } from "../data/entityIndex.js";
import { useModuleStore } from "../state/moduleStore.jsx";
import { getDevMode, subscribeDevMode } from "../dev/devMode.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { useAccessContext } from "../access.js";

export default function EntityRecordPage() {
  const { entity, id } = useParams();
  const navigate = useNavigate();
  const { modules } = useModuleStore();
  const { pushToast } = useToast();
  const [index, setIndex] = useState(null);
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState({});
  const [viewForm, setViewForm] = useState(null);
  const [fieldIndex, setFieldIndex] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [manifestError, setManifestError] = useState(null);
  const [showValidation, setShowValidation] = useState(false);
  const [devMode, setDevMode] = useState(getDevMode());
  const [manifestHash, setManifestHash] = useState(null);
  const { hasCapability } = useAccessContext();
  const canWriteRecords = hasCapability("records.write");

  useEffect(() => {
    async function buildIndex() {
      const idx = await loadEntityIndex(modules);
      setIndex(idx);
    }
    buildIndex();
  }, [modules]);

  useEffect(() => {
    const handler = () => setDevMode(getDevMode());
    const unsubscribe = subscribeDevMode(handler);
    return unsubscribe;
  }, []);

  const selected = index?.byId?.[entity] || null;
  const fullEntityId = selected?.entityFullId || null;

  useEffect(() => {
    async function load() {
      if (!entity || !id) return;
      if (!selected) {
        setError("Entity unavailable or disabled");
        return;
      }
      if (!selected.formViewId) {
        setManifestError("NO_FORM_VIEW");
        return;
      }
      setLoading(true);
      try {
        const res = await apiFetch(`/records/${entity}/${id}`);
        setRecord(res.record);
        setDraft(res.record);
        const manifestRes = await getManifest(selected.moduleId);
        setManifestHash(manifestRes.manifest_hash || null);
        const compiled = manifestRes.compiled;
        const view = compiled?.viewById?.get(selected.formViewId);
        const resolvedView = view || (manifestRes.manifest?.views || []).find((v) => v.id === selected.formViewId);
        setViewForm(resolvedView);
        const fieldMap = compiled?.fieldByEntity?.get(selected.entityFullId);
        const indexMap = fieldMap ? Object.fromEntries(fieldMap) : {};
        if (!fieldMap) {
          const entityDef = (manifestRes.manifest?.entities || []).find((e) => e.id === selected.entityFullId);
          for (const f of entityDef?.fields || []) indexMap[f.id] = f;
        }
        setFieldIndex(indexMap);
        setError(null);
        if (!resolvedView) {
          setManifestError("FORM_VIEW_MISSING");
        } else {
          setManifestError(null);
        }
      } catch (err) {
        setError(err.message || "Failed to load record");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [entity, id, selected?.moduleId, selected?.formViewId]);

  async function handleSave() {
    if (!selected) return;
    setShowValidation(true);
    setLoading(true);
    try {
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
      await apiFetch(`/records/${entity}/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      pushToast("success", "Saved");
      navigate(`/data/${entity}/${id}`);
    } catch (err) {
      setError(err.message || "Save failed");
      pushToast("error", err.message || "Save failed");
    } finally {
      setLoading(false);
    }
  }

  if (!entity || !id) {
    return <div className="alert">Select a record.</div>;
  }
  if (!selected) {
    return <div className="alert">Unknown or disabled entity.</div>;
  }
  if (manifestError === "NO_FORM_VIEW") {
    return (
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">No form view defined</h3>
          <div className="text-sm opacity-70">This entity has no form view in its manifest.</div>
          <button className="btn btn-ghost" onClick={() => navigate(`/apps/${selected.moduleId}/details`)}>Open module details</button>
        </div>
      </div>
    );
  }
  if (manifestError === "FORM_VIEW_MISSING") {
    return (
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">Form view not found</h3>
          <div className="text-sm opacity-70">This entity references a form view that is missing.</div>
          <button className="btn btn-ghost" onClick={() => navigate(`/apps/${selected.moduleId}/details`)}>Open module details</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">{selected.displayName}</h2>
        <button className="btn btn-outline" onClick={() => navigate(`/data/${entity}`)}>Back</button>
      </div>
      {devMode && (
        <div className="card bg-base-100 shadow mb-4">
          <div className="card-body">
            <h3 className="card-title">Debug</h3>
            <div className="text-sm opacity-70">Entity ID: {selected.entityId}</div>
            <div className="text-sm opacity-70">Module ID: {selected.moduleId}</div>
            <div className="text-sm opacity-70">Form View ID: {selected.formViewId || "—"}</div>
            <div className="text-sm opacity-70">Manifest Hash: {manifestHash || "—"}</div>
            <div className="text-sm opacity-70">Record ID: {id}</div>
            <div className="flex gap-2 mt-2">
              <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/apps/${selected.moduleId}`)}>Open module</button>
              <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/apps/${selected.moduleId}/details?tab=manifest`)}>Open manifest tab</button>
            </div>
          </div>
        </div>
      )}
      {error && <div className="alert alert-error mb-4">{error}</div>}
      {loading && <LoadingSpinner className="min-h-[20vh]" />}
      {viewForm && (
        <FormViewRenderer
          view={viewForm}
          entityId={selected.entityId}
          recordId={id}
          fieldIndex={fieldIndex}
          record={draft}
          onChange={(next) => setDraft(next)}
          onSave={handleSave}
          readonly={!canWriteRecords}
          showValidation={showValidation}
        />
      )}
    </div>
  );
}
