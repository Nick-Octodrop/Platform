import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import AppShell from "../../apps/AppShell.jsx";
import { readStudioPreviewManifest } from "./studioPreviewStore.js";

export default function StudioModulePreviewFramePage() {
  const { moduleId } = useParams();
  const [manifest, setManifest] = useState(() => readStudioPreviewManifest(moduleId));

  useEffect(() => {
    setManifest(readStudioPreviewManifest(moduleId));
  }, [moduleId]);

  useEffect(() => {
    function handleMessage(event) {
      const payload = event?.data;
      if (!payload || payload.type !== "octo:studio-preview-manifest") return;
      if (payload.moduleId !== moduleId) return;
      setManifest(payload.manifest && typeof payload.manifest === "object" ? payload.manifest : null);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [moduleId]);

  if (!manifest) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm opacity-60">
        Preview unavailable for this module.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-base-200">
      <AppShell
        manifestOverride={manifest}
        moduleIdOverride={moduleId}
        previewMode
        previewAllowNav
      />
    </div>
  );
}
