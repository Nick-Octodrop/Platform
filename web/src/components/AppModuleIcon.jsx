import React, { useEffect, useState } from "react";
import { normalizeLucideKey, resolveLucideIcon } from "../state/lucideIconCatalog.js";
import { normalizeHeroKey, resolveHeroIcon } from "../state/heroIconCatalog.js";

export default function AppModuleIcon({
  iconUrl,
  fallback = null,
  size = 44,
  strokeWidth = 1.31,
  iconClassName = "text-primary",
  imageClassName = "",
}) {
  const [resolved, setResolved] = useState({ kind: "fallback", Icon: null });

  useEffect(() => {
    let active = true;

    async function load() {
      const lucideKey = normalizeLucideKey(iconUrl);
      const heroParsed = normalizeHeroKey(iconUrl);
      const isImageUrl =
        typeof iconUrl === "string" &&
        !lucideKey &&
        !heroParsed &&
        !iconUrl.includes("lucide:") &&
        !iconUrl.includes("hero:") &&
        (iconUrl.startsWith("data:") || iconUrl.startsWith("http"));

      if (isImageUrl) {
        if (active) setResolved({ kind: "image", Icon: null });
        return;
      }
      if (lucideKey) {
        const Icon = await resolveLucideIcon(lucideKey);
        if (active && Icon) setResolved({ kind: "lucide", Icon });
        return;
      }
      if (heroParsed) {
        const Icon = await resolveHeroIcon(iconUrl);
        if (active && Icon) setResolved({ kind: "hero", Icon });
        return;
      }
      if (active) setResolved({ kind: "fallback", Icon: null });
    }

    setResolved({ kind: "fallback", Icon: null });
    load();
    return () => {
      active = false;
    };
  }, [iconUrl]);

  if (resolved.kind === "image" && typeof iconUrl === "string") {
    return <img src={iconUrl} alt="" className={imageClassName} />;
  }

  if (resolved.kind === "lucide" && resolved.Icon) {
    const Icon = resolved.Icon;
    return (
      <div className={iconClassName}>
        <Icon size={size} strokeWidth={strokeWidth} />
      </div>
    );
  }

  if (resolved.kind === "hero" && resolved.Icon) {
    const Icon = resolved.Icon;
    return (
      <div className={iconClassName}>
        <Icon style={{ width: size, height: size }} />
      </div>
    );
  }

  return fallback;
}
