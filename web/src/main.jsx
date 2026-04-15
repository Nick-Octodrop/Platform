import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";
import { applyBrandColors, applyTheme, getBrandColors, getInitialTheme } from "./theme/theme.js";

const ENABLE_DEV_PWA = import.meta.env.VITE_ENABLE_DEV_PWA === "1";
const SHOULD_REGISTER_PWA = !import.meta.env.DEV || ENABLE_DEV_PWA;

if (typeof window !== "undefined") {
  window.__octoPwaEnabled = SHOULD_REGISTER_PWA;
}

applyTheme(getInitialTheme());
applyBrandColors(getBrandColors());

if (typeof document !== "undefined" && typeof navigator !== "undefined") {
  const ua = navigator.userAgent || "";
  const isIosTouch = /iPad|iPhone|iPod/.test(ua);
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.setAttribute(
      "content",
      isIosTouch
        ? "width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1"
        : "width=device-width, initial-scale=1.0, viewport-fit=cover",
    );
  }
  if (isIosTouch) {
    document.documentElement.classList.add("octo-ios-touch");
  }
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  const displayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const navigatorStandalone = typeof window.navigator?.standalone === "boolean" && window.navigator.standalone;
  return Boolean(displayStandalone || navigatorStandalone);
}

function isMobileDevice() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator?.userAgent || "";
  const coarsePointer = Boolean(window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches);
  return Boolean(coarsePointer || /Android|iPhone|iPad|iPod/i.test(ua));
}

function shouldAutoApplyStandaloneUpdate() {
  return false;
}

function dispatchPwaUpdateReady() {
  if (typeof window === "undefined") return;
  window.__octoWebUpdateReady = true;
  window.dispatchEvent(new CustomEvent("octo:web-pwa-update-ready"));
}

const trackedSwRegistrations = new WeakSet();

function wireServiceWorkerRegistration(registration) {
  if (!registration || typeof window === "undefined") return;
  window.__octoWebSwRegistration = registration;
  if (registration.waiting) {
    dispatchPwaUpdateReady();
  }
  if (trackedSwRegistrations.has(registration)) return;
  trackedSwRegistrations.add(registration);

  const watchInstallingWorker = (worker) => {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        dispatchPwaUpdateReady();
      }
    });
  };

  if (registration.installing) {
    watchInstallingWorker(registration.installing);
  }
  registration.addEventListener("updatefound", () => {
    watchInstallingWorker(registration.installing);
  });
}

function isChunkLoadFailure(errorLike) {
  const message = String(
    errorLike?.message ||
    errorLike?.reason?.message ||
    errorLike?.error?.message ||
    errorLike?.reason ||
    errorLike?.error ||
    errorLike ||
    "",
  ).toLowerCase();
  if (!message) return false;
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("chunkloaderror") ||
    message.includes("loading chunk") ||
    message.includes("unable to preload css") ||
    message.includes("_result.default") ||
    message.includes("reading 'default'") ||
    message.includes("reading \"default\"")
  );
}

async function recoverFromStaleBundle(reason = "stale-bundle") {
  if (typeof window === "undefined") return false;
  const attemptKey = "octo:pwa-stale-bundle-recovery-at";
  const now = Date.now();
  const lastAttempt = Number(window.sessionStorage.getItem(attemptKey) || "0");
  if (Number.isFinite(lastAttempt) && now - lastAttempt < 15000) {
    return false;
  }
  window.sessionStorage.setItem(attemptKey, String(now));

  try {
    const applyUpdate = window.__octoWebApplyUpdate;
    if (typeof applyUpdate === "function") {
      await applyUpdate(true);
      return true;
    }
  } catch {
    // fall through to hard recovery
  }

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(async (registration) => {
        try {
          await registration.unregister();
        } catch {
          // ignore individual unregister failures
        }
      }));
    }
  } catch {
    // ignore
  }

  try {
    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
  } catch {
    // ignore
  }

  const url = new URL(window.location.href);
  url.searchParams.set("__octo_reload__", String(now));
  url.searchParams.set("__octo_reason__", reason);
  window.location.replace(url.toString());
  return true;
}

let hasReloadedForNewController = false;
if (SHOULD_REGISTER_PWA && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hasReloadedForNewController) return;
    hasReloadedForNewController = true;
    window.location.reload();
  });
}

let updateSW = null;
if (SHOULD_REGISTER_PWA) {
  updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      window.__octoWebApplyUpdate = updateSW;
      wireServiceWorkerRegistration(registration);
      if (registration?.waiting) {
        dispatchPwaUpdateReady();
        if (shouldAutoApplyStandaloneUpdate()) {
          updateSW(true).catch(() => {
            // keep manual update fallback in the shell if auto-apply fails
          });
        }
      }
    },
    onNeedRefresh() {
      window.__octoWebApplyUpdate = updateSW;
      dispatchPwaUpdateReady();
      if (shouldAutoApplyStandaloneUpdate()) {
        updateSW(true).catch(() => {
          // keep manual update fallback in the shell if auto-apply fails
        });
      }
    },
  });
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => wireServiceWorkerRegistration(registration));
  }).catch(() => {
    // ignore registration lookup failures
  });
} else if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    Promise.all(
      registrations.map((registration) =>
        registration.unregister().catch(() => {
          // ignore unregister failures in dev cleanup
        })
      )
    ).then(() => {
      if (typeof window === "undefined") return;
      const reloadKey = "octo:dev-sw-cleanup-reloaded";
      if (navigator.serviceWorker.controller && !window.sessionStorage.getItem(reloadKey)) {
        window.sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
      }
    }).catch(() => {
      // ignore unregister failures in dev cleanup
    });
  }).catch(() => {
    // ignore registration lookup failures
  });
}

if (typeof window !== "undefined") {
  window.__octoRecoverFromStaleBundle = recoverFromStaleBundle;
  window.addEventListener("vite:preloadError", (event) => {
    event?.preventDefault?.();
    recoverFromStaleBundle("vite-preload-error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (!isChunkLoadFailure(event?.reason)) return;
    event.preventDefault?.();
    recoverFromStaleBundle("dynamic-import-rejection");
  });
  window.addEventListener("error", (event) => {
    if (!isChunkLoadFailure(event)) return;
    event.preventDefault?.();
    recoverFromStaleBundle("window-error-lazy-module");
  });
}

const root = createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
