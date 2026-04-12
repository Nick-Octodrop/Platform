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
const root = createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
