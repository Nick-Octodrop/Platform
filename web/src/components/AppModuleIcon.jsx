import React, { useEffect, useState } from "react";
import { normalizeLucideKey, resolveLucideIcon } from "../state/lucideIconCatalog.js";
import { normalizeHeroKey, resolveHeroIcon } from "../state/heroIconCatalog.js";

const resolvedIconCache = new Map();

function classifyIconSource(iconUrl) {
  const raw = typeof iconUrl === "string" ? iconUrl.trim() : "";
  const isImageUrl =
    raw &&
    !raw.includes("lucide:") &&
    !raw.includes("hero:") &&
    (raw.startsWith("data:") || raw.startsWith("http"));

  if (isImageUrl) return { kind: "image" };
  if (raw.includes("hero:")) {
    const heroParsed = normalizeHeroKey(raw);
    return heroParsed ? { kind: "hero", key: raw } : { kind: "fallback" };
  }
  if (!raw) return { kind: "fallback" };
  const lucideKey = normalizeLucideKey(raw);
  if (lucideKey) return { kind: "lucide", key: lucideKey };
  return { kind: "fallback" };
}

function cacheKeyForSource(source) {
  if (!source || !source.key) return "";
  return `${source.kind}:${source.key}`;
}

function initialResolvedState(iconUrl) {
  const source = classifyIconSource(iconUrl);
  if (source.kind === "image") return { kind: "image", Icon: null };
  if (source.kind === "lucide" || source.kind === "hero") {
    const cacheKey = cacheKeyForSource(source);
    if (cacheKey && resolvedIconCache.has(cacheKey)) {
      const Icon = resolvedIconCache.get(cacheKey);
      return Icon ? { kind: source.kind, Icon } : { kind: "fallback", Icon: null };
    }
    return { kind: "loading", Icon: null };
  }
  return { kind: "fallback", Icon: null };
}

export default function AppModuleIcon({
  iconUrl,
  fallback = null,
  size = 44,
  strokeWidth = 1.31,
  iconClassName = "text-primary",
  imageClassName = "",
}) {
  const [resolved, setResolved] = useState(() => initialResolvedState(iconUrl));

  useEffect(() => {
    let active = true;

    async function load() {
      const source = classifyIconSource(iconUrl);
      if (source.kind === "image") {
        if (active) setResolved({ kind: "image", Icon: null });
        return;
      }
      if (source.kind !== "lucide" && source.kind !== "hero") {
        if (active) setResolved({ kind: "fallback", Icon: null });
        return;
      }

      const cacheKey = cacheKeyForSource(source);
      if (cacheKey && resolvedIconCache.has(cacheKey)) {
        const Icon = resolvedIconCache.get(cacheKey);
        if (active) setResolved(Icon ? { kind: source.kind, Icon } : { kind: "fallback", Icon: null });
        return;
      }

      if (active) setResolved({ kind: "loading", Icon: null });
      try {
        const Icon = source.kind === "lucide"
          ? await resolveLucideIcon(source.key)
          : await resolveHeroIcon(source.key);
        if (cacheKey) resolvedIconCache.set(cacheKey, Icon || null);
        if (active) setResolved(Icon ? { kind: source.kind, Icon } : { kind: "fallback", Icon: null });
      } catch {
        if (cacheKey) resolvedIconCache.set(cacheKey, null);
        if (active) setResolved({ kind: "fallback", Icon: null });
      }
    }

    setResolved(initialResolvedState(iconUrl));
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

  if (resolved.kind === "loading") {
    return (
      <div className={iconClassName} aria-hidden="true">
        <div style={{ width: size, height: size }} />
      </div>
    );
  }

  return fallback;
}
