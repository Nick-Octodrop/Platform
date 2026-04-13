import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";
import { applyBrandColors, applyTheme, getBrandColors, getInitialTheme } from "./theme/theme.js";

applyTheme(getInitialTheme());
applyBrandColors(getBrandColors());

if (typeof document !== "undefined" && typeof navigator !== "undefined") {
  const ua = navigator.userAgent || "";
  const isIosTouch = /iPad|iPhone|iPod/.test(ua);
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

function dispatchPwaUpdateReady() {
  if (typeof window === "undefined") return;
  window.__octoWebUpdateReady = true;
  window.dispatchEvent(new CustomEvent("octo:web-pwa-update-ready"));
}

function isChunkLoadFailure(errorLike) {
  const message = String(
    errorLike?.message ||
    errorLike?.reason?.message ||
    errorLike?.reason ||
    errorLike ||
    "",
  ).toLowerCase();
  if (!message) return false;
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("chunkloaderror") ||
    message.includes("loading chunk") ||
    message.includes("unable to preload css")
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

function installServiceWorkerUpdatePolling(registration) {
  if (!registration || typeof window === "undefined" || typeof document === "undefined") return;

  const checkForUpdate = () => {
    registration.update().catch(() => {
      // ignore transient SW update failures
    });
  };

  window.__octoWebSwRegistration = registration;
  window.addEventListener("focus", checkForUpdate);
  window.addEventListener("online", checkForUpdate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdate();
    }
  });
  window.setInterval(checkForUpdate, 60 * 1000);
}

let hasReloadedForNewController = false;
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hasReloadedForNewController) return;
    hasReloadedForNewController = true;
    window.location.reload();
  });
}

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    window.__octoWebApplyUpdate = updateSW;
    installServiceWorkerUpdatePolling(registration);
    if (registration?.waiting) {
      dispatchPwaUpdateReady();
      if (isStandaloneDisplay()) {
        updateSW(true).catch(() => {
          // keep manual update fallback in the shell if auto-apply fails
        });
      }
    }
  },
  onNeedRefresh() {
    window.__octoWebApplyUpdate = updateSW;
    dispatchPwaUpdateReady();
    if (isStandaloneDisplay()) {
      updateSW(true).catch(() => {
        // keep manual update fallback in the shell if auto-apply fails
      });
    }
  },
});

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
}

const root = createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
