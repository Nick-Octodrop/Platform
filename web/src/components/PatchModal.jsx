import React, { useEffect, useState } from "react";
import { useModuleStore } from "../state/moduleStore.jsx";
import { invalidateManifestCache } from "../api";

export default function PatchModal({ mode, moduleId, onClose, onApplied }) {
  const { actions } = useModuleStore();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      try {
        const res = mode === "upgrade" ? await actions.upgradePreview(moduleId) : await actions.installPreview(moduleId);
        if (mounted) {
          setPreview(res);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err.message || "Preview failed");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, [mode, moduleId, actions]);

  async function handleApply() {
    if (!preview) return;
    setLoading(true);
    try {
      const res = mode === "upgrade" ? await actions.upgradeApply(preview) : await actions.installApply(preview);
      if (res?.warnings?.length) {
        // no-op; caller can surface toast
      }
      invalidateManifestCache(moduleId);
      await actions.refresh({ force: true });
      if (onApplied) onApplied(res);
      onClose();
    } catch (err) {
      setError(err.message || "Apply failed");
    } finally {
      setLoading(false);
    }
  }

  const previewOk = preview?.preview?.ok;
  const diff = preview?.preview?.diff_summary;

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">{mode === "upgrade" ? "Upgrade preview" : "Install preview"}</h3>
        {loading && <div className="mt-2">Loading preview…</div>}
        {error && <div className="alert alert-error mt-2">{error}</div>}
        {preview && (
          <div className="mt-3 space-y-2">
            <div className="text-sm">
              Module: {moduleId} · Preview ok: {String(previewOk)}
            </div>
            <div className="text-xs opacity-70">Current: {preview.current_hash || "none"}</div>
            <div className="text-xs opacity-70">Proposed: {preview.proposed_hash}</div>
            {preview.preview?.warnings?.length > 0 && (
              <div className="alert alert-warning">
                {preview.preview.warnings.map((w, i) => (
                  <div key={i}>{w.code}: {w.message}</div>
                ))}
              </div>
            )}
            {preview.preview?.errors?.length > 0 && (
              <div className="alert alert-error">
                {preview.preview.errors.map((e, i) => (
                  <div key={i}>{e.code}: {e.message}</div>
                ))}
              </div>
            )}
            {diff && (
              <div className="text-xs">
                Diff summary — add: {diff.counts.add}, remove: {diff.counts.remove}, replace: {diff.counts.replace}
              </div>
            )}
          </div>
        )}
        <div className="modal-action">
          <button className="btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleApply} disabled={loading || !previewOk}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
