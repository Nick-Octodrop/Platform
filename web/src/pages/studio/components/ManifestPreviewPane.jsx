import React, { useEffect, useState } from "react";
import AppShell from "../../../apps/AppShell.jsx";

export default function ManifestPreviewPane({ moduleId, manifestText, refreshKey, onRefresh }) {
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!refreshKey) return;
    if (!manifestText?.trim()) {
      setError("No valid draft to preview.");
      setManifest(null);
      return;
    }
    try {
      const parsed = JSON.parse(manifestText);
      setManifest(parsed);
      setError(null);
    } catch (err) {
      setManifest(null);
      setError(err?.message || "Invalid JSON");
    }
  }, [refreshKey, manifestText]);

  if (error) {
    return <div className="alert alert-warning text-sm">{error}</div>;
  }

  if (!manifest) {
    return <div className="text-sm opacity-60">No valid draft to preview.</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-sm">
        <div className="font-semibold">Preview (Draft)</div>
        <button className="btn btn-ghost btn-xs" onClick={onRefresh}>Refresh</button>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <AppShell manifestOverride={manifest} moduleIdOverride={moduleId} previewMode />
      </div>
    </div>
  );
}
